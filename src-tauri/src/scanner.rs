use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::classify;
use crate::db::Db;
use crate::domain::{Item, Kind, Risk};
use crate::util::{dir_size, estimate_tokens, kind_folder, now_iso, read_trimmed, sha256_hex, slugify};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub commit: Option<String>,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub summary_en: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub added_at: String,
    #[serde(default)]
    pub size_bytes: i64,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub risk: Option<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub file_count: i64,
}

pub fn write_manifest(dir: &Path, item: &Item) -> Result<()> {
    let manifest = Manifest {
        id: item.id.clone(),
        name: item.name.clone(),
        kind: item.kind.as_str().to_string(),
        source: item.source_url.clone(),
        version: item.version.clone(),
        commit: item.commit.clone(),
        summary: item.summary_uk.clone(),
        summary_en: item.summary_en.clone(),
        tags: item.tags.clone(),
        status: if item.enabled { "enabled" } else { "disabled" }.into(),
        added_at: if item.added_at.is_empty() {
            now_iso()
        } else {
            item.added_at.clone()
        },
        size_bytes: item.size_bytes,
        license: item.license.clone(),
        risk: Some(item.risk.level.clone()),
        notes: item.notes.clone(),
        folder: item.kind.folder().to_string().into(),
        file_count: count_files(dir),
    };
    let text = serde_json::to_vec_pretty(&manifest)?;
    crate::util::write_atomic(&dir.join("skillhub.json"), &text)
}

fn count_files(dir: &Path) -> i64 {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .count() as i64
}

pub fn read_manifest(dir: &Path) -> Option<Manifest> {
    let path = dir.join("skillhub.json");
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn prettify(name: &str) -> String {
    let cleaned = name.replace(['_', '-'], " ");
    let mut chars = cleaned.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => name.to_string(),
    }
}

fn primary_text(dir: &Path, is_file: Option<&Path>) -> String {
    if let Some(file) = is_file {
        return read_trimmed(file, 200_000);
    }
    for name in ["SKILL.md", "skill.md", "README.md", "readme.md", "agent.md"] {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return read_trimmed(&candidate, 200_000);
        }
    }
    String::new()
}

