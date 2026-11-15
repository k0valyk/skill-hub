use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use rusqlite::params;

use crate::db::Db;
use crate::util::{estimate_tokens, now_iso, sha256_hex, slugify};

pub const EMOJIS: [&str; 16] = [
    "🧠", "🛠️", "🧪", "📚", "🔍", "⚙️", "🚀", "🧩", "🛰️", "🦾", "📝", "🎯", "🌿", "🔧",
    "🧭", "🗂️",
];
pub const COLORS: [&str; 8] = [
    "#8b7cff", "#5b8cff", "#2dd4bf", "#ff7aa2", "#ffb86b", "#43e97b", "#f97316", "#a78bfa",
];

const SKILL_START: &str = "<!-- skillhub:skills:start -->";
const SKILL_END: &str = "<!-- skillhub:skills:end -->";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPermission {
    pub action: String,
    pub resource: String,
    pub effect: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub key: String,
    pub path: String,
    pub file_name: String,
    pub scope: String,
    pub project_path: Option<String>,
    pub name: String,
    pub tech_name: String,
    pub description: String,
    pub icon: String,
    pub mode: String,
    pub model: Option<String>,
    pub color: Option<String>,
    pub hidden: bool,
    pub steps: Option<i64>,
    pub permissions: Vec<AgentPermission>,
    pub tags: Vec<String>,
    pub skills: Vec<String>,
    pub projects: Vec<String>,
    pub enabled: bool,
    pub status: String,
    pub activity: Option<String>,
    pub last_run_at: Option<String>,
    pub last_status: Option<String>,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub cost_usd: f64,
    pub body_tokens: i64,
    pub body_preview: String,
    pub updated_at: String,
    pub auto_approve: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTask {
    pub id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub project_path: String,
    pub prompt: String,
    pub status: String,
    pub output: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub duration_ms: i64,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub cost_usd: f64,
    pub exit_code: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub body: String,
    pub mode: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateInput {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentPatch {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub auto_approve: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct RunningInfo {
    pub task_id: String,
    pub activity: Option<String>,
    pub waiting: bool,
    pub started_at: String,
}

#[derive(Default)]
struct Parsed {
    description: String,
    mode: String,
    model: Option<String>,
    color: Option<String>,
    hidden: bool,
    steps: Option<i64>,
    permissions: Vec<AgentPermission>,
    body: String,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedEvent {
    pub activity: Option<String>,
    pub text: Option<String>,
    pub waiting: bool,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub cost: f64,
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        value[1..value.len() - 1].to_string()
    } else {
        value.to_string()
    }
}

fn yaml_scalar(value: &str) -> String {
    let clean = value.replace(['\r', '\n'], " ").trim().to_string();
    if clean.is_empty() {
        return "\"\"".into();
    }
    if clean.contains(": ") || clean.contains(" #") || clean.starts_with(['{', '[', '*', '&', '!', '|', '>', '@', '`', '"', '\'']) {
        format!("\"{}\"", clean.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        clean
    }
}

fn split_frontmatter(text: &str) -> (Option<&str>, &str) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    if !text.starts_with("---") {
        return (None, text);
    }
    let rest = text[3..].strip_prefix('\r').unwrap_or(&text[3..]);
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" {
            let body_start = offset + line.len();
            return (Some(&rest[..offset]), &rest[body_start..]);
        }
        offset += line.len();
        if offset >= rest.len() {
            break;
        }
    }
    (None, text)
}

fn parse_agent(text: &str) -> Parsed {
    let (fm, body) = split_frontmatter(text);
    let mut parsed = Parsed {
        mode: "subagent".into(),
        body: body.trim_start_matches(['\r', '\n']).to_string(),
        ..Default::default()
    };
    let Some(fm) = fm else {
        parsed.description = first_body_line(&parsed.body);
        return parsed;
    };
    let mut section = "";
    for raw in fm.lines() {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indented = raw.starts_with(' ') || raw.starts_with('\t');
        if !indented {
            section = "";
            let Some((key, value)) = trimmed.split_once(':') else {
                continue;
            };
            let key = key.trim();
            let value = unquote(value);
            match key {
                "description" => parsed.description = value,
                "mode" => parsed.mode = if value.is_empty() { "subagent".into() } else { value },
                "model" => parsed.model = Some(value).filter(|v| !v.is_empty()),
                "color" => parsed.color = Some(value).filter(|v| !v.is_empty()),
                "steps" => parsed.steps = value.parse().ok(),
                "hidden" => parsed.hidden = value == "true",
                "permissions" => section = "permissions",
                "permission" => section = "permission",
                "tools" => section = "tools",
                _ => {}
            }
            continue;
        }
        match section {
            "permissions" => {
                if let Some(rest) = trimmed.strip_prefix("- ") {
                    if let Some((key, value)) = rest.split_once(':') {
                        if key.trim() == "action" {
                            parsed.permissions.push(AgentPermission {
                                action: unquote(value),
                                resource: "*".into(),
                                effect: "allow".into(),
                            });
                        }
                    }
                } else if let Some((key, value)) = trimmed.split_once(':') {
                    if let Some(last) = parsed.permissions.last_mut() {
                        match key.trim() {
                            "action" => last.action = unquote(value),
                            "resource" => last.resource = unquote(value),
                            "effect" => last.effect = unquote(value),
                            _ => {}
                        }
                    }
                }
            }
            "permission" | "tools" => {
                if let Some((key, value)) = trimmed.split_once(':') {
                    let action = legacy_action(key.trim());
                    let effect = if section == "tools" {
                        if value.trim() == "true" { "allow".to_string() } else { "deny".to_string() }
                    } else {
                        unquote(value)
                    };
                    if !action.is_empty() && !effect.is_empty() {
                        parsed.permissions.push(AgentPermission {
                            action,
                            resource: "*".into(),
                            effect,
                        });
                    }
                }
            }
            _ => {}
        }
    }
    if parsed.description.trim().is_empty() {
        parsed.description = first_body_line(&parsed.body);
    }
    parsed
}

fn legacy_action(key: &str) -> String {
    match key {
        "write" | "edit" | "patch" => "edit",
        "bash" | "shell" => "shell",
        "webfetch" | "websearch" | "read" | "glob" | "grep" | "skill" | "task" => match key {
            "task" => "subagent",
            other => other,
        },
        _ => key,
    }
    .to_string()
}

fn first_body_line(body: &str) -> String {
    for line in body.lines() {
        let line = line.trim().trim_start_matches('#').trim();
        if !line.is_empty() && !line.starts_with("<!--") {
            return line.chars().take(240).collect();
        }
    }
    String::new()
}

fn prettify(key: &str) -> String {
    let last = key.rsplit('/').next().unwrap_or(key);
    let cleaned = last.replace(['-', '_'], " ");
    let mut chars = cleaned.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => key.to_string(),
    }
}

/// Українські назви для штатних агентів QA-циклу (доки користувач не задав свою).
fn default_display(key: &str) -> Option<&'static str> {
    match key.rsplit('/').next().unwrap_or(key) {
        "qa-tester" => Some("Тестувальник"),
        "fixer" => Some("Виправляч"),
        "auditor" => Some("Аудитор"),
        _ => None,
    }
}

