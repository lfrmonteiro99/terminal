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
use std::sync::Arc;
use terminal_core::protocol::v1::{AppCommand, AppEvent};
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::{error, info, warn};

pub struct DaemonState {
    pub auth_token: String,
    pub event_tx: broadcast::Sender<String>,
    pub command_tx: mpsc::Sender<(AppCommand, mpsc::Sender<AppEvent>)>,
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

async fn handle_socket(socket: WebSocket, state: Arc<DaemonState>) {
    let (mut sender, mut receiver) = socket.split();
    info!("New WebSocket connection, awaiting auth...");

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
                    let resp = serde_json::to_string(&AppEvent::AuthSuccess).unwrap();
                    let _ = sender.send(Message::Text(resp.into())).await;
                    true
                }
                Ok(AppCommand::Auth { .. }) => {
                    warn!("Auth failed: token mismatch");
                    let resp = serde_json::to_string(&AppEvent::AuthFailed {
                        reason: "Invalid token".into(),
                    })
                    .unwrap();
                    let _ = sender.send(Message::Text(resp.into())).await;
                    false
                }
                Ok(other) => {
                    warn!("Auth failed: expected Auth command, got {:?}", other);
                    let resp = serde_json::to_string(&AppEvent::AuthFailed {
                        reason: "Expected Auth command".into(),
                    })
                    .unwrap();
                    let _ = sender.send(Message::Text(resp.into())).await;
                    false
                }
                Err(e) => {
                    warn!("Auth failed: could not parse message: {}", e);
                    let resp = serde_json::to_string(&AppEvent::AuthFailed {
                        reason: "Invalid token".into(),
                    })
                    .unwrap();
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

    // Step 3: Sender task — forwards broadcast events + heartbeat pings
    let sender = Arc::new(Mutex::new(sender));
    let sender_clone = sender.clone();

    let send_task = tokio::spawn(async move {
        let mut heartbeat_interval =
            tokio::time::interval(std::time::Duration::from_secs(30));

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
            let msg = serde_json::to_string(&event).unwrap();
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
                        let pong = serde_json::to_string(&AppEvent::Pong).unwrap();
                        let mut s = sender.lock().await;
                        let _ = s.send(Message::Text(pong.into())).await;
                    }
                    Ok(cmd) => {
                        let cmd = cmd.sanitize();
                        if let Err(e) = state.command_tx.send((cmd, response_tx.clone())).await {
                            error!("Failed to forward command: {}", e);
                        }
                    }
                    Err(e) => {
                        warn!("Invalid command from client: {}", e);
                        let err = serde_json::to_string(&AppEvent::Error {
                            code: "INVALID_COMMAND".into(),
                            message: e.to_string(),
                        })
                        .unwrap();
                        let mut s = sender.lock().await;
                        let _ = s.send(Message::Text(err.into())).await;
                    }
                }
            }
            Ok(Message::Pong(_)) => {
                // Client responded to our ping — heartbeat OK
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
    info!("Client connection closed");
}
