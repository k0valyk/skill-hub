use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::domain::ProjectInfo;
use crate::github::GitHub;
use crate::security;
use crate::util::{base64_encode, hidden_command, now_iso, run_git, slugify};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretItem {
    pub path: String,
    pub line: usize,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishPlan {
    pub path: String,
    pub name: String,
    pub is_repo: bool,
    pub branch: String,
    pub files: Vec<String>,
    pub secrets: Vec<SecretItem>,
    pub gitignore_created: bool,
    pub languages: Vec<String>,
    pub default_message: String,
    pub remote: Option<String>,
    pub total_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub repo_url: String,
    pub branch: String,
    pub commit: Option<String>,
    pub pushed_files: usize,
    pub message: String,
}

fn auth_args(token: Option<&str>) -> Vec<String> {
    match token {
        Some(token) if !token.is_empty() => vec![
            "-c".to_string(),
            format!(
                "http.extraheader=AUTHORIZATION: basic {}",
                base64_encode(&format!("x-access-token:{token}"))
            ),
        ],
        _ => vec![],
    }
}

fn git_str(path: &Path, args: &[&str]) -> Result<String> {
    let out = run_git(path, args)?;
    if !out.status.success() {
        return Err(anyhow!(
            "{}",
            String::from_utf8_lossy(&out.stderr).trim().to_string()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn is_repo(path: &Path) -> bool {
    run_git(path, ["rev-parse", "--is-inside-work-tree"])
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false)
}

pub fn remote_url(path: &Path) -> Option<String> {
    run_git(path, ["remote", "get-url", "origin"])
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

fn detect_languages(path: &Path) -> Vec<String> {
    let mut counts: std::collections::HashMap<&'static str, i64> = std::collections::HashMap::new();
    for entry in walkdir::WalkDir::new(path)
        .max_depth(4)
        .into_iter()
        .flatten()
        .take(4000)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry.path().to_string_lossy().to_lowercase();
        if rel.contains("node_modules") || rel.contains("\\.git\\") || rel.contains("/.git/") {
            continue;
        }
        let lang = match entry.path().extension().and_then(|e| e.to_str()) {
            Some("py") => "Python",
            Some("ts") | Some("tsx") => "TypeScript",
            Some("js") | Some("jsx") => "JavaScript",
            Some("rs") => "Rust",
            Some("go") => "Go",
            Some("cs") => "C#",
            Some("java") => "Java",
            Some("vue") => "Vue",
            Some("svelte") => "Svelte",
            _ => continue,
        };
        *counts.entry(lang).or_insert(0) += 1;
    }
    let mut list: Vec<(&str, i64)> = counts.into_iter().collect();
    list.sort_by(|a, b| b.1.cmp(&a.1));
    let mut out: Vec<String> = list.into_iter().take(3).map(|(l, _)| l.to_string()).collect();
    if out.is_empty() {
        out.push("Other".into());
    }
    out
}

fn gitignore_for(languages: &[String]) -> String {
    let mut lines: Vec<&str> = vec![
        "# Створено Skill Hub",
        ".env",
        ".env.*",
        "!.env.example",
        "*.log",
        "Thumbs.db",
        ".DS_Store",
        ".idea/",
    ];
    let has = |lang: &str| languages.iter().any(|l| l == lang);
    if has("Python") {
        lines.extend(["__pycache__/", "*.pyc", ".venv/", "venv/", ".pytest_cache/", ".mypy_cache/", ".ruff_cache/", "*.sqlite3"]);
    }
    if has("TypeScript") || has("JavaScript") || has("Vue") || has("Svelte") {
        lines.extend(["node_modules/", "dist/", "build/", ".vite/", "coverage/"]);
    }
    if has("Rust") {
        lines.extend(["/target/", "*.pdb"]);
    }
    if has("Go") {
        lines.push("*.exe");
    }
    if has("C#") {
        lines.extend(["bin/", "obj/"]);
    }
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

fn collect_files(path: &Path) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    for entry in walkdir::WalkDir::new(path).into_iter().flatten() {
        if files.len() >= 1200 {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(path)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        let lower = rel.to_lowercase();
        if lower.starts_with(".git/")
            || lower.contains("node_modules/")
            || lower.starts_with("target/")
            || lower.starts_with("dist/")
            || lower.starts_with(".venv/")
            || lower.starts_with("venv/")
            || lower.ends_with("package-lock.json")
        {
            continue;
        }
        files.push(rel);
    }
    files.sort();
    files
}

fn collect_secret_inputs(path: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(path).into_iter().flatten() {
        if out.len() >= 400 {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(path)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        let lower = rel.to_lowercase();
        if lower.starts_with(".git/")
            || lower.contains("node_modules/")
            || lower.starts_with("target/")
            || lower.ends_with(".png")
            || lower.ends_with(".jpg")
            || lower.ends_with(".zip")
            || lower.ends_with(".ico")
        {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if size > 400_000 {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(entry.path()) {
            out.push((rel, text));
        }
    }
    out
}

pub fn plan(path: &Path) -> Result<PublishPlan> {
    if !path.exists() {
        return Err(anyhow!("Папка проєкту не існує: {}", path.display()));
    }
    let is_repo = is_repo(path);
    let remote = remote_url(path);
    let branch = if is_repo {
        git_str(path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|_| "main".into())
    } else {
        "main".into()
    };
    let languages = detect_languages(path);
    let files = collect_files(path);
    let secrets: Vec<SecretItem> = security::secret_scan(&collect_secret_inputs(path))
        .into_iter()
        .map(|s| SecretItem {
            path: s.path,
            line: s.line,
            reason: s.reason,
        })
        .collect();
    let total_size = files
        .iter()
        .filter_map(|f| std::fs::metadata(path.join(f)).ok())
        .map(|m| m.len() as i64)
        .sum();
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".into());

    Ok(PublishPlan {
        path: path.to_string_lossy().to_string(),
        name: slugify(&name),
        is_repo,
        branch,
        files,
        secrets,
        gitignore_created: !path.join(".gitignore").exists(),
        languages,
        default_message: format!(
            "chore: publish {} via Skill Hub ({})",
            name,
            now_iso().split('T').next().unwrap_or("")
        ),
        remote,
        total_size,
    })
}

pub fn status(path: &Path) -> ProjectInfo {
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let mut info = ProjectInfo {
        path: path.to_string_lossy().to_string(),
        name,
        is_repo: false,
        branch: String::new(),
        remote: None,
        status: "no-repo".into(),
        dirty_count: 0,
        ahead: 0,
        behind: 0,
        languages: detect_languages(path),
        last_commit: None,
        last_commit_at: None,
    };
    if !is_repo(path) {
        return info;
    }
    info.is_repo = true;
    info.remote = remote_url(path);
    let out = match run_git(path, ["status", "--porcelain=v1", "--branch"]) {
        Ok(out) if out.status.success() => out,
        _ => {
            info.status = "error".into();
            return info;
        }
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut conflict = false;
    for line in text.lines() {
        if line.starts_with("##") {
            let branch_part = line.trim_start_matches("## ");
            let mut parts = branch_part.split("...");
            info.branch = parts.next().unwrap_or("").trim().to_string();
            if let Some(rest) = parts.next() {
                if let Some(start) = rest.find('[') {
                    let flags = &rest[start + 1..rest.len().saturating_sub(1)];
                    for flag in flags.split(',') {
                        let flag = flag.trim();
                        if let Some(n) = flag.strip_prefix("ahead ") {
                            info.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = flag.strip_prefix("behind ") {
                            info.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
            }
        } else if !line.trim().is_empty() {
            let code = &line[..2.min(line.len())];
            if matches!(code, "UU" | "AA" | "DD" | "AU" | "UA" | "DU" | "UD") {
                conflict = true;
            }
            info.dirty_count += 1;
        }
    }
    if let Ok(log) = git_str(path, &["log", "-1", "--pretty=%s"]) {
        info.last_commit = Some(log);
    }
    if let Ok(date) = git_str(path, &["log", "-1", "--pretty=%cI"]) {
        info.last_commit_at = Some(date);
    }
    info.status = if conflict {
        "conflict"
    } else if info.dirty_count > 0 {
        "changes"
    } else if info.ahead > 0 || info.behind > 0 {
        "changes"
    } else {
        "clean"
    }
    .into();
    info
}

pub fn list(root: &Path) -> Vec<ProjectInfo> {
    let project_root = root.join("projects");
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&project_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                out.push(status(&path));
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

pub fn ensure_repo(path: &Path) -> Result<()> {
    if is_repo(path) {
        return Ok(());
    }
    let out = run_git(path, ["init", "-b", "main"])?;
    if !out.status.success() {
        let out = run_git(path, ["init"])?;
        if !out.status.success() {
            return Err(anyhow!(
                "Не вдалося ініціалізувати git: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
    }
    Ok(())
}

pub fn write_gitignore(path: &Path, languages: &[String]) -> Result<bool> {
    let file = path.join(".gitignore");
    if file.exists() {
        return Ok(false);
    }
    std::fs::write(file, gitignore_for(languages))?;
    Ok(true)
}

pub async fn publish(
    gh: &GitHub,
    path: &Path,
    repo_name: &str,
    private: bool,
    description: &str,
    message: &str,
    allow_secrets: bool,
    confirm_public: bool,
) -> Result<PublishResult> {
    if !private && !confirm_public {
        return Err(anyhow!(
            "Публічний репозиторій потребує підтвердження з переліком файлів."
        ));
    }
    let plan = plan(path)?;
    if !plan.secrets.is_empty() && !allow_secrets {
        let sample: Vec<String> = plan
            .secrets
            .iter()
            .take(5)
            .map(|s| format!("{}:{} — {}", s.path, s.line, s.reason))
            .collect();
        return Err(anyhow!(
            "Знайдено можливі секрети, пуш скасовано:\n{}\nПрибери їх або підтвердь ризик вручну.",
            sample.join("\n")
        ));
    }
    let name = if repo_name.trim().is_empty() {
        plan.name.clone()
    } else {
        slugify(repo_name)
    };
    ensure_repo(path)?;
    write_gitignore(path, &plan.languages)?;

    let status_before = status(path);
    if status_before.is_repo && (status_before.ahead > 0 || status_before.behind > 0) && status_before.remote.is_some() {
        // Синхронізуємося перед пушем, щоб не зробити force.
        let _ = pull(path, gh.token.as_deref());
    }

    git_str(path, &["add", "-A"])?;
    let staged = git_str(path, &["diff", "--cached", "--name-only"]).unwrap_or_default();
    let pushed_files = if staged.is_empty() {
        0
    } else {
        staged.lines().count()
    };
    if !staged.is_empty() {
        let commit_message = if message.trim().is_empty() {
            plan.default_message.clone()
        } else {
            message.trim().to_string()
        };
        let out = run_git(
            path,
            [
                "-c",
                "user.name=Skill Hub",
                "-c",
                "user.email=skillhub@local",
                "commit",
                "-m",
                &commit_message,
            ],
        )?;
        if !out.status.success() {
            return Err(anyhow!(
                "git commit не вдався: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }

    let login = gh
        .user()
        .await
        .ok()
        .and_then(|u| u.get("login").and_then(|l| l.as_str()).map(|s| s.to_string()))
        .ok_or_else(|| anyhow!("Не вдалося отримати твій GitHub-акаунт. Перевір токен у налаштуваннях."))?;

    let remote = remote_url(path);
    let repo_url = match &remote {
        Some(url) => url.clone(),
        None => {
            let created = gh.create_repo(&name, private, description).await?;
            let clone_url = created
                .get("clone_url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("https://github.com/{login}/{name}.git"));
            let out = run_git(path, ["remote", "add", "origin", &clone_url])?;
            if !out.status.success() {
                let out = run_git(path, ["remote", "set-url", "origin", &clone_url])?;
                if !out.status.success() {
                    return Err(anyhow!(
                        "Не вдалося додати remote: {}",
                        String::from_utf8_lossy(&out.stderr)
                    ));
                }
            }
            clone_url
        }
    };

    let branch = git_str(path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|_| "main".into());
    let mut args: Vec<String> = auth_args(gh.token.as_deref());
    args.extend([
        "push".to_string(),
        "-u".to_string(),
        "origin".to_string(),
        format!("HEAD:refs/heads/{branch}"),
    ]);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_git(path, arg_refs)?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        if err.to_lowercase().contains("authentication") || err.contains("403") {
            return Err(anyhow!(
                "GitHub відхилив push: токен не має прав на цей репозиторій. Перевір scope токена (потрібен repo)."
            ));
        }
        return Err(anyhow!("push не вдався: {}", err.trim()));
    }
    let commit = git_str(path, &["rev-parse", "HEAD"]).ok();
    let public_url = repo_url
        .replace(".git", "")
        .replace("https://x-access-token", "https://github.com");
    let _ = gh.client();
    Ok(PublishResult {
        repo_url: public_url,
        branch,
        commit,
        pushed_files,
        message: format!("Запушено {pushed_files} файлів у {name}"),
    })
}

fn pull(path: &Path, token: Option<&str>) -> Result<()> {
    let mut args = auth_args(token);
    args.extend(["pull".into(), "--rebase".into(), "--autostash".into()]);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_git(path, refs)?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(anyhow!("git pull не вдався: {}", err.trim()));
    }
    Ok(())
}

pub fn sync(path: &Path, token: Option<&str>) -> Result<ProjectInfo> {
    if !is_repo(path) {
        return Err(anyhow!("Це не git-репозиторій. Спочатку опублікуй проєкт."));
    }
    let before = status(path);
    if before.remote.is_none() {
        return Err(anyhow!("У репозиторію немає remote origin."));
    }
    let mut fetch = auth_args(token);
    fetch.extend(["fetch".into(), "origin".into(), "--prune".into()]);
    let refs: Vec<&str> = fetch.iter().map(|s| s.as_str()).collect();
    let _ = run_git(path, refs);

    if before.behind > 0 || before.ahead == 0 {
        let _ = pull(path, token);
    }
    if !before.is_repo || before.dirty_count > 0 {
        // навмисно не комітимо автоматично — користувач має бачити зміни
    }
    let after_pull = status(path);
    if after_pull.ahead > 0 {
        let branch = if after_pull.branch.is_empty() {
            "main".to_string()
        } else {
            after_pull.branch.clone()
        };
        let mut args = auth_args(token);
        args.extend(["push".into(), "origin".into(), format!("HEAD:{branch}")]);
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let out = run_git(path, refs)?;
        if !out.status.success() {
            return Err(anyhow!(
                "push не вдався: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }
    Ok(status(path))
}

/// Резервна копія бібліотеки в приватний репозиторій через git work-tree.
fn ensure_backup_repo(root: &Path) -> Result<PathBuf> {
    let backup_git = root.join(".skillhub/backup-git");
    std::fs::create_dir_all(&backup_git)?;
    if !backup_git.join(".git").exists() {
        let out = run_git(&backup_git, ["init"])?;
        if !out.status.success() {
            return Err(anyhow!(
                "Не вдалося створити backup-репозиторій: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        // core.worktree рахується від батьківської теки git-каталогу, тому
        // `../../library` вказував за межі бібліотеки. Абсолютний шлях надійніший.
        let worktree = root.join("library");
        std::fs::create_dir_all(&worktree)?;
        let _ = run_git(
            &backup_git,
            ["config", "core.worktree", &worktree.to_string_lossy()],
        );
        let exclude = backup_git.join(".git").join("info").join("exclude");
        std::fs::create_dir_all(exclude.parent().unwrap_or(&backup_git))?;
        let _ = std::fs::write(exclude, "*.db\n*.tmp\n*.log\n");
        let _ = run_git(&backup_git, ["checkout", "-b", "main"]);
    }
    Ok(backup_git)
}

pub async fn backup_library(root: &Path, gh: &GitHub, repo_name: &str) -> Result<String> {
    let backup_git = ensure_backup_repo(root)?;
    let _ = run_git(&backup_git, ["add", "-A"]);
    let message = format!("chore: library backup {}", now_iso());
    let _ = run_git(
        &backup_git,
        [
            "-c",
            "user.name=Skill Hub",
            "-c",
            "user.email=skillhub@local",
            "commit",
            "-m",
            &message,
        ],
    );
    let login = gh
        .user()
        .await
        .ok()
        .and_then(|u| u.get("login").and_then(|l| l.as_str()).map(|s| s.to_string()))
        .ok_or_else(|| anyhow!("Потрібен вхід у GitHub."))?;
    let name = if repo_name.trim().is_empty() {
        "skillhub-library".to_string()
    } else {
        slugify(repo_name)
    };
    let remote = remote_url(&backup_git);
    if remote.is_none() {
        let created = match gh.create_repo(&name, true, "Skill Hub library backup").await {
            Ok(value) => value,
            Err(err) => {
                if err.to_string().contains("вже існує") {
                    serde_json::json!({})
                } else {
                    return Err(err);
                }
            }
        };
        let url = created
            .get("clone_url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("https://github.com/{login}/{name}.git"));
        let out = run_git(&backup_git, ["remote", "add", "origin", &url])?;
        if !out.status.success() {
            return Err(anyhow!(
                "remote не додався: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
    }
    let mut args = auth_args(gh.token.as_deref());
    args.extend(["push".into(), "-u".into(), "origin".into(), "main".into()]);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_git(&backup_git, refs)?;
    if !out.status.success() {
        return Err(anyhow!(
            "Не вдалося запушити backup: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(format!("https://github.com/{login}/{name}"))
}

/// Ініціалізація локального проєкту з шаблону .gitignore.
pub fn init_project(path: &Path, name: &str) -> Result<String> {
    let target = path.join(slugify(name));
    std::fs::create_dir_all(&target)?;
    let languages = detect_languages(&target);
    ensure_repo(&target)?;
    write_gitignore(&target, &languages)?;
    Ok(target.to_string_lossy().to_string())
}

pub fn hidden_git_version() -> String {
    hidden_command("git")
        .arg("--version")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "git не знайдено".into())
}

pub fn resolve_project_dir(root: &Path, path: Option<&Path>) -> PathBuf {
    match path {
        Some(p) if p.is_absolute() => p.to_path_buf(),
        Some(p) => root.join(p),
        None => root.join("projects"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gitignore_python() {
        let content = gitignore_for(&["Python".to_string()]);
        assert!(content.contains("__pycache__/"));
        assert!(content.contains(".env"));
    }

    #[test]
    fn plan_detects_secrets() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("config.py"), "API_KEY = 'sk-abcdefghijklmnopqrstuvwx'").unwrap();
        let plan = plan(tmp.path()).unwrap();
        assert!(!plan.secrets.is_empty());
    }

    #[test]
    fn status_clean_after_init() {
        let tmp = tempfile::tempdir().unwrap();
        ensure_repo(tmp.path()).unwrap();
        write_gitignore(tmp.path(), &["Python".into()]).unwrap();
        let out = run_git(tmp.path(), ["add", "-A"]).unwrap();
        assert!(out.status.success());
        let _ = run_git(
            tmp.path(),
            ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"],
        );
        let info = status(tmp.path());
        assert_eq!(info.status, "clean");
    }

    #[test]
    fn backup_worktree_is_library() {
        let tmp = tempfile::tempdir().unwrap();
        crate::settings::ensure_dirs(tmp.path()).unwrap();
        let git_dir = ensure_backup_repo(tmp.path()).unwrap();
        let out = run_git(&git_dir, ["rev-parse", "--show-toplevel"]).unwrap();
        assert!(
            out.status.success(),
            "git не бачить worktree: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let top = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let expected = tmp.path().join("library").canonicalize().unwrap();
        assert_eq!(PathBuf::from(top).canonicalize().unwrap(), expected);
    }
}