pub fn default_icon(seed: &str) -> String {
    match seed.rsplit('/').next().unwrap_or(seed) {
        "qa-tester" => return "🧪|#ffb86b".into(),
        "fixer" => return "🛠️|#43e97b".into(),
        "auditor" => return "🔍|#5b8cff".into(),
        _ => {}
    }
    let hash = sha256_hex(seed.as_bytes());
    let value = u32::from_str_radix(&hash[..8], 16).unwrap_or(0);
    let emoji = EMOJIS[(value as usize) % EMOJIS.len()];
    let color = COLORS[((value as usize) / 7) % COLORS.len()];
    format!("{emoji}|{color}")
}

pub fn effective_model(agent_model: Option<&str>, default_model: &str) -> Option<String> {
    agent_model
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(str::to_string)
        .or_else(|| {
            let model = default_model.trim();
            if model.is_empty() {
                None
            } else {
                Some(model.to_string())
            }
        })
}

fn short_hash(value: &str) -> String {
    sha256_hex(value.as_bytes())[..8].to_string()
}

fn meta_row(db: &Db, path: &str) -> Option<(String, String, Vec<String>, bool)> {
    let mut stmt = db
        .conn
        .prepare("SELECT display_name, icon, tags, auto_approve FROM agents_meta WHERE path = ?1")
        .ok()?;
    stmt.query_row([path], |row| {
        let tags: String = row.get(2)?;
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            serde_json::from_str::<Vec<String>>(&tags).unwrap_or_default(),
            row.get::<_, i64>(3)? != 0,
        ))
    })
    .ok()
}

fn linked_projects(db: &Db, agent_id: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(mut stmt) = db
        .conn
        .prepare("SELECT project_path FROM agent_projects WHERE agent_id = ?1 ORDER BY project_path")
    {
        if let Ok(rows) = stmt.query_map([agent_id], |row| row.get::<_, String>(0)) {
            out.extend(rows.flatten());
        }
    }
    out
}

fn linked_skills(db: &Db, agent_id: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT item_id FROM agent_skills WHERE agent_id = ?1 ORDER BY created_at",
    ) {
        if let Ok(rows) = stmt.query_map([agent_id], |row| row.get::<_, String>(0)) {
            out.extend(rows.flatten());
        }
    }
    out
}

