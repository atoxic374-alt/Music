package config

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
)

type Config struct {
	Token            string   `json:"token"`
	Prefix           string   `json:"prefix"`
	OwnerID          string   `json:"owner_id"`
	OwnerIDs         []string `json:"owner_ids"`
	GuildID          string   `json:"guild_id"`
	AlertChannel     string   `json:"alert_channel"`
	DangerousPerms   int64    `json:"dangerous_perms"`
	DriftKickPercent float64  `json:"drift_kick_percent"`
}

func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, err
	}
	if cfg.Token == "" || cfg.GuildID == "" {
		return Config{}, errors.New("config must include token and guild_id")
	}
	if cfg.Prefix == "" {
		cfg.Prefix = "!"
	}
	if cfg.DriftKickPercent <= 0 {
		cfg.DriftKickPercent = 30
	}
	if cfg.DangerousPerms == 0 {
		cfg.DangerousPerms = 0x00000008 | 0x00000020 | 0x00000010 | 0x00000080 | 0x00000100 | 0x00000200
	}

	ownerSet := map[string]bool{}
	if cfg.OwnerID != "" {
		ownerSet[cfg.OwnerID] = true
	}
	for _, id := range cfg.OwnerIDs {
		id = strings.TrimSpace(id)
		if id != "" {
			ownerSet[id] = true
		}
	}
	cfg.OwnerIDs = cfg.OwnerIDs[:0]
	for id := range ownerSet {
		cfg.OwnerIDs = append(cfg.OwnerIDs, id)
	}
	if len(cfg.OwnerIDs) == 0 {
		return Config{}, errors.New("config must include owner_id or owner_ids")
	}
	return cfg, nil
}
