use anyhow::{anyhow, Result};
use std::io::{Read, Write};
use std::path::Path;

use crate::db::Db;
use crate::util::now_iso;

fn zip_options() -> zip::write::SimpleFileOptions {
    zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644)
}

pub fn export(db: &Db, root: &Path, dest: &Path) -> Result<usize> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = std::fs::File::create(dest)?;
    let mut zip = zip::ZipWriter::new(file);
    let library = root.join("library");
    let mut count = 0;

    for entry in walkdir::WalkDir::new(&library).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(root)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        if rel.ends_with(".DS_Store") || rel.contains("/.git/") {
            continue;
        }
        let data = std::fs::read(entry.path())?;
        zip.start_file(rel, zip_options())
            .map_err(|e| anyhow!("Помилка архіву: {e}"))?;
        zip.write_all(&data)?;
        count += 1;
    }

    let items = db.items().unwrap_or_default();
    let profiles = db.profiles().unwrap_or_default();
    let catalog = serde_json::json!({
        "format": "skillhub-catalog",
        "version": 1,
        "exportedAt": now_iso(),
        "items": items,
        "profiles": profiles,
    });
    zip.start_file("catalog.json", zip_options())
        .map_err(|e| anyhow!("Помилка архіву: {e}"))?;
    zip.write_all(serde_json::to_string_pretty(&catalog)?.as_bytes())?;
    zip.start_file(
        "README.txt",
        zip_options(),
    )
    .map_err(|e| anyhow!("Помилка архіву: {e}"))?;
    zip.write_all(
        "Skill Hub export.\n\n1. Відкрий Skill Hub → Налаштування → Імпорт.\n2. Обери цей файл.\n3. Бібліотека розпакується в library/ і просканується автоматично.\n"
            .as_bytes(),
    )?;
    zip.finish().map_err(|e| anyhow!("Не вдалося завершити архів: {e}"))?;
    Ok(count)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub structural_errors: Vec<String>,
}

pub fn import(db: &Db, root: &Path, src: &Path) -> Result<ImportResult> {
    let file = std::fs::File::open(src)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| anyhow!("Це не zip-архів Skill Hub: {e}"))?;
    let mut imported = 0;
    let mut skipped = 0;
    let mut structural_errors = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let name = entry.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        let Some(rel) = entry.enclosed_name() else {
            structural_errors.push(name);
            continue;
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if !rel_str.starts_with("library/") {
            continue;
        }
        let target = root.join(&rel);
        if target.exists() {
            skipped += 1;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf)?;
        std::fs::write(&target, buf)?;
        imported += 1;
    }
    db.record_usage(None, "import", 0)?;
    Ok(ImportResult {
        imported,
        skipped,
        structural_errors,
    })
}

pub fn backup_checksum(root: &Path) -> String {
    let mut hasher = sha2::Sha256::new();
    use sha2::Digest;
    for entry in walkdir::WalkDir::new(root.join("library")).into_iter().flatten() {
        if entry.file_type().is_file() {
            if let Ok(bytes) = std::fs::read(entry.path()) {
                hasher.update(entry.path().to_string_lossy().as_bytes());
                hasher.update(&bytes);
            }
        }
    }
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_then_import_roundtrip() {
        let src_root = tempfile::tempdir().unwrap();
        crate::settings::ensure_dirs(src_root.path()).unwrap();
        let skill = src_root.path().join("library/skills/demo");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(skill.join("SKILL.md"), "---\nname: Demo\n---\nBody").unwrap();
        let db = Db::open(&src_root.path().join(".skillhub/db.sqlite")).unwrap();
        let archive = src_root.path().join("export.zip");
        export(&db, src_root.path(), &archive).unwrap();
        assert!(archive.exists());

        let dst_root = tempfile::tempdir().unwrap();
        crate::settings::ensure_dirs(dst_root.path()).unwrap();
        let db2 = Db::open(&dst_root.path().join(".skillhub/db.sqlite")).unwrap();
        let result = import(&db2, dst_root.path(), &archive).unwrap();
        assert_eq!(result.imported, 1, "лише SKILL.md лежить у library/");
        assert!(dst_root.path().join("library/skills/demo/SKILL.md").exists());
    }

    #[test]
    fn checksum_stable() {
        let tmp = tempfile::tempdir().unwrap();
        crate::settings::ensure_dirs(tmp.path()).unwrap();
        let a = backup_checksum(tmp.path());
        let b = backup_checksum(tmp.path());
        assert_eq!(a, b);
    }
}
