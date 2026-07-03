use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;

// ── Keychain (file-based, stored in app data directory) ──

fn keychain_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    path.push("keychain.json");
    Ok(path)
}

fn keychain_path_from_env(app: &tauri::AppHandle) -> PathBuf {
    keychain_path(app).unwrap_or_else(|_| PathBuf::from("keychain.json"))
}

#[tauri::command]
fn store_keychain(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let path = keychain_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::json!({ "nsec": key });
    fs::write(&path, serde_json::to_string(&data).unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_keychain(app: tauri::AppHandle) -> Option<String> {
    let path = keychain_path_from_env(&app);
    let contents = fs::read_to_string(path).ok()?;
    let data: serde_json::Value = serde_json::from_str(&contents).ok()?;
    data.get("nsec")?.as_str().map(|s| s.to_string())
}

#[tauri::command]
fn clear_keychain(app: tauri::AppHandle) -> Result<(), String> {
    let path = keychain_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
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
