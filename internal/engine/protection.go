package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/bwmarrin/discordgo"

	"musicguard/internal/model"
)

type Protector struct {
	s              *discordgo.Session
	guildID        string
	alertChannel   string
	workerCount    int
	dangerousPerms int64
	driftThreshold float64
	owners         map[string]bool

	baselinePath string
	walPath      string

	mu            sync.RWMutex
	snapshot      model.GuildSnapshot
	resourceLocks sync.Map // map[string]*sync.Mutex
}

type WALRecord struct {
	At      time.Time `json:"at"`
	Type    string    `json:"type"`
	ActorID string    `json:"actor_id,omitempty"`
	Reason  string    `json:"reason,omitempty"`
}

func NewProtector(s *discordgo.Session, guildID, alertChannel string, workerCount int, dangerousPerms int64, driftThreshold float64, owners []string) *Protector {
	ownerMap := map[string]bool{}
	for _, id := range owners {
		ownerMap[id] = true
	}
	return &Protector{
		s:              s,
		guildID:        guildID,
		alertChannel:   alertChannel,
		workerCount:    workerCount,
		dangerousPerms: dangerousPerms,
		driftThreshold: driftThreshold,
		owners:         ownerMap,
		baselinePath:   "data/snapshot.json",
		walPath:        "data/events.log",
	}
}

func (p *Protector) Session() *discordgo.Session { return p.s }
func (p *Protector) GuildID() string             { return p.guildID }

func (p *Protector) IsOwner(userID string) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.owners[userID]
}

func (p *Protector) AddTrustedUser(userID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.snapshot.TrustedUsers == nil {
		p.snapshot.TrustedUsers = map[string]bool{}
	}
	p.snapshot.TrustedUsers[userID] = true
}

func (p *Protector) RemoveTrustedUser(userID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.snapshot.TrustedUsers, userID)
}

