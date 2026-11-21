//! The window frame off macOS (the canvas's Win-Caption and Win-Home): the
//! window is undecorated, so the web page draws the caption buttons and the
//! band is its title bar. What a title bar does beyond the page is here:
//!
//! - the first window fits the primary monitor's work area — 1440×900 in its
//!   middle, or maximized when that does not fit (it is created hidden, so it
//!   never shows at one size and jumps to another);
//! - the window menu (a right click on the band, Alt+Space), which Windows
//!   draws — the window keeps `WS_SYSMENU`, so Alt+F4 and Win+↑ work already;
//! - Snap layouts on Maximize: a window of our own that draws nothing sits
//!   over the Maximize button and tells Windows it is one (`HTMAXBUTTON`) —
//!   the way Windows Terminal does it, and the way Tauri makes an undecorated
//!   window's edges resize. The pointer there never reaches the page, so the
//!   spot reports hover and press to it (`MAX_BUTTON_EVENT`) and maximizes on
//!   click itself;
//! - the webview's browser keys (reload, find, print, developer tools, zoom)
//!   are off in a bundle, kept in development for debugging.
//!
//! The geometry is plain functions, tested on every platform; the Win32 and
//! WebView2 calls are in `win32`, compiled for Windows only.

// the geometry is tested on every platform and used on Windows alone
#![cfg_attr(not(windows), allow(dead_code))]

/// what the web side hears as the pointer enters, presses or leaves the
/// native Maximize spot — `windowFrame.ts` has the same string
pub const MAX_BUTTON_EVENT: &str = "window-frame:max-button";

/// a caption button's width (design token `caption-button`)
pub const CAPTION_BUTTON: f64 = 46.0;
/// the band's height (design token `chrome-height`)
pub const CHROME_HEIGHT: f64 = 40.0;

/// whether the webview keeps its browser keys: in development, for the
/// developer tools; never in a bundle
pub fn browser_keys_enabled(dev: bool) -> bool {
    dev
}

/// a rectangle in physical pixels
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// where the first window goes
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    /// this size, at this place — the middle of the work area
    Centered(Rect),
    /// the size does not fit the work area
    Maximized,
}

/// The first window: `size` (logical) at the monitor's `scale`, in the middle
/// of the work area (the screen without the taskbar) when it fits whole,
/// maximized when it does not.
pub fn first_placement(work_area: Rect, scale: f64, size: (f64, f64)) -> Placement {
    let width = (size.0 * scale).round() as u32;
    let height = (size.1 * scale).round() as u32;
    if width > work_area.width || height > work_area.height {
        return Placement::Maximized;
    }
    Placement::Centered(Rect {
        x: work_area.x + ((work_area.width - width) / 2) as i32,
        y: work_area.y + ((work_area.height - height) / 2) as i32,
        width,
        height,
    })
}

/// Where the window menu opens, in screen pixels: at the pointer for a right
/// click, under the band's left end for Alt+Space — as a title bar's does.
pub fn menu_point(
    client_origin: (i32, i32),
    scale: f64,
    pointer: Option<(i32, i32)>,
) -> (i32, i32) {
    pointer.unwrap_or((
        client_origin.0,
        client_origin.1 + (CHROME_HEIGHT * scale).round() as i32,
    ))
}

/// a window menu command and whether it can be chosen now
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuCommand {
    Restore,
    Move,
    Size,
    Minimize,
    Maximize,
    Close,
}

/// The window menu's items as a title bar has them: Restore only when
/// maximized; Move, Size and Maximize only when not; Minimize and Close always.
pub fn menu_items(maximized: bool) -> [(MenuCommand, bool); 6] {
    [
        (MenuCommand::Restore, maximized),
        (MenuCommand::Move, !maximized),
        (MenuCommand::Size, !maximized),
        (MenuCommand::Minimize, true),
        (MenuCommand::Maximize, !maximized),
        (MenuCommand::Close, true),
    ]
}