fn usage(db: &Db, agent_id: &str) -> (i64, i64, f64) {
    db.conn
        .query_row(
            "SELECT COALESCE(SUM(tokens_in),0), COALESCE(SUM(tokens_out),0), COALESCE(SUM(cost_usd),0)
             FROM agent_tasks WHERE agent_id = ?1 AND status IN ('ok','error')",
            [agent_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap_or((0, 0, 0.0))
}

fn last_task(db: &Db, agent_id: &str) -> Option<(String, String)> {
    let mut stmt = db
        .conn
        .prepare("SELECT status, started_at FROM agent_tasks WHERE agent_id = ?1 ORDER BY started_at DESC LIMIT 1")
        .ok()?;
    stmt.query_row([agent_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .ok()
}

fn file_updated(path: &Path) -> String {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .map(|time| {
            let dt: chrono::DateTime<chrono::Utc> = time.into();
            dt.to_rfc3339()
        })
        .unwrap_or_else(now_iso)
}

fn agent_from_file(
    db: &Db,
    running: &HashMap<String, RunningInfo>,
    path: &Path,
    key: &str,
    id: String,
    scope: &str,
    project_path: Option<String>,
) -> Option<Agent> {
    let text = std::fs::read_to_string(path).ok()?;
    let parsed = parse_agent(&text);
    let path_str = path.to_string_lossy().to_string();
    let meta = meta_row(db, &path_str);
    let enabled = !path_str.to_ascii_lowercase().ends_with(".disabled");
    let file_name = path.file_name()?.to_string_lossy().to_string();
    let tech_name = key.rsplit('/').next().unwrap_or(key).to_string();
    let (display, icon, tags, auto_approve) = meta.unwrap_or_default();
    let (tokens_in, tokens_out, cost_usd) = usage(db, &id);
    let last = last_task(db, &id);
    let (status, activity) = if let Some(info) = running.get(&id) {
        (
            if info.waiting { "waiting" } else { "working" }.to_string(),
            info.activity.clone(),
        )
    } else {
        let status = match last.as_ref().map(|(status, _)| status.as_str()) {
            Some("error") => "error",
            _ => "idle",
        };
        (status.to_string(), None)
    };
    let skills = linked_skills(db, &id);
    let projects = linked_projects(db, &id);
    let last_run_at = last.as_ref().map(|(_, started)| started.clone());
    let last_status = last.as_ref().map(|(status, _)| status.clone());
    Some(Agent {
        id,
        key: key.to_string(),
        path: path_str,
        file_name,
        scope: scope.to_string(),
        project_path,
        name: if display.trim().is_empty() {
            default_display(key)
                .map(str::to_string)
                .unwrap_or_else(|| prettify(key))
        } else {
            display
        },
        tech_name,
        description: parsed.description,
        icon: if icon.trim().is_empty() { default_icon(key) } else { icon },
        mode: parsed.mode,
        model: parsed.model,
        color: parsed.color,
        hidden: parsed.hidden,
        steps: parsed.steps,
        permissions: parsed.permissions,
        tags,
        skills,
        projects,
        enabled,
        status,
        activity,
        last_run_at,
        last_status,
        tokens_in,
        tokens_out,
        cost_usd,
        body_tokens: estimate_tokens(&parsed.body),
        body_preview: parsed.body.chars().take(600).collect(),
        updated_at: file_updated(path),
        auto_approve,
    })
}

fn files_in(base: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if !base.is_dir() {
        return out;
    }
    for entry in walkdir::WalkDir::new(base)
        .max_depth(6)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !(entry.file_type().is_dir()
                && (name == "node_modules" || name == "target" || name.starts_with('.')))
        })
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if name.ends_with(".md") || name.ends_with(".md.disabled") {
            out.push(entry.path().to_path_buf());
        }
    }
    out.sort();
    out
}

fn global_agent_dirs() -> Vec<PathBuf> {
    let config = crate::linking::opencode_config_dir();
    vec![config.join("agents"), config.join("agent")]
}

fn project_agent_dirs(db: &Db) -> Vec<(PathBuf, PathBuf)> {
    let mut projects: Vec<PathBuf> = Vec::new();
    let settings = crate::settings::load();
    let project_root = settings.project_root();
    if let Ok(entries) = std::fs::read_dir(&project_root) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                projects.push(entry.path());
            }
        }
    }
    if let Ok(mut stmt) = db
        .conn
        .prepare("SELECT DISTINCT project_path FROM agent_projects")
    {
        if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            for path in rows.flatten() {
                if !path.trim().is_empty() {
                    projects.push(PathBuf::from(path));
                }
            }
        }
    }
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for project in projects {
        let canonical = std::fs::canonicalize(&project).unwrap_or(project);
        if !seen.insert(canonical.clone()) {
            continue;
        }
        out.push((canonical.clone(), canonical.join(".opencode/agents")));
        out.push((canonical.clone(), canonical.join(".opencode/agent")));
    }
    out
}