func (p *Protector) TrustedUsers() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]string, 0, len(p.snapshot.TrustedUsers))
	for id := range p.snapshot.TrustedUsers {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

func (p *Protector) CaptureSnapshot(ctx context.Context) error {
	_ = ctx
	g, err := p.s.State.Guild(p.guildID)
	if err != nil {
		g, err = p.s.Guild(p.guildID)
		if err != nil {
			return err
		}
	}

	snap := model.GuildSnapshot{
		GuildID:       p.guildID,
		CapturedAt:    time.Now().UTC(),
		TrustedUsers:  map[string]bool{},
		TrustedBots:   map[string]bool{},
		MemberRoles:   map[string][]string{},
		GuildSettings: map[string]interface{}{"name": g.Name, "verification_level": g.VerificationLevel, "icon": g.Icon},
	}

	for id := range p.owners {
		snap.TrustedUsers[id] = true
	}
	for _, r := range g.Roles {
		snap.Roles = append(snap.Roles, model.RoleState{ID: r.ID, Name: r.Name, Color: r.Color, Position: r.Position, Permissions: int64(r.Permissions), Managed: r.Managed, Mentionable: r.Mentionable, Hoist: r.Hoist})
	}
	for _, c := range g.Channels {
		snap.Channels = append(snap.Channels, model.ChannelState{ID: c.ID, Name: c.Name, Type: int(c.Type), Position: c.Position, ParentID: c.ParentID, Topic: c.Topic, NSFW: c.NSFW, Overwrites: snapshotOverwrites(c.PermissionOverwrites)})
	}
	for _, e := range g.Emojis {
		snap.Emojis = append(snap.Emojis, model.EmojiState{ID: e.ID, Name: e.Name})
	}
	for _, m := range g.Members {
		if m.User != nil && m.User.Bot {
			snap.TrustedBots[m.User.ID] = true
		}
		if m.User != nil {
			snap.MemberRoles[m.User.ID] = append([]string{}, m.Roles...)
		}
	}

	p.mu.Lock()
	if len(p.snapshot.TrustedUsers) > 0 {
		for id := range p.snapshot.TrustedUsers {
			snap.TrustedUsers[id] = true
		}
	}
	p.snapshot = snap
	p.mu.Unlock()
	return nil
}

func (p *Protector) SaveSnapshot(path string) error {
	if path == "" {
		path = p.baselinePath
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.snapshot.GuildID == "" {
		return errors.New("snapshot is empty")
	}
	data, err := json.MarshalIndent(p.snapshot, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func (p *Protector) LoadSnapshot(path string) error {
	if path == "" {
		path = p.baselinePath
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var snap model.GuildSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return err
	}
	p.mu.Lock()
	p.snapshot = snap
	for id := range p.owners {
		if p.snapshot.TrustedUsers == nil {
			p.snapshot.TrustedUsers = map[string]bool{}
		}
		p.snapshot.TrustedUsers[id] = true
	}
	p.mu.Unlock()
	return nil
}

func (p *Protector) appendWAL(record WALRecord) error {
	b, err := json.Marshal(record)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(p.walPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(b, '\n'))
	return err
}

func (p *Protector) withResourceLock(key string, fn func() error) error {
	v, _ := p.resourceLocks.LoadOrStore(key, &sync.Mutex{})
	m := v.(*sync.Mutex)
	m.Lock()
	defer m.Unlock()
	return fn()
}

func (p *Protector) Reconcile(ctx context.Context) error {
	return p.ReconcileTargets(ctx, nil, nil)
}

func (p *Protector) ReconcileTargets(ctx context.Context, roleTargets []string, channelTargets []string) error {
	p.mu.RLock()
	snap := p.snapshot
	p.mu.RUnlock()
	if snap.GuildID == "" {
		return errors.New("no snapshot available")
	}

	wantedRoles := make(map[string]bool)
	if len(roleTargets) == 0 {
		for _, r := range snap.Roles {
			wantedRoles[r.ID] = true
			wantedRoles[r.Name] = true
		}
	} else {
		for _, t := range roleTargets {
			if t != "" {
				wantedRoles[t] = true
			}
		}
	}
	wantedChannels := make(map[string]bool)
	if len(channelTargets) == 0 {
		for _, c := range snap.Channels {
			wantedChannels[c.ID] = true
			wantedChannels[c.Name] = true
		}
	} else {
		for _, t := range channelTargets {
			if t != "" {
				wantedChannels[t] = true
			}
		}
	}

	roles, _ := p.s.GuildRoles(p.guildID)
	roleByID := make(map[string]*discordgo.Role, len(roles))
	roleByName := make(map[string]*discordgo.Role, len(roles))
	for _, r := range roles {
		roleByID[r.ID] = r
		roleByName[r.Name] = r
	}
	channels, _ := p.s.GuildChannels(p.guildID)
	channelByID := make(map[string]*discordgo.Channel, len(channels))
	channelByName := make(map[string]*discordgo.Channel, len(channels))
	for _, c := range channels {
		channelByID[c.ID] = c
		channelByName[c.Name] = c
	}

	sem := make(chan struct{}, p.workerCount)
	errCh := make(chan error, len(snap.Roles)+len(snap.Channels)+4)
	var wg sync.WaitGroup
	run := func(fn func() error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case <-ctx.Done():
				return
			case sem <- struct{}{}:
			}
			defer func() { <-sem }()
			if err := fn(); err != nil {
				errCh <- err
			}
		}()
	}

	// Restore guild-level settings in parallel lane.
	run(func() error {
		name, _ := snap.GuildSettings["name"].(string)
		if name == "" {
			return nil
		}
		_, err := p.s.GuildEdit(p.guildID, name)
		return err
	})

	for _, target := range snap.Roles {
		t := target
		if len(roleTargets) > 0 && !wantedRoles[t.ID] && !wantedRoles[t.Name] {
			continue
		}
		run(func() error {
			return p.withResourceLock("role:"+t.ID, func() error {
				if t.Managed {
					return nil
				}
				current := roleByID[t.ID]
				if current == nil {
					current = roleByName[t.Name]
				}
				if current != nil {
					_, err := p.s.GuildRoleEdit(p.guildID, current.ID, t.Name, t.Color, t.Hoist, t.Permissions, t.Mentionable)
					return err
				}
				_, err := p.s.GuildRoleCreate(p.guildID, &discordgo.RoleParams{Name: t.Name, Color: &t.Color, Permissions: &t.Permissions, Mentionable: &t.Mentionable, Hoist: &t.Hoist})
				return err
			})
		})
	}

	// Phase 1: categories first + remap old category IDs to current IDs.
	categoryRemap := sync.Map{} // oldID -> currentID
	for _, target := range snap.Channels {
		t := target
		if discordgo.ChannelType(t.Type) != discordgo.ChannelTypeGuildCategory {
			continue
		}
		if len(channelTargets) > 0 && !wantedChannels[t.ID] && !wantedChannels[t.Name] {
			continue
		}
		run(func() error {
			return p.withResourceLock("channel:"+t.ID, func() error {
				current := channelByID[t.ID]
				if current == nil {
					current = channelByName[t.Name]
				}
				if current != nil {
					_, err := p.s.ChannelEditComplex(current.ID, &discordgo.ChannelEdit{Name: t.Name, Position: &t.Position, PermissionOverwrites: restoreOverwrites(t.Overwrites)})
					if err == nil {
						categoryRemap.Store(t.ID, current.ID)
					}
					return err
				}
				created, err := p.s.GuildChannelCreateComplex(p.guildID, discordgo.GuildChannelCreateData{Name: t.Name, Type: discordgo.ChannelTypeGuildCategory, Position: t.Position, PermissionOverwrites: restoreOverwrites(t.Overwrites)})
				if err == nil && created != nil {
					categoryRemap.Store(t.ID, created.ID)
				}
				return err
			})
		})
	}

	// Wait categories so children can use remapped parent IDs.
	wg.Wait()

	// Phase 2: non-category channels.
	for _, target := range snap.Channels {
		t := target
		if discordgo.ChannelType(t.Type) == discordgo.ChannelTypeGuildCategory {
			continue
		}
		if len(channelTargets) > 0 && !wantedChannels[t.ID] && !wantedChannels[t.Name] {
			continue
		}

		parentID := t.ParentID
		if mapped, ok := categoryRemap.Load(t.ParentID); ok {
			if mid, ok2 := mapped.(string); ok2 {
				parentID = mid
			}
		} else if existingParent := channelByID[t.ParentID]; existingParent != nil {
			parentID = existingParent.ID
		}

		run(func() error {
			return p.withResourceLock("channel:"+t.ID, func() error {
				current := channelByID[t.ID]
				if current == nil {
					current = channelByName[t.Name]
				}
				if current != nil {
					_, err := p.s.ChannelEditComplex(current.ID, &discordgo.ChannelEdit{Name: t.Name, Position: &t.Position, ParentID: parentID, Topic: t.Topic, NSFW: &t.NSFW, PermissionOverwrites: restoreOverwrites(t.Overwrites)})
					return err
				}
				_, err := p.s.GuildChannelCreateComplex(p.guildID, discordgo.GuildChannelCreateData{Name: t.Name, Type: discordgo.ChannelType(t.Type), ParentID: parentID, Topic: t.Topic, NSFW: t.NSFW, Position: t.Position, PermissionOverwrites: restoreOverwrites(t.Overwrites)})
				return err
			})
		})
	}

	wg.Wait()
	close(errCh)

	var joined error
	for err := range errCh {
		joined = errors.Join(joined, err)
	}
	return joined
}

func snapshotOverwrites(overwrites []*discordgo.PermissionOverwrite) []model.OverwriteState {
	if len(overwrites) == 0 {
		return nil
	}
	out := make([]model.OverwriteState, 0, len(overwrites))
	for _, ow := range overwrites {
		if ow == nil {
			continue
		}
		out = append(out, model.OverwriteState{ID: ow.ID, Type: ow.Type, Allow: ow.Allow, Deny: ow.Deny})
	}
	return out
}

func restoreOverwrites(overwrites []model.OverwriteState) []*discordgo.PermissionOverwrite {
	if len(overwrites) == 0 {
		return nil
	}
	out := make([]*discordgo.PermissionOverwrite, 0, len(overwrites))
	for _, ow := range overwrites {
		out = append(out, &discordgo.PermissionOverwrite{ID: ow.ID, Type: ow.Type, Allow: ow.Allow, Deny: ow.Deny})
	}
	return out
}

func (p *Protector) DiffPercent() (float64, error) {
	p.mu.RLock()
	snap := p.snapshot
	p.mu.RUnlock()
	if snap.GuildID == "" {
		return 0, errors.New("no snapshot available")
	}
	roles, err := p.s.GuildRoles(p.guildID)
	if err != nil {
		return 0, err
	}
	channels, err := p.s.GuildChannels(p.guildID)
	if err != nil {
		return 0, err
	}
	roleDelta := math.Abs(float64(len(roles) - len(snap.Roles)))
	chanDelta := math.Abs(float64(len(channels) - len(snap.Channels)))
	base := math.Max(1, float64(len(snap.Roles)+len(snap.Channels)))
	return ((roleDelta + chanDelta) / base) * 100, nil
}

func (p *Protector) HandleSuspiciousChange(ctx context.Context, actorID, reason string, roleTargets []string, channelTargets []string) error {
	if actorID == "" {
		return nil
	}
	if p.IsTrusted(actorID) {
		return p.RefreshBaselineFromTrustedChange(ctx, actorID, reason)
	}

	errCh := make(chan error, 8)
	var wg sync.WaitGroup
	run := func(fn func() error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := fn(); err != nil {
				errCh <- err
			}
		}()
	}

	run(func() error { return p.PunishActor(ctx, actorID, reason) })
	run(func() error { return p.StripDangerousRolesFromMember(ctx, actorID) })
	run(func() error { return p.ReconcileTargets(ctx, roleTargets, channelTargets) })
	run(func() error {
		drift, err := p.DiffPercent()
		if err != nil || drift < p.driftThreshold {
			return err
		}
		var inner sync.WaitGroup
		inner.Add(2)
		go func() { defer inner.Done(); _ = p.RemoveAdminFromAllRoles(ctx) }()
		go func() { defer inner.Done(); _ = p.BanUser(ctx, actorID, "mass destructive change") }()
		inner.Wait()
		return nil
	})

	wg.Wait()
	close(errCh)
	var joined error
	for err := range errCh {
		joined = errors.Join(joined, err)
	}
	_ = p.appendWAL(WALRecord{At: time.Now().UTC(), Type: "incident", ActorID: actorID, Reason: reason})
	return joined
}

func (p *Protector) RefreshBaselineFromTrustedChange(ctx context.Context, actorID, reason string) error {
	if err := p.CaptureSnapshot(ctx); err != nil {
		return err
	}
	if err := p.SaveSnapshot(""); err != nil {
		return err
	}
	_ = p.appendWAL(WALRecord{At: time.Now().UTC(), Type: "trusted_update", ActorID: actorID, Reason: reason})
	return nil
}

func (p *Protector) IsTrusted(userID string) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.snapshot.TrustedUsers[userID] || p.snapshot.TrustedBots[userID]
}

