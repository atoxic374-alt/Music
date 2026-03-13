package engine

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net/http"
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
	dangerousPerms int64
	driftThreshold float64
	owners         map[string]bool

	baselinePath string
	walPath      string

	mu               sync.RWMutex
	snapshot         model.GuildSnapshot
	resourceLocks    sync.Map // map[string]*sync.Mutex
	alertMu          sync.RWMutex
	activeAlerts     map[string]bool
	blockedActors    map[string]bool
	activeAlertsPath string
	blockedPath      string
	metricsMu        sync.Mutex
	metrics          map[string]uint64

	protectionMu      sync.RWMutex
	protectionEnabled bool
}

type WALRecord struct {
	At      time.Time `json:"at"`
	Type    string    `json:"type"`
	ActorID string    `json:"actor_id,omitempty"`
	Reason  string    `json:"reason,omitempty"`
}

func NewProtector(s *discordgo.Session, guildID string, dangerousPerms int64, driftThreshold float64, owners []string) *Protector {
	ownerMap := map[string]bool{}
	for _, id := range owners {
		ownerMap[id] = true
	}
	return &Protector{
		s:                s,
		guildID:          guildID,
		dangerousPerms:   dangerousPerms,
		driftThreshold:   driftThreshold,
		owners:           ownerMap,
		baselinePath:     "data/snapshot.json",
		walPath:          "data/events.log",
		activeAlerts:     map[string]bool{},
		blockedActors:    map[string]bool{},
		activeAlertsPath: "data/active_alerts.json",
		blockedPath:      "data/blocked_actors.json",
		metrics:          map[string]uint64{},
	}
}

func (p *Protector) InitPersistentState() {
	_ = p.loadJSONFile(p.activeAlertsPath, &p.activeAlerts)
	_ = p.loadJSONFile(p.blockedPath, &p.blockedActors)
}

func (p *Protector) loadJSONFile(path string, out interface{}) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

func (p *Protector) saveJSONFile(path string, in interface{}) {
	data, err := json.Marshal(in)
	if err != nil {
		return
	}
	_ = os.WriteFile(path, data, 0o644)
}

func (p *Protector) incMetric(name string) {
	p.metricsMu.Lock()
	p.metrics[name]++
	p.metricsMu.Unlock()
}

func (p *Protector) withRetry(op string, fn func() error) error {
	_ = op
	var err error
	for i := 0; i < 5; i++ {
		err = fn()
		if err == nil {
			return nil
		}
		if !strings.Contains(strings.ToLower(err.Error()), "429") {
			return err
		}
		j := time.Duration(50+rand.Intn(120)) * time.Millisecond
		time.Sleep(time.Duration(1<<i)*100*time.Millisecond + j)
	}
	return err
}

func (p *Protector) IsBlockedActor(userID string) bool {
	p.alertMu.RLock()
	defer p.alertMu.RUnlock()
	return p.blockedActors[userID]
}

func (p *Protector) markBlockedActor(userID string) {
	p.alertMu.Lock()
	p.blockedActors[userID] = true
	cp := make(map[string]bool, len(p.blockedActors))
	for k, v := range p.blockedActors {
		cp[k] = v
	}
	p.alertMu.Unlock()
	p.saveJSONFile(p.blockedPath, cp)
}

func (p *Protector) EnableProtection() {
	p.protectionMu.Lock()
	p.protectionEnabled = true
	p.protectionMu.Unlock()
}

func (p *Protector) DisableProtection() {
	p.protectionMu.Lock()
	p.protectionEnabled = false
	p.protectionMu.Unlock()
}

func (p *Protector) IsProtectionEnabled() bool {
	p.protectionMu.RLock()
	defer p.protectionMu.RUnlock()
	return p.protectionEnabled
}

func (p *Protector) EnforceBlockedMemberDangerousRoles(ctx context.Context, userID string) error {
	if !p.IsBlockedActor(userID) {
		return nil
	}
	return p.StripDangerousRolesFromMember(ctx, userID)
}

