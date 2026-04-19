#!/usr/bin/env bash
set -euo pipefail

echo "[1/7] Go baseline checks"
go test ./...

echo "[2/7] Gateway Proxy build"
(cd gateway-proxy && go test ./...)

echo "[3/7] Manager build"
(dotnet build manager/Manager.sln -c Release)

echo "[4/7] Rust node checks"
(cd rust-node && cargo test)

echo "[5/7] Rust criterion benchmark"
(cd rust-node && cargo bench --bench packet_pipeline)

echo "[6/7] Packet-loss / jitter test suggestion"
echo "sudo tc qdisc add dev eth0 root netem delay 80ms 20ms loss 2%"

echo "[7/7] 1000-bot stress suggestion"
echo "k6 run scripts/k6-voice-stress.js"
