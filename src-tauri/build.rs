fn main() {
    // Tauri's own manifest with Windows 10 declared: without it the app runs
    // in Windows 7's compatibility mode, where a layered child window — the
    // spot that gives Maximize its Snap layouts (`window_frame.rs`) — cannot
    // be created
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run build script");
}
