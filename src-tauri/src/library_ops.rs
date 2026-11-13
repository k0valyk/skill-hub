use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::db::Db;
use crate::domain::{Item, Preview, Risk};
use crate::github::GitHub;
use crate::scanner;
use crate::util::{
    copy_dir, dir_size, estimate_tokens, git_ok, hidden_command, now_iso, read_trimmed, sha256_hex,
    slugify,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub id: String,
    pub name: String,
    pub current: Option<String>,
    pub latest: Option<String>,
    pub behind: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub changed: Vec<String>,
    pub commit: Option<String>,
}

fn copy_tree_filtered(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in walkdir::WalkDir::new(src).into_iter().flatten() {
        let rel = match entry.path().strip_prefix(src) {
            Ok(rel) => rel,
            Err(_) => continue,
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let top = rel.components().next().map(|c| c.as_os_str().to_string_lossy().to_string());
        if top.as_deref() == Some(".git") || top.as_deref() == Some("skillhub.json") {
            continue;
        }
        let target = dst.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target)?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

fn clone_sparse(url: &str, sub_path: Option<&str>, dest: &Path) -> Result<String> {
    std::fs::create_dir_all(dest)?;
    let out = hidden_command("git")
        .args([
            "clone",
            "--depth",
            "1",
            "--filter=blob:none",
            "--sparse",
            "--no-tags",
            url,
        ])
        .arg(dest)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| anyhow!("Не вдалося запустити git: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(anyhow!(
            "Не вдалося склонувати репозиторій. {}",
            humanize_git_error(&err)
        ));
    }
    if let Some(sub) = sub_path {
        let out = hidden_command("git")
            .args(["sparse-checkout", "set", sub])
            .current_dir(dest)
            .output()?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(anyhow!("Не вдалося вибрати папку {sub}: {}", humanize_git_error(&err)));
        }
    }
    git_ok(dest, &["rev-parse", "HEAD"]).map(|s| s.trim().to_string())
}

fn humanize_git_error(err: &str) -> String {
    let lower = err.to_lowercase();
    if lower.contains("could not resolve host") || lower.contains("unable to access") {
        "Немає зв'язку з GitHub. Перевір інтернет або VPN.".to_string()
    } else if lower.contains("authentication failed") || lower.contains("403") {
        "GitHub не пустив без авторизації. Увійди в GitHub у налаштуваннях.".to_string()
    } else if lower.contains("not found") {
        "Репозиторій не знайдено або він приватний.".to_string()
    } else {
        let short: String = err.trim().chars().take(220).collect();
        format!("git: {short}")
    }
}

