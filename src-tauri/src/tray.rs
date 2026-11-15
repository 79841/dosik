//! The menu-bar (tray) icon and its menu (#213).
//!
//! macOS gets a one-colour template image — the app icon's four shapes, the
//! square and diamond filled, the quarter circle and circle outlined — which
//! the system paints to suit a light or dark menu bar. Elsewhere the template
//! would be black on a dark taskbar, so the app icon stands in.
//!
//! The menu only routes. New Diagram takes the path of the tab strip's + and
//! Cmd+T: a new diagram in a new tab, so there is nothing to ask. Quit takes
//! the path of Dosik ▸ Quit Dosik: a close request, which asks about unsaved
//! external files in any tab and flushes the autosave.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter};

/// Asks the web side for a new diagram in a new tab, as the tab strip's + does.
pub const NEW_DIAGRAM_EVENT: &str = "tray:new-diagram";

#[derive(Debug, PartialEq, Eq)]
pub enum TrayAction {
    Show,
    NewDiagram,
    Quit,
}

impl TrayAction {
    pub const SHOW: &'static str = "tray-show";
    pub const NEW: &'static str = "tray-new";
    pub const QUIT: &'static str = "tray-quit";

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            Self::SHOW => Some(Self::Show),
            Self::NEW => Some(Self::NewDiagram),
            Self::QUIT => Some(Self::Quit),
            _ => None,
        }
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, TrayAction::SHOW, "Show Dosik", true, None::<&str>)?,
            &MenuItem::with_id(app, TrayAction::NEW, "New Diagram", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, TrayAction::QUIT, "Quit Dosik", true, None::<&str>)?,
        ],
    )?;
    let builder = TrayIconBuilder::with_id("dosik")
        .tooltip("Dosik")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| handle(app, event.id().as_ref()));
    #[cfg(target_os = "macos")]
    let builder = builder
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/tray/tray-icon.png"
        ))?)
        .icon_as_template(true);
    #[cfg(not(target_os = "macos"))]
    let builder = match app.default_window_icon() {
        Some(icon) => builder.icon(icon.clone()),
        None => builder,
    };
    builder.build(app)?;
    Ok(())
}

fn handle(app: &AppHandle, id: &str) {
    match TrayAction::from_id(id) {
        Some(TrayAction::Show) => crate::focus_existing(app),
        Some(TrayAction::NewDiagram) => {
            crate::focus_existing(app);
            let _ = app.emit(NEW_DIAGRAM_EVENT, ());
        }
        Some(TrayAction::Quit) => {
            // The window comes forward first, or the unsaved-files question
            // would open on a minimised or hidden window and Quit would seem
            // to do nothing (#213).
            crate::focus_existing(app);
            crate::app_menu::request_quit(app);
        }
        None => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_ids_map_to_actions() {
        assert_eq!(TrayAction::from_id("tray-show"), Some(TrayAction::Show));
        assert_eq!(
            TrayAction::from_id("tray-new"),
            Some(TrayAction::NewDiagram)
        );
        assert_eq!(TrayAction::from_id("tray-quit"), Some(TrayAction::Quit));
    }

    #[test]
    fn unknown_ids_do_nothing() {
        assert_eq!(TrayAction::from_id(""), None);
        assert_eq!(TrayAction::from_id("quit"), None);
    }

    #[test]
    fn the_template_icon_is_one_colour_with_transparency() {
        // a template image is read for its alpha only — any colour in it is a mistake
        let img = tauri::image::Image::from_bytes(include_bytes!("../icons/tray/tray-icon.png"))
            .expect("tray icon decodes");
        assert_eq!((img.width(), img.height()), (36, 36));
        let px = img.rgba();
        assert!(px.chunks(4).all(|p| p[0] == 0 && p[1] == 0 && p[2] == 0));
        assert!(px.chunks(4).any(|p| p[3] == 0));
        assert!(px.chunks(4).any(|p| p[3] == 255));
    }
}
