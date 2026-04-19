package main

import (
	"context"
	"fmt"
	"hash/fnv"
	"log"
	"net/http"
	"os"
	"sort"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

type proxyCluster struct {
	id    string
	redis *redis.Client
}

func main() {
	ctx := context.Background()
	redisAddr := getenv("REDIS_ADDR", "localhost:6379")
	proxyID := getenv("PROXY_ID", fmt.Sprintf("proxy-%d", time.Now().UnixNano()))

	cluster := proxyCluster{
		id: proxyID,
		redis: redis.NewClient(&redis.Options{
			Addr: redisAddr,
		}),
	}

	var connections int64
	go cluster.heartbeat(ctx)

	http.HandleFunc("/gateway", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		atomic.AddInt64(&connections, 1)
		defer func() {
			atomic.AddInt64(&connections, -1)
			_ = conn.Close()
		}()

		for {
			msgType, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if err = conn.WriteMessage(msgType, data); err != nil {
				return
			}
		}
	})

	http.HandleFunc("/cluster/route", func(w http.ResponseWriter, r *http.Request) {
		shardKey := r.URL.Query().Get("shard")
		if shardKey == "" {
			http.Error(w, "missing shard", http.StatusBadRequest)
			return
		}

		node, err := cluster.routeShard(ctx, shardKey)
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}

		_, _ = w.Write([]byte(node))
	})

	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("gateway_connections "))
		_, _ = w.Write([]byte(fmt.Sprintf("%d\n", atomic.LoadInt64(&connections))))
	})

	log.Printf("gateway-proxy %s listening on :8090", proxyID)
	log.Fatal(http.ListenAndServe(":8090", nil))
}

func (p proxyCluster) heartbeat(ctx context.Context) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		key := fmt.Sprintf("gateway:proxy:%s", p.id)
		_ = p.redis.Set(ctx, key, time.Now().UnixMilli(), 10*time.Second).Err()
	}
}

func (p proxyCluster) routeShard(ctx context.Context, shardKey string) (string, error) {
	keys, err := p.redis.Keys(ctx, "gateway:proxy:*").Result()
	if err != nil || len(keys) == 0 {
		return "", fmt.Errorf("no gateway proxies available")
	}

	nodes := make([]string, 0, len(keys))
	for _, k := range keys {
		nodes = append(nodes, k[len("gateway:proxy:"):])
	}
	sort.Strings(nodes)

	bestNode := ""
	bestScore := uint64(0)
	for _, node := range nodes {
		h := fnv.New64a()
		_, _ = h.Write([]byte(shardKey + ":" + node))
		score := h.Sum64()
		if bestNode == "" || score > bestScore {
			bestNode = node
			bestScore = score
		}
	}

	return bestNode, nil
}

func getenv(key string, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
