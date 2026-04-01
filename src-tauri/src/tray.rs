use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

/// Holds the tray icon to prevent it from being dropped (which removes it from the menu bar).
pub struct TrayState {
    pub _tray: tauri::tray::TrayIcon,
}

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItemBuilder::with_id("show", "Show Wren").build(app)?;
    let settings_item = MenuItemBuilder::with_id("tray_settings", "Settings...").build(app)?;
    let quit_item = MenuItemBuilder::with_id("tray_quit", "Quit Wren").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .separator()
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()?;

    // Load tray icon
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon@2x.png"))
        .map_err(|e| format!("Failed to load tray icon: {}", e))?;

    let tray = TrayIconBuilder::with_id("wren-tray")
        .tooltip("Wren")
        .icon(icon)
        .icon_as_template(false)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app_handle, event| {
            handle_menu_event(app_handle, event.id().as_ref());
        })
        .build(app)?;

    app.manage(TrayState { _tray: tray });
    tracing::info!("System tray initialized");
    Ok(())
}

fn handle_menu_event(app_handle: &tauri::AppHandle, id: &str) {
    match id {
        "show" => {
            show_main_window(app_handle);
        }
        "tray_settings" => {
            show_main_window(app_handle);
            use tauri::Emitter;
            let _ = app_handle.emit("menu:open-settings", ());
        }
        "tray_quit" => {
            app_handle.exit(0);
        }
        _ => {}
    }
}

pub fn show_main_window(app_handle: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app_handle.set_dock_visibility(true);
        restore_dock_icon();
    }
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Explicitly re-set the dock icon after showing.
/// `set_dock_visibility(true)` restores the dock entry but macOS loses the
/// programmatic icon image (especially in dev mode where there is no .app bundle).
#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn restore_dock_icon() {
    unsafe {
        use cocoa::base::id;
        use objc::*;

        let icon_bytes = include_bytes!("../icons/128x128@2x.png");
        let ns_data: id = msg_send![class!(NSData),
            dataWithBytes: icon_bytes.as_ptr()
            length: icon_bytes.len()
        ];
        let ns_image: id = msg_send![class!(NSImage), alloc];
        let ns_image: id = msg_send![ns_image, initWithData: ns_data];
        let app: id = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![app, setApplicationIconImage: ns_image];
    }
}
