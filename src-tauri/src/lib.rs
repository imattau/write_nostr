use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;

// ── Keychain ──

#[tauri::command]
fn store_keychain(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new("write_nostr", "nsec").map_err(|e| e.to_string())?;
    entry.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_keychain() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new("write_nostr", "nsec").map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn clear_keychain() -> Result<(), String> {
    let entry = keyring::Entry::new("write_nostr", "nsec").map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}

// ── File export ──

#[tauri::command]
fn save_markdown(app: tauri::AppHandle, title: String, content: String) -> Result<String, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .set_file_name(format!("{}.md", title))
        .blocking_save_file()
        .ok_or("Save cancelled")?;
    std::fs::write(file.as_path().ok_or("Invalid path")?, content).map_err(|e| e.to_string())?;
    Ok(file.to_string())
}

// ── Notifications ──

#[tauri::command]
fn notify_new_article(app: tauri::AppHandle, author: String, title: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(format!("New article by {}", author))
        .body(title)
        .show()
        .map_err(|e| e.to_string())
}

// ── App entry ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            store_keychain,
            get_keychain,
            clear_keychain,
            save_markdown,
            notify_new_article,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