pub fn scan(root: &Path, db: &Db) -> Result<Vec<Item>> {
    crate::settings::ensure_dirs(root)?;
    let existing: std::collections::HashMap<String, Item> = db
        .items()
        .unwrap_or_default()
        .into_iter()
        .map(|i| (i.path.clone(), i))
        .collect();

    let library = root.join("library");
    let mut items: Vec<Item> = Vec::new();
    let mut seen_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    let folders = [
        "skills",
        "plugins",
        "agents",
        "commands",
        "token-savers",
        "mcp",
        "prompts",
        "themes",
        "other",
    ];

    for folder in folders {
        let base = library.join(folder);
        let _ = std::fs::create_dir_all(&base);
        let entries = match std::fs::read_dir(&base) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name_os = entry.file_name().to_string_lossy().to_string();
            if name_os.starts_with('.') || name_os == "skillhub.json" {
                continue;
            }
            let is_dir = path.is_dir();
            if !is_dir && !name_os.ends_with(".md") {
                continue;
            }
            let path_key = path.to_string_lossy().to_string();
            if !seen_paths.insert(path_key.clone()) {
                continue;
            }

            let dir_ref = if is_dir {
                path.clone()
            } else {
                path.parent().unwrap_or(&base).to_path_buf()
            };
            let manifest = if is_dir { read_manifest(&path) } else { None };
            let file_ref = if is_dir { None } else { Some(path.as_path()) };
            let text = primary_text(&dir_ref, file_ref);

            let kind = manifest
                .as_ref()
                .map(|m| Kind::from_str(&m.kind))
                .unwrap_or_else(|| {
                    let folder_kind = match folder {
                        "skills" => Kind::Skill,
                        "plugins" => Kind::Plugin,
                        "agents" => Kind::Agent,
                        "commands" => Kind::Command,
                        "token-savers" => Kind::TokenSaver,
                        "mcp" => Kind::Mcp,
                        "prompts" => Kind::Prompt,
                        "themes" => Kind::Theme,
                        _ => classify::classify_local(&dir_ref),
                    };
                    folder_kind
                });

            let (fm_name, fm_desc) = classify::parse_frontmatter(&text);
            let display = manifest
                .as_ref()
                .map(|m| m.name.clone())
                .or(fm_name)
                .unwrap_or_else(|| {
                    prettify(if is_dir {
                        &name_os
                    } else {
                        name_os.trim_end_matches(".md")
                    })
                });

            let previous = existing.get(&path_key);
            let summary_uk = manifest
                .as_ref()
                .map(|m| m.summary.clone())
                .filter(|s| !s.is_empty())
                .or_else(|| fm_desc.clone())
                .or_else(|| previous.map(|p| p.summary_uk.clone()))
                .unwrap_or_default();
            let summary_en = manifest
                .as_ref()
                .map(|m| m.summary_en.clone())
                .filter(|s| !s.is_empty())
                .or_else(|| previous.map(|p| p.summary_en.clone()))
                .unwrap_or_default();

            let mut tags: Vec<String> = manifest
                .as_ref()
                .map(|m| m.tags.clone())
                .filter(|t| !t.is_empty())
                .or_else(|| previous.map(|p| p.tags.clone()))
                .unwrap_or_default();
            if tags.is_empty() {
                tags = vec![kind.as_str().to_string()];
            }

            let size = if is_dir { dir_size(&path) } else { entry.metadata().map(|m| m.len() as i64).unwrap_or(0) };
            let body_tokens = estimate_tokens(&text);
            let content_hash = sha256_hex(text.as_bytes());
            let id = previous
                .map(|p| p.id.clone())
                .or_else(|| manifest.as_ref().map(|m| m.id.clone()))
                .unwrap_or_else(|| slugify(&display));

            let item = Item {
                id,
                name: display,
                kind,
                source_url: manifest
                    .as_ref()
                    .and_then(|m| m.source.clone())
                    .or_else(|| previous.and_then(|p| p.source_url.clone())),
                source_ref: previous.and_then(|p| p.source_ref.clone()),
                commit: manifest
                    .as_ref()
                    .and_then(|m| m.commit.clone())
                    .or_else(|| previous.and_then(|p| p.commit.clone())),
                version: manifest
                    .as_ref()
                    .and_then(|m| m.version.clone())
                    .or_else(|| previous.and_then(|p| p.version.clone())),
                path: path_key.clone(),
                summary_uk,
                summary_en,
                tags,
                license: manifest
                    .as_ref()
                    .and_then(|m| m.license.clone())
                    .or_else(|| previous.and_then(|p| p.license.clone())),
                stars: previous.map(|p| p.stars).unwrap_or(0),
                pushed_at: previous.and_then(|p| p.pushed_at.clone()),
                size_bytes: size,
                tokens_est: body_tokens,
                content_hash,
                favorite: previous.map(|p| p.favorite).unwrap_or(false),
                rating: previous.map(|p| p.rating).unwrap_or(0),
                notes: previous.map(|p| p.notes.clone()).unwrap_or_default(),
                archived: false,
                install_state: previous
                    .map(|p| p.install_state.clone())
                    .unwrap_or_else(|| "downloaded".into()),
                risk: previous.map(|p| p.risk.clone()).unwrap_or_else(|| Risk {
                    level: "unknown".into(),
                    findings: vec![],
                    scanned_at: String::new(),
                }),
                added_at: previous
                    .map(|p| p.added_at.clone())
                    .or_else(|| manifest.as_ref().map(|m| m.added_at.clone()))
                    .unwrap_or_else(now_iso),
                updated_at: now_iso(),
                enabled: false,
                scopes: vec![],
                has_local_files: true,
            };
            db.upsert_item(&item)?;
            items.push(item);
        }
    }

    // Прибираємо записи, чиї файли зникли (тільки завантажені, не «лише посилання»).
    let mut stale: Vec<String> = Vec::new();
    for item in db.items().unwrap_or_default() {
        if item.install_state == "downloaded" && !Path::new(&item.path).exists() {
            stale.push(item.id);
        }
    }
    for id in stale {
        let _ = db.delete_item(&id);
    }

    Ok(db.items().unwrap_or(items))
}

pub fn unique_id(db: &Db, base: &str) -> String {
    let base_id = slugify(base);
    let mut candidate = base_id.clone();
    let mut counter = 2;
    let existing: Vec<String> = db
        .items()
        .unwrap_or_default()
        .into_iter()
        .map(|i| i.id)
        .collect();
    while existing.contains(&candidate) {
        candidate = format!("{base_id}-{counter}");
        counter += 1;
    }
    candidate
}

