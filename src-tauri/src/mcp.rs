use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::classify::first_sentence;
use crate::db::Db;
use crate::domain::Item;
use crate::scanner;
use crate::util::estimate_tokens;

const PROTOCOL_VERSION: &str = "2025-06-18";

fn tool_defs() -> Value {
    json!([
        {
            "name": "search_skills",
            "description": "Пошук у локальній бібліотеці Skill Hub. Повертає лише короткі описи (id, назва, тип, одне речення, орієнтовні токени).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Що шукаємо: тема, мова, задача"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8}
                },
                "required": ["query"]
            }
        },
        {
            "name": "get_skill",
            "description": "Завантажити повний текст скіла за id. Викликай лише тоді, коли скіл справді потрібен для задачі.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"]
            }
        },
        {
            "name": "recommend",
            "description": "Підказати 3-5 скілів під описане завдання, без завантаження їхнього тексту.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task": {"type": "string", "description": "Опис задачі природною мовою"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 10, "default": 5}
                },
                "required": ["task"]
            }
        },
        {
            "name": "enable_skill",
            "description": "Підключити скіл до OpenCode: глобально або до конкретного проєкту (.opencode/skills).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "scope": {"type": "string", "enum": ["global", "project"], "default": "global"},
                    "project": {"type": "string", "description": "Абсолютний шлях до папки проєкту для scope=project"}
                },
                "required": ["id"]
            }
        },
        {
            "name": "disable_skill",
            "description": "Відключити скіл від OpenCode. Сам скіл залишається в бібліотеці.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "scope": {"type": "string", "enum": ["global", "project"], "default": "global"},
                    "project": {"type": "string"}
                },
                "required": ["id"]
            }
        },
        {
            "name": "list_enabled",
            "description": "Показати, що зараз підключено до OpenCode, і скільки токенів це додає в контекст.",
            "inputSchema": {"type": "object", "properties": {}}
        }
    ])
}

fn item_line(item: &Item) -> String {
    let summary = if item.summary_uk.is_empty() {
        item.summary_en.clone()
    } else {
        item.summary_uk.clone()
    };
    format!(
        "{} — {} [{}]: {} (~{} ток.)",
        item.id,
        item.name,
        item.kind.as_str(),
        first_sentence(&summary),
        item.tokens_est.max(0)
    )
}

fn tokens_of(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '-' && c != '+')
        .filter(|t| t.chars().count() >= 2)
        .map(|t| t.to_string())
        .collect()
}

pub fn rank(items: &[Item], query: &str, limit: usize) -> Vec<(i64, Item)> {
    let tokens = tokens_of(query);
    let mut scored: Vec<(i64, Item)> = Vec::new();
    for item in items {
        let name = item.name.to_lowercase();
        let tags = item.tags.join(" ").to_lowercase();
        let summary = format!("{} {}", item.summary_uk, item.summary_en).to_lowercase();
        let body = scanner::read_item_text(item)
            .map(|t| t.chars().take(20_000).collect::<String>().to_lowercase())
            .unwrap_or_default();
        let mut score = 0i64;
        for token in &tokens {
            if name.contains(token) {
                score += 8;
            }
            if tags.contains(token) {
                score += 5;
            }
            if summary.contains(token) {
                score += 3;
            }
            if body.contains(token) {
                score += 1;
            }
        }
        if tokens.is_empty() {
            score = 1;
        }
        if score > 0 {
            scored.push((score, item.clone()));
        }
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.truncate(limit);
    scored
}

fn budget_line(db: &Db, threshold: i64) -> String {
    let budget = db.budget(threshold);
    let warn = match budget.level.as_str() {
        "over" => " УВАГА: бюджет перевищено, вимкни зайве.",
        "warn" => " Бюджет майже заповнений.",
        _ => "",
    };
    format!(
        "Увімкнено {} скілів: ~{} токенів у списку моделі (ліміт {}).{}",
        budget.enabled_count, budget.advertised_tokens, threshold, warn
    )
}

fn text_result(text: impl Into<String>) -> Value {
    json!({"content": [{"type": "text", "text": text.into()}]})
}

fn error_result(text: impl Into<String>) -> Value {
    json!({"content": [{"type": "text", "text": text.into()}], "isError": true})
}

pub fn handle(method: &str, params: &Value, db: &Db, root: &Path, threshold: i64) -> Option<Value> {
    match method {
        "initialize" => Some(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": false}},
            "serverInfo": {"name": "skillhub", "version": "0.1.0"},
            "instructions": "Skill Hub — локальна бібліотека скілів. Працюй ліниво: спочатку search_skills або recommend (короткі описи), і лише коли скіл справді потрібен — get_skill(id). Не завантажуй кілька скілів про запас: це витрачає токени. Підключай скіл через enable_skill лише коли користувач просить або задача повторювана."
        })),
        "ping" => Some(json!({})),
        "tools/list" => Some(json!({"tools": tool_defs()})),
        "resources/list" => Some(json!({"resources": []})),
        "prompts/list" => Some(json!({"prompts": []})),
        "tools/call" => Some(call_tool(params, db, root, threshold)),
        _ => None,
    }
}

