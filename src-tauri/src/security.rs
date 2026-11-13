use crate::domain::{FileEntry, Finding, Risk};
use regex::Regex;
use std::path::Path;
use std::sync::OnceLock;

struct Pattern {
    title: &'static str,
    detail: &'static str,
    severity: &'static str,
    regex: &'static str,
}

const PATTERNS: &[Pattern] = &[
    Pattern {
        title: "Виконання коду з рядка",
        detail: "eval / new Function можуть виконувати прихований код.",
        severity: "high",
        regex: r"(?i)\beval\s*\(|new\s+Function\s*\(",
    },
    Pattern {
        title: "Читання ключів і сховищ",
        detail: "Код звертається до SSH-ключів, AWS-креденшлів або .env.",
        severity: "high",
        regex: r"(?i)(\.ssh[/\\]id_|\.aws[/\\]credentials|id_rsa|\.env\b|wallet\.dat|credentials\.json)",
    },
    Pattern {
        title: "Завантаження й запуск скрипта",
        detail: "Класична схема curl | sh або powershell -enc виконує віддалений код.",
        severity: "high",
        regex: r"(?i)(curl|iwr|invoke-webrequest)[^\n|]{0,80}\|\s*(sh|bash|zsh|iex)|powershell[^\n]{0,60}-e(nc|ncodedcommand)?\b",
    },
    Pattern {
        title: "Запуск дочірніх процесів",
        detail: "Скіл може запускати команди на твоїй машині — перевір, що саме.",
        severity: "medium",
        regex: r"(?i)(child_process|subprocess\.(run|call|popen)|os\.system\s*\(|std::process::Command)",
    },
    Pattern {
        title: "Мережеві запити",
        detail: "Є вихідні HTTP-запити: дані можуть покидати твою машину.",
        severity: "medium",
        regex: r"(?i)\b(fetch|axios|requests\.(get|post)|urllib\.request|reqwest::|httpx\.)\b",
    },
    Pattern {
        title: "Обфускація у base64",
        detail: "Довгий base64-блок часто ховає код або команду.",
        severity: "medium",
        regex: r"[A-Za-z0-9+/]{400,}={0,2}",
    },
    Pattern {
        title: "Масове видалення файлів",
        detail: "Команди rm -rf / del /s можуть знищити дані.",
        severity: "medium",
        regex: r"(?i)(rm\s+-rf\s+[/~*]|del\s+/[sfq]|format\s+[a-z]:|Remove-Item[^\n]{0,40}-Recurse)",
    },
    Pattern {
        title: "Підвищення прав",
        detail: "Запит sudo/administrator — привід перевірити, навіщо.",
        severity: "medium",
        regex: r"(?i)\bsudo\b|runas\s+/user:administrator|Start-Process[^\n]{0,40}-Verb\s+RunAs",
    },
    Pattern {
        title: "Читання змінних середовища",
        detail: "Код читає process.env / os.environ — можливий доступ до токенів.",
        severity: "low",
        regex: r"(?i)(process\.env|os\.environ|env::var\()",
    },
];

fn compiled() -> &'static Vec<Regex> {
    static REGEXES: OnceLock<Vec<Regex>> = OnceLock::new();
    REGEXES.get_or_init(|| {
        PATTERNS
            .iter()
            .map(|p| Regex::new(p.regex).expect("regex"))
            .collect()
    })
}

pub fn scan_files(files: &[FileEntry]) -> Risk {
    let regexes = compiled();
    let mut findings: Vec<Finding> = Vec::new();
    for file in files.iter().filter(|f| f.text.is_some()).take(60) {
        let text = file.text.as_deref().unwrap_or_default();
        if text.len() > 400_000 {
            continue;
        }
        for (idx, pattern) in PATTERNS.iter().enumerate() {
            if findings.len() >= 14 {
                break;
            }
            if let Some(m) = regexes[idx].find(text) {
                let line = text[..m.start()].matches('\n').count() + 1;
                if findings
                    .iter()
                    .any(|f| f.title == pattern.title && f.file.as_deref() == Some(file.path.as_str()))
                {
                    continue;
                }
                findings.push(Finding {
                    severity: pattern.severity.to_string(),
                    title: pattern.title.to_string(),
                    detail: pattern.detail.to_string(),
                    line: Some(line),
                    file: Some(file.path.clone()),
                });
            }
        }
    }

    let level = if findings.iter().any(|f| f.severity == "high") {
        "high"
    } else if findings.iter().any(|f| f.severity == "medium") {
        "medium"
    } else if findings.is_empty() {
        "clean"
    } else {
        "low"
    };

    Risk {
        level: level.into(),
        findings,
        scanned_at: crate::util::now_iso(),
    }
}