fn scan(db: &Db, running: &HashMap<String, RunningInfo>) -> Vec<Agent> {
    let mut agents: Vec<Agent> = Vec::new();
    let mut seen_ids = HashSet::new();

    for base in global_agent_dirs() {
        for path in files_in(&base) {
            let Ok(rel) = path.strip_prefix(&base) else { continue };
            let key = rel
                .to_string_lossy()
                .replace('\\', "/")
                .trim_end_matches(".disabled")
                .trim_end_matches(".md")
                .to_string();
            let id = format!("g:{key}");
            if !seen_ids.insert(id.clone()) {
                continue;
            }
            if let Some(agent) = agent_from_file(db, running, &path, &key, id, "global", None) {
                agents.push(agent);
            }
        }
    }

    for (project, base) in project_agent_dirs(db) {
        let project_str = project.to_string_lossy().to_string();
        let hash = short_hash(&project_str);
        for path in files_in(&base) {
            let Ok(rel) = path.strip_prefix(&base) else { continue };
            let key = rel
                .to_string_lossy()
                .replace('\\', "/")
                .trim_end_matches(".disabled")
                .trim_end_matches(".md")
                .to_string();
            let id = format!("p:{hash}:{key}");
            if !seen_ids.insert(id.clone()) {
                continue;
            }
            if let Some(agent) = agent_from_file(
                db,
                running,
                &path,
                &key,
                id,
                "project",
                Some(project_str.clone()),
            ) {
                agents.push(agent);
            }
        }
    }

    agents.sort_by(|a, b| {
        let rank = |status: &str| match status {
            "working" => 0,
            "waiting" => 1,
            "error" => 2,
            _ => 3,
        };
        rank(&a.status)
            .cmp(&rank(&b.status))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    agents
}

pub fn list(db: &Db, running: &HashMap<String, RunningInfo>) -> Vec<Agent> {
    scan(db, running)
}

pub fn get(db: &Db, running: &HashMap<String, RunningInfo>, id: &str) -> Result<Agent> {
    scan(db, running)
        .into_iter()
        .find(|agent| agent.id == id)
        .ok_or_else(|| anyhow!("Агента не знайдено. Можливо, файл переміщено або видалено."))
}

fn save_meta(
    db: &Db,
    path: &str,
    display_name: &str,
    icon: &str,
    tags: &[String],
    auto_approve: bool,
) -> Result<()> {
    let tags = serde_json::to_string(tags)?;
    db.conn.execute(
        "INSERT INTO agents_meta (path, display_name, icon, tags, auto_approve, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(path) DO UPDATE SET
           display_name = excluded.display_name,
           icon = excluded.icon,
           tags = excluded.tags,
           auto_approve = excluded.auto_approve,
           updated_at = excluded.updated_at",
        params![
            path,
            display_name,
            icon,
            tags,
            if auto_approve { 1 } else { 0 },
            now_iso()
        ],
    )?;
    Ok(())
}

fn find_by_path(db: &Db, path: &Path) -> Option<Agent> {
    let target = path.to_string_lossy().to_string();
    scan(db, &HashMap::new())
        .into_iter()
        .find(|agent| agent.path == target)
}

fn unique_file(dir: &Path, base: &str) -> PathBuf {
    for counter in 1.. {
        let name = if counter == 1 {
            format!("{base}.md")
        } else {
            format!("{base}-{counter}.md")
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

fn agent_body(input: &AgentCreateInput, template: Option<&AgentTemplate>) -> String {
    if let Some(body) = input.body.as_ref().filter(|body| !body.trim().is_empty()) {
        return body.trim().to_string();
    }
    if let Some(template) = template {
        if !template.body.trim().is_empty() {
            return template.body.trim().to_string();
        }
    }
    format!(
        "You are {}. {}",
        prettify(&input.name),
        if input.description.trim().is_empty() {
            "Help the user with the tasks you are given."
        } else {
            input.description.trim()
        }
    )
}

const QA_TEAM: [(&str, &str); 3] = [
    ("qa-tester", include_str!("../qa-agents/qa-tester.md")),
    ("fixer", include_str!("../qa-agents/fixer.md")),
    ("auditor", include_str!("../qa-agents/auditor.md")),
];

/// Ставить відсутніх агентів QA-команди у глобальну папку OpenCode.
/// Існуючі файли (навіть вимкнені) не перезаписує — щоб не втратити правки користувача.
pub fn install_qa_team() -> Result<Vec<String>> {
    let base = global_agent_dirs()
        .into_iter()
        .next()
        .unwrap_or_else(|| crate::linking::opencode_config_dir().join("agents"));
    std::fs::create_dir_all(&base)?;
    let mut written = Vec::new();
    for (name, body) in QA_TEAM {
        let path = base.join(format!("{name}.md"));
        let disabled = base.join(format!("{name}.md.disabled"));
        if path.exists() || disabled.exists() {
            continue;
        }
        std::fs::write(&path, body)?;
        written.push(path.to_string_lossy().to_string());
    }
    Ok(written)
}

pub fn create(db: &Db, root: &Path, input: AgentCreateInput) -> Result<Agent> {
    let scope = input.scope.clone().unwrap_or_else(|| "global".into());
    let template = input
        .template
        .as_ref()
        .filter(|id| !id.trim().is_empty())
        .and_then(|id| templates().into_iter().find(|template| &template.id == id));
    let description = if input.description.trim().is_empty() {
        template
            .as_ref()
            .map(|template| template.description.clone())
            .unwrap_or_else(|| "Agent created in Skill Hub.".into())
    } else {
        input.description.trim().to_string()
    };
    let mode = match input.mode.as_deref().unwrap_or_else(|| {
        template
            .as_ref()
            .map(|template| template.mode.as_str())
            .unwrap_or("subagent")
    }) {
        "primary" => "primary",
        "all" => "all",
        _ => "subagent",
    };
    let base = if scope == "project" {
        let project = input
            .project
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("Вкажи папку проєкту для проєктного агента."))?;
        PathBuf::from(project).join(".opencode").join("agents")
    } else {
        global_agent_dirs()
            .into_iter()
            .next()
            .unwrap_or_else(|| crate::linking::opencode_config_dir().join("agents"))
    };
    std::fs::create_dir_all(&base)?;
    let slug = slugify(if input.name.trim().is_empty() {
        "agent"
    } else {
        input.name.trim()
    });
    let slug = if slug.is_empty() { "agent".into() } else { slug };
    let path = unique_file(&base, &slug);
    let seed = path.to_string_lossy().to_string();
    let icon = default_icon(&seed);
    let color = input
        .color
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| icon.split('|').nth(1).unwrap_or(COLORS[0]).to_string());
    let body = agent_body(&input, template.as_ref());
    let model_line = input
        .model
        .as_ref()
        .map(|model| model.trim())
        .filter(|model| !model.is_empty())
        .map(|model| format!("model: {model}\n"))
        .unwrap_or_default();
    let text = format!(
        "---\ndescription: {}\nmode: {mode}\ncolor: \"{color}\"\n{model_line}---\n\n{body}\n",
        yaml_scalar(&description)
    );
    std::fs::write(&path, text).with_context(|| format!("Не вдалося створити {}", path.display()))?;
    let display_name = input
        .display_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| prettify(&slug));
    save_meta(
        db,
        &path.to_string_lossy(),
        &display_name,
        &icon,
        input.tags.as_deref().unwrap_or(&[]),
        false,
    )?;
    if scope == "project" {
        if let Some(project) = input.project.as_ref() {
            let canonical = std::fs::canonicalize(project).unwrap_or_else(|_| PathBuf::from(project));
            let _ = db.conn.execute(
                "INSERT OR IGNORE INTO agent_projects (agent_id, project_path, created_at)
                 VALUES (?1, ?2, ?3)",
                params![
                    find_by_path(db, &path).map(|agent| agent.id).unwrap_or_default(),
                    canonical.to_string_lossy(),
                    now_iso()
                ],
            );
        }
    }
    let _ = root;
    find_by_path(db, &path)
        .ok_or_else(|| anyhow!("Агента створено, але не вдалося прочитати файл."))
}

pub fn templates() -> Vec<AgentTemplate> {
    let mut out = Vec::new();
    let dir = crate::linking::opencode_config_dir().join("agent-templates");
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            let parsed = parse_agent(&text);
            let id = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
                .unwrap_or_default();
            out.push(AgentTemplate {
                name: prettify(&id),
                description: parsed.description,
                body: parsed.body,
                mode: parsed.mode,
                id,
            });
        }
    }
    if out.is_empty() {
        for (id, name, description, mode, body) in [
            (
                "developer",
                "Розробник",
                "Пише й редагує код у проєкті, дотримується стилю та тестів.",
                "primary",
                "You are a careful software developer. Read the existing code before changing it, keep the style, run tests, and explain what you changed.",
            ),
            (
                "reviewer",
                "Рев'юер",
                "Перевіряє зміни на коректність, регресії та безпеку, нічого не змінюючи.",
                "subagent",
                "Review the current changes. List findings in severity order with file and line references. Do not edit files.",
            ),
            (
                "researcher",
                "Дослідник",
                "Шукає інформацію в коді й документації та повертає стислий висновок.",
                "subagent",
                "Research the question using local files and the web when needed. Return a concise answer with sources.",
            ),
        ] {
            out.push(AgentTemplate {
                id: id.into(),
                name: name.into(),
                description: description.into(),
                body: body.into(),
                mode: mode.into(),
            });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

fn set_description(path: &Path, description: &str) -> Result<()> {
    let text = std::fs::read_to_string(path)?;
    let (fm, body) = split_frontmatter(&text);
    let line = format!("description: {}", yaml_scalar(description));
    let Some(fm) = fm else {
        let next = format!("---\n{line}\n---\n\n{}", body.trim_start_matches(['\r', '\n']));
        std::fs::write(path, next)?;
        return Ok(());
    };
    let mut replaced = false;
    let mut lines: Vec<String> = Vec::new();
    for raw in fm.lines() {
        if !replaced && raw.trim_start().starts_with("description:") && !raw.starts_with(' ') {
            lines.push(line.clone());
            replaced = true;
        } else {
            lines.push(raw.to_string());
        }
    }
    if !replaced {
        lines.insert(0, line);
    }
    let next = format!(
        "---\n{}\n---\n{}",
        lines.join("\n"),
        body.trim_start_matches(['\r', '\n'])
    );
    std::fs::write(path, next)?;
    Ok(())
}

fn strip_skill_block(body: &str) -> String {
    if let Some(start) = body.find(SKILL_START) {
        if let Some(relative_end) = body[start..].find(SKILL_END) {
            let end = start + relative_end + SKILL_END.len();
            let mut next = String::new();
            next.push_str(body[..start].trim_end());
            next.push_str(body[end..].trim_start_matches(['\r', '\n']));
            return next.trim_end().to_string() + "\n";
        }
    }
    body.to_string()
}

fn sync_skill_block(path: &Path, skills: &[String]) -> Result<()> {
    let text = std::fs::read_to_string(path)?;
    let (fm, body) = split_frontmatter(&text);
    let mut next_body = strip_skill_block(body);
    if !skills.is_empty() {
        let list = skills
            .iter()
            .map(|id| format!("`{id}`"))
            .collect::<Vec<_>>()
            .join(", ");
        next_body.push_str(&format!(
            "\n\n{SKILL_START}\n## Skill Hub skills\nAvailable skills: {list}.\nUse the `skillhub` MCP tools (`search_skills`, `get_skill`) to load a skill only when the task needs it.\n{SKILL_END}\n"
        ));
    }
    let next = match fm {
        Some(fm) => format!(
            "---\n{}\n---\n{}",
            fm.trim_matches(['\r', '\n']),
            next_body.trim_start_matches(['\r', '\n'])
        ),
        None => next_body,
    };
    std::fs::write(path, next)?;
    Ok(())
}

pub fn update(
    db: &Db,
    running: &HashMap<String, RunningInfo>,
    id: &str,
    patch: AgentPatch,
) -> Result<Agent> {
    let agent = get(db, running, id)?;
    if let Some(description) = patch.description.as_ref() {
        if description.trim() != agent.description.trim() {
            set_description(Path::new(&agent.path), description)?;
        }
    }
    let display = patch.display_name.unwrap_or(agent.name.clone());
    let icon = patch.icon.unwrap_or(agent.icon.clone());
    let tags = patch.tags.unwrap_or(agent.tags.clone());
    let auto = patch.auto_approve.unwrap_or(agent.auto_approve);
    save_meta(db, &agent.path, &display, &icon, &tags, auto)?;
    get(db, running, id)
}

pub fn set_enabled(db: &Db, id: &str, enabled: bool) -> Result<Agent> {
    let agent = get(db, &HashMap::new(), id)?;
    if agent.enabled == enabled {
        return Ok(agent);
    }
    let old = PathBuf::from(&agent.path);
    let next = if enabled {
        let name = old
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let restored = name.strip_suffix(".disabled").unwrap_or(&name).to_string();
        old.with_file_name(restored)
    } else {
        old.with_file_name(format!("{}.disabled", agent.file_name))
    };
    if next.exists() {
        return Err(anyhow!(
            "Не вдалося перейменувати: {} вже існує.",
            next.display()
        ));
    }
    std::fs::rename(&old, &next)
        .with_context(|| format!("Не вдалося перейменувати {}", old.display()))?;
    let _ = db.conn.execute(
        "UPDATE agents_meta SET path = ?1 WHERE path = ?2",
        params![next.to_string_lossy(), agent.path],
    );
    get(db, &HashMap::new(), id)
}

pub fn remove(db: &Db, id: &str, confirm: bool) -> Result<()> {
    if !confirm {
        return Err(anyhow!("Видалення агента потребує підтвердження."));
    }
    let agent = get(db, &HashMap::new(), id)?;
    let path = PathBuf::from(&agent.path);
    if path.exists() {
        std::fs::remove_file(&path)
            .with_context(|| format!("Не вдалося видалити {}", path.display()))?;
    }
    let _ = db.conn.execute("DELETE FROM agents_meta WHERE path = ?1", [&agent.path]);
    let _ = db.conn.execute("DELETE FROM agent_projects WHERE agent_id = ?1", [id]);
    let _ = db.conn.execute("DELETE FROM agent_skills WHERE agent_id = ?1", [id]);
    let _ = db.conn.execute("DELETE FROM agent_tasks WHERE agent_id = ?1", [id]);
    if let Some(icon) = agent.icon.strip_prefix("img:") {
        let _ = std::fs::remove_file(icon);
    }
    Ok(())
}

pub fn link_project(db: &Db, running: &HashMap<String, RunningInfo>, id: &str, path: &str) -> Result<Agent> {
    let canonical = std::fs::canonicalize(path).map_err(|_| anyhow!("Папку не знайдено: {path}"))?;
    if !canonical.is_dir() {
        return Err(anyhow!("Це не папка: {path}"));
    }
    let _ = get(db, running, id)?;
    db.conn.execute(
        "INSERT OR IGNORE INTO agent_projects (agent_id, project_path, created_at) VALUES (?1, ?2, ?3)",
        params![id, canonical.to_string_lossy(), now_iso()],
    )?;
    get(db, running, id)
}

pub fn unlink_project(
    db: &Db,
    running: &HashMap<String, RunningInfo>,
    id: &str,
    path: &str,
) -> Result<Agent> {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path));
    db.conn.execute(
        "DELETE FROM agent_projects WHERE agent_id = ?1 AND project_path = ?2",
        params![id, canonical.to_string_lossy()],
    )?;
    let _ = db.conn.execute(
        "DELETE FROM agent_projects WHERE agent_id = ?1 AND project_path = ?2",
        params![id, path],
    );
    get(db, running, id)
}

pub fn link_skill(
    db: &Db,
    running: &HashMap<String, RunningInfo>,
    id: &str,
    item_id: &str,
) -> Result<Agent> {
    let agent = get(db, running, id)?;
    let exists: i64 = db
        .conn
        .query_row("SELECT COUNT(*) FROM items WHERE id = ?1", [item_id], |row| row.get(0))
        .unwrap_or(0);
    if exists == 0 {
        return Err(anyhow!("Скіл `{item_id}` не знайдено в бібліотеці."));
    }
    db.conn.execute(
        "INSERT OR IGNORE INTO agent_skills (agent_id, item_id, created_at) VALUES (?1, ?2, ?3)",
        params![id, item_id, now_iso()],
    )?;
    let skills = linked_skills(db, id);
    sync_skill_block(Path::new(&agent.path), &skills)?;
    get(db, running, id)
}

pub fn unlink_skill(
    db: &Db,
    running: &HashMap<String, RunningInfo>,
    id: &str,
    item_id: &str,
) -> Result<Agent> {
    let agent = get(db, running, id)?;
    db.conn.execute(
        "DELETE FROM agent_skills WHERE agent_id = ?1 AND item_id = ?2",
        params![id, item_id],
    )?;
    let skills = linked_skills(db, id);
    sync_skill_block(Path::new(&agent.path), &skills)?;
    get(db, running, id)
}

pub fn set_icon_from_file(
    db: &Db,
    running: &HashMap<String, RunningInfo>,
    root: &Path,
    id: &str,
    source: &Path,
) -> Result<Agent> {
    let agent = get(db, running, id)?;
    if !source.is_file() {
        return Err(anyhow!("Файл іконки не знайдено."));
    }
    let ext = source
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "png".into());
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg") {
        return Err(anyhow!("Підтримуються png, jpg, webp, gif та svg."));
    }
    let bytes = std::fs::read(source)?;
    let name = format!("{}.{}", sha256_hex(&bytes)[..16].to_string(), ext);
    let dir = root.join(".skillhub").join("agent-icons");
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(name);
    std::fs::write(&dest, bytes)?;
    let icon = format!("img:{}", dest.to_string_lossy());
    save_meta(
        db,
        &agent.path,
        &agent.name,
        &icon,
        &agent.tags,
        agent.auto_approve,
    )?;
    get(db, running, id)
}

