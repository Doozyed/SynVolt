use std::sync::{Arc, atomic::{AtomicU64, Ordering}};

static NEXT_CONSOLE_CLIENT: AtomicU64 = AtomicU64::new(1);

use futures_util::StreamExt;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio_tungstenite::accept_async;

pub const CONSOLE_PORT: u16 = 21576;

#[derive(Deserialize)]
struct ConsoleMessage {
    level: Option<String>,
    message: Option<String>,
    username: Option<String>,
    pid: Option<u32>,
}

pub struct ConsoleBridge {
    running: Arc<RwLock<bool>>,
}

impl ConsoleBridge {
    pub fn new() -> Self {
        Self {
            running: Arc::new(RwLock::new(false)),
        }
    }

    pub async fn start(&self, app: AppHandle) -> Result<(), String> {
        let mut running_guard = self.running.write().await;
        if *running_guard {
            return Ok(());
        }
        let addr = format!("127.0.0.1:{}", CONSOLE_PORT);
        let listener = TcpListener::bind(&addr)
            .await
            .map_err(|err| format!("Cannot start terminal output listener: {}", err))?;
        *running_guard = true;
        drop(running_guard);

        let running = self.running.clone();

        tokio::spawn(async move {
            loop {
                if !*running.read().await {
                    break;
                }

                let accept_result = tokio::select! {
                    result = listener.accept() => Some(result),
                    _ = tokio::time::sleep(tokio::time::Duration::from_millis(100)) => None,
                };

                let Some(Ok((stream, _))) = accept_result else {
                    continue;
                };

                let ws_stream = match accept_async(stream).await {
                    Ok(ws_stream) => ws_stream,
                    Err(err) => {
                        eprintln!("[Console] WebSocket handshake failed: {}", err);
                        continue;
                    }
                };

                let app_handle = app.clone();
                let client_id = NEXT_CONSOLE_CLIENT.fetch_add(1, Ordering::Relaxed).to_string();
                tokio::spawn(async move {
                    let (_, mut read) = ws_stream.split();
                    let mut last_identity: Option<(String, Option<u32>)> = None;

                    while let Some(message) = read.next().await {
                        match message {
                            Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                                if let Ok(payload) = serde_json::from_str::<ConsoleMessage>(&text) {
                                    if let Some(ref username) = payload.username {
                                        let identity = (username.clone(), payload.pid);
                                        if !username.is_empty() && last_identity.as_ref() != Some(&identity) {
                                            let _ = app_handle.emit("console-session", serde_json::json!({
                                                "clientId": client_id, "username": username, "pid": payload.pid, "connected": true
                                            }));
                                            last_identity = Some(identity);
                                        }
                                    }
                                    if payload.level.as_deref() == Some("identity") { continue; }
                                    let _ = app_handle.emit(
                                        "console-log",
                                        serde_json::json!({
                                            "level": payload.level.unwrap_or_else(|| "info".to_string()),
                                            "message": payload.message.unwrap_or_default(),
                                            "username": payload.username,
                                        }),
                                    );
                                }
                            }
                            Ok(tokio_tungstenite::tungstenite::Message::Close(_)) => break,
                            Err(err) => {
                                eprintln!("[Console] Read error: {}", err);
                                break;
                            }
                            _ => {}
                        }
                    }
                    let _ = app_handle.emit("console-session", serde_json::json!({
                        "clientId": client_id, "connected": false
                    }));
                });
            }
        });

        Ok(())
    }
}
