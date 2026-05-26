pub mod desktop_contract;
pub mod gateway;
pub mod models;
pub mod runtime_engine;

use anyhow::Context;
use std::path::Path;
use std::sync::Arc;
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, Theme, WebviewUrl};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_notification::NotificationExt as _;

use crate::gateway::desktop_api::desktop_settings_effects::{
    install_desktop_native_settings_bridge, DesktopNativeSettingsBridge,
};
use crate::gateway::desktop_api::{new_gateway_session_token, start_gateway_server, GatewayConfig};
use crate::models::DesktopPreferences;
use crate::runtime_engine::resolve_runtime_layout;

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "crawclaw-main";

#[derive(Clone)]
struct DesktopApiState {
    base_url: String,
    ui_url: Option<String>,
}

#[derive(Clone)]
struct TauriSettingsBridge {
    app: AppHandle,
}

impl DesktopNativeSettingsBridge for TauriSettingsBridge {
    fn apply_preferences(&self, preferences: &DesktopPreferences) -> Result<(), String> {
        let autolaunch = self.app.autolaunch();
        if preferences.ui_defaults.launch_at_login {
            autolaunch
                .enable()
                .map_err(|error| format!("Failed to enable launch at login: {error}"))?;
        } else {
            autolaunch
                .disable()
                .map_err(|error| format!("Failed to disable launch at login: {error}"))?;
        }

        if let Some(tray) = self.app.tray_by_id(TRAY_ID) {
            tray.set_visible(preferences.ui_defaults.show_in_menu_bar)
                .map_err(|error| format!("Failed to update menu bar visibility: {error}"))?;
        }

        let theme = tauri_theme_from_preference(&preferences.ui_defaults.appearance);
        self.app.set_theme(theme);
        if let Some(window) = self.app.get_webview_window("main") {
            window
                .set_theme(theme)
                .map_err(|error| format!("Failed to apply window theme: {error}"))?;
            let _ = window.emit(
                "desktop-settings-hot-applied",
                serde_json::json!({
                    "appearance": preferences.ui_defaults.appearance,
                    "language": preferences.ui_defaults.language,
                    "defaultPage": preferences.ui_defaults.default_page,
                    "launchAtLogin": preferences.ui_defaults.launch_at_login,
                    "showInMenuBar": preferences.ui_defaults.show_in_menu_bar,
                }),
            );
        }
        Ok(())
    }

    fn show_notification(&self, title: &str, body: &str, sound: bool) -> Result<(), String> {
        let mut builder = self.app.notification().builder().title(title).body(body);
        if sound {
            builder = builder.sound("default");
        }
        builder
            .show()
            .map_err(|error| format!("Failed to show desktop notification: {error}"))?;
        Ok(())
    }
}

#[tauri::command]
fn desktop_api_base_url(state: State<'_, DesktopApiState>) -> String {
    state.base_url.clone()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![desktop_api_base_url])
        .setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Regular);
            create_menu_bar_tray(app)?;
            install_desktop_native_settings_bridge(Arc::new(TauriSettingsBridge {
                app: app.handle().clone(),
            }));
            let resource_dir = app
                .path()
                .resource_dir()
                .context("failed to resolve Tauri resource directory")?;
            let runtime_layout = resolve_runtime_layout(resource_dir.clone());
            let config = GatewayConfig {
                app_name: "CrawClaw Desktop".to_string(),
                app_version: app.package_info().version.to_string(),
                runtime_layout,
                session_token: new_gateway_session_token(),
            };
            let server = tauri::async_runtime::block_on(start_gateway_server(config))?;
            let ui_url = packaged_desktop_ui_url(&resource_dir, &server.base_url);
            app.manage(DesktopApiState {
                base_url: server.base_url,
                ui_url,
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build CrawClaw Desktop")
        .run(|app, event| match event {
            tauri::RunEvent::Ready | tauri::RunEvent::Reopen { .. } => {
                if let Err(error) = ensure_main_window(app) {
                    eprintln!("[desktop] failed to show main window: {error}");
                }
            }
            _ => {}
        });
}

fn tauri_theme_from_preference(appearance: &str) -> Option<Theme> {
    match appearance {
        "浅色" | "light" | "Light" => Some(Theme::Light),
        "深色" | "dark" | "Dark" => Some(Theme::Dark),
        _ => None,
    }
}

fn create_menu_bar_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let Some(icon) = app.default_window_icon().cloned() else {
        return Ok(());
    };
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("CrawClaw Desktop")
        .build(app)
        .map(|_| ())
}

fn ensure_main_window(app: &AppHandle) -> tauri::Result<()> {
    let window = if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
    } else if let Some(window) = create_main_window_from_config(app)? {
        window
    } else {
        return Ok(());
    };
    window.show()?;
    let _ = window.unminimize();
    window.set_focus()?;
    Ok(())
}

fn create_main_window_from_config(app: &AppHandle) -> tauri::Result<Option<tauri::WebviewWindow>> {
    if let Some(ui_url) = app
        .try_state::<DesktopApiState>()
        .and_then(|state| state.ui_url.clone())
    {
        let parsed_url = ui_url.parse().map_err(tauri::Error::InvalidUrl)?;
        let window = tauri::WebviewWindowBuilder::new(
            app,
            MAIN_WINDOW_LABEL,
            WebviewUrl::External(parsed_url),
        )
        .inner_size(1440.0, 960.0)
        .min_inner_size(1120.0, 700.0)
        .resizable(true)
        .auto_resize()
        .build()?;
        window.set_title("CrawClaw Desktop")?;
        return Ok(Some(window));
    }

    let Some(window_config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW_LABEL)
        .or_else(|| app.config().app.windows.first())
    else {
        return Ok(None);
    };
    let window = tauri::WebviewWindowBuilder::from_config(app, window_config)?
        .auto_resize()
        .build()?;
    Ok(Some(window))
}

fn packaged_desktop_ui_url(resource_dir: &Path, base_url: &str) -> Option<String> {
    let localhost_base_url = base_url.replacen("http://127.0.0.1:", "http://localhost:", 1);
    resource_dir
        .join("desktop-ui")
        .join("index.html")
        .is_file()
        .then(|| format!("{localhost_base_url}/?desktopApiBaseUrl={base_url}"))
}
