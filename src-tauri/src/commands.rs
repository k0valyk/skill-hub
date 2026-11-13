use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::db::Db;
use crate::domain::{Budget, DuplicateGroup, Item, Kind, Preview, Profile, ProjectInfo, RepoMeta, Stats};
use crate::library_ops::{UpdateInfo, UpdateResult};
use crate::settings::{SecretStatus, Settings};

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub db: Arc<Mutex<Db>>,
    pub http: reqwest::Client,
    pub pending: Mutex<HashMap<String, RepoMeta>>,
    pub startup_error: Mutex<Option<String>>,
}

impl AppState {
    pub fn new() -> Self {
        let mut settings = crate::settings::load();
        let mut startup_error = None;
        let root = settings.root_path();
        let mut db = None;
        if let Err(err) = crate::settings::ensure_dirs(&root) {
            startup_error = Some(err.to_string());
        } else {
            match Db::open(&root.join(".skillhub/skillhub.db")) {
                Ok(handle) => db = Some(handle),
                Err(err) => startup_error = Some(err.to_string()),
            }
        }
        if db.is_none() {
            let fallback = std::env::temp_dir().join("SkillHub");
            let _ = crate::settings::ensure_dirs(&fallback);
            settings.root = fallback.to_string_lossy().to_string();
            let handle = Db::open(&fallback.join(".skillhub/skillhub.db"))
                .unwrap_or_else(|e| panic!("Skill Hub не може відкрити базу даних: {e}"));
            db = Some(handle);
        }
        let http = reqwest::Client::builder()
            .user_agent("SkillHub/0.1")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("http client");
        AppState {
            settings: Mutex::new(settings),
            db: Arc::new(Mutex::new(db.expect("db"))),
            http,
            pending: Mutex::new(HashMap::new()),
            startup_error: Mutex::new(startup_error),
        }
    }

    pub fn root(&self) -> PathBuf {
        self.settings.lock().unwrap().root_path()
    }

    pub fn threshold(&self) -> i64 {
        self.settings.lock().unwrap().context_budget
    }

    pub fn github(&self) -> crate::github::GitHub {
        crate::github::GitHub::new(crate::settings::get_secret("github_token"))
    }

    pub fn pending_meta(&self, url: &str) -> Option<RepoMeta> {
        self.pending.lock().unwrap().remove(url)
    }

    pub fn remember_meta(&self, url: &str, meta: RepoMeta) {
        let mut map = self.pending.lock().unwrap();
        if map.len() > 24 {
            map.clear();
        }
        map.insert(url.to_string(), meta);
    }
}

pub fn db_file(root: &Path) -> PathBuf {
    root.join(".skillhub").join("skillhub.db")
}

pub fn ensure_cli(root: &Path) -> Result<PathBuf> {
    let bin_name = if cfg!(windows) {
        "skillhub-cli.exe"
    } else {
        "skillhub-cli"
    };
    let dest_dir = root.join(".skillhub").join("bin");
    std::fs::create_dir_all(&dest_dir)?;
    let dest = dest_dir.join(bin_name);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(custom) = std::env::var("SKILLHUB_CLI") {
        candidates.push(PathBuf::from(custom));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(bin_name));
            candidates.push(dir.join("..").join("release").join(bin_name));
            candidates.push(dir.join("..").join("debug").join(bin_name));
            candidates.push(dir.join("..").join("..").join("target/debug").join(bin_name));
            candidates.push(dir.join("..").join("..").join("target/release").join(bin_name));
        }
    }
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()))
    {
        candidates.push(exe_dir.join("resources").join(bin_name));
    }
    for candidate in candidates {
        if is_real_cli(&candidate) {
            std::fs::copy(&candidate, &dest)?;
            return Ok(dest);
        }
    }
    if is_real_cli(&dest) {
        return Ok(dest);
    }
    Err(anyhow!(
        "Не знайдено skillhub-cli поруч із програмою. Збери його: `cargo build --release --bin skillhub-cli` (файл має лежати в src-tauri/target/release/)."
    ))
}

