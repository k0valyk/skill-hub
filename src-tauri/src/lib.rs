pub mod analyze;
pub mod agents;
pub mod classify;
pub mod commands;
pub mod db;
pub mod domain;
pub mod export;
pub mod feed;
pub mod github;
pub mod library_ops;
pub mod linking;
pub mod mcp;
pub mod projects;
pub mod scanner;
pub mod security;
pub mod settings;
pub mod stats;
pub mod util;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(commands::AppState::new());

            let open_item = MenuItem::with_id(app, "open", "Відкрити Skill Hub", true, None::<&str>)?;
            let add_item = MenuItem::with_id(app, "add", "Додати за посиланням", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Вийти", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &add_item, &quit_item])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Skill Hub — бібліотека скілів")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "add" => {
                        show_main(app);
                        let _ = app.emit("quick-add", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // Фонова перевірка оновлень раз на добу — не блокує старт.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(25)).await;
                let state = handle.state::<commands::AppState>();
                let settings = state.settings.lock().unwrap().clone();
                if !settings.auto_check_updates {
                    return;
                }
                let due = match settings.last_update_check.as_deref() {
                    Some(last) => chrono::DateTime::parse_from_rfc3339(last)
                        .map(|date| {
                            (chrono::Utc::now() - date.with_timezone(&chrono::Utc)).num_hours() >= 24
                        })
                        .unwrap_or(true),
                    None => true,
                };
                if !due {
                    return;
                }
                let db = state.db.clone();
                let token = settings::get_secret("github_token");
                let result = tauri::async_runtime::spawn_blocking(move || {
                    let handle = db.lock().unwrap();
                    library_ops::check_updates(&handle, token.as_deref())
                })
                .await;
                if let Ok(updates) = result {
                    let behind = updates.iter().filter(|u| u.behind).count();
                    if behind > 0 {
                        let _ = handle.emit("updates:found", behind);
                    }
                    let mut current = handle.state::<commands::AppState>().settings.lock().unwrap().clone();
                    current.last_update_check = Some(util::now_iso());
                    let _ = settings::save(&current);
                    *handle.state::<commands::AppState>().settings.lock().unwrap() = current;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_bootstrap,
            commands::scan_library,
            commands::preview_link,
            commands::preview_batch,
            commands::awesome_candidates,
            commands::install_preview,
            commands::save_preview,
            commands::update_item_fields,
            commands::read_item_text,
            commands::set_enabled,
            commands::get_budget,
            commands::get_settings,
            commands::save_profile,
            commands::delete_profile,
            commands::apply_profile,
            commands::delete_library_item,
            commands::get_stats,
            commands::get_duplicates,
            commands::check_updates,
            commands::update_library_item,
            commands::save_settings,
            commands::set_secret,
            commands::clear_secret,
            commands::github_device_start,
            commands::github_device_poll,
            commands::github_logout,
            commands::github_repos,
            commands::projects_list,
            commands::project_plan,
            commands::project_publish,
            commands::project_sync,
            commands::project_init,
            commands::connect_opencode,
            commands::opencode_status,
            commands::discover_feed,
            commands::export_library,
            commands::import_library,
            commands::backup_library,
            commands::choose_folder,
            commands::open_path,
            commands::open_url,
            commands::opencode_profile_preview,
            commands::agents_list,
            commands::agent_tasks,
            commands::agent_create,
            commands::agent_update,
            commands::agent_toggle,
            commands::agent_delete,
            commands::agent_link_project,
            commands::agent_unlink_project,
            commands::agent_link_skill,
            commands::agent_unlink_skill,
            commands::agent_choose_icon,
            commands::agent_templates,
            commands::agent_export,
            commands::agent_import,
            commands::agent_run_task,
            commands::agent_cancel_task,
            commands::agents_runtime,
            commands::agent_qa_report,
            commands::opencode_models,
            commands::voice_languages,
            commands::voice_listen,
        ])
        .run(tauri::generate_context!())
        .expect("Skill Hub не зміг запуститися");
}
