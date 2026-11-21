//! The menu-bar (tray) icon and its menu (#213).
//!
//! macOS gets a one-colour template image — the app icon's four shapes, the
//! square and diamond filled, the quarter circle and circle outlined — which
//! the system paints to suit a light or dark menu bar. Elsewhere the template
//! would be black on a dark taskbar, so the app icon stands in.
//!
//! A click is the platform's: macOS opens the menu on a left click (#213 D3);
//! Windows shows the window on a left click and leaves the menu to the right
//! button, which Windows draws (the canvas's Win-Tray).
//!
//! The menu only routes. New Diagram takes the path of the tab strip's + and
//! Cmd+T: a new diagram in a new tab, so there is nothing to ask. Quit takes
//! the path of Dosik ▸ Quit Dosik: a close request, which asks about unsaved
//! external files in any tab and flushes the autosave.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
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

/// whether a left click opens the menu: on macOS, as a menu-bar item does;
/// elsewhere the menu is the right button's
pub fn menu_on_left_click(mac: bool) -> bool {
    mac
}

/// What a click on the icon itself does (the menu's own clicks aside): off
/// macOS a left click, on its release, shows the window. On macOS a click
/// only opens the menu.
pub fn click_action(mac: bool, button: MouseButton, state: MouseButtonState) -> Option<TrayAction> {
    match (mac, button, state) {
        (false, MouseButton::Left, MouseButtonState::Up) => Some(TrayAction::Show),
        _ => None,
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let mac = cfg!(target_os = "macos");
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
        .show_menu_on_left_click(menu_on_left_click(mac))
        .on_menu_event(|app, event| {
            if let Some(action) = TrayAction::from_id(event.id().as_ref()) {
                handle(app, action);
            }
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if let Some(action) = click_action(mac, button, button_state) {
                    handle(tray.app_handle(), action);
                }
            }
        });
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

fn handle(app: &AppHandle, action: TrayAction) {
    match action {
        TrayAction::Show => crate::focus_existing(app),
        TrayAction::NewDiagram => {
            crate::focus_existing(app);
            let _ = app.emit(NEW_DIAGRAM_EVENT, ());
        }
        TrayAction::Quit => {
            // The window comes forward first, or the unsaved-files question
            // would open on a minimised or hidden window and Quit would seem
            // to do nothing (#213).
            crate::focus_existing(app);
            crate::app_menu::request_quit(app);
        }
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
    fn macos_opens_the_menu_on_a_left_click_windows_on_the_right() {
        assert!(menu_on_left_click(true));
        assert!(!menu_on_left_click(false));
    }

    #[test]
    fn a_left_click_shows_the_window_on_windows_once_released() {
        use MouseButton::{Left, Middle, Right};
        use MouseButtonState::{Down, Up};
        assert_eq!(click_action(false, Left, Up), Some(TrayAction::Show));
        // the press is not the click; the right button is the menu's
        assert_eq!(click_action(false, Left, Down), None);
        assert_eq!(click_action(false, Right, Up), None);
        assert_eq!(click_action(false, Middle, Up), None);
    }

    #[test]
    fn a_click_on_macos_only_opens_the_menu() {
        use MouseButton::{Left, Right};
        use MouseButtonState::Up;
        assert_eq!(click_action(true, Left, Up), None);
        assert_eq!(click_action(true, Right, Up), None);
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
