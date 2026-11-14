mod app_menu;
mod bridge;
mod chat;
mod codex;
mod images;
mod library;
mod open_requests;
mod secrets;

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
fn focus_existing(app: &tauri::AppHandle) {
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AgentState::default())
        .manage(open_requests::OpenRequests::default())
        .setup(|app| {
            bridge::start_agent_server(app.handle().clone());
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
            read_text_file,
            images::read_image_file,
            write_text_file,
            write_binary_file,
            library::list_library,
            library::create_folder,
            library::rename_folder,
            library::set_folder_boards,
            library::delete_folder,
            library::move_project,
            library::move_folder,
            library::reorder_item,
            library::load_project,
            // sync: `save` relies on it running on the main thread (#230)
            library::save_project,
            library::delete_project,
            library::library_path,
            library::show_in_finder,
            open_requests::take_open_requests,
            secrets::secret_get,
            secrets::secret_set,
            chat::claude_cli_version,
            chat::claude_cli_chat,
            codex::codex_cli_version,
            codex::codex_cli_chat
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
            // Files handed over by macOS — `open -b` from the MCP server's
            // `open_in_dosik` — arrive as an Apple Event, at launch or while
            // running, never on the command line (#149). The bundle declares
            // no document type (a double extension like `.dosik.json` has no
            // clean UTI), so Finder's Open With does not list Dosik (#183)
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