func (p *Protector) RemoveAdminFromAllRoles(ctx context.Context) error {
	roles, err := p.s.GuildRoles(p.guildID)
	if err != nil {
		return err
	}
	sem := make(chan struct{}, p.workerCount)
	var wg sync.WaitGroup
	for _, role := range roles {
		r := role
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case <-ctx.Done():
				return
			case sem <- struct{}{}:
			}
			defer func() { <-sem }()
			if int64(r.Permissions)&discordgo.PermissionAdministrator == 0 {
				return
			}
			_ = p.withResourceLock("role:"+r.ID, func() error {
				newPerms := int64(r.Permissions) &^ discordgo.PermissionAdministrator
				_, _ = p.s.GuildRoleEdit(p.guildID, r.ID, r.Name, r.Color, r.Hoist, newPerms, r.Mentionable)
				return nil
			})
		}()
	}
	wg.Wait()
	return nil
}

func (p *Protector) StripDangerousRolesFromMember(ctx context.Context, userID string) error {
	_ = ctx
	member, err := p.s.GuildMember(p.guildID, userID)
	if err != nil {
		return err
	}
	roles, err := p.s.GuildRoles(p.guildID)
	if err != nil {
		return err
	}
	rolePerms := map[string]int64{}
	for _, r := range roles {
		rolePerms[r.ID] = int64(r.Permissions)
	}
	for _, roleID := range member.Roles {
		if rolePerms[roleID]&p.dangerousPerms != 0 {
			_ = p.s.GuildMemberRoleRemove(p.guildID, userID, roleID)
		}
	}
	return nil
}