/// The native Maximize spot, in client pixels: the middle of the three caption
/// buttons at the band's right end. Restored, it leaves the window's top
/// `resize_border` to the resize edge above it (Tauri's); maximized there is
/// no edge to leave.
pub fn max_spot(client_width: u32, scale: f64, maximized: bool, resize_border: i32) -> Rect {
    let button = (CAPTION_BUTTON * scale).round() as i32;
    let band = (CHROME_HEIGHT * scale).round() as i32;
    let top = if maximized {
        0
    } else {
        resize_border.clamp(0, band)
    };
    Rect {
        x: client_width as i32 - 2 * button,
        y: top,
        width: button as u32,
        height: (band - top) as u32,
    }
}

/// the spot is there only while the caption buttons are: not in full screen
pub fn max_spot_shown(fullscreen: bool) -> bool {
    !fullscreen
}

/// the pointer on the spot, as the web side paints it
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpotState {
    Rest,
    Hover,
    Pressed,
}

impl SpotState {
    pub fn as_str(self) -> &'static str {
        match self {
            SpotState::Rest => "rest",
            SpotState::Hover => "hover",
            SpotState::Pressed => "pressed",
        }
    }
}

/// Places and shows the first window off macOS. Whatever happens it ends
/// shown and focused — the window is created hidden, and a window that never
/// shows is worse than one in the wrong place.
pub fn place_first_window<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, size: (f64, f64)) {
    let placement = window.primary_monitor().ok().flatten().map(|monitor| {
        let area = monitor.work_area();
        first_placement(
            Rect {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            },
            monitor.scale_factor(),
            size,
        )
    });
    match placement {
        Some(Placement::Centered(rect)) => {
            // the place first, then the size: a size on the old place could
            // put the window across two monitors for a moment
            let _ = window.set_position(tauri::PhysicalPosition::new(rect.x, rect.y));
            let _ = window.set_size(tauri::PhysicalSize::new(rect.width, rect.height));
        }
        Some(Placement::Maximized) => {
            let _ = window.maximize();
        }
        None => {
            let _ = window.center();
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(windows)]
pub mod win32 {
    //! The Win32 and WebView2 side of the frame — Windows only.

    use std::sync::OnceLock;

    use tauri::{Emitter, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::{w, Interface, PCWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, EnableMenuItem, FindWindowExW, GetCursorPos, GetParent,
        GetSystemMenu, IsZoomed, PostMessageW, RegisterClassExW, SetMenuDefaultItem, SetWindowPos,
        ShowWindow, TrackPopupMenu, HTMAXBUTTON, HWND_TOP, MENU_ITEM_FLAGS, MF_BYCOMMAND,
        MF_ENABLED, MF_GRAYED, SC_CLOSE, SC_MAXIMIZE, SC_MINIMIZE, SC_MOVE, SC_RESTORE, SC_SIZE,
        SWP_NOACTIVATE, SWP_NOOWNERZORDER, SW_HIDE, SW_SHOWNOACTIVATE, TPM_LEFTBUTTON,
        TPM_RETURNCMD, TPM_RIGHTBUTTON, WM_NCHITTEST, WM_NCLBUTTONDBLCLK, WM_NCLBUTTONDOWN,
        WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WM_SYSCOMMAND, WNDCLASSEXW, WS_CHILD,
        WS_CLIPSIBLINGS, WS_EX_LAYERED, WS_EX_NOREDIRECTIONBITMAP,
    };

    use super::{max_spot, max_spot_shown, menu_items, menu_point, MenuCommand, SpotState};

    const SPOT_CLASS: PCWSTR = w!("DOSIK_MAX_SPOT");

    /// the app, for the spot's window procedure to tell the web side
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    fn command_id(command: MenuCommand) -> u32 {
        match command {
            MenuCommand::Restore => SC_RESTORE,
            MenuCommand::Move => SC_MOVE,
            MenuCommand::Size => SC_SIZE,
            MenuCommand::Minimize => SC_MINIMIZE,
            MenuCommand::Maximize => SC_MAXIMIZE,
            MenuCommand::Close => SC_CLOSE,
        }
    }

    fn hwnd_of<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Option<HWND> {
        window.hwnd().ok().map(|h| HWND(h.0))
    }

    /// Turns the browser keys off in a bundle (`browser_keys_enabled`).
    pub fn apply_webview_prefs<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, dev: bool) {
        if super::browser_keys_enabled(dev) {
            return;
        }
        let _ = window.with_webview(|webview| {
            // SAFETY: COM calls on the webview's own controller, on its thread
            let result = unsafe {
                webview
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.Settings())
                    .and_then(|settings| settings.cast::<ICoreWebView2Settings3>())
                    .and_then(|settings| settings.SetAreBrowserAcceleratorKeysEnabled(false))
            };
            if let Err(error) = result {
                eprintln!("dosik: the webview's browser keys stay on: {error}");
            }
        });
    }

    /// Opens Windows' window menu and carries out the choice, as a title bar does.
    pub fn show_system_menu<R: tauri::Runtime>(
        window: &tauri::WebviewWindow<R>,
        at_pointer: bool,
    ) -> Result<(), String> {
        let hwnd = hwnd_of(window).ok_or("no window handle")?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        // SAFETY: plain Win32 calls on our own top-level window, on its thread
        unsafe {
            let menu = GetSystemMenu(hwnd, false);
            if menu.is_invalid() {
                return Err("the window has no window menu".into());
            }
            for (command, enabled) in menu_items(IsZoomed(hwnd).as_bool()) {
                let state: MENU_ITEM_FLAGS = if enabled { MF_ENABLED } else { MF_GRAYED };
                let _ = EnableMenuItem(menu, command_id(command), MF_BYCOMMAND | state);
            }
            let _ = SetMenuDefaultItem(menu, SC_CLOSE, 0);
            let mut origin = POINT::default();
            let _ = ClientToScreen(hwnd, &mut origin);
            let pointer = if at_pointer {
                let mut cursor = POINT::default();
                GetCursorPos(&mut cursor).ok().map(|_| (cursor.x, cursor.y))
            } else {
                None
            };
            let (x, y) = menu_point((origin.x, origin.y), scale, pointer);
            let chosen = TrackPopupMenu(
                menu,
                TPM_RETURNCMD | TPM_LEFTBUTTON | TPM_RIGHTBUTTON,
                x,
                y,
                None,
                hwnd,
                None,
            );
            if chosen.0 != 0 {
                let _ = PostMessageW(
                    Some(hwnd),
                    WM_SYSCOMMAND,
                    WPARAM(chosen.0 as usize),
                    LPARAM(0),
                );
            }
        }
        Ok(())
    }

    fn tell(state: SpotState) {
        if let Some(app) = APP.get() {
            let _ = app.emit(super::MAX_BUTTON_EVENT, state.as_str());
        }
    }

    /// whether the left button went down on the spot and has not come up
    static PRESSED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    unsafe extern "system" fn spot_proc(
        spot: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        use std::sync::atomic::Ordering;
        match msg {
            // the whole spot is the Maximize button, for Snap layouts
            WM_NCHITTEST => return LRESULT(HTMAXBUTTON as isize),
            WM_NCMOUSEMOVE => {
                // ask for the leave, so the button stops looking hovered
                let mut track = TRACKMOUSEEVENT {
                    cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE | TME_NONCLIENT,
                    hwndTrack: spot,
                    dwHoverTime: 0,
                };
                let _ = TrackMouseEvent(&mut track);
                tell(if PRESSED.load(Ordering::Relaxed) {
                    SpotState::Pressed
                } else {
                    SpotState::Hover
                });
                return LRESULT(0);
            }
            WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK => {
                PRESSED.store(true, Ordering::Relaxed);
                tell(SpotState::Pressed);
                return LRESULT(0);
            }
            WM_NCLBUTTONUP => {
                if PRESSED.swap(false, Ordering::Relaxed) {
                    if let Ok(parent) = GetParent(spot) {
                        let command = if IsZoomed(parent).as_bool() {
                            SC_RESTORE
                        } else {
                            SC_MAXIMIZE
                        };
                        let _ = PostMessageW(
                            Some(parent),
                            WM_SYSCOMMAND,
                            WPARAM(command as usize),
                            LPARAM(0),
                        );
                    }
                }
                tell(SpotState::Hover);
                return LRESULT(0);
            }
            WM_NCMOUSELEAVE => {
                PRESSED.store(false, Ordering::Relaxed);
                tell(SpotState::Rest);
                return LRESULT(0);
            }
            _ => {}
        }
        DefWindowProcW(spot, msg, wparam, lparam)
    }

    fn spot_of(parent: HWND) -> Option<HWND> {
        // SAFETY: a lookup among our own window's children
        unsafe { FindWindowExW(Some(parent), None, SPOT_CLASS, PCWSTR::null()) }.ok()
    }

    /// Puts the spot over the Maximize button — on top of the webview — or
    /// hides it in full screen. Called at start and on every resize.
    pub fn place_max_spot<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
        let (Some(parent), Ok(size), Ok(scale)) =
            (hwnd_of(window), window.inner_size(), window.scale_factor())
        else {
            return;
        };
        let Some(spot) = spot_of(parent) else {
            return;
        };
        let fullscreen = window.is_fullscreen().unwrap_or(false);
        let maximized = window.is_maximized().unwrap_or(false);
        // Tauri's resize edge is the system frame's width: a few pixels at the top
        let border = (4.0 * scale).round() as i32;
        let rect = max_spot(size.width, scale, maximized, border);
        // SAFETY: moving and showing our own child window
        unsafe {
            if !max_spot_shown(fullscreen) {
                let _ = ShowWindow(spot, SW_HIDE);
                return;
            }
            let _ = SetWindowPos(
                spot,
                Some(HWND_TOP),
                rect.x,
                rect.y,
                rect.width as i32,
                rect.height as i32,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            );
            let _ = ShowWindow(spot, SW_SHOWNOACTIVATE);
        }
    }

    /// Creates the spot. It draws nothing — layered with no surface, as Windows
    /// Terminal's drag bar — so the page's button shows through it.
    pub fn install_max_spot(window: &tauri::WebviewWindow) {
        let _ = APP.set(window.app_handle().clone());
        let Some(parent) = hwnd_of(window) else {
            return;
        };
        if spot_of(parent).is_some() {
            return;
        }
        // SAFETY: registering a class and creating a child of our own window
        unsafe {
            let instance = GetModuleHandleW(None).ok().map(|h| h.into());
            let class = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(spot_proc),
                hInstance: instance.unwrap_or_default(),
                lpszClassName: SPOT_CLASS,
                ..Default::default()
            };
            RegisterClassExW(&class);
            let created = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_NOREDIRECTIONBITMAP,
                SPOT_CLASS,
                PCWSTR::null(),
                WS_CHILD | WS_CLIPSIBLINGS,
                0,
                0,
                0,
                0,
                Some(parent),
                None,
                instance,
                None,
            );
            if let Err(error) = created {
                eprintln!("dosik: no Snap layouts on Maximize: {error}");
                return;
            }
        }
        place_max_spot(window);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK_1080P: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };

    #[test]
    fn a_first_window_that_fits_sits_in_the_middle_of_the_work_area() {
        assert_eq!(
            first_placement(WORK_1080P, 1.0, (1440.0, 900.0)),
            Placement::Centered(Rect {
                x: 240,
                y: 70,
                width: 1440,
                height: 900
            })
        );
    }

    #[test]
    fn a_first_window_that_does_not_fit_is_maximized() {
        let small = Rect {
            x: 0,
            y: 0,
            width: 1024,
            height: 728,
        };
        assert_eq!(
            first_placement(small, 1.0, (1440.0, 900.0)),
            Placement::Maximized
        );
        // one pixel short in either direction is enough
        let narrow = Rect {
            width: 1439,
            ..WORK_1080P
        };
        assert_eq!(
            first_placement(narrow, 1.0, (1440.0, 900.0)),
            Placement::Maximized
        );
    }

    #[test]
    fn the_work_area_counts_not_the_screen_a_taskbar_on_the_left() {
        // a 1920×1080 screen with a 48px taskbar on the left
        let area = Rect {
            x: 48,
            y: 0,
            width: 1872,
            height: 1080,
        };
        assert_eq!(
            first_placement(area, 1.0, (1440.0, 900.0)),
            Placement::Centered(Rect {
                x: 48 + 216,
                y: 90,
                width: 1440,
                height: 900
            })
        );
    }

    #[test]
    fn the_size_is_in_logical_pixels_scaled_to_the_monitor() {
        // 150%: 1440×900 is 2160×1350 on the monitor
        let area = Rect {
            x: 0,
            y: 0,
            width: 2560,
            height: 1392,
        };
        assert_eq!(
            first_placement(area, 1.5, (1440.0, 900.0)),
            Placement::Centered(Rect {
                x: 200,
                y: 21,
                width: 2160,
                height: 1350
            })
        );
        // 125% on a 1080p laptop: 1800×1125 is taller than the work area
        assert_eq!(
            first_placement(WORK_1080P, 1.25, (1440.0, 900.0)),
            Placement::Maximized
        );
    }

    #[test]
    fn a_second_monitor_keeps_its_own_origin() {
        let right = Rect {
            x: 1920,
            y: -200,
            width: 2560,
            height: 1400,
        };
        assert_eq!(
            first_placement(right, 1.0, (1440.0, 900.0)),
            Placement::Centered(Rect {
                x: 1920 + 560,
                y: -200 + 250,
                width: 1440,
                height: 900
            })
        );
    }

    #[test]
    fn the_window_menu_opens_at_the_pointer_or_under_the_band() {
        assert_eq!(menu_point((100, 50), 1.0, Some((640, 12))), (640, 12));
        assert_eq!(menu_point((100, 50), 1.0, None), (100, 90));
        assert_eq!(menu_point((100, 50), 1.5, None), (100, 110));
    }

    #[test]
    fn the_window_menu_offers_what_a_title_bar_does() {
        let restored = menu_items(false);
        let maximized = menu_items(true);
        let enabled = |items: [(MenuCommand, bool); 6], c: MenuCommand| {
            items.iter().find(|(command, _)| *command == c).unwrap().1
        };
        assert!(!enabled(restored, MenuCommand::Restore));
        assert!(enabled(restored, MenuCommand::Move));
        assert!(enabled(restored, MenuCommand::Size));
        assert!(enabled(restored, MenuCommand::Maximize));
        assert!(enabled(maximized, MenuCommand::Restore));
        assert!(!enabled(maximized, MenuCommand::Move));
        assert!(!enabled(maximized, MenuCommand::Size));
        assert!(!enabled(maximized, MenuCommand::Maximize));
        for items in [restored, maximized] {
            assert!(enabled(items, MenuCommand::Minimize));
            assert!(enabled(items, MenuCommand::Close));
        }
    }

    #[test]
    fn the_max_spot_covers_the_middle_caption_button() {
        // 1440 wide at 100%: Close is 1394–1440, Maximize 1348–1394
        let maximized = max_spot(1440, 1.0, true, 4);
        assert_eq!(
            maximized,
            Rect {
                x: 1348,
                y: 0,
                width: 46,
                height: 40
            }
        );
        // restored, the top edge stays the resize edge's
        let restored = max_spot(1440, 1.0, false, 4);
        assert_eq!(
            restored,
            Rect {
                x: 1348,
                y: 4,
                width: 46,
                height: 36
            }
        );
        // 150%
        assert_eq!(
            max_spot(2160, 1.5, true, 6),
            Rect {
                x: 2160 - 138,
                y: 0,
                width: 69,
                height: 60
            }
        );
    }

    #[test]
    fn the_max_spot_goes_with_the_caption_buttons_in_full_screen() {
        assert!(max_spot_shown(false));
        assert!(!max_spot_shown(true));
    }

    #[test]
    fn the_spot_states_match_the_web_side() {
        // windowFrame.ts reads these strings
        assert_eq!(SpotState::Rest.as_str(), "rest");
        assert_eq!(SpotState::Hover.as_str(), "hover");
        assert_eq!(SpotState::Pressed.as_str(), "pressed");
        assert_eq!(MAX_BUTTON_EVENT, "window-frame:max-button");
    }

    #[test]
    fn the_caption_sizes_are_the_design_tokens() {
        let tokens: serde_json::Value = serde_json::from_str(include_str!(
            "../../design/design-system/project/tokens.json"
        ))
        .expect("tokens.json parses");
        let layout = |name: &str| -> f64 {
            tokens["layout"]["tokens"]
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["name"] == name)
                .and_then(|t| t["value"].as_str())
                .and_then(|v| v.trim_end_matches("px").parse().ok())
                .unwrap_or_else(|| panic!("no layout token {name}"))
        };
        assert_eq!(CAPTION_BUTTON, layout("caption-button"));
        assert_eq!(CHROME_HEIGHT, layout("chrome-height"));
    }

    #[test]
    fn browser_keys_are_off_in_a_bundle_and_on_in_development() {
        assert!(!browser_keys_enabled(false));
        assert!(browser_keys_enabled(true));
    }
}
