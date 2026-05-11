pub mod gateway;
pub mod models;
pub mod runtime_engine;

use anyhow::Context;
use tauri::{Manager, State};

use crate::gateway::desktop_api::{new_gateway_session_token, start_gateway_server, GatewayConfig};
use crate::runtime_engine::resolve_runtime_layout;

#[derive(Clone)]
struct DesktopApiState {
    base_url: String,
}

#[tauri::command]
fn desktop_api_base_url(state: State<'_, DesktopApiState>) -> String {
    state.base_url.clone()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![desktop_api_base_url])
        .setup(|app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .context("failed to resolve Tauri resource directory")?;
            let runtime_layout = resolve_runtime_layout(resource_dir);
            let config = GatewayConfig {
                app_name: "CrawClaw Desktop".to_string(),
                app_version: app.package_info().version.to_string(),
                runtime_layout,
                session_token: new_gateway_session_token(),
            };
            let server = tauri::async_runtime::block_on(start_gateway_server(config))?;
            app.manage(DesktopApiState {
                base_url: server.base_url,
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run CrawClaw Desktop");
}
