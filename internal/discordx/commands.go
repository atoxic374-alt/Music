package discordx

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"

	"musicguard/internal/engine"
)

type CommandRouter struct {
	protector *engine.Protector
	prefix    string
}

func NewCommandRouter(p *engine.Protector, prefix string) *CommandRouter {
	return &CommandRouter{protector: p, prefix: prefix}
}

func (r *CommandRouter) OnMessageCreate(s *discordgo.Session, m *discordgo.MessageCreate) {
	if m.Author == nil || m.Author.Bot || m.GuildID == "" {
		return
	}
	if !strings.HasPrefix(m.Content, r.prefix) {
		return
	}
	if !r.protector.IsOwner(m.Author.ID) {
		_, _ = s.ChannelMessageSendReply(m.ChannelID, "هذا الأمر متاح فقط لأونرات البوت.", m.Reference())
		return
	}

	parts := strings.Fields(strings.TrimPrefix(m.Content, r.prefix))
	if len(parts) == 0 {
		return
	}
	cmd := strings.ToLower(parts[0])
	args := parts[1:]

	switch cmd {
	case "protect":
		r.handleProtect(s, m)
	case "backup":
		r.handleBackup(s, m)
	case "protect-user":
		r.handleProtectUserPanel(s, m)
	case "trust":
		r.handleTrust(s, m, args)
	case "untrust":
		r.handleUntrust(s, m, args)
	default:
		_, _ = s.ChannelMessageSendReply(m.ChannelID, "أمر غير معروف.", m.Reference())
	}
}

func (r *CommandRouter) OnInteraction(s *discordgo.Session, i *discordgo.InteractionCreate) {
	if i.Type != discordgo.InteractionMessageComponent {
		return
	}
	custom := i.MessageComponentData().CustomID
	if strings.HasPrefix(custom, "restore_roles:") {
		if i.Member == nil || !r.protector.IsOwner(i.Member.User.ID) {
			r.respondComponent(s, i, "هذا الزر متاح فقط لأونرات البوت.")
			return
		}
		targetID := strings.TrimPrefix(custom, "restore_roles:")
		if err := r.protector.RestoreMemberRoles(context.Background(), targetID); err != nil {
			r.respondComponent(s, i, "تعذر الاستعادة: "+err.Error())
			return
		}
		r.respondComponent(s, i, "✅ تمت محاولة استعادة رولات الشخص من النسخة.")
		return
	}
	switch custom {
	case "trusted:add":
		r.respondComponent(s, i, "استخدم الأمر: trust <userID>")
	case "trusted:remove":
		r.respondComponent(s, i, "استخدم الأمر: untrust <userID>")
	case "trusted:refresh":
		r.refreshTrustedPanel(s, i)
	default:
		r.respondComponent(s, i, "زر غير معروف")
	}
}

func (r *CommandRouter) handleProtect(s *discordgo.Session, m *discordgo.MessageCreate) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if err := r.protector.CaptureSnapshot(ctx); err != nil {
		_, _ = s.ChannelMessageSendReply(m.ChannelID, "فشل أخذ النسخة: "+err.Error(), m.Reference())
		return
	}
	if err := r.protector.SaveSnapshot("data/snapshot.json"); err != nil {
		_, _ = s.ChannelMessageSendReply(m.ChannelID, "فشل حفظ النسخة: "+err.Error(), m.Reference())
		return
	}
	_, _ = s.ChannelMessageSendReply(m.ChannelID, "✅ تم تفعيل الحماية وحفظ النسخة الأساسية.", m.Reference())
}