fn call_tool(params: &Value, db: &Db, root: &Path, threshold: i64) -> Value {
    let name = params.get("name").and_then(|v| v.as_str()).unwrap_or_default();
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    match name {
        "search_skills" => {
            let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(8)
                .clamp(1, 20) as usize;
            let items = db.items().unwrap_or_default();
            let results = rank(&items, query, limit);
            if results.is_empty() {
                return text_result("Нічого не знайдено. Спробуй інші слова або додай скіл у Skill Hub.");
            }
            let mut lines: Vec<String> = results.iter().map(|(_, item)| item_line(item)).collect();
            lines.push(String::from("Повний текст: get_skill(id)."));
            text_result(lines.join("\n"))
        }
        "get_skill" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            match db.get_item(id) {
                Ok(Some(item)) => match scanner::read_item_text(&item) {
                    Ok(text) => {
                        let body = text.chars().take(60_000).collect::<String>();
                        let saved = (estimate_tokens(&body) - 40).max(0);
                        let _ = db.record_usage(Some(&item.id), "mcp_get_skill", saved);
                        text_result(format!(
                            "# {name} ({kind})\nID: {id}\nДжерело: {source}\nТеги: {tags}\n\n{body}",
                            name = item.name,
                            kind = item.kind.as_str(),
                            id = item.id,
                            source = item.source_url.clone().unwrap_or_else(|| "локальна папка".into()),
                            tags = item.tags.join(", "),
                            body = body
                        ))
                    }
                    Err(err) => error_result(format!("Не вдалося прочитати скіл: {err}")),
                },
                Ok(None) => error_result(format!("Скіл {id} не знайдено в бібліотеці.")),
                Err(err) => error_result(format!("База даних недоступна: {err}")),
            }
        }
        "recommend" => {
            let task = args.get("task").and_then(|v| v.as_str()).unwrap_or("");
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(5)
                .clamp(1, 10) as usize;
            let items = db.items().unwrap_or_default();
            let results = rank(&items, task, limit);
            if results.is_empty() {
                return text_result("Під цю задачу нічого не підібралося. Переглянь бібліотеку або додай новий скіл.");
            }
            let lines: Vec<String> = results
                .iter()
                .map(|(score, item)| format!("{}{}", item_line(item), if *score >= 8 { " ★" } else { "" }))
                .collect();
            text_result(format!("Рекомендації:\n{}", lines.join("\n")))
        }
        "enable_skill" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let scope = args.get("scope").and_then(|v| v.as_str()).unwrap_or("global");
            let project = args.get("project").and_then(|v| v.as_str()).map(PathBuf::from);
            if scope == "project" && project.is_none() {
                return error_result("Для scope=project передай абсолютний шлях у полі project.");
            }
            match db.get_item(id) {
                Ok(Some(item)) => {
                    if !item.has_local_files {
                        return error_result("Спочатку завантаж скіл у бібліотеку (зараз збережено лише посилання).");
                    }
                    match crate::linking::enable(db, &item, scope, project.as_deref()) {
                        Ok(link) => text_result(format!(
                            "Скіл {} підключено ({}). Посилання: {}\n{}",
                            item.name,
                            scope,
                            link.target,
                            budget_line(db, threshold)
                        )),
                        Err(err) => error_result(format!("Не вдалося підключити: {err}")),
                    }
                }
                Ok(None) => error_result(format!("Скіл {id} не знайдено.")),
                Err(err) => error_result(format!("База даних недоступна: {err}")),
            }
        }
        "disable_skill" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let scope = args.get("scope").and_then(|v| v.as_str()).unwrap_or("global");
            let project = args.get("project").and_then(|v| v.as_str()).map(PathBuf::from);
            match crate::linking::disable(db, id, scope, project.as_deref()) {
                Ok(_) => text_result(format!("Відключено {id} ({}).\n{}", scope, budget_line(db, threshold))),
                Err(err) => error_result(format!("Не вдалося відключити: {err}")),
            }
        }
        "list_enabled" => {
            let items = db.items().unwrap_or_default();
            let enabled: Vec<&Item> = items.iter().filter(|i| i.enabled).collect();
            let mut lines: Vec<String> = enabled
                .iter()
                .map(|item| {
                    format!(
                        "{} — {} [{}] ({}).
",
                        item.id,
                        item.name,
                        item.kind.as_str(),
                        if item.scopes.is_empty() {
                            "global".to_string()
                        } else {
                            item.scopes.join(", ")
                        }
                    )
                })
                .collect();
            if lines.is_empty() {
                lines.push("Нічого не підключено.".into());
            }
            lines.push(budget_line(db, threshold));
            lines.push(format!("Корінь бібліотеки: {}", root.display()));
            text_result(lines.join(""))
        }
        _ => error_result(format!("Невідомий інструмент: {name}")),
    }
}