func (p *Protector) Session() *discordgo.Session { return p.s }
func (p *Protector) GuildID() string             { return p.guildID }

func (p *Protector) IsOwner(userID string) bool {
	if userID == "" {
		return false
	}
	p.mu.RLock()
	isCfgOwner := p.owners[userID]
	p.mu.RUnlock()
	if isCfgOwner {
		return true
	}
	return p.serverOwnerID() == userID
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
		GuildID:      p.guildID,
		CapturedAt:   time.Now().UTC(),
		TrustedUsers: map[string]bool{},
		TrustedBots:  map[string]bool{},
		MemberRoles:  map[string][]string{},
		GuildSettings: map[string]interface{}{
			"name":                      g.Name,
			"verification_level":        g.VerificationLevel,
			"icon_hash":                 g.Icon,
			"banner_hash":               g.Banner,
			"description":               g.Description,
			"preferred_locale":          g.PreferredLocale,
			"afk_channel_id":            g.AfkChannelID,
			"afk_timeout":               g.AfkTimeout,
			"system_channel_id":         g.SystemChannelID,
			"rules_channel_id":          g.RulesChannelID,
			"public_updates_channel_id": g.PublicUpdatesChannelID,
		},
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

	if g.Icon != "" {
		if iconData, err := fetchCDNAssetAsDataURI(fmt.Sprintf("https://cdn.discordapp.com/icons/%s/%s.png?size=4096", g.ID, g.Icon)); err == nil && iconData != "" {
			snap.GuildSettings["icon_data"] = iconData
		}
	}
	if g.Banner != "" {
		if bannerData, err := fetchCDNAssetAsDataURI(fmt.Sprintf("https://cdn.discordapp.com/banners/%s/%s.png?size=4096", g.ID, g.Banner)); err == nil && bannerData != "" {
			snap.GuildSettings["banner_data"] = bannerData
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

	errCh := make(chan error, len(snap.Roles)+len(snap.Channels)+4)
	var wg sync.WaitGroup
	run := func(fn func() error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case <-ctx.Done():
				return
			default:
			}
			if err := fn(); err != nil {
				errCh <- err
			}
		}()
	}

	// Restore guild-level settings in parallel lane.
	run(func() error { return p.restoreGuildSettings(snap.GuildSettings) })

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

	var postWG sync.WaitGroup
	postWG.Add(2)
	go func() {
		defer postWG.Done()
		if err := p.reorderRolesFromSnapshot(snap, wantedRoles); err != nil {
			errCh <- err
		}
	}()
	go func() {
		defer postWG.Done()
		if err := p.reorderChannelsFromSnapshot(snap, wantedChannels); err != nil {
			errCh <- err
		}
	}()
	postWG.Wait()

	close(errCh)

	var joined error
	for err := range errCh {
		joined = errors.Join(joined, err)
	}
	return joined
}

func fetchCDNAssetAsDataURI(url string) (string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("asset fetch failed: %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if len(body) == 0 {
		return "", nil
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/png"
	}
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(body), nil
}

func (p *Protector) restoreGuildSettings(settings map[string]interface{}) error {
	if len(settings) == 0 {
		return nil
	}
	payload := map[string]interface{}{}
	if name, ok := settings["name"].(string); ok && name != "" {
		payload["name"] = name
	}
	if v, ok := settings["verification_level"]; ok {
		switch vv := v.(type) {
		case float64:
			payload["verification_level"] = int(vv)
		case int:
			payload["verification_level"] = vv
		}
	}
	for _, k := range []string{"description", "preferred_locale", "afk_channel_id", "system_channel_id", "rules_channel_id", "public_updates_channel_id"} {
		if v, ok := settings[k].(string); ok {
			payload[k] = v
		}
	}
	if v, ok := settings["afk_timeout"]; ok {
		switch vv := v.(type) {
		case float64:
			payload["afk_timeout"] = int(vv)
		case int:
			payload["afk_timeout"] = vv
		}
	}
	if iconData, ok := settings["icon_data"].(string); ok && iconData != "" {
		payload["icon"] = iconData
	}
	if bannerData, ok := settings["banner_data"].(string); ok && bannerData != "" {
		payload["banner"] = bannerData
	}
	if len(payload) == 0 {
		return nil
	}
	endpoint := discordgo.EndpointGuild(p.guildID)
	_, err := p.s.RequestWithBucketID("PATCH", endpoint, payload, endpoint)
	return err
}

