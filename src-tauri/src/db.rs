use anyhow::{Context, Result};
use rusqlite::{params, Connection, Row};
use std::collections::HashMap;
use std::path::Path;

use crate::domain::{Budget, Item, Kind, LinkInfo, Profile, Risk};
use crate::util::now_iso;

pub struct Db {
    pub conn: Connection,
}

#[derive(Debug, Clone)]
pub struct Rule {
    pub match_type: String,
    pub match_value: String,
    pub set_kind: Option<String>,
    pub add_tags: Vec<String>,
    pub remove_tags: Vec<String>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path).context("Не вдалося відкрити базу даних")?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "busy_timeout", 5000)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Db { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                source_url TEXT,
                source_ref TEXT,
                commit_sha TEXT,
                version TEXT,
                path TEXT NOT NULL,
                summary_uk TEXT DEFAULT '',
                summary_en TEXT DEFAULT '',
                tags TEXT DEFAULT '[]',
                license TEXT,
                stars INTEGER DEFAULT 0,
                pushed_at TEXT,
                size_bytes INTEGER DEFAULT 0,
                tokens_est INTEGER DEFAULT 0,
                content_hash TEXT DEFAULT '',
                favorite INTEGER DEFAULT 0,
                rating INTEGER DEFAULT 0,
                notes TEXT DEFAULT '',
                archived INTEGER DEFAULT 0,
                install_state TEXT DEFAULT 'downloaded',
                risk_level TEXT DEFAULT 'unknown',
                risk_findings TEXT DEFAULT '[]',
                added_at TEXT,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS scope_links (
                item_id TEXT NOT NULL,
                scope TEXT NOT NULL,
                project_path TEXT NOT NULL DEFAULT '',
                link_type TEXT NOT NULL DEFAULT 'junction',
                target TEXT NOT NULL DEFAULT '',
                created_at TEXT,
                PRIMARY KEY (item_id, scope, project_path)
            );
            CREATE TABLE IF NOT EXISTS usage_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id TEXT,
                action TEXT NOT NULL,
                tokens INTEGER DEFAULT 0,
                ts TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS analysis_cache (
                key TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                model TEXT,
                tokens_in INTEGER DEFAULT 0,
                tokens_out INTEGER DEFAULT 0,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                match_type TEXT NOT NULL,
                match_value TEXT NOT NULL,
                set_kind TEXT,
                add_tags TEXT DEFAULT '[]',
                remove_tags TEXT DEFAULT '[]',
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS profile_items (
                profile_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                PRIMARY KEY (profile_id, item_id)
            );
            CREATE TABLE IF NOT EXISTS kv (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS feed_cache (
                key TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                fetched_at TEXT
            );
            CREATE TABLE IF NOT EXISTS agents_meta (
                path TEXT PRIMARY KEY,
                display_name TEXT DEFAULT '',
                icon TEXT DEFAULT '',
                tags TEXT DEFAULT '[]',
                auto_approve INTEGER DEFAULT 0,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS agent_projects (
                agent_id TEXT NOT NULL,
                project_path TEXT NOT NULL,
                created_at TEXT,
                PRIMARY KEY (agent_id, project_path)
            );
            CREATE TABLE IF NOT EXISTS agent_skills (
                agent_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                created_at TEXT,
                PRIMARY KEY (agent_id, item_id)
            );
            CREATE TABLE IF NOT EXISTS agent_tasks (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                agent_name TEXT DEFAULT '',
                project_path TEXT DEFAULT '',
                prompt TEXT NOT NULL,
                status TEXT NOT NULL,
                output TEXT DEFAULT '',
                started_at TEXT,
                finished_at TEXT,
                duration_ms INTEGER DEFAULT 0,
                tokens_in INTEGER DEFAULT 0,
                tokens_out INTEGER DEFAULT 0,
                cost_usd REAL DEFAULT 0,
                exit_code INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);
            CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_events(ts);
            CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON agent_tasks(agent_id, started_at);
            "#,
        )?;
        Ok(())
    }

    // ---------- items ----------

    pub fn items(&self) -> Result<Vec<Item>> {
        let mut stmt = self.conn.prepare("SELECT * FROM items ORDER BY added_at DESC")?;
        let rows = stmt.query_map([], row_to_item)?;
        let mut items: Vec<Item> = rows.filter_map(|r| r.ok()).collect();
        let links = self.links().unwrap_or_default();
        let mut by_item: HashMap<String, Vec<String>> = HashMap::new();
        for link in links {
            let label = match link.scope.as_str() {
                "global" => "global".to_string(),
                _ => format!("project|{}", link.project_path.clone().unwrap_or_default()),
            };
            by_item.entry(link.item_id).or_default().push(label);
        }
        for item in &mut items {
            if let Some(scopes) = by_item.get(&item.id) {
                item.scopes = scopes.clone();
                item.enabled = true;
            }
            item.has_local_files = Path::new(&item.path).exists();
        }
        Ok(items)
    }

    pub fn get_item(&self, id: &str) -> Result<Option<Item>> {
        let mut stmt = self.conn.prepare("SELECT * FROM items WHERE id = ?1")?;
        let item = stmt.query_row([id], row_to_item).ok();
        Ok(item.map(|mut item| {
            item.has_local_files = Path::new(&item.path).exists();
            if let Ok(links) = self.item_links(id) {
                item.enabled = !links.is_empty();
                // Той самий формат підпису, що й у `items()`: global / project|<path>.
                item.scopes = links
                    .iter()
                    .map(|l| match l.scope.as_str() {
                        "global" => "global".to_string(),
                        _ => format!("project|{}", l.project_path.clone().unwrap_or_default()),
                    })
                    .collect::<Vec<_>>();
            }
            item
        }))
    }

    pub fn item_links(&self, id: &str) -> Result<Vec<LinkInfo>> {
        let mut stmt = self.conn.prepare(
            "SELECT item_id, scope, project_path, link_type, target FROM scope_links WHERE item_id = ?1",
        )?;
        let rows = stmt.query_map([id], |row| {
            Ok(LinkInfo {
                item_id: row.get(0)?,
                scope: row.get(1)?,
                project_path: row.get::<_, String>(2).ok().filter(|s| !s.is_empty()),
                link_type: row.get(3)?,
                target: row.get(4)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn upsert_item(&self, item: &Item) -> Result<()> {
        let tags = serde_json::to_string(&item.tags)?;
        let findings = serde_json::to_string(&item.risk.findings)?;
        self.conn.execute(
            r#"INSERT INTO items (id,name,kind,source_url,source_ref,commit_sha,version,path,summary_uk,summary_en,tags,
                license,stars,pushed_at,size_bytes,tokens_est,content_hash,favorite,rating,notes,archived,install_state,
                risk_level,risk_findings,added_at,updated_at)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, kind=excluded.kind, source_url=excluded.source_url, source_ref=excluded.source_ref,
                commit_sha=excluded.commit_sha, version=excluded.version, path=excluded.path,
                summary_uk=excluded.summary_uk, summary_en=excluded.summary_en, tags=excluded.tags,
                license=excluded.license, stars=excluded.stars, pushed_at=excluded.pushed_at,
                size_bytes=excluded.size_bytes, tokens_est=excluded.tokens_est, content_hash=excluded.content_hash,
                favorite=excluded.favorite, rating=excluded.rating, notes=excluded.notes, archived=excluded.archived,
                install_state=excluded.install_state, risk_level=excluded.risk_level, risk_findings=excluded.risk_findings,
                updated_at=excluded.updated_at"#,
            params![
                item.id,
                item.name,
                item.kind.as_str(),
                item.source_url,
                item.source_ref,
                item.commit,
                item.version,
                item.path,
                item.summary_uk,
                item.summary_en,
                tags,
                item.license,
                item.stars,
                item.pushed_at,
                item.size_bytes,
                item.tokens_est,
                item.content_hash,
                item.favorite as i64,
                item.rating,
                item.notes,
                item.archived as i64,
                if item.install_state.is_empty() { "downloaded" } else { item.install_state.as_str() },
                item.risk.level,
                findings,
                if item.added_at.is_empty() { now_iso() } else { item.added_at.clone() },
                now_iso(),
            ],
        )?;
        Ok(())
    }

    pub fn delete_item(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM scope_links WHERE item_id = ?1", [id])?;
        self.conn
            .execute("DELETE FROM profile_items WHERE item_id = ?1", [id])?;
        self.conn.execute("DELETE FROM items WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn add_link(
        &self,
        item_id: &str,
        scope: &str,
        project_path: &str,
        link_type: &str,
        target: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO scope_links (item_id, scope, project_path, link_type, target, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![item_id, scope, project_path, link_type, target, now_iso()],
        )?;
        Ok(())
    }

    pub fn remove_link(&self, item_id: &str, scope: &str, project_path: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM scope_links WHERE item_id = ?1 AND scope = ?2 AND project_path = ?3",
            params![item_id, scope, project_path],
        )?;
        Ok(())
    }

    pub fn links(&self) -> Result<Vec<LinkInfo>> {
        let mut stmt = self
            .conn
            .prepare("SELECT item_id, scope, project_path, link_type, target FROM scope_links")?;
        let rows = stmt.query_map([], |row| {
            Ok(LinkInfo {
                item_id: row.get(0)?,
                scope: row.get(1)?,
                project_path: row.get::<_, String>(2).ok().filter(|s| !s.is_empty()),
                link_type: row.get(3)?,
                target: row.get(4)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // ---------- usage ----------

    pub fn record_usage(&self, item_id: Option<&str>, action: &str, tokens: i64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO usage_events (item_id, action, tokens, ts) VALUES (?1,?2,?3,?4)",
            params![item_id, action, tokens, now_iso()],
        )?;
        Ok(())
    }

    pub fn usage_summary(&self) -> Result<(i64, i64, Vec<(String, i64)>)> {
        let mcp_calls: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM usage_events WHERE action LIKE 'mcp_%'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let saved: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(tokens),0) FROM usage_events",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let mut stmt = self.conn.prepare(
            "SELECT u.item_id, COUNT(*) c FROM usage_events u
             WHERE u.item_id IS NOT NULL AND u.action = 'mcp_get_skill'
             GROUP BY u.item_id ORDER BY c DESC LIMIT 8",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        Ok((mcp_calls, saved, rows.filter_map(|r| r.ok()).collect()))
    }

    // ---------- analysis cache ----------

    pub fn cache_get(&self, key: &str) -> Option<(String, i64, i64, String)> {
        self.conn
            .query_row(
                "SELECT payload, tokens_in, tokens_out, created_at FROM analysis_cache WHERE key = ?1",
                [key],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .ok()
    }

    pub fn cache_put(
        &self,
        key: &str,
        payload: &str,
        model: &str,
        tokens_in: i64,
        tokens_out: i64,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO analysis_cache (key,payload,model,tokens_in,tokens_out,created_at)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![key, payload, model, tokens_in, tokens_out, now_iso()],
        )?;
        Ok(())
    }

    pub fn token_totals(&self) -> (i64, i64) {
        self.conn
            .query_row(
                "SELECT COALESCE(SUM(tokens_in),0), COALESCE(SUM(tokens_out),0) FROM analysis_cache",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap_or((0, 0))
    }

    // ---------- rules ----------

    pub fn rule_for_host(&self, host_key: &str) -> Option<Rule> {
        self.conn
            .query_row(
                "SELECT match_type, match_value, set_kind, add_tags, remove_tags FROM rules
                 WHERE match_type = 'host' AND match_value = ?1 LIMIT 1",
                [host_key],
                |r| {
                    Ok(Rule {
                        match_type: r.get(0)?,
                        match_value: r.get(1)?,
                        set_kind: r.get(2).ok(),
                        add_tags: parse_json_vec(r.get::<_, String>(3).unwrap_or_default()),
                        remove_tags: parse_json_vec(r.get::<_, String>(4).unwrap_or_default()),
                    })
                },
            )
            .ok()
    }

    pub fn upsert_host_rule(
        &self,
        host_key: &str,
        set_kind: Option<&str>,
        add_tags: &[String],
        remove_tags: &[String],
    ) -> Result<()> {
        self.conn.execute(
            "DELETE FROM rules WHERE match_type='host' AND match_value=?1",
            [host_key],
        )?;
        self.conn.execute(
            "INSERT INTO rules (match_type, match_value, set_kind, add_tags, remove_tags, created_at)
             VALUES ('host', ?1, ?2, ?3, ?4, ?5)",
            params![
                host_key,
                set_kind,
                serde_json::to_string(add_tags)?,
                serde_json::to_string(remove_tags)?,
                now_iso()
            ],
        )?;
        Ok(())
    }

    // ---------- profiles ----------

    pub fn profiles(&self) -> Result<Vec<Profile>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, description, created_at FROM profiles ORDER BY name COLLATE NOCASE")?;
        let rows = stmt.query_map([], |r| {
            Ok(Profile {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                item_ids: vec![],
                created_at: r.get(3)?,
            })
        })?;
        let mut profiles: Vec<Profile> = rows.filter_map(|r| r.ok()).collect();
        for profile in &mut profiles {
            let mut stmt = self
                .conn
                .prepare("SELECT item_id FROM profile_items WHERE profile_id = ?1")?;
            let ids = stmt.query_map([profile.id.as_str()], |r| r.get::<_, String>(0))?;
            profile.item_ids = ids.filter_map(|r| r.ok()).collect();
        }
        Ok(profiles)
    }

    pub fn save_profile(&self, profile: &Profile) -> Result<()> {
        self.conn.execute(
            "INSERT INTO profiles (id, name, description, created_at) VALUES (?1,?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description",
            params![
                profile.id,
                profile.name,
                profile.description,
                if profile.created_at.is_empty() { now_iso() } else { profile.created_at.clone() }
            ],
        )?;
        self.conn.execute(
            "DELETE FROM profile_items WHERE profile_id = ?1",
            [profile.id.as_str()],
        )?;
        for item_id in &profile.item_ids {
            self.conn.execute(
                "INSERT OR IGNORE INTO profile_items (profile_id, item_id) VALUES (?1, ?2)",
                params![profile.id, item_id],
            )?;
        }
        Ok(())
    }

    pub fn delete_profile(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM profile_items WHERE profile_id = ?1", [id])?;
        self.conn.execute("DELETE FROM profiles WHERE id = ?1", [id])?;
        Ok(())
    }

    // ---------- kv & feed ----------

    pub fn kv_get(&self, key: &str) -> Option<String> {
        self.conn
            .query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
            .ok()
    }

    pub fn kv_set(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn feed_get(&self, key: &str) -> Option<(String, String)> {
        self.conn
            .query_row(
                "SELECT payload, fetched_at FROM feed_cache WHERE key = ?1",
                [key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok()
    }

    pub fn feed_put(&self, key: &str, payload: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO feed_cache (key, payload, fetched_at) VALUES (?1, ?2, ?3)",
            params![key, payload, now_iso()],
        )?;
        Ok(())
    }

    pub fn budget(&self, threshold: i64) -> Budget {
        let mut advertised = 0i64;
        let mut on_demand = 0i64;
        let mut enabled = 0i64;
        if let Ok(items) = self.items() {
            for item in items.iter().filter(|i| i.enabled) {
                enabled += 1;
                let desc = if item.summary_uk.is_empty() {
                    item.summary_en.clone()
                } else {
                    item.summary_uk.clone()
                };
                advertised += crate::util::estimate_tokens(&desc) + 14;
                on_demand += item.tokens_est.max(0);
            }
        }
        let level = if advertised > threshold {
            "over"
        } else if advertised as f64 > threshold as f64 * 0.75 {
            "warn"
        } else {
            "ok"
        };
        Budget {
            enabled_count: enabled,
            advertised_tokens: advertised,
            on_demand_tokens: on_demand,
            threshold,
            level: level.into(),
        }
    }
}

fn parse_json_vec(value: String) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(&value).unwrap_or_default()
}

fn row_to_item(row: &Row) -> rusqlite::Result<Item> {
    let kind_raw: String = row.get("kind")?;
    let tags_raw: String = row.get("tags").unwrap_or_default();
    let risk_raw: String = row.get("risk_findings").unwrap_or_default();
    let findings: Vec<crate::domain::Finding> = serde_json::from_str(&risk_raw).unwrap_or_default();
    let level: String = row.get("risk_level").unwrap_or_else(|_| "unknown".into());
    Ok(Item {
        id: row.get("id")?,
        name: row.get("name")?,
        kind: Kind::from_str(&kind_raw),
        source_url: row.get("source_url").ok(),
        source_ref: row.get("source_ref").ok(),
        commit: row.get("commit_sha").ok(),
        version: row.get("version").ok(),
        path: row.get("path")?,
        summary_uk: row.get("summary_uk").unwrap_or_default(),
        summary_en: row.get("summary_en").unwrap_or_default(),
        tags: serde_json::from_str(&tags_raw).unwrap_or_default(),
        license: row.get("license").ok(),
        stars: row.get("stars").unwrap_or(0),
        pushed_at: row.get("pushed_at").ok(),
        size_bytes: row.get("size_bytes").unwrap_or(0),
        tokens_est: row.get("tokens_est").unwrap_or(0),
        content_hash: row.get("content_hash").unwrap_or_default(),
        favorite: row.get::<_, i64>("favorite").unwrap_or(0) != 0,
        rating: row.get("rating").unwrap_or(0),
        notes: row.get("notes").unwrap_or_default(),
        archived: row.get::<_, i64>("archived").unwrap_or(0) != 0,
        install_state: row
            .get::<_, String>("install_state")
            .unwrap_or_else(|_| "downloaded".into()),
        risk: Risk {
            level,
            findings,
            scanned_at: String::new(),
        },
        added_at: row.get("added_at").unwrap_or_default(),
        updated_at: row.get("updated_at").unwrap_or_default(),
        enabled: false,
        scopes: vec![],
        has_local_files: false,
    })
}