pub fn install(
    db: &Db,
    root: &Path,
    preview: &Preview,
    meta: Option<crate::domain::RepoMeta>,
    progress: impl Fn(&str, u8),
) -> Result<Item> {
    crate::settings::ensure_dirs(root)?;
    let target = scanner::ensure_unique_dir(root, preview.kind, &preview.default_id);
    let parent = target
        .parent()
        .ok_or_else(|| anyhow!("Некоректний шлях бібліотеки"))?
        .to_path_buf();
    std::fs::create_dir_all(&parent)?;

    let cache = root.join(".skillhub").join("cache");
    std::fs::create_dir_all(&cache)?;
    let tmp = cache.join(format!("clone-{}", uuid::Uuid::new_v4()));
    progress("clone", 12);

    let commit;
    let mut warnings_extra: Vec<String> = Vec::new();

    if preview.is_gist {
        let meta = meta.ok_or_else(|| anyhow!("Не вдалося отримати файли gist. Спробуй ще раз."))?;
        std::fs::create_dir_all(&target)?;
        for file in &meta.files {
            let safe_name = file.path.replace(['/', '\\'], "_");
            std::fs::write(target.join(safe_name), file.text.clone().unwrap_or_default())?;
        }
        commit = meta.commit.clone();
    } else {
        let commit_sha = clone_sparse(&preview.url, preview.sub_path.as_deref(), &tmp)?;
        commit = Some(commit_sha);
        progress("extract", 45);
        if preview.sub_is_file {
            let rel = preview.sub_path.clone().unwrap_or_default();
            let source = tmp.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
            std::fs::create_dir_all(&target)?;
            let filename = source
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "SKILL.md".into());
            std::fs::copy(&source, target.join(filename))?;
        } else if let Some(sub) = &preview.sub_path {
            let source = tmp.join(sub.replace('/', std::path::MAIN_SEPARATOR_STR));
            if !source.exists() {
                return Err(anyhow!("Папка {sub} не з'явилася після sparse checkout."));
            }
            copy_tree_filtered(&source, &target)?;
        } else {
            copy_tree_filtered(&tmp, &target)?;
        }
    }

    let _ = std::fs::remove_dir_all(&tmp);

    progress("scan", 72);
    let text = read_trimmed(
        &crate::util::find_first_file(&target, &["SKILL.md", "skill.md", "README.md", "readme.md"])
            .unwrap_or_else(|| target.join("none")),
        400_000,
    );
    let size = if target.is_dir() { dir_size(&target) } else { 0 };
    let risk = crate::security::scan_dir(&target);
    if risk.level == "high" {
        warnings_extra.push("Під час встановлення знайдено небезпечні патерни у коді.".into());
    }

    let mut id = slugify(
        &target
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| preview.default_id.clone()),
    );
    id = scanner::unique_id(db, &id);
    // якщо id змінився через колізію — перейменовуємо папку, щоб id і тека збігалися
    let final_dir = parent.join(&id);
    if final_dir != target {
        let _ = std::fs::remove_dir_all(&final_dir);
        std::fs::rename(&target, &final_dir)?;
    }

    let mut item = Item {
        id,
        name: preview.name.clone(),
        kind: preview.kind,
        source_url: Some(preview.url.clone()),
        source_ref: preview
            .sub_path
            .clone()
            .or_else(|| Some(preview.branch.clone())),
        commit,
        version: None,
        path: final_dir.to_string_lossy().to_string(),
        summary_uk: preview.summary_uk.clone(),
        summary_en: preview.summary_en.clone(),
        tags: preview.tags.clone(),
        license: preview.license.clone(),
        stars: preview.stars,
        pushed_at: preview.pushed_at.clone(),
        size_bytes: size,
        tokens_est: estimate_tokens(&text),
        content_hash: sha256_hex(text.as_bytes()),
        favorite: false,
        rating: 0,
        notes: warnings_extra.join(" "),
        archived: false,
        install_state: "downloaded".into(),
        risk,
        added_at: now_iso(),
        updated_at: now_iso(),
        enabled: false,
        scopes: vec![],
        has_local_files: true,
    };
    progress("manifest", 90);
    scanner::write_manifest(&final_dir, &item)?;
    item.added_at = now_iso();
    db.upsert_item(&item)?;
    db.record_usage(Some(&item.id), "install", 0)?;
    progress("done", 100);
    Ok(item)
}

pub fn save_link(db: &Db, preview: &Preview) -> Result<Item> {
    let id = scanner::unique_id(db, &preview.default_id);
    let item = Item {
        id,
        name: preview.name.clone(),
        kind: preview.kind,
        source_url: Some(preview.url.clone()),
        source_ref: preview.sub_path.clone(),
        commit: preview.commit.clone(),
        version: None,
        path: String::new(),
        summary_uk: preview.summary_uk.clone(),
        summary_en: preview.summary_en.clone(),
        tags: preview.tags.clone(),
        license: preview.license.clone(),
        stars: preview.stars,
        pushed_at: preview.pushed_at.clone(),
        size_bytes: preview.size_bytes,
        tokens_est: 0,
        content_hash: String::new(),
        favorite: false,
        rating: 0,
        notes: String::new(),
        archived: false,
        install_state: "linked".into(),
        risk: preview.risk.clone(),
        added_at: now_iso(),
        updated_at: now_iso(),
        enabled: false,
        scopes: vec![],
        has_local_files: false,
    };
    db.upsert_item(&item)?;
    db.record_usage(Some(&item.id), "save_link", 0)?;
    Ok(item)
}

pub fn delete(db: &Db, root: &Path, id: &str, remove_files: bool) -> Result<()> {
    let item = db
        .get_item(id)?
        .ok_or_else(|| anyhow!("Елемент не знайдено"))?;
    for link in db.item_links(id)? {
        let _ = linking_remove(&link.target);
    }
    if remove_files && !item.path.is_empty() {
        let path = PathBuf::from(&item.path);
        let library = root.join("library");
        if path.starts_with(&library) && path.exists() {
            if path.is_dir() {
                std::fs::remove_dir_all(&path)?;
            } else {
                std::fs::remove_file(&path)?;
            }
        } else {
            return Err(anyhow!(
                "Відмова видаляти файли поза бібліотекою: {}",
                path.display()
            ));
        }
    }
    db.delete_item(id)?;
    Ok(())
}

