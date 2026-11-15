# Архітектура Skill Hub

Документ описує, як влаштований застосунок: шари, потоки даних, формати на диску й ключові рішення. Мета — щоб нову фічу можна було додати, не тримаючи в голові весь проєкт.

---

## 1. Шари

```text
┌──────────────────────────────────────────────────────────────┐
│ React 19 + TS + Vite + Tailwind 4 + Framer Motion            │
│  store.ts (zustand)  ←→  lib/api.ts  ←→  invoke / events     │
└───────────────────────────┬──────────────────────────────────┘
                            │ Tauri IPC (camelCase, JSON)
┌───────────────────────────▼──────────────────────────────────┐
│ Rust: commands.rs — тонкий командний шар                      │
│  analyze · scanner · library_ops · linking · projects ·      │
│  github · security · classify · db · mcp · stats · export    │
└──────────────┬──────────────────────────┬────────────────────┘
               │                          │
        SQLite (rusqlite)          Файлова система + git + HTTP
```

Правила:

- Увесь I/O, git, HTTP і секрети — у Rust. Фронтенд ніколи не бачить токенів.
- Команди повертають серіалізовані структури з `#[serde(rename_all = "camelCase")]`; TypeScript-контракт — `src/lib/types.ts`.
- Довгі операції (клонування, git-пуш, сканування) виконуються в `spawn_blocking` або всередині sync-блоку без утримання `MutexGuard` через `.await`.
- `Db` живе як `Arc<Mutex<Db>>`; функції, що приймають `&Mutex<Db>`, блокують його самі.

### Два бінарники

| Бінарник | Роль |
| --- | --- |
| `skillhub` | GUI (Tauri): вікно, трей, фонова перевірка оновлень |
| `skillhub-cli` | Консоль: `init/list/search/enable/disable/budget/connect/check-updates` + MCP stdio |

CLI — окремий крейт `src-tauri/cli` у тому самому Cargo workspace: він залежить від тієї ж `skillhub_lib`, тому логіка підключення й сканування однакова для GUI, CLI і MCP. Окремий крейт ще й не дає Tauri-бандлеру вважати CLI другим `[[bin]]` GUI (інакше MSI додає sidecar двічі). GUI копіює CLI у `<root>/.skillhub/bin/` під час «Connect», щоб не залежати від порядку збірки Tauri.

---

## 2. Модулі Rust (`src-tauri/src`)

| Модуль | Відповідальність |
| --- | --- |
| `commands.rs` | Tauri-команди, `AppState` (root, settings, db, http, pending meta), bootstrap, підготовка CLI |
| `domain.rs` | `Item`, `Kind`, `Risk`, `Preview`, `RepoMeta`, `Budget`, `Profile`, `ProjectInfo`… |
| `db.rs` | SQLite: схема, міграції, CRUD, профілі, кеш аналізу, usage-події, бюджет |
| `settings.rs` | `settings.json`, ключі через `keyring` (Windows Credential Manager), env-перекриття |
| `util.rs` | Шляхи, атомарний запис, SHA-256, slug, прихований запуск процесів, `expand_home` |
| `github.rs` | Парсинг URL/gist/awesome, REST-клієнт, Device Flow, ліміти, помилки |
| `classify.rs` | Правила визначення типу й тегів за файлами та README |
| `security.rs` | Сканер патернів, `Risk { level, findings }` |
| `analyze.rs` | `fetch_meta`, збір `RepoMeta`, правила-описи, DeepSeek, кеш, `Preview`, попередження |
| `scanner.rs` | Скан `library/`, читання/запис `skillhub.json`, підрахунок токенів і розміру |
| `library_ops.rs` | `install`, `save_link`, `update`, `check_updates`, видалення |
| `linking.rs` | Junction/копія в `.opencode/skills`, `disable`, бюджет, `connect_opencode` |
| `projects.rs` | Список проєктів, git-статус, план публікації, `.gitignore`, push/PR-логіка |
| `mcp.rs` | JSON-RPC 2.0 по stdio, схеми інструментів, ранжування, ліниве читання |
| `agents.rs` | Скан і парсинг агентів OpenCode V2, метадані, зв'язки з папками/скілами, історія завдань, запуск `opencode run --format json`, парсер подій |
| `stats.rs` | Агрегати для сторінки статистики та дублікати |
| `export.rs` | Zip-експорт/імпорт, бекап |
| `feed.rs` | Стрічка відкриттів із GitHub (кеш у БД) |

---

## 3. Потік «додати за посиланням»

