# Observability Plan (Prometheus + Grafana)

## Prometheus Targets

- `manager:8080/metrics`
- `audio-node:8081/metrics` (to be exported by node process or sidecar)
- `gateway-proxy:8090/metrics`

## Core Metrics

- `music_active_sessions`
- `music_node_rtt_ms`
- `music_node_packet_loss_percent`
- `gateway_connections`
- `music_commands_stream_lag`

## Grafana Dashboards

1. **Global Health**: nodes up/down + command throughput.
2. **Playback QoS**: jitter, packet loss, time-to-first-audio.
3. **Capacity**: memory per bot, cpu per node, gateway ws load.

## Alerts

- Packet loss > 5% for 3m.
- Time-to-first-audio > 100ms p95.
- Redis stream lag > 200 commands.
- Gateway proxy instances < minimum replica count.