/// Заглушка, яку build.rs створює для перевірки externalBin, має нульовий
/// розмір. Справжній CLI — це кілька мегабайтів, тому маленькі файли ігноруємо,
/// щоб не скопіювати порожній exe в `.skillhub/bin`.
fn is_real_cli(path: &Path) -> bool {
    path.is_file()
        && std::fs::metadata(path)
            .map(|meta| meta.len() > 64 * 1024)
            .unwrap_or(false)
}

pub fn open_db(root: &Path) -> Result<Db> {
    crate::settings::ensure_dirs(root)?;
    Db::open(&db_file(root))
}

// ---------- серіалізовані відповіді ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeInfo {
    pub connected: bool,
    pub cli_path: Option<String>,
    pub config_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub settings: Settings,
    pub secrets: SecretStatus,
    pub items: Vec<Item>,
    pub profiles: Vec<Profile>,
    pub budget: Budget,
    pub opencode: OpencodeInfo,
    pub git_version: String,
    pub app_version: String,
    pub startup_error: Option<String>,
    pub analysis_tokens_in: i64,
    pub analysis_tokens_out: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFailure {
    pub url: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPreview {
    pub previews: Vec<Preview>,
    pub failures: Vec<PreviewFailure>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwesomeCandidate {
    pub url: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItemPatch {
    pub name: Option<String>,
    pub kind: Option<String>,
    pub tags: Option<Vec<String>>,
    pub summary_uk: Option<String>,
    pub summary_en: Option<String>,
    pub favorite: Option<bool>,
    pub rating: Option<i64>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleResult {
    pub item: Item,
    pub budget: Budget,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepo {
    pub name: String,
    pub full_name: String,
    pub url: String,
    pub private: bool,
    pub stars: i64,
    pub updated_at: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionOutcome {
    pub ok: bool,
    pub message: String,
    pub detail: Option<String>,
}

pub fn humanize(err: &anyhow::Error) -> String {
    let mut text = err.to_string();
    if let Some(source) = err.source() {
        let extra = source.to_string();
        if !text.contains(&extra) {
            text.push_str(&format!(" Причина: {extra}"));
        }
    }
    text
}

// ---------- команди ----------

#[tauri::command]
pub async fn app_bootstrap(state: tauri::State<'_, AppState>) -> Result<Bootstrap, String> {
    let root = state.root();
    let db = state.db.clone();
    let scan_root = root.clone();
    let items = tauri::async_runtime::spawn_blocking(move || {
        let handle = db.lock().unwrap();
        crate::scanner::scan(&scan_root, &handle)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| humanize(&e))?;

    let handle = state.db.lock().unwrap();
    let profiles = handle.profiles().unwrap_or_default();
    let (tokens_in, tokens_out) = handle.token_totals();
    let budget = handle.budget(state.threshold());
    drop(handle);
    let settings = state.settings.lock().unwrap().clone();
    let secrets = crate::settings::secret_status();
    let cli = ensure_cli(&root).ok();
    Ok(Bootstrap {
        settings,
        secrets,
        items,
        profiles,
        budget,
        opencode: OpencodeInfo {
            connected: crate::linking::opencode_connected(),
            cli_path: cli.map(|p| p.to_string_lossy().to_string()),
            config_path: crate::linking::opencode_config_dir()
                .join("opencode.json")
                .to_string_lossy()
                .to_string(),
        },
        git_version: crate::projects::hidden_git_version(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        startup_error: state.startup_error.lock().unwrap().clone(),
        analysis_tokens_in: tokens_in,
        analysis_tokens_out: tokens_out,
    })
}

#[tauri::command]
pub async fn scan_library(state: tauri::State<'_, AppState>) -> Result<Vec<Item>, String> {
    let root = state.root();
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let handle = db.lock().unwrap();
        crate::scanner::scan(&root, &handle)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| humanize(&e))
}

#[tauri::command]
pub async fn preview_link(
    url: String,
    state: tauri::State<'_, AppState>,
) -> Result<Preview, String> {
    let settings = state.settings.lock().unwrap().clone();
    let gh = state.github();
    let lang = settings.language.clone();
    let model = settings.deepseek_model.clone();
    let url_trimmed = url.trim().to_string();
    let parsed = crate::github::parse_url(&url_trimmed).map_err(|e| humanize(&e))?;
    let meta = crate::analyze::fetch_meta(&gh, &parsed)
        .await
        .map_err(|e| humanize(&e))?;
    state.remember_meta(&url_trimmed, meta.clone());
    let preview = crate::analyze::preview_with_meta(
        &gh,
        state.db.as_ref(),
        &parsed,
        meta,
        &lang,
        &model,
    )
    .await
    .map_err(|e| humanize(&e))?;
    Ok(preview)
}

#[tauri::command]
pub async fn preview_batch(
    input: String,
    state: tauri::State<'_, AppState>,
) -> Result<BatchPreview, String> {
    let urls: Vec<String> = crate::github::parse_awesome(&input)
        .into_iter()
        .map(|(url, _, _)| url)
        .collect();
    let urls: Vec<String> = if urls.is_empty() {
        input
            .lines()
            .flat_map(|line| line.split_whitespace())
            .filter(|token| token.contains("github.com") || token.contains("gist.github.com"))
            .map(|s| s.trim().to_string())
            .collect()
    } else {
        urls
    };
    let mut urls: Vec<String> = urls
        .into_iter()
        .filter(|u| u.contains("github.com"))
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    urls.truncate(8);
    if urls.is_empty() {
        return Err("Не знайшов посилань GitHub у тексті.".into());
    }
    let settings = state.settings.lock().unwrap().clone();
    let gh = state.github();
    let mut previews = Vec::new();
    let mut failures = Vec::new();
    for url in urls {
        match crate::github::parse_url(&url) {
            Ok(parsed) => match crate::analyze::fetch_meta(&gh, &parsed).await {
                Ok(meta) => {
                    state.remember_meta(&url, meta.clone());
                    match crate::analyze::preview_with_meta(
                        &gh,
                        state.db.as_ref(),
                        &parsed,
                        meta,
                        &settings.language,
                        &settings.deepseek_model,
                    )
                    .await
                    {
                        Ok(preview) => previews.push(preview),
                        Err(err) => failures.push(PreviewFailure {
                            url,
                            error: humanize(&err),
                        }),
                    }
                }
                Err(err) => failures.push(PreviewFailure {
                    url,
                    error: humanize(&err),
                }),
            },
            Err(err) => failures.push(PreviewFailure {
                url,
                error: humanize(&err),
            }),
        }
    }
    Ok(BatchPreview { previews, failures })
}

#[tauri::command]
pub async fn awesome_candidates(
    url: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AwesomeCandidate>, String> {
    let gh = state.github();
    let parsed = crate::github::parse_url(&url).map_err(|e| humanize(&e))?;
    let meta = crate::analyze::fetch_meta(&gh, &parsed)
        .await
        .map_err(|e| humanize(&e))?;
    let items: Vec<AwesomeCandidate> = crate::github::parse_awesome(&meta.readme)
        .into_iter()
        .map(|(url, name, description)| AwesomeCandidate {
            url,
            name,
            description,
        })
        .collect();
    if items.is_empty() {
        return Err("У цьому README не знайдено посилань на GitHub-проєкти.".into());
    }
    Ok(items)
}

#[tauri::command]
pub async fn install_preview(
    preview: Preview,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Item, String> {
    use tauri::Emitter;
    let root = state.root();
    let db = state.db.clone();
    let gh = state.github();
    let meta = state.pending_meta(&preview.url);
    let meta = match meta {
        Some(meta) => Some(meta),
        None => {
            let parsed = crate::github::parse_url(&preview.url).map_err(|e| humanize(&e))?;
            Some(
                crate::analyze::fetch_meta(&gh, &parsed)
                    .await
                    .map_err(|e| humanize(&e))?,
            )
        }
    };
    let app_handle = app.clone();
    let url_label = preview.url.clone();
    let result = {
        let handle = db.lock().unwrap();
        crate::library_ops::install(&handle, &root, &preview, meta, |stage, pct| {
            let _ = app_handle.emit(
                "install:progress",
                serde_json::json!({"url": url_label, "stage": stage, "pct": pct}),
            );
        })
        .map_err(|e| humanize(&e))?
    };
    let _ = app.emit("library:changed", ());
    Ok(result)
}

#[tauri::command]
pub async fn save_preview(
    preview: Preview,
    state: tauri::State<'_, AppState>,
) -> Result<Item, String> {
    let handle = state.db.lock().unwrap();
    let item = crate::library_ops::save_link(&handle, &preview).map_err(|e| humanize(&e))?;
    Ok(item)
}

#[tauri::command]
pub async fn update_item_fields(
    id: String,
    patch: ItemPatch,
    state: tauri::State<'_, AppState>,
) -> Result<Item, String> {
    let handle = state.db.lock().unwrap();
    let mut item = handle
        .get_item(&id)
        .map_err(|e| humanize(&e))?
        .ok_or_else(|| "Елемент не знайдено".to_string())?;
    let old_tags = item.tags.clone();
    if let Some(name) = patch.name {
        if !name.trim().is_empty() {
            item.name = name.trim().to_string();
        }
    }
    if let Some(kind) = patch.kind {
        item.kind = Kind::from_str(&kind);
    }
    if let Some(tags) = patch.tags {
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        item.tags = tags
            .into_iter()
            .map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty() && seen.insert(t.clone()))
            .take(10)
            .collect();
    }
    if let Some(summary) = patch.summary_uk {
        item.summary_uk = summary;
    }
    if let Some(summary) = patch.summary_en {
        item.summary_en = summary;
    }
    if let Some(favorite) = patch.favorite {
        item.favorite = favorite;
    }
    if let Some(rating) = patch.rating {
        item.rating = rating.clamp(0, 5);
    }
    if let Some(notes) = patch.notes {
        item.notes = notes;
    }
    item.updated_at = crate::util::now_iso();

    // Запам'ятовуємо правило для цього джерела.
    if let Some(source) = &item.source_url {
        if let Ok(parsed) = crate::github::parse_url(source) {
            let host_key = if parsed.is_gist {
                format!("gist:{}", parsed.owner)
            } else {
                format!("github:{}", parsed.owner.to_lowercase())
            };
            let removed: Vec<String> = old_tags
                .iter()
                .filter(|t| !item.tags.contains(t))
                .cloned()
                .collect();
            let _ = handle.upsert_host_rule(&host_key, Some(item.kind.as_str()), &item.tags, &removed);
        }
    }
    if !item.path.is_empty() && Path::new(&item.path).exists() {
        let _ = crate::scanner::write_manifest(Path::new(&item.path), &item);
    }
    handle.upsert_item(&item).map_err(|e| humanize(&e))?;
    Ok(item)
}

#[tauri::command]
pub async fn read_item_text(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let handle = state.db.lock().unwrap();
    let item = handle
        .get_item(&id)
        .map_err(|e| humanize(&e))?
        .ok_or_else(|| "Елемент не знайдено".to_string())?;
    let text = crate::scanner::read_item_text(&item).map_err(|e| humanize(&e))?;
    Ok(text.chars().take(60_000).collect())
}

#[tauri::command]
pub async fn set_enabled(
    id: String,
    enabled: bool,
    scope: Option<String>,
    project: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<ToggleResult, String> {
    let scope_value = scope.unwrap_or_else(|| "global".into());
    let project_path = project.filter(|p| !p.trim().is_empty()).map(PathBuf::from);
    if scope_value == "project" && project_path.is_none() {
        return Err("Вибери папку проєкту для проєктного підключення.".into());
    }
    let handle = state.db.lock().unwrap();
    let item = handle
        .get_item(&id)
        .map_err(|e| humanize(&e))?
        .ok_or_else(|| "Елемент не знайдено".to_string())?;
    if enabled {
        crate::linking::enable(&handle, &item, &scope_value, project_path.as_deref())
            .map_err(|e| humanize(&e))?;
    } else {
        crate::linking::disable(&handle, &id, &scope_value, project_path.as_deref())
            .map_err(|e| humanize(&e))?;
    }
    let budget = handle.budget(state.threshold());
    let updated = handle
        .get_item(&id)
        .map_err(|e| humanize(&e))?
        .ok_or_else(|| "Елемент зник".to_string())?;
    drop(handle);
    let _ = crate::linking::verify_links(&state.db.lock().unwrap());
    Ok(ToggleResult {
        item: updated,
        budget,
    })
}

#[tauri::command]
pub async fn get_budget(state: tauri::State<'_, AppState>) -> Result<Budget, String> {
    let handle = state.db.lock().unwrap();
    Ok(handle.budget(state.threshold()))
}

#[tauri::command]
pub async fn get_settings(state: tauri::State<'_, AppState>) -> Result<Settings, String> {
    Ok(state.settings.lock().unwrap().clone())
}

#[tauri::command]
pub async fn save_profile(
    profile: Profile,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Profile>, String> {
    let handle = state.db.lock().unwrap();
    handle.save_profile(&profile).map_err(|e| humanize(&e))?;
    handle.profiles().map_err(|e| humanize(&e))
}

#[tauri::command]
pub async fn delete_profile(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Profile>, String> {
    let handle = state.db.lock().unwrap();
    handle.delete_profile(&id).map_err(|e| humanize(&e))?;
    handle.profiles().map_err(|e| humanize(&e))
}

#[tauri::command]
pub async fn apply_profile(
    id: String,
    scope: Option<String>,
    project: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Item>, String> {
    let handle = state.db.lock().unwrap();
    let profiles = handle.profiles().map_err(|e| humanize(&e))?;
    let profile = profiles
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "Профіль не знайдено".to_string())?;
    let scope_value = scope.unwrap_or_else(|| "global".into());
    let project_path = project.filter(|p| !p.trim().is_empty()).map(PathBuf::from);
    let items = handle.items().unwrap_or_default();
    for item in items.iter().filter(|i| profile.item_ids.contains(&i.id)) {
        if item.has_local_files {
            let _ = crate::linking::enable(&handle, item, &scope_value, project_path.as_deref());
        }
    }
    let result = handle.items().map_err(|e| humanize(&e))?;
    Ok(result)
}

#[tauri::command]
pub async fn delete_library_item(
    id: String,
    remove_files: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Item>, String> {
    let root = state.root();
    let handle = state.db.lock().unwrap();
    crate::library_ops::delete(&handle, &root, &id, remove_files.unwrap_or(false))
        .map_err(|e| humanize(&e))?;
    crate::scanner::scan(&root, &handle).map_err(|e| humanize(&e))
}

#[tauri::command]
pub async fn get_stats(state: tauri::State<'_, AppState>) -> Result<Stats, String> {
    let handle = state.db.lock().unwrap();
    Ok(crate::stats::compute(&handle, state.threshold()))
}

#[tauri::command]
pub async fn get_duplicates(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DuplicateGroup>, String> {
    let handle = state.db.lock().unwrap();
    Ok(crate::stats::duplicates(&handle))
}

#[tauri::command]
pub async fn check_updates(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<UpdateInfo>, String> {
    let db = state.db.clone();
    let token = crate::settings::get_secret("github_token");
    let updates = tauri::async_runtime::spawn_blocking(move || {
        let handle = db.lock().unwrap();
        crate::library_ops::check_updates(&handle, token.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?;
    let mut settings = state.settings.lock().unwrap().clone();
    settings.last_update_check = Some(crate::util::now_iso());
    let _ = crate::settings::save(&settings);
    *state.settings.lock().unwrap() = settings;
    Ok(updates)
}

#[tauri::command]
pub async fn update_library_item(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<UpdateResult, String> {
    let root = state.root();
    let gh = state.github();
    let result = crate::library_ops::update_item(&gh, state.db.as_ref(), &root, &id)
        .await
        .map_err(|e| humanize(&e))?;
    Ok(result)
}

#[tauri::command]
pub async fn save_settings(
    next: Settings,
    state: tauri::State<'_, AppState>,
) -> Result<Settings, String> {
    let old_root = state.root();
    let new_root = next.root_path();
    crate::settings::ensure_dirs(&new_root).map_err(|e| humanize(&e))?;
    let mut sanitized = next;
    sanitized.context_budget = sanitized.context_budget.clamp(500, 200_000);
    if sanitized.workspace_missing() {
        return Err("Вкажи коректну папку бібліотеки.".into());
    }
    crate::settings::save(&sanitized).map_err(|e| humanize(&e))?;
    if old_root != new_root {
        let new_db = Db::open(&db_file(&new_root)).map_err(|e| humanize(&e))?;
        *state.db.lock().unwrap() = new_db;
        let handle = state.db.lock().unwrap();
        let _ = crate::scanner::scan(&new_root, &handle);
    }
    *state.settings.lock().unwrap() = sanitized.clone();
    Ok(sanitized)
}

#[tauri::command]
pub async fn set_secret(
    kind: String,
    value: String,
    state: tauri::State<'_, AppState>,
) -> Result<SecretStatus, String> {
    match kind.as_str() {
        "deepseek" => {
            crate::settings::set_secret("deepseek_api_key", &value).map_err(|e| humanize(&e))?;
            let _ = state.db.lock().unwrap().kv_set("deepseek_key_added", &crate::util::now_iso());
        }
        "github" => {
            if value.trim().is_empty() {
                crate::settings::delete_secret("github_token");
            } else {
                let gh = crate::github::GitHub::new(Some(value.trim().to_string()));
                let user = gh.user().await.map_err(|e| {
                    format!(
                        "GitHub не прийняв токен. Перевір, що він активний і має scope repo. ({})",
                        humanize(&e)
                    )
                })?;
                let login = user
                    .get("login")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                crate::settings::set_secret("github_token", value.trim())
                    .map_err(|e| humanize(&e))?;
                let mut settings = state.settings.lock().unwrap().clone();
                settings.github_login = Some(login);
                let _ = crate::settings::save(&settings);
                *state.settings.lock().unwrap() = settings;
            }
        }
        _ => return Err("Невідомий тип секрету.".into()),
    }
    Ok(crate::settings::secret_status())
}

#[tauri::command]
pub async fn clear_secret(kind: String) -> Result<SecretStatus, String> {
    match kind.as_str() {
        "deepseek" => crate::settings::delete_secret("deepseek_api_key"),
        "github" => crate::settings::delete_secret("github_token"),
        _ => return Err("Невідомий тип секрету.".into()),
    }
    Ok(crate::settings::secret_status())
}

#[tauri::command]
pub async fn github_device_start(
    state: tauri::State<'_, AppState>,
) -> Result<crate::github::DeviceStart, String> {
    let client_id = state.settings.lock().unwrap().github_client_id.clone();
    let device = crate::github::device_start(&state.http, &client_id)
        .await
        .map_err(|e| humanize(&e))?;
    let _ = open::that(&device.verification_uri);
    Ok(device)
}

#[tauri::command]
pub async fn github_device_poll(
    device_code: String,
    state: tauri::State<'_, AppState>,
) -> Result<crate::github::DevicePoll, String> {
    let client_id = state.settings.lock().unwrap().github_client_id.clone();
    let poll = crate::github::device_poll(&state.http, &client_id, &device_code)
        .await
        .map_err(|e| humanize(&e))?;
    if poll.state == "ok" {
        if let Some(token) = &poll.token {
            crate::settings::set_secret("github_token", token).map_err(|e| humanize(&e))?;
            let gh = crate::github::GitHub::new(Some(token.clone()));
            if let Ok(user) = gh.user().await {
                let login = user
                    .get("login")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let mut settings = state.settings.lock().unwrap().clone();
                settings.github_login = login;
                let _ = crate::settings::save(&settings);
                *state.settings.lock().unwrap() = settings;
            }
        }
    }
    Ok(poll)
}

#[tauri::command]
pub async fn github_logout(state: tauri::State<'_, AppState>) -> Result<SecretStatus, String> {
    crate::settings::delete_secret("github_token");
    let mut settings = state.settings.lock().unwrap().clone();
    settings.github_login = None;
    let _ = crate::settings::save(&settings);
    *state.settings.lock().unwrap() = settings;
    Ok(crate::settings::secret_status())
}

#[tauri::command]
pub async fn github_repos(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<GithubRepo>, String> {
    let gh = state.github();
    if gh.token.is_none() {
        return Err("Спочатку увійди в GitHub.".into());
    }
    let repos = gh.repos().await.map_err(|e| humanize(&e))?;
    Ok(repos
        .into_iter()
        .map(|repo| GithubRepo {
            name: repo
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            full_name: repo
                .get("full_name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            url: repo
                .get("html_url")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            private: repo.get("private").and_then(|v| v.as_bool()).unwrap_or(false),
            stars: repo
                .get("stargazers_count")
                .and_then(|v| v.as_i64())
                .unwrap_or(0),
            updated_at: repo
                .get("updated_at")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            description: repo
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
        .collect())
}

#[tauri::command]
pub async fn projects_list(state: tauri::State<'_, AppState>) -> Result<Vec<ProjectInfo>, String> {
    let root = state.root();
    tauri::async_runtime::spawn_blocking(move || crate::projects::list(&root))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_plan(
    path: String,
) -> Result<crate::projects::PublishPlan, String> {
    tauri::async_runtime::spawn_blocking(move || crate::projects::plan(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| humanize(&e))
}

#[tauri::command]
pub async fn project_publish(
    path: String,
    name: String,
    private: bool,
    description: String,
    message: String,
    allow_secrets: bool,
    confirm_public: bool,
    state: tauri::State<'_, AppState>,
) -> Result<crate::projects::PublishResult, String> {
    let gh = state.github();
    if gh.token.is_none() {
        return Err("Спочатку увійди в GitHub у налаштуваннях.".into());
    }
    crate::projects::publish(
        &gh,
        Path::new(&path),
        &name,
        private,
        &description,
        &message,
        allow_secrets,
        confirm_public,
    )
    .await
    .map_err(|e| humanize(&e))
}

#[tauri::command]
pub async fn project_sync(
    path: String,
) -> Result<ProjectInfo, String> {
    let token = crate::settings::get_secret("github_token");
    tauri::async_runtime::spawn_blocking(move || {
        crate::projects::sync(Path::new(&path), token.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| humanize(&e))
}

#[tauri::command]
pub async fn project_init(
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let root = state.root();
    crate::projects::init_project(&root.join("projects"), &name).map_err(|e| humanize(&e))
}

#[tauri::command]
pub async fn connect_opencode(
    scope: Option<String>,
    project: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let root = state.root();
    let cli = ensure_cli(&root).map_err(|e| humanize(&e))?;
    let project_path = project.filter(|p| !p.trim().is_empty()).map(PathBuf::from);
    let scope_value = scope.unwrap_or_else(|| "global".into());
    crate::linking::connect_opencode(&scope_value, project_path.as_deref(), &cli)
        .map_err(|e| humanize(&e))
}

#[tauri::command]
pub async fn opencode_status(
    state: tauri::State<'_, AppState>,
) -> Result<OpencodeInfo, String> {
    let root = state.root();
    Ok(OpencodeInfo {
        connected: crate::linking::opencode_connected(),
        cli_path: ensure_cli(&root)
            .ok()
            .map(|p| p.to_string_lossy().to_string()),
        config_path: crate::linking::opencode_config_dir()
            .join("opencode.json")
            .to_string_lossy()
            .to_string(),
    })
}

#[tauri::command]
pub async fn discover_feed(
    force: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<crate::domain::FeedCard>, String> {
    let gh = state.github();
    let db = state.db.clone();
    crate::feed::discover(&gh, db.as_ref(), force.unwrap_or(false))
        .await
        .map_err(|e| humanize(&e))
}

#[tauri::command]
pub async fn export_library(
    dest: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let target = match dest {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => {
            let file = rfd::AsyncFileDialog::new()
                .set_file_name(format!("skillhub-{}.zip", crate::util::today()))
                .add_filter("Skill Hub archive", &["zip"])
                .save_file()
                .await
                .ok_or_else(|| "Експорт скасовано".to_string())?;
            file.path().to_path_buf()
        }
    };
    let root = state.root();
    let db = state.db.clone();
    let dest_clone = target.clone();
    let count = tauri::async_runtime::spawn_blocking(move || {
        let handle = db.lock().unwrap();
        crate::export::export(&handle, &root, &dest_clone)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| humanize(&e))?;
    Ok(format!("{} ({} файлів)", target.display(), count))
}

#[tauri::command]
pub async fn import_library(
    src: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<crate::export::ImportResult, String> {
    let source = match src {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => {
            let file = rfd::AsyncFileDialog::new()
                .add_filter("Skill Hub archive", &["zip"])
                .pick_file()
                .await
                .ok_or_else(|| "Імпорт скасовано".to_string())?;
            file.path().to_path_buf()
        }
    };
    let root = state.root();
    let db = state.db.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let handle = db.lock().unwrap();
        let result = crate::export::import(&handle, &root, &source)?;
        let _ = crate::scanner::scan(&root, &handle);
        Ok::<_, anyhow::Error>(result)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| humanize(&e))?;
    Ok(result)
}

#[tauri::command]
pub async fn backup_library(
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let root = state.root();
    let gh = state.github();
    if gh.token.is_none() {
        return Err("Спочатку увійди в GitHub у налаштуваннях.".into());
    }
    let name = state
        .settings
        .lock()
        .unwrap()
        .github_backup_repo
        .clone()
        .unwrap_or_else(|| "skillhub-library".into());
    let url = crate::projects::backup_library(&root, &gh, &name)
        .await
        .map_err(|e| humanize(&e))?;
    let mut settings = state.settings.lock().unwrap().clone();
    settings.github_backup_repo = Some(name);
    let _ = crate::settings::save(&settings);
    *state.settings.lock().unwrap() = settings;
    Ok(url)
}

#[tauri::command]
pub async fn choose_folder() -> Result<Option<String>, String> {
    Ok(rfd::AsyncFileDialog::new()
        .pick_folder()
        .await
        .map(|f| f.path().to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("Шлях не існує: {path}"));
    }
    let arg = if target.is_dir() {
        target
    } else {
        target.parent().unwrap_or(Path::new(".")).to_path_buf()
    };
    open::that(arg).map_err(|e| format!("Не вдалося відкрити провідник: {e}"))
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| format!("Не вдалося відкрити посилання: {e}"))
}

#[tauri::command]
pub async fn opencode_profile_preview() -> Result<String, String> {
    Ok(crate::linking::opencode_config_dir()
        .join("skills")
        .to_string_lossy()
        .to_string())
}
