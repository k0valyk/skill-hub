use anyhow::Result;
use chrono::{DateTime, Utc};

use crate::db::Db;
use crate::domain::{FeedCard, Kind};
use crate::github::GitHub;

const CACHE_KEY: &str = "feed:v1";
const TTL_HOURS: i64 = 6;

fn guess_kind(name: &str, description: &str, topics: &[String]) -> Kind {
    let haystack = format!(
        "{} {} {}",
        name.to_lowercase(),
        description.to_lowercase(),
        topics.join(" ").to_lowercase()
    );
    if haystack.contains("mcp") {
        Kind::Mcp
    } else if haystack.contains("plugin") {
        Kind::Plugin
    } else if haystack.contains("subagent") || haystack.contains("agent") {
        Kind::Agent
    } else if haystack.contains("token") || haystack.contains("context window") {
        Kind::TokenSaver
    } else if haystack.contains("skill") {
        Kind::Skill
    } else if haystack.contains("theme") {
        Kind::Theme
    } else {
        Kind::Other
    }
}

pub async fn discover(
    gh: &GitHub,
    db: &std::sync::Mutex<Db>,
    force: bool,
) -> Result<Vec<FeedCard>> {
    if !force {
        let cached_entry = db.lock().unwrap().feed_get(CACHE_KEY);
        if let Some((payload, fetched_at)) = cached_entry {
            if let Ok(date) = DateTime::parse_from_rfc3339(&fetched_at) {
                let age = Utc::now() - date.with_timezone(&Utc);
                if age.num_hours() < TTL_HOURS {
                    if let Ok(cards) = serde_json::from_str::<Vec<FeedCard>>(&payload) {
                        return Ok(cards);
                    }
                }
            }
        }
    }

    let queries = [
        "opencode skill in:name,description,readme",
        "opencode plugin in:name,description,readme",
        "claude code skill in:name,description",
    ];
    let mut repos: Vec<serde_json::Value> = Vec::new();
    let mut last_error: Option<String> = None;
    for query in queries {
        match gh.search(query).await {
            Ok(mut found) => repos.append(&mut found),
            Err(err) => last_error = Some(err.to_string()),
        }
    }
    let installed: Vec<String> = db
        .lock()
        .unwrap()
        .items()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| i.source_url.map(|u| u.to_lowercase()))
        .collect();

    let mut seen = std::collections::HashSet::new();
    let mut cards: Vec<FeedCard> = Vec::new();
    for repo in repos {
        let url = repo
            .get("html_url")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_lowercase();
        if url.is_empty() || !seen.insert(url.clone()) || installed.contains(&url) {
            continue;
        }
        let name = repo
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("repo")
            .to_string();
        let owner = repo
            .get("owner")
            .and_then(|o| o.get("login"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let description = repo
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let topics: Vec<String> = repo
            .get("topics")
            .and_then(|t| t.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        let kind = guess_kind(&name, &description, &topics);
        let mut tags: Vec<String> = topics.iter().take(3).cloned().collect();
        if tags.is_empty() {
            tags.push(kind.as_str().to_string());
        }
        cards.push(FeedCard {
            url: url.clone(),
            name,
            owner,
            summary: description,
            stars: repo.get("stargazers_count").and_then(|v| v.as_i64()).unwrap_or(0),
            pushed_at: repo
                .get("pushed_at")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            kind,
            tags,
            license: repo
                .get("license")
                .and_then(|l| l.get("spdx_id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        });
        if cards.len() >= 24 {
            break;
        }
    }

    if cards.is_empty() {
        let cached_entry = db.lock().unwrap().feed_get(CACHE_KEY);
        if let Some((payload, _)) = cached_entry {
            if let Ok(cached) = serde_json::from_str::<Vec<FeedCard>>(&payload) {
                return Ok(cached);
            }
        }
        if let Some(err) = last_error {
            return Err(anyhow::anyhow!(err));
        }
    }

    cards.sort_by(|a, b| b.stars.cmp(&a.stars));
    if !cards.is_empty() {
        let _ = db
            .lock()
            .unwrap()
            .feed_put(CACHE_KEY, &serde_json::to_string(&cards)?);
    }
    Ok(cards)
}
