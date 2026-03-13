package model

import "time"

type GuildSnapshot struct {
	GuildID       string                 `json:"guild_id"`
	CapturedAt    time.Time              `json:"captured_at"`
	Roles         []RoleState            `json:"roles"`
	Channels      []ChannelState         `json:"channels"`
	Emojis        []EmojiState           `json:"emojis"`
	TrustedUsers  map[string]bool        `json:"trusted_users"`
	TrustedBots   map[string]bool        `json:"trusted_bots"`
	MemberRoles   map[string][]string    `json:"member_roles"`
	GuildSettings map[string]interface{} `json:"guild_settings"`
}

type RoleState struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Color       int    `json:"color"`
	Position    int    `json:"position"`
	Permissions int64  `json:"permissions"`
	Managed     bool   `json:"managed"`
	Mentionable bool   `json:"mentionable"`
	Hoist       bool   `json:"hoist"`
}

type OverwriteState struct {
	ID    string `json:"id"`
	Type  string `json:"type"`
	Allow int64  `json:"allow"`
	Deny  int64  `json:"deny"`
}

type ChannelState struct {
	ID         string           `json:"id"`
	Name       string           `json:"name"`
	Type       int              `json:"type"`
	Position   int              `json:"position"`
	ParentID   string           `json:"parent_id"`
	Topic      string           `json:"topic"`
	NSFW       bool             `json:"nsfw"`
	Overwrites []OverwriteState `json:"overwrites"`
}

type EmojiState struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
