use crate::domain::{Kind, RepoMeta};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct Classification {
    pub kind: Kind,
    pub tags: Vec<String>,
    pub confidence: f64,
    pub reasons: Vec<String>,
    pub is_awesome: bool,
}

fn has(files: &[String], needle: &str) -> bool {
    files.iter().any(|f| f.to_lowercase().ends_with(needle))
}

fn any_contains(files: &[String], needle: &str) -> bool {
    files.iter().any(|f| f.to_lowercase().contains(needle))
}

pub fn classify(meta: &RepoMeta) -> Classification {
    let files: Vec<String> = meta.files.iter().map(|f| f.path.clone()).collect();
    let readme = meta.readme.to_lowercase();
    let sub = meta.sub_path.clone().unwrap_or_default().to_lowercase();
    let mut tags: Vec<String> = Vec::new();
    let mut reasons: Vec<String> = Vec::new();

    for topic in &meta.topics {
        if tags.len() < 4 && !topic.is_empty() {
            tags.push(topic.to_lowercase());
        }
    }
    if let Some(lang) = &meta.language {
        tags.push(lang.to_lowercase());
    }
    for (needle, tag) in [
        ("telegram", "telegram"),
        ("aiogram", "aiogram"),
        ("python", "python"),
        ("typescript", "typescript"),
        ("rust", "rust"),
        ("react", "react"),
        ("context", "context"),
        ("token", "tokens"),
        ("memory", "memory"),
        ("cache", "caching"),
        ("rag", "rag"),
        ("prompt", "prompts"),
    ] {
        if (readme.contains(needle) || any_contains(&files, needle)) && !tags.iter().any(|t| t == tag) {
            tags.push(tag.to_string());
        }
    }

    let is_awesome = (readme.contains("awesome") && readme.matches("github.com/").count() > 20)
        || (meta.name.to_lowercase().starts_with("awesome-") && !has(&files, "skill.md"));

    let mut kind = Kind::Other;
    let mut confidence = 0.35;

    if has(&files, "skill.md") || any_contains(&files, "/skills/") || sub.contains("skills/") {
        kind = Kind::Skill;
        confidence = 0.93;
        reasons.push("У репозиторії є SKILL.md — це скіл".into());
    } else if has(&files, ".mcp.json")
        || has(&files, "mcp.json")
        || has(&files, "mcp-servers.json")
        || meta.name.to_lowercase().contains("mcp-server")
        || meta.name.to_lowercase().ends_with("-mcp")
        || readme.contains("model context protocol")
        || any_contains(&files, "mcp.json")
    {
        kind = Kind::Mcp;
        confidence = 0.85;
        reasons.push("Знайдено MCP-конфіг або згадку Model Context Protocol".into());
    } else if readme.contains("@opencode-ai/plugin")
        || any_contains(&files, ".opencode/plugin")
        || meta.name.to_lowercase().contains("opencode-plugin")
    {
        kind = Kind::Plugin;
        confidence = 0.88;
        reasons.push("Структура плагіна OpenCode (@opencode-ai/plugin)".into());
    } else if any_contains(&files, "agents/") || has(&files, "agent.md") || sub.starts_with("agents/") {
        kind = Kind::Agent;
        confidence = 0.7;
        reasons.push("Є файли агентів (agents/*.md)".into());
    } else if any_contains(&files, "commands/") || sub.starts_with("commands/") {
        kind = Kind::Command;
        confidence = 0.68;
        reasons.push("Є кастомні команди (commands/*.md)".into());
    } else if readme.contains("save token")
        || readme.contains("token saving")
        || readme.contains("економ")
        || (readme.contains("token") && (readme.contains("compress") || readme.contains("compact")))
        || any_contains(&files, "token-saver")
    {
        kind = Kind::TokenSaver;
        confidence = 0.72;
        reasons.push("Опис акцентує економію токенів або стиснення контексту".into());
    } else if any_contains(&files, "themes/") || has(&files, "theme.json") {
        kind = Kind::Theme;
        confidence = 0.7;
        reasons.push("Є тема оформлення".into());
    } else if any_contains(&files, "prompts/") && !readme.contains("skill") {
        kind = Kind::Prompt;
        confidence = 0.6;
        reasons.push("Набір промптів або шаблонів".into());
    }

    let tag_kind = match kind {
        Kind::Skill => "skill",
        Kind::Plugin => "plugin",
        Kind::Agent => "agent",
        Kind::Command => "command",
        Kind::TokenSaver => "token-saver",
        Kind::Mcp => "mcp",
        Kind::Prompt => "prompt",
        Kind::Theme => "theme",
        Kind::Other => "other",
    };
    if !tags.iter().any(|t| t == tag_kind) {
        tags.insert(0, tag_kind.to_string());
    }
    tags.dedup();
    tags.truncate(6);

    Classification {
        kind,
        tags,
        confidence,
        reasons,
        is_awesome,
    }
}

