use anyhow::{anyhow, Context, Result};
use std::path::{Path, PathBuf};

use crate::db::Db;
use crate::domain::{Budget, Item, Kind, LinkInfo};
use crate::util::{copy_dir, expand_home, hidden_command};

pub fn opencode_config_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("SKILLHUB_OPENCODE_DIR") {
        if !custom.trim().is_empty() {
            return PathBuf::from(custom);
        }
    }
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        if !xdg.trim().is_empty() {
            return PathBuf::from(xdg).join("opencode");
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config")
        .join("opencode")
}

fn subdir_for(kind: Kind) -> &'static str {
    match kind {
        Kind::Skill => "skills",
        Kind::Agent => "agents",
        Kind::Command => "commands",
        Kind::Plugin => "plugin",
        _ => "skills",
    }
}

pub fn link_base(kind: Kind, scope: &str, project: Option<&Path>) -> Result<PathBuf> {
    if scope == "project" {
        let project = project.ok_or_else(|| anyhow!("Для проєктного скіла вкажи папку проєкту."))?;
        Ok(project.join(".opencode").join(subdir_for(kind)))
    } else {
        Ok(opencode_config_dir().join(subdir_for(kind)))
    }
}

fn is_link_entry(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

/// Windows junction — це reparse point, але не symlink, тому `is_symlink()`
/// його не бачить. Без цієї перевірки `remove_dir_all` міг би зазирнути
/// всередину бібліотеки й видалити оригінальні файли.
fn is_reparse_point(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        std::fs::symlink_metadata(path)
            .map(|meta| meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        false
    }
}

fn remove_entry(path: &Path) -> Result<()> {
    if !path.exists() && !is_link_entry(path) {
        return Ok(());
    }
    if is_link_entry(path) || is_reparse_point(path) {
        // Прибираємо саме лінк, не торкаючись цілі.
        if std::fs::remove_dir(path).is_err() {
            let _ = std::fs::remove_file(path);
        }
        return Ok(());
    }
    if path.is_dir() {
        std::fs::remove_dir_all(path)?;
    } else {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

fn make_dir_link(source: &Path, link: &Path) -> Result<&'static str> {
    #[cfg(windows)]
    {
        let mut cmd = hidden_command("cmd");
        cmd.args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(source);
        let out = cmd.output().context("Не вдалося створити junction")?;
        if out.status.success() {
            return Ok("junction");
        }
        // fallback: копія (symlink на Windows часто вимагає прав адміністратора)
        copy_dir(source, link)?;
        return Ok("copy");
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, link)?;
        Ok("symlink")
    }
}

fn make_file_link(source: &Path, link: &Path) -> Result<&'static str> {
    #[cfg(windows)]
    {
        if let Some(parent) = link.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(source, link)?;
        Ok("copy")
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, link)?;
        Ok("symlink")
    }
}

pub fn enable(
    db: &Db,
    item: &Item,
    scope: &str,
    project: Option<&Path>,
) -> Result<LinkInfo> {
    if !item.kind.is_linkable() {
        return Err(anyhow!(
            "Цей тип ({}) не підключається до OpenCode як скіл. Його можна зберігати й читати в бібліотеці.",
            item.kind.as_str()
        ));
    }
    let source = Path::new(&item.path);
    if !source.exists() {
        return Err(anyhow!(
            "Файли елемента не знайдено: {}. Онови елемент або видали його з каталогу.",
            item.path
        ));
    }
    let base = link_base(item.kind, scope, project)?;
    std::fs::create_dir_all(&base)
        .with_context(|| format!("Не вдалося створити {}", base.display()))?;

    let (target, link_type) = if source.is_dir() {
        let link = base.join(&item.id);
        if link.exists() || is_link_entry(&link) {
            remove_entry(&link)?;
        }
        let link_type = make_dir_link(source, &link)?;
        (link, link_type.to_string())
    } else {
        let filename = source
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| format!("{}.md", item.id));
        let link = base.join(filename);
        if link.exists() || is_link_entry(&link) {
            remove_entry(&link)?;
        }
        let link_type = make_file_link(source, &link)?;
        (link, link_type.to_string())
    };

    let project_str = project
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    db.add_link(
        &item.id,
        scope,
        project
            .map(|_| project_str.as_str())
            .unwrap_or(""),
        &link_type,
        &target.to_string_lossy(),
    )?;
    db.record_usage(Some(&item.id), "enable", 0)?;

    Ok(LinkInfo {
        item_id: item.id.clone(),
        scope: scope.to_string(),
        project_path: if scope == "project" {
            Some(project_str)
        } else {
            None
        },
        link_type,
        target: target.to_string_lossy().to_string(),
    })
}

