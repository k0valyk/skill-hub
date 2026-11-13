fn main() {
    // Tauri перевіряє наявність externalBin ще на етапі build-скрипта, тому
    // в чистому клоні (де binaries/ ще порожня) створюємо заглушку. Реальний
    // CLI з'являється після `cargo build --bin skillhub-cli` і stage-cli.mjs,
    // а для `cargo test` / `cargo check` вміст файлу не важливий.
    if let Ok(target) = std::env::var("TARGET") {
        let ext = if target.contains("windows") { ".exe" } else { "" };
        let dir = std::path::PathBuf::from("binaries");
        let path = dir.join(format!("skillhub-cli-{target}{ext}"));
        if !path.exists() {
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(&path, []);
        }
    }
    tauri_build::build()
}