```text
URL
 └─ github::parse_url           → owner/repo, branch, subpath, gist?
 └─ analyze::fetch_meta         → REST: repo, README, license, tree, stars, commit
     └─ security::scan_files    → ризик і знахідки
     └─ classify::classify      → Kind + теги (правила)
     └─ analyze::describe_rules → 3 речення UK/EN без AI
     └─ DeepSeek (якщо є ключ)  → кращі описи, кеш за prompt+commit
     └─ warnings_for            → «варто знати»
 └─ Preview (нічого не записано на диск)
```

Далі користувач явно обирає:

- **Завантажити** → `library_ops::install`:
  1. sparse checkout у `.skillhub/cache/clone-*` (або запис файлів gist);
  2. копіювання у `library/<kind>/<id>` з фільтром сміття;
  3. скан, `skillhub.json`, запис у БД;
  4. прогрес летить подією `install:progress` (`{url, stage, pct}`);
  5. подія `library:changed` для пересканування UI.
- **Зберегти посилання** → `library_ops::save_link`: запис у БД + `skillhub.json` без файлів (`install_state = "linked"`), пізніше можна довантажити.

Пакетний режим: `preview_batch` приймає рядки/awesome-список, кожен URL аналізується незалежно; збори повертаються окремим списком `failures`, а не валять весь пакет. Для awesome-списку `awesome_candidates` віддає знайдені проєкти, користувач обирає підмножину.

Кеш аналізу: `analysis_cache(cache_key, payload, created_at)`, ключ = SHA-256 від версії промпта, мови, моделі, URL, підшляху, коміту, `pushed_at` і довжини README. Інвалідація природна: змінився коміт — змінився ключ.

---

## 4. Підключення до OpenCode

```
library/skills/telegram-bot-kit   ──junction──▶  <opencode>/.opencode/skills/telegram-bot-kit
```

- Глобальний конфіг: `SKILLHUB_OPENCODE_DIR` → `XDG_CONFIG_HOME/opencode` → `~/.config/opencode`.
- Проєктний: `<project>/.opencode/skills`.
- На Windows створюється directory junction (`cmd /C mklink /J`) без прав адміністратора; якщо не вдалося — копіювання.
- `disable` видаляє лінк; оригінал у бібліотеці недоторканий.
- `scope_links` у БД зберігає, що і де підключено, щоб UI показував `scopes`, а `list_enabled` — правду.

MCP-сервер додається у `opencode.json`:

```json
{"mcp":{"servers":{"skillhub":{"type":"local","command":["…/skillhub-cli.exe","--root","…","mcp"],"cwd":"~","pool":true}}}}
```

### Бюджет контексту

OpenCode показує агенту лише `id`, `name`, `description`. Тому:

```
advertised = Σ (tokens_est(description увімкненого) + 14)
on_demand  = Σ tokens_est(повний текст)
```

Поріг — `settings.contextBudget` (за замовчуванням 6000). `level`: `ok` / `warn` (≥85 %) / `over`. Повний текст читає лише `get_skill`, тому великі скіли не з'їдають контекст, доки не знадобляться.

---

## 5. MCP-протокол

`mcp::serve(root)` — цикл по рядках stdin/stdout, JSON-RPC 2.0:

- `initialize` → `serverInfo {name: "skillhub", version}`, capabilities `tools`;
- `tools/list` → шість інструментів зі схемами;
- `tools/call` → результат у `content: [{type: "text", text}]`, помилки — як `isError`;
- `notifications/initialized`, `ping` — тихо ok.

Кожен виклик пише `usage_events(item_id, kind, tokens)`, тому статистика й «найчастіше використовувані» реальні, а не вигадані. Ранжування (`mcp::rank`) — зважений збіг за назвою, тегами, типом і описом; покриття покращується без embeddings і без мережі.

---

## 5.1 Агенти OpenCode

Discovery:

```text
~/.config/opencode/agents/*.md        ← глобальні (і старий agent/)
<project>/.opencode/agents/*.md       ← проєктні
```

Проєкти беруться з `projects/`, `project_dir` і всіх прив'язок у `agent_projects`; вкладені теки дають ID `team/reviewer`. Вимкнений агент лежить як `<name>.md.disabled` — OpenCode його не бачить, а SkillHub показує картку зі статусом «вимкнений».