fn linking_remove(target: &str) -> Result<()> {
    let path = Path::new(target);
    if !path.exists() {
        return Ok(());
    }
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_dir(path);
    Ok(())
}

pub async fn update_item(
    gh: &GitHub,
    db: &std::sync::Mutex<Db>,
    root: &Path,
    id: &str,
) -> Result<UpdateResult> {
    let item = db
        .lock()
        .unwrap()
        .get_item(id)?
        .ok_or_else(|| anyhow!("Елемент не знайдено"))?;
    let url = item
        .source_url
        .clone()
        .ok_or_else(|| anyhow!("У цього елемента немає джерела — оновлення неможливе."))?;
    if item.install_state == "linked" {
        return Err(anyhow!("Елемент збережено лише посиланням. Спочатку завантаж його в бібліотеку."));
    }
    let parsed = crate::github::parse_url(&url)?;
    if parsed.is_gist {
        return Err(anyhow!("Gist не оновлюється автоматично — видали й додай заново."));
    }

    let tmp = root
        .join(".skillhub/cache")
        .join(format!("update-{}", uuid::Uuid::new_v4()));
    let commit = clone_sparse(&url, parsed.sub_path.as_deref(), &tmp)?;
    let (added, removed, changed) = if Path::new(&item.path).exists() {
        scanner::diff_dirs(Path::new(&item.path), &tmp)
    } else {
        (vec![], vec![], vec![])
    };

    let cache = root.join(".skillhub/cache");
    let staged = cache.join(format!("staged-{}", uuid::Uuid::new_v4()));
    if let Some(sub) = &parsed.sub_path {
        let source = tmp.join(sub.replace('/', std::path::MAIN_SEPARATOR_STR));
        if source.is_file() {
            std::fs::create_dir_all(&staged)?;
            std::fs::copy(&source, staged.join("SKILL.md"))?;
        } else if source.exists() {
            copy_tree_filtered(&source, &staged)?;
        }
    } else {
        copy_tree_filtered(&tmp, &staged)?;
    }
    let _ = std::fs::remove_dir_all(&tmp);
    if !staged.exists() {
        return Err(anyhow!("Не вдалося підготувати нову версію елемента."));
    }

    let target = PathBuf::from(&item.path);
    if target.exists() {
        let backup = root
            .join(".skillhub/backups")
            .join(format!("{}-{}", item.id, chrono::Utc::now().format("%Y%m%d-%H%M%S")));
        std::fs::create_dir_all(backup.parent().unwrap_or(root))?;
        copy_dir(&target, &backup)?;
        std::fs::remove_dir_all(&target)?;
    }
    std::fs::create_dir_all(&target)?;
    copy_tree_filtered(&staged, &target)?;
    let _ = std::fs::remove_dir_all(&staged);

    let text = read_trimmed(
        &crate::util::find_first_file(&target, &["SKILL.md", "skill.md", "README.md"])
            .unwrap_or_else(|| target.join("none")),
        400_000,
    );
    let mut updated = item.clone();
    updated.commit = Some(commit.clone());
    updated.size_bytes = dir_size(&target);
    updated.tokens_est = estimate_tokens(&text);
    updated.content_hash = sha256_hex(text.as_bytes());
    updated.updated_at = now_iso();
    updated.risk = crate::security::scan_dir(&target);
    if let Ok(repo) = gh.repo(&parsed.owner, &parsed.repo).await {
        updated.stars = repo.get("stargazers_count").and_then(|v| v.as_i64()).unwrap_or(updated.stars);
        updated.pushed_at = repo
            .get("pushed_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or(updated.pushed_at);
        updated.license = repo
            .get("license")
            .and_then(|l| l.get("spdx_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or(updated.license);
    }
    scanner::write_manifest(&target, &updated)?;
    {
        let handle = db.lock().unwrap();
        handle.upsert_item(&updated)?;
        handle.record_usage(Some(id), "update", 0)?;
    }

    Ok(UpdateResult {
        added,
        removed,
        changed,
        commit: Some(commit),
    })
}

pub fn check_updates(db: &Db, token: Option<&str>) -> Vec<UpdateInfo> {
    let items = db.items().unwrap_or_default();
    let mut out = Vec::new();
    for item in items {
        if item.source_url.is_none() || item.install_state == "linked" {
            continue;
        }
        let url = item.source_url.clone().unwrap_or_default();
        let parsed = match crate::github::parse_url(&url) {
            Ok(p) if !p.is_gist => p,
            _ => continue,
        };
        let repo_url = format!("https://github.com/{}/{}.git", parsed.owner, parsed.repo);
        let mut cmd = hidden_command("git");
        if let Some(token) = token {
            let header = format!(
                "AUTHORIZATION: basic {}",
                crate::util::base64_encode(&format!("x-access-token:{token}"))
            );
            cmd.args(["-c", &format!("http.extraheader={header}")]);
        }
        cmd.args(["ls-remote", &repo_url, "HEAD"])
            .env("GIT_TERMINAL_PROMPT", "0");
        let output = cmd.output();
        match output {
            Ok(proc) if proc.status.success() => {
                let text = String::from_utf8_lossy(&proc.stdout).to_string();
                let latest = text.split_whitespace().next().map(|s| s.to_string());
                let behind = match (&item.commit, &latest) {
                    (Some(current), Some(latest)) => current != latest,
                    (None, Some(_)) => true,
                    _ => false,
                };
                out.push(UpdateInfo {
                    id: item.id.clone(),
                    name: item.name.clone(),
                    current: item.commit.clone(),
                    latest,
                    behind,
                    error: None,
                });
            }
            Ok(proc) => out.push(UpdateInfo {
                id: item.id.clone(),
                name: item.name.clone(),
                current: item.commit.clone(),
                latest: None,
                behind: false,
                error: Some(humanize_git_error(&String::from_utf8_lossy(&proc.stderr))),
            }),
            Err(err) => out.push(UpdateInfo {
                id: item.id.clone(),
                name: item.name.clone(),
                current: item.commit.clone(),
                latest: None,
                behind: false,
                error: Some(format!("git недоступний: {err}")),
            }),
        }
    }
    out
}

pub fn guessed_kind_from_dir(dir: &Path) -> crate::domain::Kind {
    crate::classify::classify_local(dir)
}

pub fn empty_risk() -> Risk {
    Risk {
        level: "clean".into(),
        findings: vec![],
        scanned_at: now_iso(),
    }
}

pub fn describe_item_fallback(item: &Item) -> String {
    format!(
        "Це {} «{}». {}",
        item.kind.as_str(),
        item.name,
        crate::classify::first_sentence(&item.summary_uk)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Kind;

    #[test]
    fn copy_skips_git_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        std::fs::create_dir_all(src.join(".git")).unwrap();
        std::fs::write(src.join(".git/config"), "x").unwrap();
        std::fs::write(src.join("SKILL.md"), "body").unwrap();
        copy_tree_filtered(&src, &dst).unwrap();
        assert!(dst.join("SKILL.md").exists());
        assert!(!dst.join(".git").exists());
    }

    #[test]
    fn save_link_has_no_files() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(&tmp.path().join("db.sqlite")).unwrap();
        let preview = Preview {
            url: "https://github.com/acme/demo".into(),
            kind: Kind::Skill,
            name: "Demo".into(),
            owner: "acme".into(),
            repo: "demo".into(),
            branch: "main".into(),
            sub_path: None,
            sub_is_file: false,
            commit: Some("abc".into()),
            summary_uk: "Це скіл. Він робить речі. Він потрібен тобі.".into(),
            summary_en: "A skill.".into(),
            tags: vec!["skill".into()],
            license: Some("MIT".into()),
            stars: 3,
            pushed_at: None,
            size_bytes: 10,
            default_folder: "skills".into(),
            default_id: "demo".into(),
            risk: empty_risk(),
            warnings: vec![],
            description_source: "rules".into(),
            tokens_used: 0,
            cached: false,
            file_count: 1,
            is_gist: false,
            is_awesome: false,
        };
        let item = save_link(&db, &preview).unwrap();
        assert_eq!(item.install_state, "linked");
        assert!(!item.has_local_files);
    }
}
