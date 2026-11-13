use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::util::{default_root, expand_home, write_atomic};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub root: String,
    pub theme: String,
    pub accent: String,
    pub language: String,
    pub deepseek_model: String,
    pub context_budget: i64,
    pub auto_check_updates: bool,
    pub last_update_check: Option<String>,
    pub github_client_id: String,
    pub github_login: Option<String>,
    pub github_backup_repo: Option<String>,
    pub reduce_motion: bool,
    pub onboarded: bool,
    pub project_dir: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            root: default_root().to_string_lossy().to_string(),
            theme: "dark".into(),
            accent: "violet".into(),
            language: "uk".into(),
            deepseek_model: "deepseek-chat".into(),
            context_budget: 6000,
            auto_check_updates: true,
            last_update_check: None,
            github_client_id: String::new(),
            github_login: None,
            github_backup_repo: None,
            reduce_motion: false,
            onboarded: false,
            project_dir: None,
        }
    }
}

pub fn config_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("SKILLHUB_CONFIG_DIR") {
        return PathBuf::from(custom);
    }
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("dev.skillhub.app")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    let path = settings_path();
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<Settings>(&text).unwrap_or_default(),
        Err(_) => {
            let defaults = Settings::default();
            let _ = save(&defaults);
            defaults
        }
    }
}

pub fn save(settings: &Settings) -> Result<()> {
    let text = serde_json::to_vec_pretty(settings)?;
    write_atomic(&settings_path(), &text)
}

impl Settings {
    pub fn root_path(&self) -> PathBuf {
        expand_home(&self.root)
    }

    pub fn workspace_missing(&self) -> bool {
        self.root.trim().is_empty()
    }

    pub fn project_root(&self) -> PathBuf {
        match &self.project_dir {
            Some(dir) if !dir.trim().is_empty() => expand_home(dir),
            _ => self.root_path().join("projects"),
        }
    }
}

pub fn ensure_dirs(root: &Path) -> Result<()> {
    let dirs = [
        "library/skills",
        "library/plugins",
        "library/agents",
        "library/commands",
        "library/token-savers",
        "library/mcp",
        "library/prompts",
        "library/themes",
        "library/other",
        "projects",
        ".skillhub/logs",
        ".skillhub/cache",
        ".skillhub/backups",
    ];
    for dir in dirs {
        std::fs::create_dir_all(root.join(dir))
            .with_context(|| format!("Не вдалося створити папку {dir}"))?;
    }
    Ok(())
}

// ---------- секрети ----------

const SERVICE: &str = "SkillHub";

pub fn set_secret(name: &str, value: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, name)
        .map_err(|e| anyhow::anyhow!("Сховище секретів недоступне: {e}"))?;
    if value.trim().is_empty() {
        let _ = entry.delete_password();
        return Ok(());
    }
    entry
        .set_password(value.trim())
        .map_err(|e| anyhow::anyhow!("Не вдалося зберегти секрет у Windows Credential Manager: {e}"))
}

pub fn get_secret(name: &str) -> Option<String> {
    if let Ok(value) = std::env::var(env_name(name)) {
        if !value.trim().is_empty() {
            return Some(value.trim().to_string());
        }
    }
    let entry = keyring::Entry::new(SERVICE, name).ok()?;
    entry.get_password().ok().filter(|v| !v.trim().is_empty())
}

pub fn delete_secret(name: &str) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, name) {
        let _ = entry.delete_password();
    }
}

fn env_name(name: &str) -> &'static str {
    match name {
        "github_token" => "SKILLHUB_GITHUB_TOKEN",
        "deepseek_api_key" => "DEEPSEEK_API_KEY",
        _ => "SKILLHUB_SECRET",
    }
}

pub fn secret_status() -> SecretStatus {
    SecretStatus {
        github_token: get_secret("github_token").is_some(),
        deepseek_key: get_secret("deepseek_api_key").is_some(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub github_token: bool,
    pub deepseek_key: bool,
}