pub fn export_to(db: &Db, id: &str, dest: &Path) -> Result<String> {
    let agent = get(db, &HashMap::new(), id)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(&agent.path, dest)
        .with_context(|| format!("Не вдалося експортувати {}", agent.path))?;
    Ok(dest.to_string_lossy().to_string())
}

pub fn import_from(
    db: &Db,
    source: &Path,
    scope: &str,
    project: Option<&str>,
) -> Result<Agent> {
    if !source.is_file() {
        return Err(anyhow!("Файл агента не знайдено."));
    }
    let base = if scope == "project" {
        let project = project
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("Вкажи папку проєкту для імпорту."))?;
        PathBuf::from(project).join(".opencode").join("agents")
    } else {
        global_agent_dirs()
            .into_iter()
            .next()
            .unwrap_or_else(|| crate::linking::opencode_config_dir().join("agents"))
    };
    std::fs::create_dir_all(&base)?;
    let stem = source
        .file_stem()
        .map(|stem| slugify(&stem.to_string_lossy()))
        .unwrap_or_else(|| "agent".into());
    let stem = if stem.is_empty() { "agent".into() } else { stem };
    let dest = unique_file(&base, &stem);
    std::fs::copy(source, &dest)?;
    let text = std::fs::read_to_string(&dest).unwrap_or_default();
    let parsed = parse_agent(&text);
    let icon = default_icon(&dest.to_string_lossy());
    save_meta(
        db,
        &dest.to_string_lossy(),
        &prettify(&stem),
        &icon,
        &[],
        false,
    )?;
    let _ = parsed;
    find_by_path(db, &dest).ok_or_else(|| anyhow!("Імпортовано, але агента не видно."))
}

