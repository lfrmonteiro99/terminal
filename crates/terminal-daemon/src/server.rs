use crate::daemon_context::ClientId;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::Response,
    routing::any,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use terminal_core::protocol::v1::{AppCommand, AppEvent};
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::{error, info, warn};
use uuid::Uuid;

pub struct DaemonState {
    pub auth_token: String,
    pub event_tx: broadcast::Sender<String>,
    pub command_tx: mpsc::Sender<(ClientId, AppCommand, mpsc::Sender<AppEvent>)>,
    /// Shared with `DaemonContext` so the WS handler can scrub a client's
    /// entry on disconnect (M5b, issue #100).
    pub active_workspaces: Arc<Mutex<HashMap<Uuid, Uuid>>>,
}

pub fn build_router(state: Arc<DaemonState>) -> Router {
    Router::new()
        .route("/ws", any(ws_handler))
        .with_state(state)
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<DaemonState>>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

/// Serialize an event, returning a fallback error JSON on failure.
fn event_json(event: &AppEvent) -> String {
    serde_json::to_string(event).unwrap_or_else(|e| {
        format!(r#"{{"type":"Error","code":"SERIALIZATION","message":"{}"}}"#, e)
    })
}

async fn handle_socket(socket: WebSocket, state: Arc<DaemonState>) {
    let client_id = ClientId::new();
    let (mut sender, mut receiver) = socket.split();
    info!("New WebSocket connection ({:?}), awaiting auth...", client_id);

    // Step 1: Auth handshake — first message must be Auth command
    let authed = match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        receiver.next(),
    )
    .await
    {
        Ok(Some(Ok(Message::Text(text)))) => {
            info!("Auth message received: {}", &*text);
            match serde_json::from_str::<AppCommand>(&*text) {
                Ok(AppCommand::Auth { token }) if token == state.auth_token => {
                    let resp = event_json(&AppEvent::AuthSuccess);
                    let _ = sender.send(Message::Text(resp.into())).await;
                    true
                }
                Ok(AppCommand::Auth { .. }) => {
                    warn!("Auth failed: token mismatch");
                    let resp = event_json(&AppEvent::AuthFailed {
                        reason: "Invalid token".into(),
                    });
                    let _ = sender.send(Message::Text(resp.into())).await;
                    false
                }
                Ok(other) => {
                    warn!("Auth failed: expected Auth command, got {:?}", other);
                    let resp = event_json(&AppEvent::AuthFailed {
                        reason: "Expected Auth command".into(),
                    });
                    let _ = sender.send(Message::Text(resp.into())).await;
                    false
                }
                Err(e) => {
                    warn!("Auth failed: could not parse message: {}", e);
                    let resp = event_json(&AppEvent::AuthFailed {
                        reason: "Invalid token".into(),
                    });
                    let _ = sender.send(Message::Text(resp.into())).await;
                    false
                }
            }
        }
        Ok(Some(Ok(other))) => {
            warn!("Auth failed: expected Text message, got {:?}", other);
            false
        }
        Ok(Some(Err(e))) => {
            warn!("Auth failed: WebSocket error: {}", e);
            false
        }
        Ok(None) => {
            warn!("Auth failed: connection closed before auth");
            false
        }
        Err(_) => {
            warn!("Auth failed: 10s timeout");
            false
        }
    };

    if !authed {
        info!("Client failed auth, disconnecting");
        return;
    }
    info!("Client authenticated");

    // Step 2: Subscribe to broadcast events
    let mut event_rx = state.event_tx.subscribe();

    // Heartbeat timeout: read from env, default 90 s (issue #112).
    let heartbeat_timeout_secs: u64 = std::env::var("TERMINAL_HEARTBEAT_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(90);

    // Shared last-pong timestamp: updated by recv loop, checked by send task.
    let last_pong_at = Arc::new(Mutex::new(Instant::now()));
    let last_pong_at_send = last_pong_at.clone();

    // Step 3: Sender task — forwards broadcast events + heartbeat pings
    let sender = Arc::new(Mutex::new(sender));
    let sender_clone = sender.clone();

    let send_task = tokio::spawn(async move {
        let ping_interval_secs = 30u64;
        let mut heartbeat_interval =
            tokio::time::interval(std::time::Duration::from_secs(ping_interval_secs));

        loop {
            tokio::select! {
                event = event_rx.recv() => {
                    match event {
                        Ok(msg) => {
                            let mut s = sender_clone.lock().await;
                            if s.send(Message::Text(msg.into())).await.is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                _ = heartbeat_interval.tick() => {
                    // Check if the client has responded to pings within the timeout window.
                    let elapsed = last_pong_at_send.lock().await.elapsed();
                    if elapsed.as_secs() > heartbeat_timeout_secs {
                        warn!(
                            "Heartbeat timeout: no pong received in {}s, disconnecting",
                            elapsed.as_secs()
                        );
                        break;
                    }
                    let mut s = sender_clone.lock().await;
                    if s.send(Message::Ping(vec![].into())).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Step 4: Receiver task — process incoming commands
    let (response_tx, mut response_rx) = mpsc::channel::<AppEvent>(32);
    let sender_clone2 = sender.clone();

    // Forward individual responses back to this client
    let response_task = tokio::spawn(async move {
        while let Some(event) = response_rx.recv().await {
            let msg = event_json(&event);
            let mut s = sender_clone2.lock().await;
            if s.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                match serde_json::from_str::<AppCommand>(&text) {
                    Ok(AppCommand::Ping) => {
                        let pong = event_json(&AppEvent::Pong);
                        let mut s = sender.lock().await;
                        let _ = s.send(Message::Text(pong.into())).await;
                    }
                    Ok(cmd) => {
                        let cmd = cmd.sanitize();
                        if let Err(e) = state.command_tx.send((client_id, cmd, response_tx.clone())).await {
                            error!("Failed to forward command: {}", e);
                        }
                    }
                    Err(e) => {
                        warn!("Invalid command from client: {}", e);
                        let err = event_json(&AppEvent::Error {
                            code: "INVALID_COMMAND".into(),
                            message: e.to_string(),
                        });
                        let mut s = sender.lock().await;
                        let _ = s.send(Message::Text(err.into())).await;
                    }
                }
            }
            Ok(Message::Pong(_)) => {
                // Client responded to our ping — reset the timeout window.
                *last_pong_at.lock().await = Instant::now();
            }
            Ok(Message::Close(_)) => {
                info!("Client disconnected gracefully");
                break;
            }
            Err(e) => {
                warn!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    send_task.abort();
    response_task.abort();
    // M5b: scrub this client's active-workspace entry on disconnect.
    state.active_workspaces.lock().await.remove(&client_id.0);
    info!("Client connection closed ({:?})", client_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message as TungMessage;

    /// Spin up a test server with a known token.
    /// Returns (port, token).
    async fn start_test_server() -> (u16, String) {
        let token = "test-secret-token".to_string();
        let (event_tx, _) = broadcast::channel::<String>(16);
        // command_tx that simply drops all messages
        let (command_tx, _command_rx) =
            mpsc::channel::<(ClientId, AppCommand, mpsc::Sender<AppEvent>)>(16);

        let state = Arc::new(DaemonState {
            auth_token: token.clone(),
            event_tx,
            command_tx,
            active_workspaces: Arc::new(Mutex::new(HashMap::new())),
        });

        let router = build_router(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });

        (port, token)
    }

    async fn connect(port: u16) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
        let url = format!("ws://127.0.0.1:{}/ws", port);
        let (ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        ws
    }

    fn auth_msg(token: &str) -> TungMessage {
        let cmd = serde_json::to_string(&AppCommand::Auth { token: token.to_string() }).unwrap();
        TungMessage::Text(cmd.into())
    }

    async fn recv_text(ws: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>) -> String {
        loop {
            match ws.next().await.unwrap().unwrap() {
                TungMessage::Text(t) => return t.to_string(),
                TungMessage::Ping(_) | TungMessage::Pong(_) => continue,
                other => panic!("unexpected message: {:?}", other),
            }
        }
    }

    #[tokio::test]
    async fn auth_valid_token_succeeds() {
        let (port, token) = start_test_server().await;
        let mut ws = connect(port).await;

        ws.send(auth_msg(&token)).await.unwrap();
        let resp = recv_text(&mut ws).await;

        let event: serde_json::Value = serde_json::from_str(&resp).unwrap();
        assert_eq!(event["type"], "AuthSuccess", "expected AuthSuccess, got: {}", resp);
    }

    #[tokio::test]
    async fn auth_invalid_token_fails() {
        let (port, _) = start_test_server().await;
        let mut ws = connect(port).await;

        ws.send(auth_msg("wrong-token")).await.unwrap();
        let resp = recv_text(&mut ws).await;

        let event: serde_json::Value = serde_json::from_str(&resp).unwrap();
        assert_eq!(event["type"], "AuthFailed", "expected AuthFailed, got: {}", resp);
    }

    #[tokio::test]
    async fn auth_malformed_json_fails() {
        let (port, _) = start_test_server().await;
        let mut ws = connect(port).await;

        ws.send(TungMessage::Text("this is not json!!!".into())).await.unwrap();
        let resp = recv_text(&mut ws).await;

        let event: serde_json::Value = serde_json::from_str(&resp).unwrap();
        assert_eq!(event["type"], "AuthFailed", "expected AuthFailed, got: {}", resp);
    }

    #[tokio::test]
    async fn auth_wrong_command_type_fails() {
        let (port, _) = start_test_server().await;
        let mut ws = connect(port).await;

        // Send Ping instead of Auth
        let ping_msg = serde_json::to_string(&AppCommand::Ping).unwrap();
        ws.send(TungMessage::Text(ping_msg.into())).await.unwrap();
        let resp = recv_text(&mut ws).await;

        let event: serde_json::Value = serde_json::from_str(&resp).unwrap();
        assert_eq!(event["type"], "AuthFailed", "expected AuthFailed, got: {}", resp);
    }

    #[tokio::test]
    async fn post_auth_invalid_command_returns_error() {
        let (port, token) = start_test_server().await;
        let mut ws = connect(port).await;

        // Authenticate first
        ws.send(auth_msg(&token)).await.unwrap();
        let resp = recv_text(&mut ws).await;
        let event: serde_json::Value = serde_json::from_str(&resp).unwrap();
        assert_eq!(event["type"], "AuthSuccess");

        // Send garbage post-auth
        ws.send(TungMessage::Text("garbage command".into())).await.unwrap();
        let resp = recv_text(&mut ws).await;

        let event: serde_json::Value = serde_json::from_str(&resp).unwrap();
        assert_eq!(event["type"], "Error", "expected Error, got: {}", resp);
        assert_eq!(event["code"], "INVALID_COMMAND");
    }
}
