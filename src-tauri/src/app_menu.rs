//! The macOS menu bar (#218 D12): Tauri's default menu with two changes —
//! File ▸ Close Tab takes ⌘W and Close Window moves to ⇧⌘W, and Quit asks the
//! window to close instead of ending the process (#218).
//!
//! With document tabs, ⌘W closes the active tab. The default menu binds ⌘W
//! twice (File ▸ Close Window and Window ▸ Close Window), and whether a page's
//! `preventDefault` beats a menu key equivalent in WKWebView cannot be relied
//! on — losing that race would close the whole window instead of a tab. A
//! menu item fires once, whatever WebKit does with the key: Close Tab tells
//! the front end, which closes the active tab — or, on Home, asks the window
//! to close (`useMenuEvents.ts`). Close Window goes through
//! `WebviewWindow::close`, which emits close-requested like the red light, so
//! the unsaved-file question and the autosave flush still run (#123, #114).
//!
//! Quit (⌘Q) is ours too. AppKit's own Quit sends `terminate:`, which ends
//! the process without a close request — dirty external files in any tab
//! would go without the one question closing the window asks (#123, #218 D8).
//! Ours asks the window to close the same way Close Window does; once it has
//! closed, the last window gone ends the app. With no window to ask, it exits.
//! (The Dock's Quit and a logout still go through `terminate:`.)
//!
//! Every other menu — the rest of the app menu, Edit (⌘C/⌘V/⌘Z in text fields
//! need it), View (Full Screen), Window, Help — is the default one, item for
//! item. The same layout was here for #125 (3e60ff7) and left with #127.
//! Other platforms keep no menu bar; Ctrl+W is the front end's.

/// File ▸ Close Tab (⌘W)
pub const CLOSE_TAB_ID: &str = "close-tab";
/// File ▸ Close Window (⇧⌘W)
pub const CLOSE_WINDOW_ID: &str = "close-window";
/// Dosik ▸ Quit Dosik (⌘Q)
pub const QUIT_ID: &str = "quit";
/// what the front end hears when Close Tab is chosen — `useMenuEvents.ts` has the same string
pub const CLOSE_TAB_EVENT: &str = "menu:close-tab";

/// What a menu item asks for — the ids are ours, every other item is AppKit's own.
#[derive(Debug, PartialEq, Eq)]
pub enum MenuAction {
    CloseTab,
    CloseWindow,
    Quit,
}

pub fn action_for(id: &str) -> Option<MenuAction> {
    match id {
        CLOSE_TAB_ID => Some(MenuAction::CloseTab),
        CLOSE_WINDOW_ID => Some(MenuAction::CloseWindow),
        QUIT_ID => Some(MenuAction::Quit),
        _ => None,
    }
}

/// Carries out our items: Close Tab is the front end's, Close Window and Quit
/// the window's — a close request, which the front end can answer with Cancel.
pub fn on_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    use tauri::{Emitter, Manager};
    match action_for(event.id().as_ref()) {
        Some(MenuAction::CloseTab) => {
            let _ = app.emit(CLOSE_TAB_EVENT, ());
        }
        Some(MenuAction::CloseWindow) => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        Some(MenuAction::Quit) => request_quit(app),
        None => {}
    }
}

/// Quit through the window's close request, so the front end can ask about
/// unsaved external files and flush the autosave (`useFlushOnClose`) —
/// `app.exit` would skip both. Closing the last window ends the app. With no
/// window to ask, or when the request fails, Quit must still quit. Shared by
/// Dosik ▸ Quit Dosik and the menu-bar icon's Quit Dosik.
pub fn request_quit<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    match app.get_webview_window("main") {
        Some(window) => {
            if window.close().is_err() {
                app.exit(0);
            }
        }
        None => app.exit(0),
    }
}

#[cfg(target_os = "macos")]
pub fn build<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{
        AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
        WINDOW_SUBMENU_ID,
    };

    // what the default menu passes to the About panel
    let pkg = app.package_info();
    let config = app.config();
    let about = AboutMetadata {
        name: Some(pkg.name.clone()),
        version: Some(pkg.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };

    let app_menu = Submenu::with_items(
        app,
        pkg.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                QUIT_ID,
                format!("Quit {}", pkg.name),
                true,
                Some("CmdOrCtrl+Q"),
            )?,
        ],
    )?;
    let close_tab = MenuItem::with_id(app, CLOSE_TAB_ID, "Close Tab", true, Some("CmdOrCtrl+W"))?;
    let close_window = MenuItem::with_id(
        app,
        CLOSE_WINDOW_ID,
        "Close Window",
        true,
        Some("CmdOrCtrl+Shift+W"),
    )?;
    let file = Submenu::with_items(app, "File", true, &[&close_tab, &close_window])?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    // the default's Window menu ends in a second ⌘W Close Window; File has it
    // now, on ⇧⌘W. The id makes this NSApp's windows menu (window list,
    // Bring All to Front), as in the default
    let window = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
        ],
    )?;
    let help = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &[])?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn our_items_map_to_their_actions() {
        assert_eq!(action_for(CLOSE_TAB_ID), Some(MenuAction::CloseTab));
        assert_eq!(action_for(CLOSE_WINDOW_ID), Some(MenuAction::CloseWindow));
        assert_eq!(action_for(QUIT_ID), Some(MenuAction::Quit));
    }

    #[test]
    fn predefined_items_are_appkits() {
        // AppKit performs the predefined items itself; a stray id must do nothing
        assert_eq!(action_for("copy"), None);
        assert_eq!(action_for(""), None);
    }

    #[test]
    fn the_ids_differ() {
        assert_ne!(CLOSE_TAB_ID, CLOSE_WINDOW_ID);
        assert_ne!(QUIT_ID, CLOSE_TAB_ID);
        assert_ne!(QUIT_ID, CLOSE_WINDOW_ID);
    }
}