func (p *Protector) reorderRolesFromSnapshot(snap model.GuildSnapshot, wantedRoles map[string]bool) error {
	roles, err := p.s.GuildRoles(p.guildID)
	if err != nil {
		return err
	}
	roleByID := make(map[string]*discordgo.Role, len(roles))
	roleByName := make(map[string]*discordgo.Role, len(roles))
	for _, r := range roles {
		roleByID[r.ID] = r
		roleByName[r.Name] = r
	}
	body := make([]map[string]interface{}, 0, len(snap.Roles))
	for _, t := range snap.Roles {
		if len(wantedRoles) > 0 && !wantedRoles[t.ID] && !wantedRoles[t.Name] {
			continue
		}
		if t.Managed {
			continue
		}
		current := roleByID[t.ID]
		if current == nil {
			current = roleByName[t.Name]
		}
		if current == nil {
			continue
		}
		body = append(body, map[string]interface{}{"id": current.ID, "position": t.Position})
	}
	if len(body) == 0 {
		return nil
	}
	endpoint := discordgo.EndpointGuildRoles(p.guildID)
	_, err = p.s.RequestWithBucketID("PATCH", endpoint, body, endpoint)
	return err
}

func (p *Protector) reorderChannelsFromSnapshot(snap model.GuildSnapshot, wantedChannels map[string]bool) error {
	channels, err := p.s.GuildChannels(p.guildID)
	if err != nil {
		return err
	}
	channelByID := make(map[string]*discordgo.Channel, len(channels))
	channelByName := make(map[string]*discordgo.Channel, len(channels))
	for _, c := range channels {
		channelByID[c.ID] = c
		channelByName[c.Name] = c
	}
	resolvedParent := map[string]string{}
	for _, t := range snap.Channels {
		if discordgo.ChannelType(t.Type) != discordgo.ChannelTypeGuildCategory {
			continue
		}
		current := channelByID[t.ID]
		if current == nil {
			current = channelByName[t.Name]
		}
		if current != nil {
			resolvedParent[t.ID] = current.ID
		}
	}
	body := make([]map[string]interface{}, 0, len(snap.Channels))
	for _, t := range snap.Channels {
		if len(wantedChannels) > 0 && !wantedChannels[t.ID] && !wantedChannels[t.Name] {
			continue
		}
		current := channelByID[t.ID]
		if current == nil {
			current = channelByName[t.Name]
		}
		if current == nil {
			continue
		}
		item := map[string]interface{}{"id": current.ID, "position": t.Position}
		if discordgo.ChannelType(t.Type) != discordgo.ChannelTypeGuildCategory {
			if pid, ok := resolvedParent[t.ParentID]; ok {
				item["parent_id"] = pid
			} else if t.ParentID == "" {
				item["parent_id"] = nil
			}
		}
		body = append(body, item)
	}
	if len(body) == 0 {
		return nil
	}
	endpoint := discordgo.EndpointGuildChannels(p.guildID)
	_, err = p.s.RequestWithBucketID("PATCH", endpoint, body, endpoint)
	return err
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
	p.incMetric("incident_total")
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
	p.incMetric("trusted_update_total")
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
	var wg sync.WaitGroup
	for _, role := range roles {
		r := role
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case <-ctx.Done():
				return
			default:
			}
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
			_ = p.withRetry("dangerous_role_remove", func() error { return p.s.GuildMemberRoleRemove(p.guildID, userID, roleID) })
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
	return p.withRetry("member_edit", func() error {
		return p.s.GuildMemberEdit(p.guildID, userID, &discordgo.GuildMemberParams{Roles: &roles})
	})
}

