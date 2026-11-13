use anyhow::{anyhow, Result};
use std::path::PathBuf;

use skillhub_lib::{
    db::Db, linking, library_ops, mcp, scanner, settings, util, commands,
};

fn print_help() {
    println!(
        "Skill Hub CLI 0.1.0\n\n\
Використання: skillhub-cli [--root ПАПКА] <команда>\n\n\
Команди:\n\
  init                         створити структуру бібліотеки та просканувати\n\
  list [--json]                список елементів\n\
  search <запит>               пошук по бібліотеці\n\
  enable <id> [--project ПАПКА]  підключити до OpenCode\n\
  disable <id> [--project ПАПКА] відключити\n\
  budget                       бюджет контексту\n\
  connect [--project ПАПКА]    прописати MCP-сервер в opencode.json\n\
  mcp                          запустити MCP-сервер (stdio) для OpenCode\n\
  version                      версія\n"
    );
}

#[tokio::main]
async fn main() {
    if let Err(err) = run().await {
        eprintln!("Помилка: {err}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut root: PathBuf = settings::load().root_path();
    let mut rest: Vec<String> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--root" => {
                if i + 1 >= args.len() {
                    return Err(anyhow!("Після --root потрібен шлях до папки."));
                }
                root = util::expand_home(&args[i + 1]);
                i += 2;
            }
            "--help" | "-h" => {
                print_help();
                return Ok(());
            }
            other => {
                rest.push(other.to_string());
                i += 1;
            }
        }
    }
    let command = rest.first().map(|s| s.as_str()).unwrap_or("help");

    if command == "mcp" {
        return mcp::serve(root).await;
    }
    if command == "help" {
        print_help();
        return Ok(());
    }
    if command == "version" {
        println!("skillhub-cli {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    settings::ensure_dirs(&root)?;
    let db = Db::open(&root.join(".skillhub/skillhub.db"))?;
    let settings = settings::load();
    let threshold = settings.context_budget;

    match command {
        "init" => {
            let items = scanner::scan(&root, &db)?;
            println!("Бібліотека: {}", root.display());
            println!("Знайдено елементів: {}", items.len());
            let budget = db.budget(threshold);
            println!(
                "Увімкнено: {} (≈{} токенів у контексті)",
                budget.enabled_count, budget.advertised_tokens
            );
            Ok(())
        }
        "list" => {
            let as_json = rest.iter().any(|a| a == "--json");
            let items = db.items()?;
            if as_json {
                println!("{}", serde_json::to_string_pretty(&items)?);
            } else {
                for item in items {
                    println!(
                        "{:<28} {:<12} {}",
                        item.id,
                        item.kind.as_str(),
                        item.name
                    );
                }
                println!("Всього: {}", db.items()?.len());
            }
            Ok(())
        }
        "search" => {
            let query = rest.get(1).cloned().unwrap_or_default();
            if query.is_empty() {
                return Err(anyhow!("Вкажи запит: skillhub-cli search telegram"));
            }
            let items = db.items()?;
            let results = mcp::rank(&items, &query, 10);
            if results.is_empty() {
                println!("Нічого не знайдено.");
            }
            for (_, item) in results {
                println!(
                    "{:<28} {:<12} {}",
                    item.id,
                    item.kind.as_str(),
                    item.name
                );
            }
            Ok(())
        }
        "enable" | "disable" => {
            let id = rest
                .get(1)
                .cloned()
                .ok_or_else(|| anyhow!("Вкажи id елемента: skillhub-cli enable <id>"))?;
            let project = rest
                .iter()
                .position(|a| a == "--project")
                .and_then(|idx| rest.get(idx + 1))
                .map(PathBuf::from);
            let item = db
                .get_item(&id)?
                .ok_or_else(|| anyhow!("Елемент {id} не знайдено"))?;
            if command == "enable" {
                let link = linking::enable(
                    &db,
                    &item,
                    if project.is_some() { "project" } else { "global" },
                    project.as_deref(),
                )?;
                println!("Підключено {} → {}", item.name, link.target);
            } else {
                linking::disable(
                    &db,
                    &id,
                    if project.is_some() { "project" } else { "global" },
                    project.as_deref(),
                )?;
                println!("Відключено {}", item.name);
            }
            let budget = db.budget(threshold);
            println!(
                "Бюджет: {} скілів, ≈{} токенів (ліміт {})",
                budget.enabled_count, budget.advertised_tokens, threshold
            );
            Ok(())
        }
        "budget" => {
            let budget = db.budget(threshold);
            println!("Увімкнено скілів: {}", budget.enabled_count);
            println!(
                "Описи в контексті моделі: ≈{} токенів (ліміт {})",
                budget.advertised_tokens, threshold
            );
            println!(
                "Повний текст на вимогу: ≈{} токенів",
                budget.on_demand_tokens
            );
            println!(
                "Стан: {}",
                match budget.level.as_str() {
                    "ok" => "ок",
                    "warn" => "близько до ліміту",
                    _ => "перевищено",
                }
            );
            Ok(())
        }
        "connect" => {
            let project = rest
                .iter()
                .position(|a| a == "--project")
                .and_then(|idx| rest.get(idx + 1))
                .map(PathBuf::from);
            let cli = commands::ensure_cli(&root)?;
            let scope = if project.is_some() { "project" } else { "global" };
            let path = linking::connect_opencode(scope, project.as_deref(), &cli)?;
            println!("MCP-сервер skillhub прописано у {path}");
            Ok(())
        }
        "check-updates" => {
            let token = settings::get_secret("github_token");
            let updates = library_ops::check_updates(&db, token.as_deref());
            for update in &updates {
                let state = if update.behind { "є оновлення" } else { "актуально" };
                println!("{:<28} {}", update.id, state);
                if let Some(err) = &update.error {
                    println!("    попередження: {err}");
                }
            }
            Ok(())
        }
        other => Err(anyhow!(
            "Невідома команда «{other}». Запусти skillhub-cli --help."
        )),
    }
}