- **Джерело правди — файл.** Frontmatter парситься вручну: V2 `description/mode/model/color/permissions/steps/hidden` плюс legacy `tools`/`permission`. Метадані (людська назва, іконка, теги, авто-дозволи) живуть у `agents_meta` за шляхом; втрата БД не ламає агентів.
- **Запуск завдання**: `opencode run --agent <key> --format json [--auto] [--model <model>] --title "Skill Hub · <key>" "<prompt>"` з `cwd` вибраного проєкту. Модель береться з агента, інакше з `settings.agentModel` (список — `opencode models`). CLI шукається в OpenCode Desktop, PATH або `SKILLHUB_OPENCODE_CLI`; `.cmd/.bat` обгортаються в `cmd /C`.
- **Потік подій** читається построчно: `text` → вивід і рядок активності, `tool_use` → «🔧 tool», `step_finish` → токени/вартість, `error` → текст помилки, `permission` → статус «чекає підтвердження». Події летять у UI (`agent:activity`, `agent:finished`), а підсумок пишеться в `agent_tasks`.
- **Скасування** — `JoinHandle::abort()` + `kill_on_drop`, запис у БД отримує статус `cancelled`.
- **Скіли агента** зберігаються в `agent_skills` і синхронізуються у видимий блок у тілі `.md` між `<!-- skillhub:skills:start/end -->`, щоб агент знав, що є в бібліотеці, і завантажував текст ліниво через MCP.
- **Папки** — це `cwd` для запуску і джерело проєктних агентів; OpenCode отримує доступ до workspace через звичайні permissions.

---

## 5.2 Голос і QA-цикл

### Голос

- `voice_languages` / `voice_listen` (Rust) запускають PowerShell-скрипт `scripts/voice-listen.ps1` з `System.Speech.Recognition` у `spawn_blocking`. Скрипт вбудований через `include_str!`, пише в temp з UTF-8 BOM і повертає розпізнаний текст.
- Мови залежать від мовних пакетів Windows; `voice_languages` повертає встановлені. Аудіо не йде в модель і не витрачає токени.
- Озвучення — Web Speech API у WebView2 (`speechSynthesis`), вибір голосу за мовою, `prepareSpeech` прибирає код/таблиці/списки, економний режим лишає 2–3 речення. Перемикач зберігається per-agent у `localStorage`.
- UI: кнопка мікрофона в composer, «Авто» для автовідправки, індикатор «Слухаю…», оцінка токенів під полем, динамік і стоп у шапці агента.

### QA-цикл

- Глобальні агенти `qa-tester`, `fixer` і `auditor` (Markdown у `~/.config/opencode/agents`) працюють із папкою `reports/` проєкту. `qa-report.json` має фіксовану схему; `fixer` змінює `status/fixSummary/files`; `auditor` перевіряє докази й пише `audit-report.json`.
- Кнопка **QA цикл** (`AgentQaCycle`) запускає `qa-tester` → читає звіт (`agent_qa_report`) → запускає `fixer` → запускає `auditor` → читає вердикт (`agent_audit_report`) і повторює до 5 кругів, поки є critical/high або аудит не підтвердив якість. Події завдань уже дають живий статус, логи, токени й вартість; кнопка зупинки скасовує поточного агента.
- `scripts/qa-ui.mjs` (Playwright + Edge) перевіряє браузерний mock-режим: вкладки, палітру (Ctrl+K, Escape, клік поза), агенти, голосовий ввід, QA-модалку, теми. Пише `reports/ui/ui-report.json` і скріншоти.

---

## 6. Дані на диску

### `skillhub.json` (поруч з елементом)

```json
{
  "id": "telegram-bot-kit",
  "name": "telegram-bot-kit",
  "kind": "skill",
  "sourceUrl": "https://github.com/owner/repo",
  "sourceRef": "main",
  "commit": "abc123…",
  "summaryUk": "Це … Він … Знадобиться …",
  "summaryEn": "…",
  "tags": ["telegram", "aiogram"],
  "license": "MIT",
  "stars": 812,
  "tokensEst": 640,
  "risk": {"level": "clean", "findings": []},
  "installState": "local",
  "addedAt": "2026-11-13T…",
  "updatedAt": "2026-11-13T…"
}
```

`scanner` вміє відновлювати записи з `skillhub.json` навіть якщо БД втрачено — бібліотека самодостатня.

### SQLite (`.skillhub/skillhub.db`)

| Таблиця | Призначення |
| --- | --- |
| `items` | Каталог: метадані, описи, теги, ризик, стан, зірки, токени |
| `scope_links` | item × scope × проєкт × тип лінка × шлях |
| `usage_events` | Виклики MCP / встановлення / оновлення |
| `analysis_cache` | Кеш описів за ключем |
| `rules` | Користувацькі правила класифікації (теги/виключення) |
| `profiles`, `profile_items` | Набори скілів |
| `kv` | Дрібні прапорці (наприклад, дата додавання ключа) |
| `feed_cache` | Кеш стрічки відкриттів |
| `agents_meta` | Display name, іконка, теги, авто-дозволи (ключ — шлях до `.md`) |
| `agent_projects`, `agent_skills` | Зв'язки агента з папками проєктів і скілами бібліотеки |
| `agent_tasks` | Історія запусків: prompt, статус, output, тривалість, токени, вартість |