pub fn scan_dir(path: &Path) -> Risk {
    let mut files: Vec<FileEntry> = Vec::new();
    for entry in walkdir::WalkDir::new(path)
        .max_depth(4)
        .into_iter()
        .flatten()
    {
        if files.len() >= 60 {
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
            .to_string();
        let skip = rel.contains("node_modules")
            || rel.contains(".git")
            || rel.ends_with(".png")
            || rel.ends_with(".jpg")
            || rel.ends_with(".ico")
            || rel.ends_with(".lock");
        if skip {
            continue;
        }
        let meta = entry.metadata().ok();
        if meta.as_ref().map(|m| m.len() > 300_000).unwrap_or(false) {
            continue;
        }
        let text = std::fs::read_to_string(entry.path()).ok();
        files.push(FileEntry {
            path: rel,
            size: meta.map(|m| m.len() as i64).unwrap_or(0),
            text,
        });
    }
    scan_files(&files)
}

pub struct SecretFinding {
    pub path: String,
    pub line: usize,
    pub reason: String,
}

pub fn secret_scan(files: &[(String, String)]) -> Vec<SecretFinding> {
    let aws = Regex::new(r"AKIA[0-9A-Z]{16}").unwrap();
    let github = Regex::new(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}").unwrap();
    let generic = Regex::new(
        r#"(?i)(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"][^'"\s]{12,}['"]"#,
    )
    .unwrap();
    let private_key = Regex::new(r"-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----").unwrap();
    let openai = Regex::new(r"sk-[A-Za-z0-9_\-]{20,}").unwrap();
    let telegram = Regex::new(r"[0-9]{8,10}:[A-Za-z0-9_-]{35}").unwrap();

    let mut out = Vec::new();
    for (path, content) in files {
        let lower = path.to_lowercase();
        let base = lower.rsplit(['/', '\\']).next().unwrap_or(&lower);
        let is_env = base == ".env" || base.starts_with(".env.") && !base.ends_with(".example");
        let skip = lower.contains("node_modules/")
            || lower.ends_with(".lock")
            || lower.ends_with("pnpm-lock.yaml")
            || lower.ends_with("package-lock.json");
        if skip {
            continue;
        }
        if is_env {
            out.push(SecretFinding {
                path: path.clone(),
                line: 0,
                reason: "Файл .env містить змінні середовища і не має потрапляти в git".into(),
            });
        }
        for (idx, line) in content.lines().enumerate() {
            if line.len() > 800 {
                continue;
            }
            let mut push = |reason: &str| {
                if out.len() < 40 {
                    out.push(SecretFinding {
                        path: path.clone(),
                        line: idx + 1,
                        reason: reason.to_string(),
                    });
                }
            };
            if private_key.is_match(line) {
                push("Приватний ключ у файлі");
            }
            if aws.is_match(line) {
                push("Схоже на AWS access key");
            }
            if github.is_match(line) {
                push("Схоже на GitHub token");
            }
            if openai.is_match(line) && !lower.contains("readme") {
                push("Схоже на API-ключ (sk-…)");
            }
            if telegram.is_match(line) {
                push("Схоже на Telegram bot token");
            }
            if generic.is_match(line) {
                push("Підозріле присвоєння секрету");
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_eval() {
        let files = vec![FileEntry {
            path: "run.ts".into(),
            size: 30,
            text: Some("eval(userInput)".into()),
        }];
        let risk = scan_files(&files);
        assert_eq!(risk.level, "high");
    }

    #[test]
    fn clean_file_ok() {
        let files = vec![FileEntry {
            path: "SKILL.md".into(),
            size: 20,
            text: Some("# Helper\nDo the thing".into()),
        }];
        assert_eq!(scan_files(&files).level, "clean");
    }

    #[test]
    fn detects_github_token() {
        let files = vec![(
            "config.ts".to_string(),
            "const token = \"ghp_1234567890abcdefghijklmnop\";".to_string(),
        )];
        assert!(!secret_scan(&files).is_empty());
    }

    #[test]
    fn env_file_flagged() {
        let files = vec![(".env".to_string(), "DEBUG=1".to_string())];
        assert!(!secret_scan(&files).is_empty());
    }
}
