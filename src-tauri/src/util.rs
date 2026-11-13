use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let out = hasher.finalize();
    out.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn estimate_tokens(text: &str) -> i64 {
    let chars = text.chars().count() as f64;
    (chars / 4.0).ceil() as i64
}

pub fn slugify(input: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "item".to_string()
    } else {
        trimmed.chars().take(64).collect()
    }
}

pub fn expand_home(input: &str) -> PathBuf {
    if let Some(rest) = input.strip_prefix("~/").or_else(|| input.strip_prefix("~\\")) {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(input)
}

pub fn default_root() -> PathBuf {
    dirs::document_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
        .join("SkillHub")
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("dat")
    ));
    std::fs::write(&tmp, bytes)?;
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn hidden_command(program: &str) -> Command {
    let cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = cmd;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        return cmd;
    }
    #[cfg(not(windows))]
    cmd
}

pub fn run_git<I, S>(cwd: &Path, args: I) -> Result<Output>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let mut cmd = hidden_command("git");
    cmd.current_dir(cwd).args(args).env("GIT_TERMINAL_PROMPT", "0");
    let out = cmd.output().map_err(|e| {
        anyhow!("Не вдалося запустити git. Перевір, чи встановлений Git for Windows. ({e})")
    })?;
    Ok(out)
}

pub fn git_ok(cwd: &Path, args: &[&str]) -> Result<String> {
    let out = run_git(cwd, args)?;
    if !out.status.success() {
        return Err(anyhow!(
            "git {} завершився з помилкою: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn dir_size(path: &Path) -> i64 {
    let mut total = 0i64;
    for entry in walkdir::WalkDir::new(path).into_iter().flatten() {
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                total += meta.len() as i64;
            }
        }
    }
    total
}

pub fn copy_dir(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in walkdir::WalkDir::new(src).into_iter().flatten() {
        let rel = entry.path().strip_prefix(src)?;
        if rel.as_os_str().is_empty() {
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

pub fn find_first_file(dir: &Path, names: &[&str]) -> Option<PathBuf> {
    for name in names {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub fn read_trimmed(path: &Path, max_bytes: usize) -> String {
    let bytes = std::fs::read(path).unwrap_or_default();
    let slice = if bytes.len() > max_bytes {
        &bytes[..max_bytes]
    } else {
        &bytes[..]
    };
    String::from_utf8_lossy(slice).to_string()
}

pub fn base64_encode(input: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(input.as_bytes())
}

/// Назва папки в бібліотеці для типу елемента.
pub fn kind_folder(kind: &str) -> &'static str {
    match kind {
        "skill" => "skills",
        "plugin" => "plugins",
        "agent" => "agents",
        "command" => "commands",
        "token-saver" => "token-savers",
        "mcp" => "mcp",
        "prompt" => "prompts",
        "theme" => "themes",
        _ => "other",
    }
}