Схема створюється ідемпотентно (`CREATE TABLE IF NOT EXISTS`) при відкритті.

---

## 7. Frontend

```text
src/
├─ main.tsx / App.tsx        # bootstrap, тема/акцент/мова, події, роутинг в'юхів
├─ store.ts                  # zustand: стан + усі дії, useT()
├─ lib/
│  ├─ api.ts                 # invoke + listen, mock-фолбек у браузері
│  ├─ types.ts               # контракт із Rust (camelCase)
│  ├─ i18n.ts                # UK/EN словники, TranslationKey
│  ├─ mock.ts                # демо-дані для `npm run dev`
│  └─ utils.ts               # фільтри, сортування, формати, акценти
├─ components/
│  ├─ Sidebar, TopBar, LibraryView, ItemCard
│  ├─ DetailDrawer, AddPreview, CommandPalette, Toasts
│  ├─ Settings, Projects (+PublishDialog), Stats, Discover
│  ├─ Agents (сітка/карта, drawer, створення, історія завдань)
│  ├─ ProfileEditor, common (KindIcon, BudgetBar, Toggle, …)
└─ styles.css                # токени, glass, анімації, reduce-motion
```

Домовленості:

- `lib/api.ts` єдина точка IPC; якщо Tauri немає — викликає `mockCall`, тому UI повністю клікабельний у браузері.
- `store` — єдине джерело істини; компоненти не викликають `invoke` напряму (окрім одноразового `awesome_candidates`).
- Тема й акцент застосовуються класами/змінними на `<html>`: `html.light`, `--accent`, `html.reduce-motion`.
- Події: `quick-add` (трей), `library:changed` (пересканування), `install:progress`, `updates:found`.
- `Ctrl+K` відкриває палітру: навігація, дії, пошук по елементах.
- Скрізь, де ключі динамічні (`kind.${kind}`), використовується `as TranslationKey`.

---

## 8. Помилки та безпека

- Rust-команди повертають `Result<T, String>` з людським текстом (`humanize` для git/HTTP). UI показує тост, а не стек.
- Секрети: `keyring` (сервіс `SkillHub`, ключі `github_token`, `deepseek_api_key`); env-перекриття для тестів. У фронтенд віддається лише `{githubToken: bool, deepseekKey: bool}`.
- Публічний пуш вимагає `confirm_public`; якщо знайдено секрети — додатково `allow_secrets`.
- Сканер обмежує розмір файлів (300 КБ на файл, 60 файлів) і ігнорує бінарники, щоб аналіз був швидким і передбачуваним.
- Видалення файлів з диска — явний чекбокс; без нього видаляється лише запис.
- `panic = "abort"` у release, `lto`, `opt-level = "s"` — маленький бінарник.

---

## 9. Тести

- **Rust** (`cargo test`): правила класифікації, `gitignore_for`, парсинг GitHub URL/awesome, ранжування MCP, бюджет, лікування (`enable`/`disable`) на тимчасових каталогах, MCP-відповіді.
- **Frontend** (`vitest`, jsdom): `filterItems`, `sortItems`, `formatBytes`, `splitSentences`, `truncate`.

Тести ізольюють глобальний OpenCode-конфіг через `SKILLHUB_OPENCODE_DIR`, тому не чіпають реальні налаштування розробника.

---

## 10. Ключові рішення

| Рішення | Чому |
| --- | --- |
| Tauri замість Electron | Менший розмір, RAM і швидший старт; WebView2 уже є в Windows |
| Workspace: GUI + окремий крейт CLI | Спільна логіка GUI/CLI/MCP без дублювання і без подвійного sidecar у MSI |
| MCP вручну (JSON-RPC по рядках) | Мінімум залежностей, повний контроль над лінивим завантаженням |
| Junction замість копіювання | Оновлення в бібліотеці одразу видно OpenCode; fallback — копія |
| `skillhub.json` + SQLite | Бібліотека переносима й відновлювана; БД лише індекс і кеш |
| Sparse checkout | Не тягнемо гігабайти монорепо заради однієї папки |
| Кеш за комітом | Повторний аналіз того ж стану безкоштовний і миттєвий |
| Правила → AI | Працює офлайн і без ключа; AI лише покращує текст |
| Пресети акцентів | Один градієнт у дизайні, але користувач обирає настрій |
