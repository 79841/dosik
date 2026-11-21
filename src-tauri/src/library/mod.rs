//! The library's commands: what the webview asks of the projects and
//! diagrams, by id — Rust owns where they are, so the webview never handles
//! paths. The files themselves are kept by `legacy` (projects under the app
//! data directory, folders and files named by id).

mod legacy;

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use legacy::{
    delete, item_path, list, load, make_folder_in, move_folder_to, move_to_at, place_boards,
    remove_folder, reorder, retitle_folder, save, shown_path, BoardFailure, BoardSpot, FolderBoard,
    FolderMeta, ItemKind, ItemPath,
};

fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("projects"))
}

/// Off the main thread (#230 D3): the listing reads every diagram, and the
/// first one after an older build writes an order down for each folder.
#[tauri::command]
pub async fn list_library(app: AppHandle) -> Result<Vec<FolderMeta>, String> {
    let dir = library_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || list(&dir))
        .await
        .map_err(|error| format!("listing the library failed: {error}"))?
}

/// A new project — or, with `parent`, a folder inside that folder (#229 D9).
#[tauri::command]
pub fn create_folder(
    app: AppHandle,
    id: String,
    name: String,
    board: Option<BoardSpot>,
    parent: Option<String>,
) -> Result<(), String> {
    make_folder_in(
        &library_dir(&app)?,
        &id,
        &name,
        board.as_ref(),
        parent.as_deref(),
    )
}

/// Resolves the projects that could not take their place (none: all did);
/// rejects only when the library itself cannot be reached. Off the main
/// thread: the Home canvas's first look places every project at once, a
/// synced write each, and the window must not wait on them (#221).
/// The folder lock keeps it in order with a rename and a project's removal.
#[tauri::command]
pub async fn set_folder_boards(
    app: AppHandle,
    boards: Vec<FolderBoard>,
) -> Result<Vec<BoardFailure>, String> {
    place_boards(library_dir(&app)?, boards).await
}

#[tauri::command]
pub fn rename_folder(app: AppHandle, id: String, name: String) -> Result<(), String> {
    retitle_folder(&library_dir(&app)?, &id, &name)
}

#[tauri::command]
pub fn delete_folder(app: AppHandle, id: String) -> Result<(), String> {
    remove_folder(&library_dir(&app)?, &id)
}

/// A diagram into `folder`, to `index` in its order — the top if left out (#230 D6).
#[tauri::command]
pub fn move_project(
    app: AppHandle,
    id: String,
    folder: String,
    index: Option<usize>,
) -> Result<(), String> {
    move_to_at(&library_dir(&app)?, &id, &folder, index)
}

/// A folder (never a project) into `parent`, to `index` — the top if left out (#230 D6).
#[tauri::command]
pub fn move_folder(
    app: AppHandle,
    id: String,
    parent: String,
    index: Option<usize>,
) -> Result<(), String> {
    move_folder_to(&library_dir(&app)?, &id, &parent, index)
}

/// `item` (`folder:<id>`, `diagram:<id>`) to `index` among the items of
/// `parent` — the projects, for none (#230 D6).
#[tauri::command]
pub fn reorder_item(
    app: AppHandle,
    parent: Option<String>,
    item: String,
    index: usize,
) -> Result<(), String> {
    reorder(&library_dir(&app)?, parent.as_deref(), &item, index)
}

#[tauri::command]
pub fn load_project(app: AppHandle, id: String) -> Result<String, String> {
    load(&library_dir(&app)?, &id)
}

/// Sync on purpose: Tauri runs it on the main thread, in turn with the moves
/// and deletes — `save` writes a diagram in a folder without `META_LOCK` on
/// that alone. Made async, look at `save`'s lock-free branch again (#230).
#[tauri::command]
pub fn save_project(
    app: AppHandle,
    id: String,
    contents: String,
    folder: Option<String>,
) -> Result<(), String> {
    save(&library_dir(&app)?, &id, &contents, folder.as_deref())
}

#[tauri::command]
pub fn delete_project(app: AppHandle, id: String) -> Result<(), String> {
    delete(&library_dir(&app)?, &id)
}

/// Where an item is on disk (#238) — the path card and Copy Path. Off the
/// main thread: it walks the folders, and the card asks as the pointer rests.
#[tauri::command(async)]
pub fn library_path(app: AppHandle, kind: ItemKind, id: String) -> Result<ItemPath, String> {
    let path = item_path(&library_dir(&app)?, kind, &id)?;
    let home = app.path().home_dir().ok();
    Ok(ItemPath {
        shown: shown_path(&path, home.as_deref()),
        path: path.to_string_lossy().into_owned(),
    })
}

/// Show in Finder (#238): a folder opens in the file manager, a diagram's
/// file is shown selected in its folder. Opened from here, by id, so the
/// webview needs no right to open paths (`opener:default` stays as it is).
/// Off the main thread like `library_path` — it walks the folders too; the
/// opener's own commands open and reveal from an async command the same way.
#[tauri::command(async)]
pub fn show_in_finder(app: AppHandle, kind: ItemKind, id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = item_path(&library_dir(&app)?, kind, &id)?;
    match kind {
        ItemKind::Folder => app.opener().open_path(path.to_string_lossy(), None::<&str>),
        ItemKind::Diagram => app.opener().reveal_item_in_dir(&path),
    }
    .map_err(|e| e.to_string())
}

/// The library's own folder (`projects/`) for Settings ▸ General (#252),
/// shown with `~` like the path card.
#[tauri::command]
pub fn library_root(app: AppHandle) -> Result<ItemPath, String> {
    let path = library_dir(&app)?;
    let home = app.path().home_dir().ok();
    Ok(ItemPath {
        shown: shown_path(&path, home.as_deref()),
        path: path.to_string_lossy().into_owned(),
    })
}

/// Settings ▸ General ▸ Show in Finder: the library folder opens (#252, the
/// same opening as a folder's Show in Finder, #238).
#[tauri::command(async)]
pub fn show_library_in_finder(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = library_dir(&app)?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn save_project_runs_on_the_main_thread() {
        // `save` writes a diagram in a folder without the
        // lock because `save_project` is a sync command — run on the main
        // thread, in turn with the moves and deletes. Made async, that branch
        // must be looked at again.
        let source = include_str!("mod.rs");
        let at = source
            .find("pub fn save_project(")
            .expect("save_project, a plain fn");
        let attribute = &source[source[..at].rfind("#[tauri::command").unwrap()..at];
        assert!(!attribute.contains("async"), "{attribute}");
        assert!(!source.contains(concat!("async fn ", "save_project")));
    }
}
