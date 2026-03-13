package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
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

	protector := engine.NewProtector(s, cfg.GuildID, cfg.AlertChannel, cfg.DangerousPerms, cfg.DriftKickPercent, cfg.OwnerIDs)
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
	s.AddHandler(func(_ *discordgo.Session, ev *discordgo.GuildUpdate) { handleGuardEvent(protector, "guild_update|") })

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
	actorID := fetchLastActor(p)
	roleTargets, channelTargets := engine.TargetsFromReason(reason)
	_ = p.HandleSuspiciousChange(ctx, actorID, reason, roleTargets, channelTargets)
}

func fetchLastActor(p *engine.Protector) string {
	entries, err := p.Session().GuildAuditLog(p.GuildID(), "", "", 0, 1)
	if err != nil || len(entries.AuditLogEntries) == 0 {
		return ""
	}
	return entries.AuditLogEntries[0].UserID
}