pub fn opencode_cli() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("SKILLHUB_OPENCODE_CLI") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let base = PathBuf::from(appdata)
                .join("ai.opencode.desktop")
                .join("cli");
            if let Ok(entries) = std::fs::read_dir(&base) {
                let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
                for entry in entries.flatten() {
                    let exe = entry.path().join("opencode-cli.exe");
                    if !exe.is_file() {
                        continue;
                    }
                    let modified = std::fs::metadata(&exe)
                        .and_then(|meta| meta.modified())
                        .unwrap_or(std::time::UNIX_EPOCH);
                    if best.as_ref().map(|(time, _)| modified > *time).unwrap_or(true) {
                        best = Some((modified, exe));
                    }
                }
                if let Some((_, exe)) = best {
                    return Some(exe);
                }
            }
        }
    }
    let names: &[&str] = if cfg!(windows) {
        &["opencode-cli.exe", "opencode.exe"]
    } else {
        &["opencode-cli", "opencode"]
    };
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            for name in names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        for candidate in [
            "/usr/local/bin/opencode",
            "/opt/homebrew/bin/opencode",
            "/usr/bin/opencode",
        ] {
            let path = PathBuf::from(candidate);
            if path.is_file() {
                return Some(path);
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            for relative in [".local/bin/opencode", ".bun/bin/opencode"] {
                let path = PathBuf::from(&home).join(relative);
                if path.is_file() {
                    return Some(path);
                }
            }
        }
    }
    None
}