func (p *Protector) RestoreMemberRoles(ctx context.Context, userID string) error {
	_ = ctx
	p.mu.RLock()
	roles := append([]string{}, p.snapshot.MemberRoles[userID]...)
	p.mu.RUnlock()
	if len(roles) == 0 {
		return errors.New("no saved roles for this member")
	}
	return p.s.GuildMemberEdit(p.guildID, userID, &discordgo.GuildMemberParams{Roles: &roles})
}

func (p *Protector) BanUser(ctx context.Context, userID, reason string) error {
	_ = ctx
	return p.s.GuildBanCreateWithReason(p.guildID, userID, reason, 1)
}

func (p *Protector) PunishActor(ctx context.Context, userID string, reason string) error {
	_ = ctx
	if userID == "" || p.IsTrusted(userID) {
		return nil
	}
	member, err := p.s.GuildMember(p.guildID, userID)
	if err == nil {
		for _, roleID := range member.Roles {
			_ = p.s.GuildMemberRoleRemove(p.guildID, userID, roleID)
		}
	}
	if p.alertChannel != "" {
		embed := &discordgo.MessageEmbed{
			Title:       "Protection action",
			Description: fmt.Sprintf("User <@%s> changed the server and roles were removed.\nReason: %s", userID, reason),
			Color:       0x5865F2,
			Timestamp:   time.Now().Format(time.RFC3339),
		}
		components := []discordgo.MessageComponent{discordgo.ActionsRow{Components: []discordgo.MessageComponent{discordgo.Button{CustomID: "restore_roles:" + userID, Label: "استعادة رولات الشخص", Style: discordgo.SuccessButton}}}}
		_, _ = p.s.ChannelMessageSendComplex(p.alertChannel, &discordgo.MessageSend{Embed: embed, Components: components})
	}
	return nil
}

func TargetsFromReason(reason string) (roleTargets []string, channelTargets []string) {
	parts := strings.Split(reason, "|")
	if len(parts) < 3 {
		return nil, nil
	}
	typePart := parts[0]
	id := parts[1]
	name := parts[2]
	if strings.HasPrefix(typePart, "role") {
		return []string{id, name}, nil
	}
	if strings.HasPrefix(typePart, "channel") {
		return nil, []string{id, name}
	}
	return nil, nil
}
