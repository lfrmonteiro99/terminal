// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::sync::Mutex;
use tauri::Manager;
use terminal_core::config::{DaemonConfig, DaemonMode};
use tracing_subscriber::EnvFilter;

/// Managed state: holds daemon info once ready, and the handle for shutdown.
pub struct DaemonState {
    pub info: Option<commands::DaemonInfo>,
    pub handle: Option<terminal_daemon::DaemonHandle>,
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        // Single-instance: focus existing window if user tries to launch again
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![commands::get_daemon_info])
        // Pre-create state as None BEFORE run() — avoids race condition
        .manage(Mutex::new(DaemonState {
            info: None,
            handle: None,
        }))
        .setup(|app| {
            let handle = app.handle().clone();

            let join = tauri::async_runtime::spawn(async move {
                let mut config = DaemonConfig::default();
                config.mode = DaemonMode::Embedded;
                config.port = 0; // OS picks free port

                match terminal_daemon::start_server(config).await {
                    Ok(daemon) => {
                        let state = handle.state::<Mutex<DaemonState>>();
                        let mut lock = state.lock().expect("State lock poisoned");
                        let port = daemon.port;
                        let token = daemon.token.clone();
                        lock.info = Some(commands::DaemonInfo {
                            port,
                            token,
                        });
                        lock.handle = Some(daemon);
                        tracing::info!("Embedded daemon ready on port {}", port);
                    }
                    Err(e) => {
                        tracing::error!("Daemon failed to start: {:?}", e);
                    }
                }
            });

            // Watcher: logs panics from daemon task
            tauri::async_runtime::spawn(async move {
                if let Err(e) = join.await {
                    tracing::error!("Daemon task panicked: {:?}", e);
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building tauri app")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Explicit clean shutdown via shutdown_tx
                // Scope the state borrow so MutexGuard drops before State
                let daemon_handle = {
                    let state = app.state::<Mutex<DaemonState>>();
                    state.lock().ok().and_then(|mut lock| lock.handle.take())
                };
                if let Some(handle) = daemon_handle {
                    handle.shutdown();
                    tracing::info!("Daemon shutdown signal sent");
                }
            }
        });
}
