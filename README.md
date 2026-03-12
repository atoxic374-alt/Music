# Music

Discord multi-bot music controller with token/subscription management and Lavalink playback.

## ✅ Production baseline (applied)

This repository is now aligned to your requested production baseline:

1) **Redis/Postgres instead of JSON**
- Default `storage.provider` is now `redis`.
- Postgres is also supported as a backend option.
- JSON is still supported only as a fallback/testing mode, not recommended for scale.

2) **Multiple Lavalink nodes**
- Config now ships with **3 node slots** (main-1/main-2/main-3).
- Runtime already performs best-node selection based on load.

3) **Shards by default**
- `npm start` now runs shard manager mode.
- Single-process mode is still available via `npm run start:single`.

4) **Metrics + periodic tuning**
- `/metrics` includes runtime counters and current boot tuning values.
- Auto-tune loop periodically adjusts startup concurrency/delay based on CPU/memory pressure.

## ✅ Fixes for known slowdown risks
- Large-scale JSON IO contention: mitigated by defaulting to Redis/Postgres.
- Single Lavalink bottleneck: mitigated by multi-node configuration.
- No observability/autoscaling signals: mitigated with `/healthz` + `/metrics` + auto-tune counters.
- Weak VPS/CPU versus high bot count: mitigated by adaptive boot throttle and reduced gateway/cache load.

## Audio quality / clarity improvements
- High-clarity EQ profile remains enabled.
- Safer volume cap via `audio.strictVolumeCap` to reduce clipping/distortion.
- Playback filters are preserved with low-overhead runtime settings.

## HTTP endpoints
- `/healthz` → basic liveness + memory
- `/metrics` → Prometheus-style counters

## Scripts
- `npm start` → sharding mode (recommended)
- `npm run start:single` → single process mode
- `npm run start:shards` → explicit sharding mode
- `npm run storage:migrate` → migrate JSON data to selected backend

## Recommended deployment profile
- `storage.provider=redis`
- 3+ Lavalink nodes
- shard mode enabled
- monitor `/metrics` in Prometheus/Grafana
- keep compliance mode enabled for public deployments


## Environment token
- Use only one env variable for bot login: `DISCORD_TOKEN`.
- Keep `.env` consistent and remove old/duplicate token variable names.
