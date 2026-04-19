mod extractor;
mod ipv6_rotator;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use bytes::Bytes;
use extractor::{ExtractRequest, ExtractorRegistry};
use ipv6_rotator::Ipv6Rotator;
use serde::{Deserialize, Serialize};
use std::{collections::VecDeque, net::SocketAddr, sync::Arc};
use tokio::sync::Mutex;

#[derive(Clone)]
struct NodeState {
    jitter_buffer: Arc<Mutex<VecDeque<Bytes>>>,
    rotator: Arc<Ipv6Rotator>,
    extractors: Arc<ExtractorRegistry>,
    manager_token: Arc<String>,
}

impl Default for NodeState {
    fn default() -> Self {
        Self {
            jitter_buffer: Arc::new(Mutex::new(VecDeque::new())),
            rotator: Arc::new(Ipv6Rotator::new("2001:db8::/64").expect("valid cidr")),
            extractors: Arc::new(ExtractorRegistry::default_registry()),
            manager_token: Arc::new("change-me".to_string()),
        }
    }
}

#[derive(Deserialize)]
struct PushPacket {
    payload: Vec<u8>,
    opus_direct: bool,
}

#[derive(Serialize)]
struct PushAck {
    queue_depth: usize,
    mode: &'static str,
}

#[derive(Serialize)]
struct FetchAck {
    source_ip: String,
    stream_url: String,
    codec: String,
    extractor: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let state = NodeState::default();
    let app = Router::new()
        .route("/v1/audio/push", post(push_audio_packet))
        .route("/v1/audio/fetch", post(fetch_source))
        .route("/v1/health", post(health))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8081));
    tracing::info!("audio-node listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

async fn push_audio_packet(
    State(state): State<NodeState>,
    headers: HeaderMap,
    Json(packet): Json<PushPacket>,
) -> Result<Json<PushAck>, StatusCode> {
    authenticate_manager(&headers, &state.manager_token)?;

    let bytes = Bytes::from(packet.payload);
    let mut queue = state.jitter_buffer.lock().await;
    queue.push_back(bytes);
    while queue.len() > 50 {
        queue.pop_front();
    }

    Ok(Json(PushAck {
        queue_depth: queue.len(),
        mode: if packet.opus_direct { "opus-pass" } else { "transcode" },
    }))
}

async fn fetch_source(
    State(state): State<NodeState>,
    headers: HeaderMap,
    Json(request): Json<ExtractRequest>,
) -> Result<Json<FetchAck>, StatusCode> {
    authenticate_manager(&headers, &state.manager_token)?;

    let selected_ip = state.rotator.next_ip();
    let extracted = state
        .extractors
        .resolve(&request)
        .map_err(|_| StatusCode::UNPROCESSABLE_ENTITY)?;

    Ok(Json(FetchAck {
        source_ip: selected_ip.to_string(),
        stream_url: extracted.stream_url,
        codec: extracted.codec,
        extractor: extracted.plugin,
    }))
}

fn authenticate_manager(headers: &HeaderMap, token: &str) -> Result<(), StatusCode> {
    let provided = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();

    if provided == format!("Bearer {token}") {
        Ok(())
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn health() -> Json<&'static str> {
    Json("ok")
}
