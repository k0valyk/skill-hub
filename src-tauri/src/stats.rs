use crate::db::Db;
use crate::domain::{DuplicateGroup, Item, Stats};

pub fn compute(db: &Db, threshold: i64) -> Stats {
    let items = db.items().unwrap_or_default();
    let (mcp_calls, saved, top) = db.usage_summary().unwrap_or((0, 0, vec![]));
    let mut by_kind_map: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for item in &items {
        *by_kind_map.entry(item.kind.as_str().to_string()).or_insert(0) += 1;
    }
    let mut by_kind: Vec<(String, i64)> = by_kind_map.into_iter().collect();
    by_kind.sort_by(|a, b| b.1.cmp(&a.1));
    let top_skills = top
        .into_iter()
        .map(|(id, count)| {
            let name = items
                .iter()
                .find(|i| i.id == id)
                .map(|i| i.name.clone())
                .unwrap_or(id);
            (name, count)
        })
        .collect();

    Stats {
        total: items.len() as i64,
        by_kind,
        enabled: items.iter().filter(|i| i.enabled).count() as i64,
        favorites: items.iter().filter(|i| i.favorite).count() as i64,
        total_size: items.iter().map(|i| i.size_bytes.max(0)).sum(),
        saved_tokens: saved,
        mcp_calls,
        top_skills,
        budget: db.budget(threshold),
    }
}

fn norm(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

fn jaccard(a: &[String], b: &[String]) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 0.0;
    }
    let set_a: std::collections::HashSet<&String> = a.iter().collect();
    let set_b: std::collections::HashSet<&String> = b.iter().collect();
    let inter = set_a.intersection(&set_b).count() as f64;
    let union = set_a.union(&set_b).count() as f64;
    if union == 0.0 {
        0.0
    } else {
        inter / union
    }
}

pub fn duplicates(db: &Db) -> Vec<DuplicateGroup> {
    let items = db.items().unwrap_or_default();
    let mut groups: Vec<DuplicateGroup> = Vec::new();
    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut by_name: std::collections::HashMap<String, Vec<Item>> = std::collections::HashMap::new();
    for item in &items {
        by_name.entry(norm(&item.name)).or_default().push(item.clone());
    }
    for (key, group) in by_name {
        if group.len() > 1 && !key.is_empty() {
            for item in &group {
                used.insert(item.id.clone());
            }
            groups.push(DuplicateGroup {
                reason: "Однакова назва".into(),
                items: group,
            });
        }
    }

    let mut by_hash: std::collections::HashMap<String, Vec<Item>> = std::collections::HashMap::new();
    for item in &items {
        if item.content_hash.len() > 10 {
            by_hash.entry(item.content_hash.clone()).or_default().push(item.clone());
        }
    }
    for (_, group) in by_hash {
        if group.len() > 1 {
            for item in &group {
                used.insert(item.id.clone());
            }
            groups.push(DuplicateGroup {
                reason: "Ідентичний вміст".into(),
                items: group,
            });
        }
    }

    for i in 0..items.len() {
        if used.contains(&items[i].id) {
            continue;
        }
        let mut group = vec![items[i].clone()];
        for j in (i + 1)..items.len() {
            if used.contains(&items[j].id) {
                continue;
            }
            if jaccard(&items[i].tags, &items[j].tags) >= 0.66 {
                group.push(items[j].clone());
            }
        }
        if group.len() > 1 {
            for item in &group {
                used.insert(item.id.clone());
            }
            groups.push(DuplicateGroup {
                reason: "Схожі теги".into(),
                items: group,
            });
        }
    }

    groups.truncate(24);
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jaccard_basics() {
        assert_eq!(
            jaccard(&["a".into(), "b".into()], &["a".into(), "b".into()]),
            1.0
        );
        assert_eq!(jaccard(&["a".into()], &["b".into()]), 0.0);
    }

    #[test]
    fn duplicates_by_name() {
        let tmp = tempfile::tempdir().unwrap();
        let db = crate::db::Db::open(&tmp.path().join("db.sqlite")).unwrap();
        let mut a = sample("A Skill");
        a.id = "a".into();
        let mut b = sample("a skill!");
        b.id = "b".into();
        db.upsert_item(&a).unwrap();
        db.upsert_item(&b).unwrap();
        let groups = duplicates(&db);
        assert!(groups.iter().any(|g| g.items.len() == 2));
    }

    fn sample(name: &str) -> crate::domain::Item {
        crate::domain::Item {
            id: name.into(),
            name: name.into(),
            kind: crate::domain::Kind::Skill,
            source_url: None,
            source_ref: None,
            commit: None,
            version: None,
            path: String::new(),
            summary_uk: String::new(),
            summary_en: String::new(),
            tags: vec![],
            license: None,
            stars: 0,
            pushed_at: None,
            size_bytes: 0,
            tokens_est: 0,
            content_hash: String::new(),
            favorite: false,
            rating: 0,
            notes: String::new(),
            archived: false,
            install_state: "linked".into(),
            risk: Default::default(),
            added_at: String::new(),
            updated_at: String::new(),
            enabled: false,
            scopes: vec![],
            has_local_files: false,
        }
    }
}