pub fn disable(db: &Db, item_id: &str, scope: &str, project: Option<&Path>) -> Result<()> {
    let project_str = project
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "".into());
    let links: Vec<LinkInfo> = db
        .links()?
        .into_iter()
        .filter(|l| {
            l.item_id == item_id
                && l.scope == scope
                && (scope == "global"
                    || l.project_path.as_deref().unwrap_or("") == project_str)
        })
        .collect();
    if links.is_empty() {
        // На випадок розсинхрону — пробуємо прибрати стандартний шлях.
        if let Some(item) = db.get_item(item_id)? {
            if let Ok(base) = link_base(item.kind, scope, project) {
                let candidate = base.join(&item.id);
                let _ = remove_entry(&candidate);
            }
        }
    }
    for link in links {
        let target = PathBuf::from(&link.target);
        if let Err(err) = remove_entry(&target) {
            return Err(anyhow!(
                "Не вдалося прибрати посилання {}: {err}. Можливо, файл зайнятий — закрий OpenCode і спробуй ще раз.",
                target.display()
            ));
        }
        db.remove_link(item_id, scope, &project_str)?;
    }
    db.record_usage(Some(item_id), "disable", 0)?;
    Ok(())
}

pub fn budget(db: &Db, threshold: i64) -> Budget {
    db.budget(threshold)
}

pub fn verify_links(db: &Db) -> Result<usize> {
    let mut repaired = 0;
    for link in db.links()? {
        let target = PathBuf::from(&link.target);
        if target.exists() || is_link_entry(&target) {
            continue;
        }
        if let Some(item) = db.get_item(&link.item_id)? {
            if !Path::new(&item.path).exists() {
                continue;
            }
            let project = link
                .project_path
                .as_ref()
                .map(|p| expand_home(p))
                .filter(|p| !p.as_os_str().is_empty());
            if enable(db, &item, &link.scope, project.as_deref()).is_ok() {
                repaired += 1;
            }
        }
    }
    Ok(repaired)
}