pub fn insert_task(db: &Db, task: &AgentTask) -> Result<()> {
    db.conn.execute(
        "INSERT INTO agent_tasks
         (id, agent_id, agent_name, project_path, prompt, status, output, started_at, finished_at,
          duration_ms, tokens_in, tokens_out, cost_usd, exit_code)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            task.id,
            task.agent_id,
            task.agent_name,
            task.project_path,
            task.prompt,
            task.status,
            task.output,
            task.started_at,
            task.finished_at,
            task.duration_ms,
            task.tokens_in,
            task.tokens_out,
            task.cost_usd,
            task.exit_code
        ],
    )?;
    Ok(())
}

pub fn finish_task(
    db: &Db,
    task_id: &str,
    status: &str,
    output: &str,
    duration_ms: i64,
    tokens_in: i64,
    tokens_out: i64,
    cost_usd: f64,
    exit_code: Option<i64>,
) -> Result<()> {
    db.conn.execute(
        "UPDATE agent_tasks SET status = ?1, output = ?2, finished_at = ?3, duration_ms = ?4,
         tokens_in = ?5, tokens_out = ?6, cost_usd = ?7, exit_code = ?8 WHERE id = ?9",
        params![
            status,
            output,
            now_iso(),
            duration_ms,
            tokens_in,
            tokens_out,
            cost_usd,
            exit_code,
            task_id
        ],
    )?;
    Ok(())
}

pub fn cancel_task(db: &Db, task_id: &str, duration_ms: i64) -> Result<()> {
    db.conn.execute(
        "UPDATE agent_tasks SET status = 'cancelled', finished_at = ?1, duration_ms = ?2 WHERE id = ?3",
        params![now_iso(), duration_ms, task_id],
    )?;
    Ok(())
}

pub fn tasks(db: &Db, agent_id: &str, limit: i64) -> Vec<AgentTask> {
    let mut out = Vec::new();
    let Ok(mut stmt) = db.conn.prepare(
        "SELECT id, agent_id, agent_name, project_path, prompt, status, output, started_at,
                finished_at, duration_ms, tokens_in, tokens_out, cost_usd, exit_code
         FROM agent_tasks WHERE agent_id = ?1 ORDER BY started_at DESC LIMIT ?2",
    ) else {
        return out;
    };
    let Ok(rows) = stmt.query_map(params![agent_id, limit.max(1)], |row| {
        Ok(AgentTask {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            agent_name: row.get(2)?,
            project_path: row.get(3)?,
            prompt: row.get(4)?,
            status: row.get(5)?,
            output: row.get(6)?,
            started_at: row.get(7)?,
            finished_at: row.get(8)?,
            duration_ms: row.get(9)?,
            tokens_in: row.get(10)?,
            tokens_out: row.get(11)?,
            cost_usd: row.get(12)?,
            exit_code: row.get(13)?,
        })
    }) else {
        return out;
    };
    for task in rows.flatten() {
        out.push(task);
    }
    out
}