pub fn folder_for(root: &Path, kind: Kind) -> PathBuf {
    root.join("library").join(kind_folder(kind.as_str()))
}

pub fn ensure_unique_dir(root: &Path, kind: Kind, id: &str) -> PathBuf {
    let base = folder_for(root, kind);
    let mut candidate = base.join(id);
    let mut counter = 2;
    while candidate.exists() {
        candidate = base.join(format!("{id}-{counter}"));
        counter += 1;
    }
    candidate
}

pub fn item_from_dir(dir: &Path, kind: Kind) -> Result<Item> {
    let name = dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "item".into());
    let text = primary_text(dir, None);
    Ok(Item {
        id: slugify(&name),
        name: prettify(&name),
        kind,
        source_url: None,
        source_ref: None,
        commit: None,
        version: None,
        path: dir.to_string_lossy().to_string(),
        summary_uk: String::new(),
        summary_en: String::new(),
        tags: vec![kind.as_str().into()],
        license: None,
        stars: 0,
        pushed_at: None,
        size_bytes: dir_size(dir),
        tokens_est: estimate_tokens(&text),
        content_hash: sha256_hex(text.as_bytes()),
        favorite: false,
        rating: 0,
        notes: String::new(),
        archived: false,
        install_state: "downloaded".into(),
        risk: Risk::default(),
        added_at: now_iso(),
        updated_at: now_iso(),
        enabled: false,
        scopes: vec![],
        has_local_files: true,
    })
}

pub fn read_item_text(item: &Item) -> Result<String> {
    let path = Path::new(&item.path);
    if path.is_file() {
        return Ok(read_trimmed(path, 400_000));
    }
    if !path.exists() {
        return Err(anyhow::anyhow!("Файли елемента відсутні на диску"));
    }
    let text = primary_text(path, None);
    if text.is_empty() {
        return Err(anyhow::anyhow!("У папці немає SKILL.md або README"));
    }
    Ok(text)
}

pub fn diff_dirs(old: &Path, new: &Path) -> (Vec<String>, Vec<String>, Vec<String>) {
    let list = |base: &Path| -> std::collections::HashMap<String, String> {
        let mut map = std::collections::HashMap::new();
        for entry in walkdir::WalkDir::new(base).into_iter().flatten() {
            if entry.file_type().is_file() {
                let rel = entry
                    .path()
                    .strip_prefix(base)
                    .unwrap_or(entry.path())
                    .to_string_lossy()
                    .to_string();
                if rel == "skillhub.json" {
                    continue;
                }
                let hash = std::fs::read(entry.path())
                    .map(|b| sha256_hex(&b))
                    .unwrap_or_default();
                map.insert(rel, hash);
            }
        }
        map
    };
    let a = list(old);
    let b = list(new);
    let added = b.keys().filter(|k| !a.contains_key(*k)).cloned().collect();
    let removed = a.keys().filter(|k| !b.contains_key(*k)).cloned().collect();
    let changed = b
        .iter()
        .filter(|(k, v)| a.get(*k).map(|old| old != *v).unwrap_or(false))
        .map(|(k, _)| k.clone())
        .collect();
    (added, removed, changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prettifies_dir_names() {
        assert_eq!(prettify("telegram-bot-helper"), "Telegram bot helper");
    }

    #[test]
    fn scan_finds_local_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        crate::settings::ensure_dirs(root).unwrap();
        let skill = root.join("library/skills/demo");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(
            skill.join("SKILL.md"),
            "---\nname: Demo Skill\ndescription: Робить демо\n---\nТіло скіла",
        )
        .unwrap();
        let db = Db::open(&root.join(".skillhub/skillhub.db")).unwrap();
        let items = scan(root, &db).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "Demo Skill");
        assert_eq!(items[0].kind, Kind::Skill);
        assert!(items[0].summary_uk.contains("демо"));
    }

    #[test]
    fn diff_detects_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let old = tmp.path().join("old");
        let new = tmp.path().join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("a.md"), "one").unwrap();
        std::fs::write(new.join("a.md"), "two").unwrap();
        std::fs::write(new.join("b.md"), "new").unwrap();
        let (added, removed, changed) = diff_dirs(&old, &new);
        assert_eq!(added, vec!["b.md"]);
        assert!(removed.is_empty());
        assert_eq!(changed, vec!["a.md"]);
    }
}