/// Прописує MCP-сервер skillhub в opencode.json, зберігаючи решту налаштувань.
pub fn connect_opencode(
    scope: &str,
    project: Option<&Path>,
    cli_path: &Path,
) -> Result<String> {
    let config_file = if scope == "project" {
        let project = project.ok_or_else(|| anyhow!("Вкажи папку проєкту для проєктного підключення."))?;
        project.join(".opencode").join("opencode.json")
    } else {
        opencode_config_dir().join("opencode.json")
    };
    if let Some(parent) = config_file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut root: serde_json::Value = if config_file.exists() {
        let text = std::fs::read_to_string(&config_file)?;
        match serde_json::from_str(&text) {
            Ok(value) => value,
            Err(_) => {
                return Err(anyhow!(
                    "Файл {} містить коментарі або некоректний JSON. Додай сервер вручну:\n\"mcp\": {{\"servers\": {{\"skillhub\": {{\"type\": \"local\", \"command\": [\"{}\", \"mcp\"], \"cwd\": \"~\"}}}}}}",
                    config_file.display(),
                    cli_path.display()
                ))
            }
        }
    } else {
        serde_json::json!({ "$schema": "https://opencode.ai/config.json" })
    };
    if !root.is_object() {
        root = serde_json::json!({});
    }
    let obj = root.as_object_mut().unwrap();
    let mcp = obj
        .entry("mcp".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !mcp.is_object() {
        *mcp = serde_json::json!({});
    }
    let mcp_obj = mcp.as_object_mut().unwrap();
    let servers = mcp_obj
        .entry("servers".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !servers.is_object() {
        *servers = serde_json::json!({});
    }
    servers.as_object_mut().unwrap().insert(
        "skillhub".to_string(),
        serde_json::json!({
            "type": "local",
            "command": [cli_path.to_string_lossy(), "mcp"],
            "cwd": "~",
            "pool": true
        }),
    );
    let text = serde_json::to_vec_pretty(&root)?;
    crate::util::write_atomic(&config_file, &text)?;
    Ok(config_file.to_string_lossy().to_string())
}

pub fn opencode_connected() -> bool {
    let file = opencode_config_dir().join("opencode.json");
    std::fs::read_to_string(file)
        .map(|t| t.contains("\"skillhub\""))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Item, Kind, Risk};

    fn item(id: &str, kind: Kind) -> Item {
        Item {
            id: id.into(),
            name: id.into(),
            kind,
            source_url: None,
            source_ref: None,
            commit: None,
            version: None,
            path: String::new(),
            summary_uk: "Тестовий опис скіла.".into(),
            summary_en: "Test skill.".into(),
            tags: vec![],
            license: None,
            stars: 0,
            pushed_at: None,
            size_bytes: 0,
            tokens_est: 800,
            content_hash: String::new(),
            favorite: false,
            rating: 0,
            notes: String::new(),
            archived: false,
            install_state: "downloaded".into(),
            risk: Risk::default(),
            added_at: String::new(),
            updated_at: String::new(),
            enabled: false,
            scopes: vec![],
            has_local_files: true,
        }
    }

    #[test]
    fn budget_counts_only_enabled() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(&tmp.path().join("db.sqlite")).unwrap();
        let a = item("a", Kind::Skill);
        let mut b = item("b", Kind::Skill);
        b.enabled = true;
        db.upsert_item(&a).unwrap();
        db.upsert_item(&b).unwrap();
        db.add_link("b", "global", "", "junction", "x").unwrap();
        let budget = db.budget(6000);
        assert_eq!(budget.enabled_count, 1);
        assert!(budget.advertised_tokens > 0);
        assert_eq!(budget.level, "ok");
    }

    #[test]
    fn budget_over_threshold() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(&tmp.path().join("db.sqlite")).unwrap();
        let mut many = item("many", Kind::Skill);
        many.summary_uk = "дуже довгий опис ".repeat(500);
        db.upsert_item(&many).unwrap();
        db.add_link("many", "global", "", "junction", "x").unwrap();
        assert_eq!(db.budget(1000).level, "over");
    }

    #[test]
    fn config_dir_respects_xdg() {
        std::env::set_var("XDG_CONFIG_HOME", "C:/tmp/xdg");
        assert!(opencode_config_dir().ends_with("opencode"));
        std::env::remove_var("XDG_CONFIG_HOME");
    }

    #[test]
    fn enable_creates_link_and_db_row() {
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("SKILLHUB_CONFIG_DIR", tmp.path().join("cfg"));
        let db = Db::open(&tmp.path().join("db.sqlite")).unwrap();
        let skill_dir = tmp.path().join("library/skills/demo");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "---\nname: Demo\n---\nBody").unwrap();
        let mut demo = item("demo", Kind::Skill);
        demo.path = skill_dir.to_string_lossy().to_string();
        db.upsert_item(&demo).unwrap();
        let info = enable(&db, &demo, "global", None).unwrap();
        assert!(Path::new(&info.target).exists());
        disable(&db, "demo", "global", None).unwrap();
        assert!(!Path::new(&info.target).exists());
        std::env::remove_var("SKILLHUB_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(dirs::home_dir().unwrap().join(".config/opencode/skills/demo"));
    }
}