func (r *CommandRouter) handleBackup(s *discordgo.Session, m *discordgo.MessageCreate) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if err := r.protector.LoadSnapshot("data/snapshot.json"); err != nil {
		_, _ = s.ChannelMessageSendReply(m.ChannelID, "فشل تحميل النسخة: "+err.Error(), m.Reference())
		return
	}
	if err := r.protector.Reconcile(ctx); err != nil {
		_, _ = s.ChannelMessageSendReply(m.ChannelID, "⚠️ تمت المزامنة مع أخطاء جزئية: "+err.Error(), m.Reference())
		return
	}
	_, _ = s.ChannelMessageSendReply(m.ChannelID, "✅ تم تطبيق الفروقات من النسخة بدون حذف شامل.", m.Reference())
}

func (r *CommandRouter) handleProtectUserPanel(s *discordgo.Session, m *discordgo.MessageCreate) {
	embed := r.TrustedEmbed(r.protector.TrustedUsers(), s.State.User.AvatarURL("512"))
	components := []discordgo.MessageComponent{
		discordgo.ActionsRow{Components: []discordgo.MessageComponent{
			discordgo.Button{CustomID: "trusted:add", Label: "إضافة موثوق", Style: discordgo.PrimaryButton},
			discordgo.Button{CustomID: "trusted:remove", Label: "إزالة موثوق", Style: discordgo.DangerButton},
			discordgo.Button{CustomID: "trusted:refresh", Label: "تحديث", Style: discordgo.SecondaryButton},
		}},
	}
	_, _ = s.ChannelMessageSendComplex(m.ChannelID, &discordgo.MessageSend{Embed: embed, Components: components, Reference: m.Reference()})
}

func (r *CommandRouter) handleTrust(s *discordgo.Session, m *discordgo.MessageCreate, args []string) {
	if len(args) == 0 {
		_, _ = s.ChannelMessageSendReply(m.ChannelID, "استخدم: trust <userID>", m.Reference())
		return
	}
	id := strings.Trim(args[0], "<@!>")
	r.protector.AddTrustedUser(id)
	_ = r.protector.SaveSnapshot("data/snapshot.json")
	_, _ = s.ChannelMessageSendReply(m.ChannelID, "✅ تمت إضافة المستخدم إلى الموثوقين.", m.Reference())
}

func (r *CommandRouter) handleUntrust(s *discordgo.Session, m *discordgo.MessageCreate, args []string) {
	if len(args) == 0 {
		_, _ = s.ChannelMessageSendReply(m.ChannelID, "استخدم: untrust <userID>", m.Reference())
		return
	}
	id := strings.Trim(args[0], "<@!>")
	r.protector.RemoveTrustedUser(id)
	_ = r.protector.SaveSnapshot("data/snapshot.json")
	_, _ = s.ChannelMessageSendReply(m.ChannelID, "✅ تمت إزالة المستخدم من الموثوقين.", m.Reference())
}

func (r *CommandRouter) TrustedEmbed(trusted []string, avatarURL string) *discordgo.MessageEmbed {
	list := "- لا يوجد"
	if len(trusted) > 0 {
		rows := make([]string, 0, len(trusted))
		for _, id := range trusted {
			rows = append(rows, "<@"+id+">")
		}
		list = "- " + strings.Join(rows, "\n- ")
	}
	return &discordgo.MessageEmbed{
		Title:       "Protect User",
		Description: fmt.Sprintf("قائمة الموثوقين:\n%s", list),
		Color:       0x5865F2,
		Thumbnail:   &discordgo.MessageEmbedThumbnail{URL: avatarURL},
		Timestamp:   time.Now().Format(time.RFC3339),
	}
}

func (r *CommandRouter) refreshTrustedPanel(s *discordgo.Session, i *discordgo.InteractionCreate) {
	embed := r.TrustedEmbed(r.protector.TrustedUsers(), s.State.User.AvatarURL("512"))
	_ = s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseUpdateMessage,
		Data: &discordgo.InteractionResponseData{Embeds: []*discordgo.MessageEmbed{embed}},
	})
}

func (r *CommandRouter) respondComponent(s *discordgo.Session, i *discordgo.InteractionCreate, msg string) {
	_ = s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{Content: msg, Flags: discordgo.MessageFlagsEphemeral},
	})
}
