use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::classify::{self, Classification};
use crate::db::Db;
use crate::domain::{FileEntry, Kind, Preview, RepoMeta};
use crate::github::{GitHub, ParsedUrl};
use crate::security;
use crate::settings;
use crate::util::{estimate_tokens, sha256_hex, slugify};

const PROMPT_VERSION: &str = "v3";
const MAX_README: usize = 7000;
const MAX_FILE: usize = 120_000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AiDescription {
    #[serde(default)]
    uk: Vec<String>,
    #[serde(default)]
    en: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
}

pub async fn fetch_meta(gh: &GitHub, parsed: &ParsedUrl) -> Result<RepoMeta> {
    if parsed.is_gist {
        return fetch_gist(gh, parsed).await;
    }
    let repo_json = gh.repo(&parsed.owner, &parsed.repo).await?;
    let default_branch = repo_json
        .get("default_branch")
        .and_then(|v| v.as_str())
        .unwrap_or("main")
        .to_string();
    let branch = parsed.branch.clone().unwrap_or_else(|| default_branch.clone());
    let tree = gh
        .tree(&parsed.owner, &parsed.repo, &branch)
        .await
        .unwrap_or_default();

    let sub_path = parsed
        .sub_path
        .as_ref()
        .map(|p| p.trim_matches('/').to_string())
        .filter(|p| !p.is_empty());
    let mut sub_is_file = false;
    if let Some(sub) = &sub_path {
        if let Some(entry) = tree.iter().find(|f| &f.path == sub) {
            sub_is_file = true;
            let _ = entry;
        } else if !tree.iter().any(|f| f.path.starts_with(&format!("{sub}/"))) {
            return Err(anyhow!(
                "У репозиторії немає папки «{sub}» на гілці {branch}. Перевір посилання."
            ));
        }
    }

    let scoped: Vec<&crate::github::RepoTreeFile> = tree
        .iter()
        .filter(|f| match &sub_path {
            Some(sub) if sub_is_file => f.path == *sub,
            Some(sub) => f.path.starts_with(&format!("{sub}/")),
            None => true,
        })
        .collect();

    let size_bytes = scoped.iter().map(|f| f.size.max(0)).sum::<i64>();
    let relative = |path: &str| -> String {
        match &sub_path {
            Some(sub) if !sub_is_file => path
                .strip_prefix(&format!("{sub}/"))
                .unwrap_or(path)
                .to_string(),
            _ => path.to_string(),
        }
    };

    let mut files: Vec<FileEntry> = scoped
        .iter()
        .map(|f| FileEntry {
            path: relative(&f.path),
            size: f.size,
            text: None,
        })
        .collect();
    files.sort_by_key(|f| f.path.matches('/').count() * 10_000 + f.path.len());

    let readme = gh
        .readme(
            &parsed.owner,
            &parsed.repo,
            &branch,
            sub_path.as_deref().unwrap_or(""),
        )
        .await
        .unwrap_or_default();

    // Підвантажуємо лише найважливіші текстові файли — дешево й достатньо для аналізу.
    let interesting = [
        "skill.md",
        "readme.md",
        "package.json",
        "mcp.json",
        ".mcp.json",
        "opencode.json",
        "plugin.json",
        "manifest.json",
        "pyproject.toml",
        "cargo.toml",
        "agent.md",
        "index.ts",
        "index.js",
        "main.py",
    ];
    let mut fetched = 0;
    for entry in &mut files {
        if fetched >= 14 {
            break;
        }
        let lower = entry.path.to_lowercase();
        let base = lower.rsplit('/').next().unwrap_or(&lower);
        let is_interesting = interesting.contains(&base) || (lower.ends_with(".md") && lower.matches('/').count() <= 1);
        if !is_interesting || entry.size > MAX_FILE as i64 {
            continue;
        }
        let full_path = match (&sub_path, sub_is_file) {
            (Some(sub), false) => format!("{sub}/{}", entry.path),
            (Some(sub), true) => sub.clone(),
            _ => entry.path.clone(),
        };
        if let Some(text) = gh
            .fetch_raw(&parsed.owner, &parsed.repo, &branch, &full_path)
            .await
        {
            entry.text = Some(text);
            fetched += 1;
        }
    }

    let license = repo_json
        .get("license")
        .and_then(|l| l.get("spdx_id").or_else(|| l.get("name")))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let topics = repo_json
        .get("topics")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let name = sub_path
        .as_ref()
        .and_then(|p| p.rsplit('/').next().map(|s| s.to_string()))
        .unwrap_or_else(|| parsed.repo.clone());

    Ok(RepoMeta {
        url: parsed.normalized.clone(),
        host: "github.com".into(),
        owner: parsed.owner.clone(),
        repo: parsed.repo.clone(),
        branch,
        sub_path,
        sub_is_file,
        is_gist: false,
        name,
        description: repo_json
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        readme,
        files,
        license,
        stars: repo_json.get("stargazers_count").and_then(|v| v.as_i64()).unwrap_or(0),
        pushed_at: repo_json
            .get("pushed_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        default_branch,
        commit: repo_json
            .get("default_branch")
            .and_then(|v| v.as_str())
            .and_then(|_| None),
        size_bytes,
        language: repo_json
            .get("language")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        archived: repo_json.get("archived").and_then(|v| v.as_bool()).unwrap_or(false),
        is_fork: repo_json.get("fork").and_then(|v| v.as_bool()).unwrap_or(false),
        topics,
    })
}

async fn fetch_gist(gh: &GitHub, parsed: &ParsedUrl) -> Result<RepoMeta> {
    let id = parsed
        .gist_id
        .clone()
        .ok_or_else(|| anyhow!("Некоректне посилання на gist"))?;
    let json = gh.gist(&id).await?;
    let mut files: Vec<FileEntry> = Vec::new();
    let mut readme = String::new();
    if let Some(map) = json.get("files").and_then(|v| v.as_object()) {
        for (name, file) in map {
            let content = file
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if name.to_lowercase().ends_with(".md") && readme.is_empty() {
                readme = content.clone();
            }
            files.push(FileEntry {
                path: name.clone(),
                size: content.len() as i64,
                text: Some(content),
            });
        }
    }
    let description = json
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if readme.is_empty() {
        readme = description.clone();
    }
    let owner = json
        .get("owner")
        .and_then(|o| o.get("login"))
        .and_then(|v| v.as_str())
        .unwrap_or("gist")
        .to_string();
    Ok(RepoMeta {
        url: parsed.normalized.clone(),
        host: "gist.github.com".into(),
        owner,
        repo: id.clone(),
        branch: "main".into(),
        sub_path: None,
        sub_is_file: false,
        is_gist: true,
        name: id,
        description,
        readme,
        files: files.clone(),
        license: None,
        stars: 0,
        pushed_at: json
            .get("updated_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        default_branch: "main".into(),
        commit: json
            .get("history")
            .and_then(|h| h.as_array())
            .and_then(|a| a.first())
            .and_then(|c| c.get("version"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        size_bytes: files.iter().map(|f| f.size).sum(),
        language: None,
        archived: false,
        is_fork: false,
        topics: vec![],
    })
}

fn kind_label(kind: Kind, lang: &str) -> &'static str {
    let uk = lang != "en";
    match (kind, uk) {
        (Kind::Skill, true) => "скіл",
        (Kind::Skill, false) => "skill",
        (Kind::Plugin, true) => "плагін",
        (Kind::Plugin, false) => "plugin",
        (Kind::Agent, true) => "агент",
        (Kind::Agent, false) => "agent",
        (Kind::Command, true) => "команда",
        (Kind::Command, false) => "command",
        (Kind::TokenSaver, true) => "інструмент економії токенів",
        (Kind::TokenSaver, false) => "token saver",
        (Kind::Mcp, true) => "MCP-сервер",
        (Kind::Mcp, false) => "MCP server",
        (Kind::Prompt, true) => "набір промптів",
        (Kind::Prompt, false) => "prompt pack",
        (Kind::Theme, true) => "тема",
        (Kind::Theme, false) => "theme",
        (Kind::Other, true) => "матеріал",
        (Kind::Other, false) => "resource",
    }
}

fn why_by_tags(tags: &[String], lang: &str) -> String {
    let uk = lang != "en";
    let has = |t: &str| tags.iter().any(|x| x == t);
    if has("telegram") || has("aiogram") {
        return if uk {
            "Знадобиться, коли робиш Telegram-ботів на Python і хочеш менше ручної рутини.".into()
        } else {
            "Useful when you build Python Telegram bots and want less repetitive work.".into()
        };
    }
    if has("react") || has("typescript") || has("frontend") {
        return if uk {
            "Знадобиться у фронтенд-задачах, де важлива швидкість ітерацій.".into()
        } else {
            "Useful for frontend work where fast iteration matters.".into()
        };
    }
    if has("context") || has("tokens") || has("caching") {
        return if uk {
            "Знадобиться, щоб зменшити витрати токенів і тримати контекст коротшим.".into()
        } else {
            "Useful for cutting token spend and keeping context shorter.".into()
        };
    }
    if has("mcp") {
        return if uk {
            "Знадобиться, коли бракує інструментів у самому агенті.".into()
        } else {
            "Useful when the agent needs tools it does not ship with.".into()
        };
    }
    if uk {
        "Знадобиться, коли хочеш прискорити типові задачі й не писати інструкції щоразу.".into()
    } else {
        "Useful when you want to speed up recurring tasks instead of rewriting instructions.".into()
    }
}

pub fn describe_rules(meta: &RepoMeta, classification: &Classification) -> (String, String) {
    let uk_kind = kind_label(classification.kind, "uk");
    let en_kind = kind_label(classification.kind, "en");
    let repo_desc = meta.description.trim();
    let body_hint = match classification.kind {
        Kind::Skill => (
            "Містить SKILL.md з інструкціями, які агент підвантажує лише за потреби.",
            "It ships a SKILL.md that the agent loads only when needed.",
        ),
        Kind::Plugin => (
            "Додає хуки й інструменти до OpenCode через плагін.",
            "It adds hooks and tools to OpenCode as a plugin.",
        ),
        Kind::Mcp => (
            "Піднімає MCP-сервер з додатковими інструментами для агента.",
            "It runs an MCP server that gives the agent extra tools.",
        ),
        Kind::Agent => (
            "Описує агента або субагента з власними правилами та інструментами.",
            "It defines an agent or subagent with its own rules and tools.",
        ),
        Kind::Command => (
            "Додає кастомну команду, яку можна викликати з чату.",
            "It adds a custom command you can call from chat.",
        ),
        Kind::TokenSaver => (
            "Стискає контекст або кешує відповіді, щоб зменшити витрати токенів.",
            "It compresses context or caches responses to cut token spend.",
        ),
        Kind::Prompt => (
            "Містить готові промпти й шаблони для повторюваних задач.",
            "It bundles ready-made prompts and templates for recurring tasks.",
        ),
        Kind::Theme => (
            "Змінює вигляд інтерфейсу, не впливаючи на логіку.",
            "It changes the interface look without touching logic.",
        ),
        Kind::Other => (
            "Містить матеріали, які варто переглянути перед використанням.",
            "It contains material worth reviewing before use.",
        ),
    };
    let uk = format!(
        "Це {uk_kind} «{}»{}. {}. {}",
        meta.name,
        if repo_desc.is_empty() {
            String::new()
        } else {
            format!(" — {}", crate::classify::first_sentence(repo_desc).trim_end_matches('.'))
        },
        body_hint.0,
        why_by_tags(&classification.tags, "uk"),
    );
    let en = format!(
        "This is a {en_kind} called \"{}\"{} . {}. {}",
        meta.name,
        if repo_desc.is_empty() {
            String::new()
        } else {
            format!(" — {}", crate::classify::first_sentence(repo_desc).trim_end_matches('.'))
        },
        body_hint.1,
        why_by_tags(&classification.tags, "en"),
    );
    (uk, en)
}

pub fn warnings_for(meta: &RepoMeta, classification: &Classification, risk: &crate::domain::Risk) -> Vec<String> {
    let mut warnings = Vec::new();
    if meta.archived {
        warnings.push("Репозиторій архівований: автор більше його не підтримує.".into());
    }
    if let Some(pushed) = &meta.pushed_at {
        if let Ok(date) = DateTime::parse_from_rfc3339(pushed) {
            let days = (Utc::now() - date.with_timezone(&Utc)).num_days();
            if days > 540 {
                warnings.push(format!(
                    "Проєкт не оновлювався {} місяців — можливо, покинутий.",
                    days / 30
                ));
            }
        }
    }
    if meta.license.is_none() {
        warnings.push("Немає явної ліцензії — перевір умови використання перед публікацією.".into());
    }
    if classification.kind == Kind::Other {
        warnings.push("Не вдалося впевнено визначити тип — перевір вміст вручну.".into());
    }
    if risk.level == "high" {
        warnings.push("Знайдено небезпечні патерни в коді. Прочитай попередження нижче перед увімкненням.".into());
    } else if risk.level == "medium" {
        warnings.push("Код звертається до мережі або запускає процеси. Перевір, чи це очікувано.".into());
    }
    warnings
}

pub async fn preview(
    gh: &GitHub,
    db: &std::sync::Mutex<Db>,
    input: &str,
    lang: &str,
    model: &str,
) -> Result<Preview> {
    let parsed = crate::github::parse_url(input)?;
    let meta = fetch_meta(gh, &parsed).await?;
    preview_with_meta(gh, db, &parsed, meta, lang, model).await
}

pub async fn preview_with_meta(
    gh: &GitHub,
    db: &std::sync::Mutex<Db>,
    parsed: &crate::github::ParsedUrl,
    mut meta: RepoMeta,
    lang: &str,
    model: &str,
) -> Result<Preview> {
    if let Some(commit) = gh.commit_sha(&parsed.owner, &parsed.repo, &meta.branch).await {
        meta.commit = Some(commit);
    }

    let mut classification = classify::classify(&meta);
    let host_key = if parsed.is_gist {
        format!("gist:{}", parsed.owner)
    } else {
        format!("github:{}", parsed.owner.to_lowercase())
    };
    if let Some(rule) = db.lock().unwrap().rule_for_host(&host_key) {
        if let Some(kind) = rule.set_kind {
            classification.kind = Kind::from_str(&kind);
            classification.reasons.push("Застосовано твоє правило для цього джерела".into());
        }
        for tag in rule.add_tags {
            if !classification.tags.contains(&tag) {
                classification.tags.push(tag);
            }
        }
        classification
            .tags
            .retain(|t| !rule.remove_tags.contains(t));
    }

    let risk = security::scan_files(&meta.files);
    let mut warnings = warnings_for(&meta, &classification, &risk);

    let cache_key = sha256_hex(
        format!(
            "{}|{}|{}|{}|{}|{}|{}|{}",
            PROMPT_VERSION,
            lang,
            model,
            meta.url,
            meta.sub_path.clone().unwrap_or_default(),
            meta.commit.clone().unwrap_or_default(),
            meta.pushed_at.clone().unwrap_or_default(),
            meta.readme.len()
        )
        .as_bytes(),
    );

    let mut ai_tokens = 0i64;
    let mut description_source = "rules".to_string();
    let mut cached = false;
    let (mut uk, mut en) = describe_rules(&meta, &classification);

    let cached_entry = db.lock().unwrap().cache_get(&cache_key);
    if let Some((payload, _, _, _)) = cached_entry {
        if let Ok(desc) = serde_json::from_str::<AiDescription>(&payload) {
            if !desc.uk.is_empty() {
                uk = desc.uk.join(" ");
                en = if desc.en.is_empty() {
                    en.clone()
                } else {
                    desc.en.join(" ")
                };
                for tag in desc.tags {
                    if !classification.tags.contains(&tag) {
                        classification.tags.push(tag);
                    }
                }
                description_source = "ai".into();
                cached = true;
            }
        }
    } else if let Some(key) = settings::get_secret("deepseek_api_key") {
        match ask_deepseek(gh.client(), &key, model, &meta, &classification, lang).await {
            Ok((desc, tokens_in, tokens_out)) => {
                ai_tokens = tokens_in + tokens_out;
                uk = desc.uk.join(" ");
                en = desc.en.join(" ");
                for tag in &desc.tags {
                    if !classification.tags.contains(tag) {
                        classification.tags.push(tag.clone());
                    }
                }
                let _ = db.lock().unwrap().cache_put(
                    &cache_key,
                    &serde_json::to_string(&desc)?,
                    model,
                    tokens_in,
                    tokens_out,
                );
                description_source = "ai".into();
            }
            Err(err) => {
                warnings.push(format!(
                    "Опис згенеровано без ШІ: {err}. Ключ DeepSeek можна додати в налаштуваннях."
                ));
            }
        }
    }

    classification.tags.truncate(7);
    let default_id = slugify(
        meta.sub_path
            .as_ref()
            .and_then(|p| p.rsplit('/').next())
            .unwrap_or(&meta.name),
    );

    Ok(Preview {
        url: meta.url.clone(),
        kind: classification.kind,
        name: if meta.name.is_empty() {
            meta.repo.clone()
        } else {
            meta.name.clone()
        },
        owner: meta.owner.clone(),
        repo: meta.repo.clone(),
        branch: meta.branch.clone(),
        sub_path: meta.sub_path.clone(),
        sub_is_file: meta.sub_is_file,
        commit: meta.commit.clone(),
        summary_uk: uk.trim().to_string(),
        summary_en: en.trim().to_string(),
        tags: classification.tags,
        license: meta.license.clone(),
        stars: meta.stars,
        pushed_at: meta.pushed_at.clone(),
        size_bytes: meta.size_bytes,
        default_folder: classification.kind.folder().to_string(),
        default_id,
        risk,
        warnings,
        description_source,
        tokens_used: ai_tokens,
        cached,
        file_count: meta.files.len(),
        is_gist: meta.is_gist,
        is_awesome: classification.is_awesome,
    })
}

async fn ask_deepseek(
    client: &reqwest::Client,
    key: &str,
    model: &str,
    meta: &RepoMeta,
    classification: &Classification,
    lang: &str,
) -> Result<(AiDescription, i64, i64)> {
    let readme: String = meta.readme.chars().take(MAX_README).collect();
    let files: Vec<&str> = meta.files.iter().take(80).map(|f| f.path.as_str()).collect();
    let system = "Ти — редактор каталогу інструментів для AI-агента OpenCode. Описуй коротко, живою мовою, без води й без маркетингу. Повертай лише JSON.";
    let user = format!(
        "Проєкт: {owner}/{repo}\nТип (за правилами): {kind}\nМова опису: {lang}\nОпис з GitHub: {desc}\nФайли:\n{files}\n\nREADME (обрізаний):\n{readme}\n\nПоверни JSON: {{\"uk\":[\"що це\",\"що робить\",\"чому знадобиться мені\"],\"en\":[\"what it is\",\"what it does\",\"why I need it\"],\"tags\":[\"3-5 коротких тегів\"]}}. Кожне речення до 120 символів, без крапок з комами, без повторів. Якщо мова uk — пиши природною українською.",
        owner = meta.owner,
        repo = meta.repo,
        kind = classification.kind.as_str(),
        lang = if lang == "en" { "en" } else { "uk" },
        desc = meta.description,
        files = files.join("\n"),
        readme = readme
    );

    let response = client
        .post("https://api.deepseek.com/chat/completions")
        .bearer_auth(key)
        .json(&serde_json::json!({
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user}
            ],
            "temperature": 0.3,
            "max_tokens": 400,
            "response_format": {"type": "json_object"}
        }))
        .send()
        .await
        .map_err(|e| anyhow!("DeepSeek недоступний: {e}"))?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let hint = if status == reqwest::StatusCode::UNAUTHORIZED {
            "Ключ DeepSeek недійсний або протермінований."
        } else if status == reqwest::StatusCode::PAYMENT_REQUIRED {
            "На балансі DeepSeek закінчилися кошти."
        } else {
            "Спробуй пізніше або перевір ключ."
        };
        return Err(anyhow!("DeepSeek повернув {} ({hint})", status.as_u16()));
    }
    let json: serde_json::Value = serde_json::from_str(&text)?;
    let content = json
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("{}");
    let mut desc: AiDescription = serde_json::from_str(content)
        .map_err(|e| anyhow!("DeepSeek повернув неочікуваний формат: {e}"))?;
    desc.uk.truncate(3);
    desc.en.truncate(3);
    desc.tags.truncate(5);
    if desc.uk.is_empty() {
        return Err(anyhow!("DeepSeek не дав опису"));
    }
    let tokens_in = json
        .get("usage")
        .and_then(|u| u.get("prompt_tokens"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let tokens_out = json
        .get("usage")
        .and_then(|u| u.get("completion_tokens"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    if tokens_in == 0 {
        // Приблизна оцінка, якщо API не прислав usage.
        let approx = estimate_tokens(&user) + estimate_tokens(system);
        return Ok((desc, approx, estimate_tokens(content)));
    }
    Ok((desc, tokens_in, tokens_out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{FileEntry, RepoMeta};

    fn sample_meta() -> RepoMeta {
        RepoMeta {
            url: "https://github.com/acme/tg".into(),
            host: "github.com".into(),
            owner: "acme".into(),
            repo: "tg".into(),
            branch: "main".into(),
            sub_path: None,
            sub_is_file: false,
            is_gist: false,
            name: "tg".into(),
            description: "Telegram helpers".into(),
            readme: "Telegram bot helpers".into(),
            files: vec![FileEntry {
                path: "SKILL.md".into(),
                size: 100,
                text: None,
            }],
            license: Some("MIT".into()),
            stars: 5,
            pushed_at: None,
            default_branch: "main".into(),
            commit: None,
            size_bytes: 100,
            language: Some("Python".into()),
            archived: false,
            is_fork: false,
            topics: vec!["telegram".into(), "aiogram".into()],
        }
    }

    #[test]
    fn rules_description_has_three_sentences() {
        let meta = sample_meta();
        let classification = classify::classify(&meta);
        let (uk, en) = describe_rules(&meta, &classification);
        assert!(uk.contains("скіл"));
        assert!(uk.contains("Telegram"));
        assert!(!en.is_empty());
        let sentences = uk.matches('.').count() + uk.matches('!').count();
        assert!(sentences >= 3, "очікували 3 речення, отримали: {uk}");
    }

    #[test]
    fn warnings_flag_missing_license() {
        let mut meta = sample_meta();
        meta.license = None;
        let classification = classify::classify(&meta);
        let risk = crate::domain::Risk {
            level: "clean".into(),
            findings: vec![],
            scanned_at: String::new(),
        };
        let warnings = warnings_for(&meta, &classification, &risk);
        assert!(warnings.iter().any(|w| w.contains("ліцензі")));
    }
}