pub fn parse_event(line: &str) -> ParsedEvent {
    let mut event = ParsedEvent::default();
    let line = line.trim();
    if line.is_empty() {
        return event;
    }
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        event.activity = Some(shorten(line));
        return event;
    };
    let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
    let part = value.get("part").unwrap_or(&Value::Null);
    match kind {
        "text" => {
            let text = part.get("text").and_then(Value::as_str).unwrap_or("");
            event.text = Some(text.to_string());
            event.activity = Some(shorten(text));
        }
        "tool_use" | "tool" => {
            let tool = part.get("tool").and_then(Value::as_str).unwrap_or("tool");
            let status = part
                .get("state")
                .and_then(|state| state.get("status"))
                .and_then(Value::as_str)
                .unwrap_or("");
            event.activity = Some(if status.is_empty() {
                format!("🔧 {tool}")
            } else {
                format!("🔧 {tool} · {status}")
            });
        }
        "step_finish" => {
            let tokens = part.get("tokens").unwrap_or(&Value::Null);
            event.tokens_in = tokens.get("input").and_then(Value::as_i64).unwrap_or(0);
            event.tokens_out = tokens.get("output").and_then(Value::as_i64).unwrap_or(0);
            event.cost = part.get("cost").and_then(Value::as_f64).unwrap_or(0.0);
        }
        "error" => {
            let message = value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .or_else(|| {
                    part.get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                })
                .or_else(|| part.get("message").and_then(Value::as_str))
                .or_else(|| value.get("message").and_then(Value::as_str))
                .unwrap_or("Помилка");
            event.activity = Some(shorten(&format!("⚠️ {message}")));
            event.text = Some(format!("⚠️ {message}"));
        }
        other => {
            if other.contains("permission") {
                event.waiting = true;
                event.activity = Some("Очікує підтвердження".into());
            } else if let Some(text) = part.get("text").and_then(Value::as_str) {
                event.activity = Some(shorten(text));
            }
        }
    }
    event
}

fn shorten(value: &str) -> String {
    let line = value.lines().next().unwrap_or("").trim();
    if line.chars().count() > 160 {
        format!("{}…", line.chars().take(160).collect::<String>())
    } else {
        line.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_v2_frontmatter() {
        let text = "---\ndescription: Reviews code\nmode: subagent\nmodel: deepseek/deepseek-chat\npermissions:\n  - action: edit\n    resource: \"*\"\n    effect: deny\n  - action: read\n    resource: src/**\n    effect: allow\n---\n\nReview only.\n";
        let parsed = parse_agent(text);
        assert_eq!(parsed.description, "Reviews code");
        assert_eq!(parsed.mode, "subagent");
        assert_eq!(parsed.model.as_deref(), Some("deepseek/deepseek-chat"));
        assert_eq!(parsed.permissions.len(), 2);
        assert_eq!(parsed.permissions[0].action, "edit");
        assert_eq!(parsed.permissions[1].resource, "src/**");
        assert_eq!(parsed.body.trim(), "Review only.");
    }

    #[test]
    fn parses_legacy_tools() {
        let text = "---\ndescription: Old agent\ntools:\n  write: false\n  bash: true\n---\nBody";
        let parsed = parse_agent(text);
        assert!(parsed
            .permissions
            .iter()
            .any(|permission| permission.action == "edit" && permission.effect == "deny"));
        assert!(parsed
            .permissions
            .iter()
            .any(|permission| permission.action == "shell" && permission.effect == "allow"));
    }

    #[test]
    fn icon_is_deterministic() {
        let first = default_icon("g:agent-factory");
        let second = default_icon("g:agent-factory");
        assert_eq!(first, second);
        assert!(first.contains('|'));
    }

    #[test]
    fn qa_team_has_ukrainian_names_and_icons() {
        assert_eq!(default_display("qa-tester"), Some("Тестувальник"));
        assert_eq!(default_display("fixer"), Some("Виправляч"));
        assert_eq!(default_display("auditor"), Some("Аудитор"));
        assert!(default_icon("auditor").starts_with("🔍|"));
        assert!(default_icon("qa-tester").starts_with("🧪|"));
        assert!(default_icon("fixer").starts_with("🛠️|"));
        assert_eq!(prettify("my-agent"), "My agent");
    }

    #[test]
    fn effective_model_prefers_agent_then_default() {
        assert_eq!(
            effective_model(Some("deepseek/deepseek-chat"), "deepseek/deepseek-flash"),
            Some("deepseek/deepseek-chat".into())
        );
        assert_eq!(
            effective_model(None, "deepseek/deepseek-flash"),
            Some("deepseek/deepseek-flash".into())
        );
        assert_eq!(
            effective_model(Some("  "), "deepseek/deepseek-flash"),
            Some("deepseek/deepseek-flash".into())
        );
        assert_eq!(effective_model(None, ""), None);
    }

    #[test]
    fn parses_error_event() {
        let line = r#"{"type":"error","error":{"type":"provider.free-limit","message":"Free usage limit reached.","status":429}}"#;
        let event = parse_event(line);
        assert!(event.activity.unwrap().contains("Free usage limit"));
        assert!(event.text.unwrap().contains("Free usage limit"));
    }

    #[test]
    fn skill_block_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agent.md");
        std::fs::write(&path, "---\ndescription: Test\n---\n\nBody\n").unwrap();
        sync_skill_block(&path, &["alpha".into(), "beta".into()]).unwrap();
        sync_skill_block(&path, &["alpha".into(), "beta".into()]).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text.matches(SKILL_START).count(), 1);
        assert!(text.contains("`alpha`"));
        sync_skill_block(&path, &[]).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains(SKILL_START));
        assert!(text.contains("Body"));
    }
}