/// Швидка класифікація локальної папки без мережі.
pub fn classify_local(path: &Path) -> Kind {
    let mut names: Vec<String> = Vec::new();
    for entry in walkdir::WalkDir::new(path)
        .max_depth(3)
        .into_iter()
        .flatten()
    {
        if entry.file_type().is_file() {
            let rel = entry
                .path()
                .strip_prefix(path)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .replace('\\', "/")
                .to_lowercase();
            names.push(rel);
        }
    }
    let readme = crate::util::find_first_file(path, &["README.md", "readme.md", "README.MD"])
        .map(|p| crate::util::read_trimmed(&p, 8000).to_lowercase())
        .unwrap_or_default();

    if names.iter().any(|f| f == "skill.md") {
        Kind::Skill
    } else if names.iter().any(|f| f.ends_with("mcp.json") || f.ends_with("mcp-config.json")) {
        Kind::Mcp
    } else if readme.contains("@opencode-ai/plugin")
        || names.iter().any(|f| f.starts_with("plugin/") || f.contains(".opencode/plugin"))
    {
        Kind::Plugin
    } else if names.iter().any(|f| f.starts_with("agents/") || f == "agent.md") {
        Kind::Agent
    } else if names.iter().any(|f| f.starts_with("commands/")) {
        Kind::Command
    } else if readme.contains("token") && (readme.contains("context") || readme.contains("compress")) {
        Kind::TokenSaver
    } else if names.iter().any(|f| f.starts_with("prompts/")) {
        Kind::Prompt
    } else if names.iter().any(|f| f.starts_with("themes/") || f.ends_with("theme.json")) {
        Kind::Theme
    } else {
        Kind::Other
    }
}

/// Витягує name/description з frontmatter SKILL.md.
pub fn parse_frontmatter(text: &str) -> (Option<String>, Option<String>) {
    let mut name = None;
    let mut description = None;
    if !text.starts_with("---") {
        return (None, None);
    }
    let body = &text[3..];
    if let Some(end) = body.find("\n---") {
        let front = &body[..end];
        for line in front.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("name:") {
                name = Some(rest.trim().trim_matches('"').trim_matches('\'').to_string());
            } else if let Some(rest) = line.strip_prefix("description:") {
                let value = rest.trim().trim_matches('"').trim_matches('\'').to_string();
                if !value.is_empty() {
                    description = Some(value);
                }
            }
        }
    }
    (name, description)
}

/// Перше речення опису — короткий підпис для картки й MCP.
pub fn first_sentence(text: &str) -> String {
    let clean = text.replace('\n', " ");
    for (idx, ch) in clean.char_indices() {
        if matches!(ch, '.' | '!' | '?') {
            let candidate = clean[..=idx].trim();
            if candidate.chars().count() > 12 {
                return candidate.to_string();
            }
        }
    }
    let trimmed = clean.trim();
    if trimmed.chars().count() > 160 {
        let cut: String = trimmed.chars().take(157).collect();
        format!("{cut}…")
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{FileEntry, RepoMeta};

    fn meta(files: &[&str], readme: &str) -> RepoMeta {
        RepoMeta {
            url: "https://github.com/acme/demo".into(),
            host: "github.com".into(),
            owner: "acme".into(),
            repo: "demo".into(),
            branch: "main".into(),
            sub_path: None,
            sub_is_file: false,
            is_gist: false,
            name: "demo".into(),
            description: String::new(),
            readme: readme.into(),
            files: files
                .iter()
                .map(|p| FileEntry {
                    path: p.to_string(),
                    size: 10,
                    text: None,
                })
                .collect(),
            license: Some("MIT".into()),
            stars: 10,
            pushed_at: None,
            default_branch: "main".into(),
            commit: None,
            size_bytes: 100,
            language: Some("TypeScript".into()),
            archived: false,
            is_fork: false,
            topics: vec![],
        }
    }

    #[test]
    fn detects_skill() {
        let c = classify(&meta(&["SKILL.md", "scripts/run.ts"], "A skill for tests"));
        assert_eq!(c.kind, Kind::Skill);
        assert!(c.tags.contains(&"skill".to_string()));
    }

    #[test]
    fn detects_mcp() {
        let c = classify(&meta(&["mcp.json", "README.md"], "Model Context Protocol server"));
        assert_eq!(c.kind, Kind::Mcp);
    }

    #[test]
    fn detects_plugin() {
        let c = classify(&meta(
            &["package.json", "index.ts"],
            "Uses @opencode-ai/plugin hooks",
        ));
        assert_eq!(c.kind, Kind::Plugin);
    }

    #[test]
    fn detects_awesome_list() {
        let links = (0..30)
            .map(|i| format!("https://github.com/x/y{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let c = classify(&meta(&["README.md"], &format!("Awesome opencode\n{links}")));
        assert!(c.is_awesome);
    }

    #[test]
    fn frontmatter_parsed() {
        let text = "---\nname: Git Release\ndescription: Release helper\n---\nbody";
        let (name, desc) = parse_frontmatter(text);
        assert_eq!(name.as_deref(), Some("Git Release"));
        assert_eq!(desc.as_deref(), Some("Release helper"));
    }

    #[test]
    fn first_sentence_works() {
        assert_eq!(
            first_sentence("Це скіл для релізів. Він робить нотатки."),
            "Це скіл для релізів."
        );
    }
}