func (p *Protector) BanUser(ctx context.Context, userID, reason string) error {
	_ = ctx
	return p.withRetry("ban", func() error { return p.s.GuildBanCreateWithReason(p.guildID, userID, reason, 1) })
}

func (p *Protector) alertKey(actorID, reason string) string { return actorID + "|" + reason }

func (p *Protector) acquireAlert(actorID, reason string) bool {
	key := p.alertKey(actorID, reason)
	p.alertMu.Lock()
	if p.activeAlerts[key] {
		p.alertMu.Unlock()
		return false
	}
	p.activeAlerts[key] = true
	cp := make(map[string]bool, len(p.activeAlerts))
	for k, v := range p.activeAlerts {
		cp[k] = v
	}
	p.alertMu.Unlock()
	p.saveJSONFile(p.activeAlertsPath, cp)
	return true
}

func (p *Protector) ResolveAlert(actorID string) {
	p.alertMu.Lock()
	for key := range p.activeAlerts {
		if strings.HasPrefix(key, actorID+"|") {
			delete(p.activeAlerts, key)
		}
	}
	cp := make(map[string]bool, len(p.activeAlerts))
	for k, v := range p.activeAlerts {
		cp[k] = v
	}
	p.alertMu.Unlock()
	p.saveJSONFile(p.activeAlertsPath, cp)
}

func (p *Protector) serverOwnerID() string {
	g, err := p.s.State.Guild(p.guildID)
	if err == nil && g.OwnerID != "" {
		return g.OwnerID
	}
	g, err = p.s.Guild(p.guildID)
	if err == nil {
		return g.OwnerID
	}
	return ""
}

func (p *Protector) PunishActor(ctx context.Context, userID string, reason string) error {
	_ = ctx
	if userID == "" || p.IsTrusted(userID) {
		return nil
	}

	member, err := p.s.GuildMember(p.guildID, userID)
	removedAny := false
	if err == nil {
		for _, roleID := range member.Roles {
			if remErr := p.withRetry("role_remove", func() error { return p.s.GuildMemberRoleRemove(p.guildID, userID, roleID) }); remErr == nil {
				removedAny = true
			}
		}
	}
	p.markBlockedActor(userID)

	if !p.acquireAlert(userID, reason) {
		return nil
	}

	ownerID := p.serverOwnerID()
	if ownerID == "" {
		return nil
	}
	var dm *discordgo.Channel
	err = p.withRetry("dm_create", func() error {
		var e error
		dm, e = p.s.UserChannelCreate(ownerID)
		return e
	})
	if err != nil || dm == nil {
		return nil
	}

	desc := fmt.Sprintf("User <@%s> changed the server.\nReason: %s", userID, reason)
	if removedAny {
		desc += "\nAction: roles removed successfully."
	} else {
		desc += "\nAction: unable to remove roles (user may be equal/higher than bot or no removable roles)."
	}
	embed := &discordgo.MessageEmbed{Title: "Protection action", Description: desc, Color: 0x5865F2, Timestamp: time.Now().Format(time.RFC3339)}

	if removedAny {
		components := []discordgo.MessageComponent{discordgo.ActionsRow{Components: []discordgo.MessageComponent{discordgo.Button{CustomID: "restore_roles:" + userID, Label: "استعادة رولات الشخص", Style: discordgo.SuccessButton}}}}
		_ = p.withRetry("dm_send_complex", func() error {
			_, e := p.s.ChannelMessageSendComplex(dm.ID, &discordgo.MessageSend{Embed: embed, Components: components})
			return e
		})
		return nil
	}
	_ = p.withRetry("dm_send_embed", func() error { _, e := p.s.ChannelMessageSendEmbed(dm.ID, embed); return e })
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