/// Мінімальний MCP-сервер над stdio (JSON-RPC 2.0, по одному повідомленню на рядок).
pub async fn serve(root: PathBuf) -> Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let db_path = root.join(".skillhub").join("skillhub.db");
    let db = Db::open(&db_path).map_err(|e| {
        anyhow!(
            "Не вдалося відкрити базу Skill Hub ({}). Відкрий застосунок хоч раз і повтори. Деталі: {e}",
            db_path.display()
        )
    })?;
    let settings = crate::settings::load();
    let threshold = settings.context_budget;
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();

    while let Ok(Some(line)) = reader.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let id = request.get("id").cloned();
        let method = request
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
        let response = handle(&method, &params, &db, &root, threshold);
        if let Some(id) = id {
            let payload = match response {
                Some(result) if result.get("isError").is_none() && method == "tools/call" => {
                    json!({"jsonrpc": "2.0", "id": id, "result": result})
                }
                Some(result) if method == "tools/call" => {
                    json!({"jsonrpc": "2.0", "id": id, "result": result})
                }
                Some(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
                None => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {"code": -32601, "message": format!("Метод {method} не підтримується")}
                }),
            };
            let text = serde_json::to_string(&payload)?;
            stdout.write_all(text.as_bytes()).await?;
            stdout.write_all(b"\n").await?;
            stdout.flush().await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Item, Kind, Risk};

    fn item(id: &str, name: &str, summary: &str, tags: &[&str]) -> Item {
        Item {
            id: id.into(),
            name: name.into(),
            kind: Kind::Skill,
            source_url: None,
            source_ref: None,
            commit: None,
            version: None,
            path: String::new(),
            summary_uk: summary.into(),
            summary_en: String::new(),
            tags: tags.iter().map(|s| s.to_string()).collect(),
            license: None,
            stars: 0,
            pushed_at: None,
            size_bytes: 0,
            tokens_est: 500,
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
            has_local_files: false,
        }
    }

    #[test]
    fn rank_matches_name_and_tags() {
        let items = vec![
            item("tg", "Telegram helper", "Робить ботів", &["telegram", "python"]),
            item("web", "Frontend kit", "React компоненти", &["react"]),
        ];
        let result = rank(&items, "telegram bot", 5);
        assert_eq!(result[0].1.id, "tg");
        let none = rank(&items, "kubernetes", 5);
        assert!(none.is_empty());
    }

    #[test]
    fn tools_listed() {
        let root = tempfile::tempdir().unwrap();
        let db = Db::open(&root.path().join("db.sqlite")).unwrap();
        let response = handle("tools/list", &json!({}), &db, root.path(), 6000).unwrap();
        let tools = response.get("tools").unwrap().as_array().unwrap();
        assert!(tools.iter().any(|t| t.get("name").unwrap() == "search_skills"));
    }

    #[test]
    fn unknown_tool_returns_error() {
        let root = tempfile::tempdir().unwrap();
        let db = Db::open(&root.path().join("db.sqlite")).unwrap();
        let response = handle(
            "tools/call",
            &json!({"name": "nope", "arguments": {}}),
            &db,
            root.path(),
            1000,
        )
        .unwrap();
        assert_eq!(response.get("isError"), Some(&json!(true)));
    }
}
