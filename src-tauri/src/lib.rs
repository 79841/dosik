mod app_menu;
mod bridge;
mod chat;
mod codex;
mod images;
mod library;
mod mcp_install;
mod open_requests;
mod plugins;
mod secrets;
mod tray;

use base64::Engine;
use tauri::State;

use bridge::AgentState;

#[tauri::command]
fn sync_snapshot(
    state: State<'_, AgentState>,
    snapshot: String,
    project: Option<serde_json::Value>,
) {
    *state.snapshot.lock().unwrap() = snapshot;
    *state.project.lock().unwrap() = project.unwrap_or(serde_json::Value::Null);
}

#[tauri::command]
fn agent_ops_result(
    state: State<'_, AgentState>,
    request_id: String,
    applied: u64,
    errors: Vec<String>,
    project: Option<serde_json::Value>,
) {
    let sender = state.pending.lock().unwrap().remove(&request_id);
    if let Some(sender) = sender {
        let _ = sender.send(serde_json::json!({
            "ok": errors.is_empty(),
            "applied": applied,
            "errors": errors,
            "project": project.unwrap_or(serde_json::Value::Null),
        }));
    }
}

/// Answers a chat turn's request (`/api/chat/<token>/…`, #167) with the
/// status and body the frontend decided.
#[tauri::command]
fn agent_chat_result(
    state: State<'_, AgentState>,
    request_id: String,
    status: u16,
    body: serde_json::Value,
) {
    let sender = state.pending.lock().unwrap().remove(&request_id);
    if let Some(sender) = sender {
        let _ = sender.send(serde_json::json!({ "status": status, "body": body }));
    }
}

/// The port the agent bridge listens on, or None if it could not bind (#167).
#[tauri::command]
fn bridge_port(state: State<'_, AgentState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

/// Settings ▸ Integrations (#252): the port the bridge asked for, and whether
/// it has it (it may be held by another app — an installed Dosik, say).
#[derive(serde::Serialize)]
struct BridgeStatus {
    port: u16,
    listening: bool,
}

#[tauri::command]
fn bridge_status(state: State<'_, AgentState>) -> BridgeStatus {
    let wanted = bridge::wanted_port(std::env::var("DOSIK_PORT").ok().as_deref());
    match *state.port.lock().unwrap() {
        Some(port) => BridgeStatus {
            port,
            listening: true,
        },
        None => BridgeStatus {
            port: wanted,
            listening: false,
        },
    }
}

/// Settings ▸ About ▸ Third-party notices: the notices file the bundle
/// carries, opened from here so the webview needs no right to open paths.
#[tauri::command(async)]
fn open_notices(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::path::BaseDirectory;
    use tauri::Manager;
    use tauri_plugin_opener::OpenerExt;
    let path = app
        .path()
        .resolve("THIRD_PARTY_NOTICES.txt", BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_binary_file(path: String, base64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("base64 decode failed: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("{path}: {e}"))
}

/// Brings the running window forward when a second launch is refused (#109).
pub(crate) fn focus_existing(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // A packaged app runs once: launching it again raises the window that is
    // already there instead of opening a second one (#109). Development is the
    // exception — several instances on different `DOSIK_PORT`s are how the app
    // gets verified.
    //
    // `is_dev()` and not `cfg!(debug_assertions)`: the question is "is this a
    // bundle?", not "which profile?", and `tauri build --debug` produces a
    // bundle with debug assertions on. Keeping it a runtime branch also means
    // the plugin path is type-checked in every build, not only in release.
    let builder = if tauri::is_dev() {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            focus_existing(app);
            // a second launch with a file is a request to open it here (#149)
            open_requests::request_open(
                app,
                open_requests::diagram_paths(argv, std::path::Path::new(&cwd)),
            );
        }))
    };
    // ⌘W closes a tab, ⇧⌘W the window (#218 D12). Should building it ever
    // fail, the default menu stands in rather than the app not starting
    #[cfg(target_os = "macos")]
    let builder = builder.menu(|app| {
        app_menu::build(app).or_else(|e| {
            // ⌘W would close the window, not a tab — say why
            eprintln!("dosik: the app menu could not be built ({e}); using the default menu");
            tauri::menu::Menu::default(app)
        })
    });
    builder
        .on_menu_event(app_menu::on_event)
        .manage(mcp_install::McpServerState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AgentState::default())
        .manage(open_requests::OpenRequests::default())
        .setup(|app| {
            // the library before anything asks for it: its older form is
            // moved into the default location off the main thread
            library::setup(app.handle());
            bridge::start_agent_server(app.handle().clone());
            // the bundled MCP server into the app data, where the AI apps are
            // pointed (#252) — off the main thread, and never in the way of startup;
            // its trouble is kept for Settings ▸ Integrations
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(error) = mcp_install::ensure(&handle) {
                    eprintln!("dosik: {error}");
                }
            });
            // the menu-bar icon and its menu (#213) — an extra: if the platform
            // cannot make one, the app still starts
            if let Err(error) = tray::create(app.handle()) {
                eprintln!("dosik: no menu-bar icon: {error}");
            }
            // launched with a file on the command line (#149)
            if let Ok(cwd) = std::env::current_dir() {
                open_requests::request_open(
                    app.handle(),
                    open_requests::diagram_paths(std::env::args_os(), &cwd),
                );
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sync_snapshot,
            agent_ops_result,
            agent_chat_result,
            bridge_port,
            bridge_status,
            open_notices,
            read_text_file,
            images::read_image_file,
            write_text_file,
            write_binary_file,
            library::list_library,
            library::create_folder,
            library::rename_folder,
            library::set_folder_boards,
            library::delete_folder,
            library::count_other_files,
            library::move_project,
            library::move_folder,
            library::reorder_item,
            library::load_project,
            // sync: a tab's saves land in the order they were sent
            library::save_project,
            library::delete_project,
            library::locate_project,
            library::remove_project,
            library::add_library_folder,
            library::change_default_location,
            library::watch_files,
            library::library_diagram_at,
            library::library_path,
            library::show_in_finder,
            library::library_root,
            library::show_library_in_finder,
            library::take_left_behind,
            open_requests::take_open_requests,
            secrets::secret_get,
            secrets::secret_set,
            chat::claude_cli_status,
            chat::claude_cli_chat,
            codex::codex_cli_status,
            codex::codex_cli_chat,
            plugins::plugins_status,
            plugins::plugin_install,
            plugins::plugin_remove,
            plugins::open_claude
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            // macOS never starts a second process for a Dock/Spotlight relaunch
            // — LaunchServices reopens the running one, so the single-instance
            // plugin never sees it. That path arrives here instead (#109).
            #[cfg(target_os = "macos")]
            if matches!(_event, tauri::RunEvent::Reopen { .. }) && !tauri::is_dev() {
                focus_existing(_app);
            }
            // Files handed over by macOS — a double-click in Finder, Open
            // With, `open -b` from the MCP server's `open_in_dosik` — arrive
            // as an Apple Event, at launch or while running, never on the
            // command line (#149). The bundle declares `.dosik` as its own
            // document type (`fileAssociations` in tauri.conf.json); the
            // older `.dosik.json`, a double extension with no clean type of
            // its own, still opens this way but is not claimed
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &_event {
                let paths = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect();
                open_requests::request_open(_app, paths);
                focus_existing(_app);
            }
        });
}
