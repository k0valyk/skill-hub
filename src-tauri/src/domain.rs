use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Skill,
    Plugin,
    Agent,
    Command,
    TokenSaver,
    Mcp,
    Prompt,
    Theme,
    Other,
}

impl Kind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Kind::Skill => "skill",
            Kind::Plugin => "plugin",
            Kind::Agent => "agent",
            Kind::Command => "command",
            Kind::TokenSaver => "token-saver",
            Kind::Mcp => "mcp",
            Kind::Prompt => "prompt",
            Kind::Theme => "theme",
            Kind::Other => "other",
        }
    }

    pub fn from_str(value: &str) -> Kind {
        match value {
            "skill" => Kind::Skill,
            "plugin" => Kind::Plugin,
            "agent" => Kind::Agent,
            "command" => Kind::Command,
            "token-saver" | "token_saver" => Kind::TokenSaver,
            "mcp" => Kind::Mcp,
            "prompt" => Kind::Prompt,
            "theme" => Kind::Theme,
            _ => Kind::Other,
        }
    }

    pub fn folder(&self) -> &'static str {
        match self {
            Kind::Skill => "skills",
            Kind::Plugin => "plugins",
            Kind::Agent => "agents",
            Kind::Command => "commands",
            Kind::TokenSaver => "token-savers",
            Kind::Mcp => "mcp",
            Kind::Prompt => "prompts",
            Kind::Theme => "themes",
            Kind::Other => "other",
        }
    }

    pub fn is_linkable(&self) -> bool {
        matches!(
            self,
            Kind::Skill | Kind::Agent | Kind::Command | Kind::Plugin | Kind::TokenSaver
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub severity: String,
    pub title: String,
    pub detail: String,
    #[serde(default)]
    pub line: Option<usize>,
    #[serde(default)]
    pub file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Risk {
    pub level: String,
    pub findings: Vec<Finding>,
    #[serde(default)]
    pub scanned_at: String,
}

impl Default for Risk {
    fn default() -> Self {
        Risk {
            level: "unknown".into(),
            findings: vec![],
            scanned_at: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub source_ref: Option<String>,
    #[serde(default)]
    pub commit: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    pub path: String,
    #[serde(default)]
    pub summary_uk: String,
    #[serde(default)]
    pub summary_en: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub stars: i64,
    #[serde(default)]
    pub pushed_at: Option<String>,
    #[serde(default)]
    pub size_bytes: i64,
    #[serde(default)]
    pub tokens_est: i64,
    #[serde(default)]
    pub content_hash: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub rating: i64,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub install_state: String,
    #[serde(default)]
    pub risk: Risk,
    #[serde(default)]
    pub added_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub has_local_files: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoMeta {
    pub url: String,
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub sub_path: Option<String>,
    #[serde(default)]
    pub sub_is_file: bool,
    pub is_gist: bool,
    pub name: String,
    pub description: String,
    pub readme: String,
    pub files: Vec<FileEntry>,
    pub license: Option<String>,
    pub stars: i64,
    pub pushed_at: Option<String>,
    pub default_branch: String,
    pub commit: Option<String>,
    pub size_bytes: i64,
    pub language: Option<String>,
    pub archived: bool,
    pub is_fork: bool,
    #[serde(default)]
    pub topics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub size: i64,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub url: String,
    pub kind: Kind,
    pub name: String,
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub sub_path: Option<String>,
    pub sub_is_file: bool,
    #[serde(default)]
    pub commit: Option<String>,
    pub summary_uk: String,
    pub summary_en: String,
    pub tags: Vec<String>,
    pub license: Option<String>,
    pub stars: i64,
    pub pushed_at: Option<String>,
    pub size_bytes: i64,
    pub default_folder: String,
    pub default_id: String,
    pub risk: Risk,
    pub warnings: Vec<String>,
    pub description_source: String,
    pub tokens_used: i64,
    pub cached: bool,
    pub file_count: usize,
    pub is_gist: bool,
    pub is_awesome: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    pub enabled_count: i64,
    pub advertised_tokens: i64,
    pub on_demand_tokens: i64,
    pub threshold: i64,
    pub level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInfo {
    pub item_id: String,
    pub scope: String,
    pub project_path: Option<String>,
    pub link_type: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub is_repo: bool,
    pub branch: String,
    pub remote: Option<String>,
    pub status: String,
    pub dirty_count: i64,
    pub ahead: i64,
    pub behind: i64,
    pub languages: Vec<String>,
    pub last_commit: Option<String>,
    pub last_commit_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub reason: String,
    pub items: Vec<Item>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: i64,
    pub by_kind: Vec<(String, i64)>,
    pub enabled: i64,
    pub favorites: i64,
    pub total_size: i64,
    pub saved_tokens: i64,
    pub mcp_calls: i64,
    pub top_skills: Vec<(String, i64)>,
    pub budget: Budget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub item_ids: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedCard {
    pub url: String,
    pub name: String,
    pub owner: String,
    pub summary: String,
    pub stars: i64,
    pub pushed_at: Option<String>,
    pub kind: Kind,
    pub tags: Vec<String>,
    pub license: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_saver_can_be_linked() {
        assert!(Kind::TokenSaver.is_linkable());
        assert_eq!(Kind::from_str("token-saver"), Kind::TokenSaver);
    }
}
