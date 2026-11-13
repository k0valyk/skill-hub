use anyhow::{anyhow, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const UA: &str = "SkillHub/0.1 (+https://github.com)";

#[derive(Debug, Clone, Default)]
pub struct ParsedUrl {
    pub owner: String,
    pub repo: String,
    pub branch: Option<String>,
    pub sub_path: Option<String>,
    pub is_gist: bool,
    pub gist_id: Option<String>,
    pub normalized: String,
}

#[derive(Debug)]
pub struct RepoTreeFile {
    pub path: String,
    pub size: i64,
}

pub struct GitHub {
    client: reqwest::Client,
    pub token: Option<String>,
}

impl GitHub {
    pub fn new(token: Option<String>) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(UA)
            .timeout(Duration::from_secs(25))
            .build()
            .expect("http client");
        GitHub { client, token }
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    fn request(&self, method: reqwest::Method, url: &str) -> reqwest::RequestBuilder {
        let mut req = self
            .client
            .request(method, url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(token) = &self.token {
            req = req.bearer_auth(token);
        }
        req
    }

    pub async fn get_json(&self, url: &str) -> Result<serde_json::Value> {
        let response = self
            .request(reqwest::Method::GET, url)
            .send()
            .await
            .map_err(|e| anyhow!("Немає зв'язку з GitHub API: {e}"))?;
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(anyhow!(
                "GitHub обмежив запити (ліміт API). Увійди в GitHub у налаштуваннях — з токеном ліміт у 60 разів більший."
            ));
        }
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(anyhow!("GitHub не знайшов цей об'єкт. Перевір посилання або доступ до репозиторію."));
        }
        if !status.is_success() {
            return Err(anyhow!("GitHub API повернув помилку {}: {}", status.as_u16(), trim_msg(&text)));
        }
        serde_json::from_str(&text).map_err(|e| anyhow!("Некоректна відповідь GitHub API: {e}"))
    }

    pub async fn repo(&self, owner: &str, repo: &str) -> Result<serde_json::Value> {
        self.get_json(&format!("https://api.github.com/repos/{owner}/{repo}"))
            .await
    }

    pub async fn tree(&self, owner: &str, repo: &str, git_ref: &str) -> Result<Vec<RepoTreeFile>> {
        let url = format!(
            "https://api.github.com/repos/{owner}/{repo}/git/trees/{}?recursive=1",
            encode_ref(git_ref)
        );
        let json = self.get_json(&url).await?;
        let mut out = Vec::new();
        if let Some(tree) = json.get("tree").and_then(|t| t.as_array()) {
            for entry in tree {
                if entry.get("type").and_then(|t| t.as_str()) == Some("blob") {
                    out.push(RepoTreeFile {
                        path: entry
                            .get("path")
                            .and_then(|p| p.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        size: entry.get("size").and_then(|s| s.as_i64()).unwrap_or(0),
                    });
                }
            }
        }
        Ok(out)
    }

    pub async fn readme(&self, owner: &str, repo: &str, branch: &str, path: &str) -> Option<String> {
        let mut candidates = Vec::new();
        if !path.is_empty() {
            candidates.push(format!("{}/README.md", path.trim_end_matches('/')));
            candidates.push(format!("{}/readme.md", path.trim_end_matches('/')));
        }
        candidates.extend(
            ["README.md", "readme.md", "Readme.md", "README.MD", "README.rst"]
                .iter()
                .map(|s| s.to_string()),
        );
        for candidate in candidates {
            if let Some(text) = self.fetch_raw(owner, repo, branch, &candidate).await {
                return Some(text);
            }
        }
        None
    }

    pub async fn fetch_raw(&self, owner: &str, repo: &str, git_ref: &str, path: &str) -> Option<String> {
        let mut url = url::Url::parse("https://raw.githubusercontent.com").ok()?;
        {
            let mut seg = url.path_segments_mut().ok()?;
            seg.push(owner);
            seg.push(repo);
            for part in git_ref.split('/') {
                seg.push(part);
            }
            for part in path.split(['/', '\\']) {
                seg.push(part);
            }
        }
        let response = self
            .client
            .get(url)
            .header("User-Agent", UA)
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        let text = response.text().await.ok()?;
        Some(text)
    }

    pub async fn gist(&self, id: &str) -> Result<serde_json::Value> {
        self.get_json(&format!("https://api.github.com/gists/{id}"))
            .await
    }

    pub async fn user(&self) -> Result<serde_json::Value> {
        self.get_json("https://api.github.com/user").await
    }

    pub async fn create_repo(
        &self,
        name: &str,
        private: bool,
        description: &str,
    ) -> Result<serde_json::Value> {
        let response = self
            .request(reqwest::Method::POST, "https://api.github.com/user/repos")
            .json(&serde_json::json!({
                "name": name,
                "private": private,
                "description": description,
                "auto_init": false,
            }))
            .send()
            .await
            .map_err(|e| anyhow!("Не вдалося створити репозиторій: {e}"))?;
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
            if text.contains("already exists") {
                return Err(anyhow!(
                    "Репозиторій з такою назвою вже існує на GitHub. Обери іншу назву."
                ));
            }
            return Err(anyhow!("GitHub відхилив створення репозиторію: {}", trim_msg(&text)));
        }
        if !status.is_success() {
            return Err(anyhow!(
                "Не вдалося створити репозиторій ({}): {}",
                status.as_u16(),
                trim_msg(&text)
            ));
        }
        serde_json::from_str(&text).map_err(|e| anyhow!("Дивна відповідь GitHub: {e}"))
    }

    pub async fn repos(&self) -> Result<Vec<serde_json::Value>> {
        let json = self
            .get_json("https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner")
            .await?;
        Ok(json.as_array().cloned().unwrap_or_default())
    }

    pub async fn commit_sha(&self, owner: &str, repo: &str, git_ref: &str) -> Option<String> {
        let url = format!(
            "https://api.github.com/repos/{owner}/{repo}/commits/{}",
            encode_ref(git_ref)
        );
        self.get_json(&url)
            .await
            .ok()
            .and_then(|v| v.get("sha").and_then(|s| s.as_str()).map(|s| s.to_string()))
    }

    pub async fn search(&self, query: &str) -> Result<Vec<serde_json::Value>> {
        let url = format!(
            "https://api.github.com/search/repositories?q={}&sort=stars&order=desc&per_page=24",
            urlencode(query)
        );
        let json = self.get_json(&url).await?;
        Ok(json
            .get("items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default())
    }
}

fn trim_msg(text: &str) -> String {
    let short: String = text.chars().take(240).collect();
    short.replace('\n', " ")
}

fn encode_ref(git_ref: &str) -> String {
    git_ref.replace('#', "%23").replace(' ', "%20")
}

fn urlencode(input: &str) -> String {
    let mut out = String::new();
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

pub fn parse_url(input: &str) -> Result<ParsedUrl> {
    let raw = input.trim();
    if raw.is_empty() {
        return Err(anyhow!("Встав посилання на репозиторій GitHub."));
    }
    let with_scheme = if raw.starts_with("http://") || raw.starts_with("https://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let url = url::Url::parse(&with_scheme)
        .map_err(|_| anyhow!("Це не схоже на посилання. Приклад: https://github.com/user/repo"))?;
    let host = url.host_str().unwrap_or_default().to_lowercase();
    let segments: Vec<String> = url
        .path_segments()
        .map(|s| s.filter(|p| !p.is_empty()).map(|p| p.to_string()).collect())
        .unwrap_or_default();

    if host == "gist.github.com" {
        let gist_id = segments
            .last()
            .cloned()
            .ok_or_else(|| anyhow!("У посиланні на gist немає ідентифікатора."))?;
        return Ok(ParsedUrl {
            owner: segments.first().cloned().unwrap_or_default(),
            repo: gist_id.clone(),
            gist_id: Some(gist_id),
            is_gist: true,
            normalized: url.to_string(),
            ..Default::default()
        });
    }

    if host != "github.com" && host != "www.github.com" && host != "raw.githubusercontent.com" {
        return Err(anyhow!(
            "Підтримується лише GitHub (github.com або gist.github.com). Ти вставив {host}."
        ));
    }

    if host == "raw.githubusercontent.com" {
        if segments.len() < 4 {
            return Err(anyhow!("Некоректне посилання raw.githubusercontent.com."));
        }
        let owner = segments[0].clone();
        let repo = segments[1].clone();
        let branch = segments[2].clone();
        let path = segments[3..].join("/");
        return Ok(ParsedUrl {
            normalized: format!("https://github.com/{owner}/{repo}"),
            owner,
            repo,
            branch: Some(branch),
            sub_path: Some(path),
            ..Default::default()
        });
    }

    if segments.len() < 2 {
        return Err(anyhow!(
            "Потрібне посилання на репозиторій: https://github.com/owner/repo"
        ));
    }
    let owner = segments[0].clone();
    let repo = segments[1].trim_end_matches(".git").to_string();
    let mut branch = None;
    let mut sub_path = None;
    if segments.len() > 3 && (segments[2] == "tree" || segments[2] == "blob") {
        branch = Some(segments[3].clone());
        if segments.len() > 4 {
            sub_path = Some(segments[4..].join("/"));
        }
    } else if segments.len() > 2 && segments[2] == "commit" {
        branch = segments.get(3).cloned();
    }
    Ok(ParsedUrl {
        normalized: format!("https://github.com/{owner}/{repo}"),
        owner,
        repo,
        branch,
        sub_path,
        ..Default::default()
    })
}

/// Розбір awesome-списку: витягує посилання на GitHub-репозиторії.
pub fn parse_awesome(readme: &str) -> Vec<(String, String, String)> {
    let link_re = regex::Regex::new(r"\[([^\]]{2,80})\]\((https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\)").unwrap();
    let bare_re = regex::Regex::new(r"(?:^|\s)(https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)").unwrap();
    let mut out: Vec<(String, String, String)> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in readme.lines() {
        let mut name = None;
        let mut url = None;
        if let Some(cap) = link_re.captures(line) {
            name = Some(cap[1].trim().to_string());
            url = Some(cap[2].trim_end_matches('.').to_string());
        } else if let Some(cap) = bare_re.captures(line) {
            url = Some(cap[1].trim_end_matches('.').to_string());
        }
        if let Some(url) = url {
            let cleaned = url.trim_end_matches('/').to_string();
            let parts: Vec<&str> = cleaned.trim_start_matches("https://github.com/").split('/').collect();
            if parts.len() < 2 {
                continue;
            }
            let owner = parts[0].to_lowercase();
            if matches!(
                owner.as_str(),
                "features" | "topics" | "collections" | "sponsors" | "marketplace" | "apps" | "orgs"
            ) {
                continue;
            }
            if !seen.insert(cleaned.to_lowercase()) {
                continue;
            }
            let label = name.unwrap_or_else(|| format!("{}/{}", parts[0], parts[1]));
            let description = line
                .split(" - ")
                .nth(1)
                .unwrap_or("")
                .trim()
                .trim_end_matches(['.', '|'])
                .to_string();
            out.push((cleaned, label, description));
            if out.len() >= 80 {
                break;
            }
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: i64,
    pub interval: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePoll {
    pub state: String,
    pub token: Option<String>,
    pub interval: Option<i64>,
    pub message: Option<String>,
}

pub async fn device_start(client: &reqwest::Client, client_id: &str) -> Result<DeviceStart> {
    if client_id.trim().is_empty() {
        return Err(anyhow!(
            "Спочатку вкажи Client ID OAuth App у налаштуваннях (або увійди через токен)."
        ));
    }
    let response = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .header("User-Agent", UA)
        .form(&[("client_id", client_id), ("scope", "repo read:user gist")])
        .send()
        .await
        .map_err(|e| anyhow!("Немає зв'язку з GitHub: {e}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!(
            "GitHub не почав авторизацію ({}): {}. Перевір Client ID і що в OAuth App увімкнено Device Flow.",
            status.as_u16(),
            trim_msg(&text)
        ));
    }
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| anyhow!("Дивна відповідь GitHub: {e}"))?;
    if let Some(error) = json.get("error_description").and_then(|v| v.as_str()) {
        return Err(anyhow!("GitHub: {error}"));
    }
    Ok(DeviceStart {
        device_code: json
            .get("device_code")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        user_code: json
            .get("user_code")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        verification_uri: json
            .get("verification_uri")
            .and_then(|v| v.as_str())
            .unwrap_or("https://github.com/login/device")
            .to_string(),
        expires_in: json.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(900),
        interval: json.get("interval").and_then(|v| v.as_i64()).unwrap_or(5),
    })
}

pub async fn device_poll(
    client: &reqwest::Client,
    client_id: &str,
    device_code: &str,
) -> Result<DevicePoll> {
    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .header("User-Agent", UA)
        .form(&[
            ("client_id", client_id),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| anyhow!("Немає зв'язку з GitHub: {e}"))?;
    let text = response.text().await.unwrap_or_default();
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| anyhow!("Дивна відповідь GitHub: {e}"))?;
    if let Some(token) = json.get("access_token").and_then(|v| v.as_str()) {
        return Ok(DevicePoll {
            state: "ok".into(),
            token: Some(token.to_string()),
            interval: None,
            message: None,
        });
    }
    let error = json
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let message = json
        .get("error_description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let state = match error.as_str() {
        "authorization_pending" => "pending",
        "slow_down" => "slow_down",
        "expired_token" => "expired",
        "access_denied" => "denied",
        _ => "error",
    };
    Ok(DevicePoll {
        state: state.into(),
        token: None,
        interval: None,
        message,
    })
}

pub fn extract_readme_base64(json: &serde_json::Value) -> Option<String> {
    let content = json.get("content")?.as_str()?.replace('\n', "");
    let bytes = base64::engine::general_purpose::STANDARD.decode(content).ok()?;
    Some(String::from_utf8_lossy(&bytes).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_repo_url() {
        let parsed = parse_url("https://github.com/acme/demo").unwrap();
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "demo");
        assert!(parsed.branch.is_none());
    }

    #[test]
    fn parses_tree_url() {
        let parsed = parse_url("https://github.com/acme/demo/tree/main/skills/telegram").unwrap();
        assert_eq!(parsed.branch.as_deref(), Some("main"));
        assert_eq!(parsed.sub_path.as_deref(), Some("skills/telegram"));
    }

    #[test]
    fn parses_gist() {
        let parsed = parse_url("https://gist.github.com/user/abc123").unwrap();
        assert!(parsed.is_gist);
        assert_eq!(parsed.gist_id.as_deref(), Some("abc123"));
    }

    #[test]
    fn rejects_other_hosts() {
        assert!(parse_url("https://gitlab.com/acme/demo").is_err());
    }

    #[test]
    fn awesome_list_parsed() {
        let readme = "- [Telegram skill](https://github.com/acme/tg) - helps with bots\n- [MCP](https://github.com/acme/mcp-server) - context";
        let items = parse_awesome(readme);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].1, "Telegram skill");
        assert!(items[0].2.contains("bots"));
    }
}
