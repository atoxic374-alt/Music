package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/bwmarrin/discordgo"

	"musicguard/internal/config"
	"musicguard/internal/discordx"
	"musicguard/internal/engine"
)

func main() {
	cfg, err := config.Load("config.json")
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	_ = os.MkdirAll("data", 0o755)
	s, err := discordgo.New("Bot " + cfg.Token)
	if err != nil {
		log.Fatalf("new session: %v", err)
	}
	s.Identify.Intents = discordgo.IntentsGuilds | discordgo.IntentsGuildMembers | discordgo.IntentsGuildMessages

	protector := engine.NewProtector(s, cfg.GuildID, cfg.DangerousPerms, cfg.DriftKickPercent, cfg.OwnerIDs)
	protector.InitPersistentState()
	router := discordx.NewCommandRouter(protector, cfg.Prefix)

	s.AddHandler(func(_ *discordgo.Session, r *discordgo.Ready) {
		log.Printf("ready as %s", r.User.String())
	})

	s.AddHandler(router.OnMessageCreate)
	s.AddHandler(router.OnInteraction)

	s.AddHandler(func(_ *discordgo.Session, ev *discordgo.ChannelDelete) {
		handleGuardEvent(protector, fmt.Sprintf("channel_delete|%s|%s", ev.ID, ev.Name))
	})
	s.AddHandler(func(_ *discordgo.Session, ev *discordgo.ChannelCreate) {
		handleGuardEvent(protector, fmt.Sprintf("channel_create|%s|%s", ev.ID, ev.Name))
	})
	s.AddHandler(func(_ *discordgo.Session, ev *discordgo.ChannelUpdate) {
		handleGuardEvent(protector, fmt.Sprintf("channel_update|%s|%s", ev.ID, ev.Name))
	})
	s.AddHandler(func(_ *discordgo.Session, ev *discordgo.GuildRoleDelete) {
		handleGuardEvent(protector, fmt.Sprintf("role_delete|%s|%s", ev.RoleID, ev.Role.Name))
	})
	s.AddHandler(func(_ *discordgo.Session, ev *discordgo.GuildRoleCreate) {
		handleGuardEvent(protector, fmt.Sprintf("role_create|%s|%s", ev.Role.ID, ev.Role.Name))
	})
	s.AddHandler(func(_ *discordgo.Session, ev *discordgo.GuildRoleUpdate) {
		handleGuardEvent(protector, fmt.Sprintf("role_update|%s|%s", ev.Role.ID, ev.Role.Name))
	})
	s.AddHandler(func(_ *discordgo.Session, ev *discordgo.GuildUpdate) { handleGuardEvent(protector, "guild_update||") })
	s.AddHandler(func(_ *discordgo.Session, ev *discordgo.GuildMemberUpdate) {
		if ev.User != nil {
			_ = protector.EnforceBlockedMemberDangerousRoles(context.Background(), ev.User.ID)
		}
	})

	if err := s.Open(); err != nil {
		log.Fatalf("open session: %v", err)
	}
	defer s.Close()

	if err := protector.LoadSnapshot("data/snapshot.json"); err != nil {
		log.Printf("no saved baseline loaded yet: %v", err)
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
}

func handleGuardEvent(p *engine.Protector, reason string) {
	ctx := context.Background()
	actorID := fetchLastActor(p, reason)
	roleTargets, channelTargets := engine.TargetsFromReason(reason)
	_ = p.HandleSuspiciousChange(ctx, actorID, reason, roleTargets, channelTargets)
}

func fetchLastActor(p *engine.Protector, reason string) string {
	parts := strings.Split(reason, "|")
	kind := ""
	targetID := ""
	if len(parts) >= 2 {
		kind = parts[0]
		targetID = parts[1]
	}

	entries, err := p.Session().GuildAuditLog(p.GuildID(), "", "", 0, 20)
	if err != nil || len(entries.AuditLogEntries) == 0 {
		return ""
	}
	for _, e := range entries.AuditLogEntries {
		if targetID != "" && e.TargetID != targetID {
			continue
		}
		if kind == "" {
			return e.UserID
		}
		if strings.HasPrefix(kind, "channel_") && strings.Contains(strings.ToLower(e.ActionType.String()), "channel") {
			return e.UserID
		}
		if strings.HasPrefix(kind, "role_") && strings.Contains(strings.ToLower(e.ActionType.String()), "role") {
			return e.UserID
		}
		if strings.HasPrefix(kind, "guild_") {
			return e.UserID
		}
	}
	return entries.AuditLogEntries[0].UserID
}
