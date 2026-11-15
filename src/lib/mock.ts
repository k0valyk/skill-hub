import type {
  Agent,
  AgentTask,
  Budget,
  DuplicateGroup,
  FeedCard,
  Item,
  Kind,
  Preview,
  Profile,
  ProjectInfo,
  Settings,
  Stats,
} from "./types";

const now = new Date();
const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();

const summaries: Record<string, [string, string]> = {
  "telegram-bot-kit": [
    "Це набір скілів для Telegram-ботів на aiogram 3. Він дає агенту готові шаблони хендлерів, FSM і роботи з aiosqlite. Знадобиться, щоб не переписувати ту саму рутину в кожному боті.",
    "A skill pack for aiogram 3 Telegram bots. It gives the agent ready handler, FSM and aiosqlite patterns. Useful when you keep rewriting the same boilerplate.",
  ],
  "context-compressor": [
    "Це інструмент стиснення контексту для довгих сесій. Він переписує історію в короткі структуровані нотатки перед кожним кроком моделі. Знадобиться, коли сесія розростається і токени починають горіти.",
    "A context compression tool for long sessions. It rewrites history into short structured notes before each model step. Useful when sessions grow and tokens burn.",
  ],
  "opencode-git-workflow": [
    "Це плагін OpenCode для git-дисципліни. Він підказує момент для коміту, перевіряє staged-файли й формує опис змін. Знадобиться, щоб не тримати десятки незв'язаних правок в одному коміті.",
    "An OpenCode plugin for git discipline. It suggests when to commit, checks staged files and drafts a change summary. Useful to avoid giant unrelated commits.",
  ],
  "deepseek-cheap-review": [
    "Це скіл для дешевого код-рев'ю на DeepSeek Flash. Він дає агенту короткий чекліст і просить відповідь лише по суті. Знадобиться для швидких перевірок без витрат на повну модель.",
    "A skill for cheap code review with DeepSeek Flash. It gives the agent a short checklist and asks for a focused answer. Useful for quick reviews without full-model cost.",
  ],
  "saas-backend-patterns": [
    "Це агент для бекенду B2B SaaS. Він тримає правила мультитенантності, міграцій і аудиту в одному місці. Знадобиться, коли проєкт росте і хочеться однакових рішень.",
    "An agent for B2B SaaS backends. It keeps multi-tenancy, migrations and audit rules in one place. Useful when a project grows and decisions should stay consistent.",
  ],
  "mcp-postgres": [
    "Це MCP-сервер для PostgreSQL. Він дає агенту безпечні запити до схеми й даних. Знадобиться, коли треба досліджувати базу без ручного копіювання SQL.",
    "An MCP server for PostgreSQL. It gives the agent safe schema and data queries. Useful when exploring a database without copying SQL by hand.",
  ],
  "frontend-motion-kit": [
    "Це скіл для анімацій на Framer Motion. Він описує пружини, жести й повагу до reduce-motion. Знадобиться, щоб інтерфейс рухався плавно, але не дістав користувача.",
    "A Framer Motion animation skill. It covers springs, gestures and reduced-motion respect. Useful for smooth interfaces that don't annoy users.",
  ],
  "token-budget-guard": [
    "Це правило для агента, яке стежить за бюджетом контексту. Воно попереджає, коли описів скілів стає забагато. Знадобиться, щоб не платити за скіли, які ти не використовуєш.",
    "An agent rule that watches the context budget. It warns when too many skill descriptions pile up. Useful to stop paying for skills you never use.",
  ],
  "prompt-library-ua": [
    "Це бібліотека українських системних промптів. Вона містить шаблони для брифів, листів і технічних описів. Знадобиться, коли потрібен нормальний тон без вигадування з нуля.",
    "A library of Ukrainian system prompts. It includes templates for briefs, emails and technical docs. Useful when you need a good tone without starting from scratch.",
  ],
};

function kindFor(id: string): Kind {
  if (id.startsWith("mcp")) return "mcp";
  if (id.includes("compressor") || id.includes("budget")) return "token-saver";
  if (id.includes("plugin") || id.includes("git-workflow")) return "plugin";
  if (id.includes("agent") || id.includes("backend")) return "agent";
  if (id.includes("prompt")) return "prompt";
  return "skill";
}

let items: Item[] = Object.entries(summaries).map(([id, [uk, en]], index) => {
  const kind = kindFor(id);
  return {
    id,
    name: id
      .split("-")
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" "),
    kind,
    sourceUrl: `https://github.com/demo/${id}`,
    sourceRef: "main",
    commit: `mock${index}abc`,
    version: null,
    path: `C:\\Users\\demo\\Documents\\SkillHub\\library\\${kind}\\${id}`,
    summaryUk: uk,
    summaryEn: en,
    tags: [kind, id.includes("telegram") ? "telegram" : "workflow", "python"],
    license: "MIT",
    stars: 120 + index * 37,
    pushedAt: iso(index * 12 + 2),
    sizeBytes: 18_000 + index * 24_000,
    tokensEst: 600 + index * 180,
    contentHash: `hash-${index}`,
    favorite: index === 0 || index === 3,
    rating: index === 0 ? 5 : index === 3 ? 4 : 0,
    notes: "",
    archived: false,
    installState: "downloaded",
    risk:
      index === 1
        ? {
            level: "medium",
            findings: [
              {
                severity: "medium",
                title: "Мережеві запити",
                detail: "Є вихідні HTTP-запити: дані можуть покидати твою машину.",
                file: "scripts/compress.ts",
                line: 42,
              },
            ],
            scannedAt: iso(1),
          }
        : { level: "clean", findings: [], scannedAt: iso(1) },
    addedAt: iso(index * 3 + 1),
    updatedAt: iso(index),
    enabled: index < 4,
    scopes: index < 4 ? ["global"] : [],
    hasLocalFiles: true,
  };
});

let profiles: Profile[] = [
  {
    id: "telegram",
    name: "Telegram-бот",
    description: "aiogram 3, aiosqlite, APScheduler",
    itemIds: ["telegram-bot-kit", "context-compressor"],
    createdAt: iso(10),
  },
  {
    id: "saas",
    name: "B2B SaaS бекенд",
    description: "Мультитенантність, міграції, аудит",
    itemIds: ["saas-backend-patterns", "mcp-postgres"],
    createdAt: iso(8),
  },
];

let mockAgents: Agent[] = [
  {
    id: "g:agent-factory",
    key: "agent-factory",
    path: "C:\\Users\\demo\\.config\\opencode\\agents\\agent-factory.md",
    fileName: "agent-factory.md",
    scope: "global",
    projectPath: null,
    name: "Agent Factory",
    techName: "agent-factory",
    description: "Створює й редагує агентів OpenCode за описом, підбирає шаблон і перевіряє формат.",
    icon: "🏭|#8b7cff",
    mode: "primary",
    model: "deepseek/deepseek-flash",
    color: "#8b7cff",
    hidden: false,
    steps: 16,
    permissions: [
      { action: "edit", resource: "~/.config/opencode/agents/*", effect: "allow" },
      { action: "shell", resource: "*", effect: "ask" },
      { action: "subagent", resource: "*", effect: "deny" },
    ],
    tags: ["meta", "agents"],
    skills: [],
    projects: [],
    enabled: true,
    status: "idle",
    activity: null,
    lastRunAt: iso(2),
    lastStatus: "ok",
    tokensIn: 12400,
    tokensOut: 3100,
    costUsd: 0.0042,
    bodyTokens: 420,
    bodyPreview: "You are agent-factory...",
    updatedAt: iso(2),
    autoApprove: true,
  },
  {
    id: "g:skill-finder",
    key: "skill-finder",
    path: "C:\\Users\\demo\\.config\\opencode\\agents\\skill-finder.md",
    fileName: "skill-finder.md",
    scope: "global",
    projectPath: null,
    name: "Skill Finder",
    techName: "skill-finder",
    description: "Шукає потрібні скіли в Skill Hub, вмикає 1–3 найкращі та вимикає зайві.",
    icon: "🧭|#2dd4bf",
    mode: "subagent",
    model: "deepseek/deepseek-flash",
    color: "#2dd4bf",
    hidden: false,
    steps: 8,
    permissions: [
      { action: "skillhub_*", resource: "*", effect: "allow" },
      { action: "shell", resource: "*", effect: "ask" },
    ],
    tags: ["skills", "search"],
    skills: ["frontend-motion-kit"],
    projects: [],
    enabled: true,
    status: "working",
    activity: "Шукаю скіли для анімацій…",
    lastRunAt: iso(0),
    lastStatus: "ok",
    tokensIn: 5400,
    tokensOut: 820,
    costUsd: 0.0011,
    bodyTokens: 260,
    bodyPreview: "Search Skill Hub lazily...",
    updatedAt: iso(4),
    autoApprove: false,
  },
  {
    id: "p:8f2a1c3d:reviewer",
    key: "reviewer",
    path: "C:\\Users\\demo\\Documents\\SkillHub\\projects\\saas-api\\.opencode\\agents\\reviewer.md",
    fileName: "reviewer.md",
    scope: "project",
    projectPath: "C:\\Users\\demo\\Documents\\SkillHub\\projects\\saas-api",
    name: "Code Reviewer",
    techName: "reviewer",
    description: "Перевіряє зміни на коректність і регресії, нічого не редагуючи.",
    icon: "🧪|#ff7aa2",
    mode: "subagent",
    model: "deepseek/deepseek-chat",
    color: "#ff7aa2",
    hidden: false,
    steps: 6,
    permissions: [
      { action: "edit", resource: "*", effect: "deny" },
      { action: "shell", resource: "git diff*", effect: "allow" },
    ],
    tags: ["review", "quality"],
    skills: ["deepseek-cheap-review"],
    projects: ["C:\\Users\\demo\\Documents\\SkillHub\\projects\\saas-api"],
    enabled: true,
    status: "waiting",
    activity: "Очікує підтвердження на запуск тестів",
    lastRunAt: iso(0),
    lastStatus: "ok",
    tokensIn: 9100,
    tokensOut: 1400,
    costUsd: 0.0023,
    bodyTokens: 380,
    bodyPreview: "Review the current changes...",
    updatedAt: iso(0),
    autoApprove: false,
  },
];

const mockAgentTasks: AgentTask[] = [
  {
    id: "task-1",
    agentId: "p:8f2a1c3d:reviewer",
    agentName: "Code Reviewer",
    projectPath: "C:\\Users\\demo\\Documents\\SkillHub\\projects\\saas-api",
    prompt: "Перевір останні зміни в API та знайди ризики.",
    status: "ok",
    output: "Знайдено 2 зауваження:\n1. src/api/orders.ts:44 — немає перевірки tenantId.\n2. src/api/orders.ts:88 — тест не покриває відмову платежу.",
    startedAt: iso(0),
    finishedAt: iso(0),
    durationMs: 42000,
    tokensIn: 9100,
    tokensOut: 1400,
    costUsd: 0.0023,
    exitCode: 0,
  },
  {
    id: "task-2",
    agentId: "g:agent-factory",
    agentName: "Agent Factory",
    projectPath: "",
    prompt: "Створи агента для перевірки міграцій.",
    status: "ok",
    output: "Створено ~/.config/opencode/agents/migration-reviewer.md",
    startedAt: iso(2),
    finishedAt: iso(2),
    durationMs: 21000,
    tokensIn: 6200,
    tokensOut: 900,
    costUsd: 0.0016,
    exitCode: 0,
  },
];

let settings: Settings = {
  root: "C:\\Users\\demo\\Documents\\SkillHub",
  theme: "dark",
  accent: "violet",
  language: "uk",
  deepseekModel: "deepseek-chat",
  contextBudget: 6000,
  autoCheckUpdates: true,
  lastUpdateCheck: iso(2),
  githubClientId: "",
  githubLogin: null,
  githubBackupRepo: null,
  reduceMotion: false,
  onboarded: true,
  projectDir: null,
};

function budget(): Budget {
  const enabled = items.filter((item) => item.enabled);
  const advertised = enabled.reduce((sum, item) => sum + Math.ceil(item.summaryUk.length / 4) + 14, 0);
  const onDemand = enabled.reduce((sum, item) => sum + item.tokensEst, 0);
  const level = advertised > settings.contextBudget ? "over" : advertised > settings.contextBudget * 0.75 ? "warn" : "ok";
  return {
    enabledCount: enabled.length,
    advertisedTokens: advertised,
    onDemandTokens: onDemand,
    threshold: settings.contextBudget,
    level: level as Budget["level"],
  };
}

const delay = (ms = 420) => new Promise((resolve) => setTimeout(resolve, ms));

export async function mockCall<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  switch (command) {
    case "app_bootstrap": {
      await delay(180);
      return {
        settings,
        secrets: { githubToken: false, deepseekKey: true },
        items,
        profiles,
        budget: budget(),
        opencode: { connected: false, cliPath: null, configPath: "~/.config/opencode/opencode.json" },
        gitVersion: "git version 2.55.0 (mock)",
        appVersion: "0.1.0",
        startupError: null,
        analysisTokensIn: 4120,
        analysisTokensOut: 890,
      } as T;
    }
    case "scan_library":
      await delay(300);
      return items as T;
    case "preview_link": {
      await delay(900);
      const url = String(args?.url ?? "");
      const repo = url.split("/").filter(Boolean).pop() ?? "demo";
      const id = repo.replace(/\.git$/, "").toLowerCase();
      const kind = kindFor(id);
      const preview: Preview = {
        url: `https://github.com/demo/${id}`,
        kind,
        name: id.split("-").map((p) => p[0]?.toUpperCase() + p.slice(1)).join(" "),
        owner: "demo",
        repo: id,
        branch: "main",
        subPath: null,
        subIsFile: false,
        commit: "mockabc123",
        summaryUk: summaries[id]?.[0] ??
          "Це корисний інструмент для OpenCode. Він додає готові інструкції та шаблони для типової роботи. Знадобиться, коли хочеться менше рутини й більше однакових рішень.",
        summaryEn: summaries[id]?.[1] ?? "A useful OpenCode tool with ready-made instructions and templates.",
        tags: [kind, "workflow"],
        license: "MIT",
        stars: 240,
        pushedAt: iso(6),
        sizeBytes: 42_000,
        defaultFolder: kind === "mcp" ? "mcp" : `${kind}s`,
        defaultId: id,
        risk: { level: "clean", findings: [], scannedAt: iso(0) },
        warnings: [],
        descriptionSource: "ai",
        tokensUsed: 812,
        cached: false,
        fileCount: 14,
        isGist: false,
        isAwesome: false,
      };
      return preview as T;
    }
    case "preview_batch": {
      await delay(1200);
      return { previews: [], failures: [] } as T;
    }
    case "install_preview": {
      await delay(1400);
      const preview = args?.preview as Preview;
      const item: Item = {
        ...(items[0] as Item),
        id: preview.defaultId,
        name: preview.name,
        kind: preview.kind,
        summaryUk: preview.summaryUk,
        summaryEn: preview.summaryEn,
        tags: preview.tags,
        sourceUrl: preview.url,
        stars: preview.stars,
        license: preview.license,
        enabled: false,
        scopes: [],
        favorite: false,
        notes: "",
        risk: preview.risk,
        addedAt: new Date().toISOString(),
        installState: "downloaded",
      };
      items = [item, ...items.filter((existing) => existing.id !== item.id)];
      return item as T;
    }
    case "save_preview": {
      await delay(300);
      const preview = args?.preview as Preview;
      const local: any = mockCall;
      void local;
      return {
        ...(items[0] as Item),
        id: preview.defaultId,
        name: preview.name,
        kind: preview.kind,
        summaryUk: preview.summaryUk,
        sourceUrl: preview.url,
        path: "",
        installState: "linked",
        hasLocalFiles: false,
        enabled: false,
        scopes: [],
      } as T;
    }
    case "set_enabled": {
      await delay(320);
      const id = String(args?.id);
      const enabled = Boolean(args?.enabled);
      const scope = String(args?.scope ?? "global");
      items = items.map((item) =>
        item.id === id
          ? {
              ...item,
              enabled,
              scopes: enabled
                ? scope === "global"
                  ? ["global"]
                  : [`project|${String(args?.project ?? "")}`]
                : [],
            }
          : item,
      );
      return {
        item: items.find((item) => item.id === id),
        budget: budget(),
      } as T;
    }
    case "update_item_fields": {
      await delay(200);
      const patch = (args?.patch ?? {}) as Record<string, unknown>;
      items = items.map((item) => (item.id === args?.id ? { ...item, ...patch } : item));
      return items.find((item) => item.id === args?.id) as T;
    }
    case "delete_library_item": {
      await delay(250);
      items = items.filter((item) => item.id !== args?.id);
      return items as T;
    }
    case "read_item_text":
      await delay(200);
      return ("---\nname: Demo\ndescription: Mock skill\n---\n\n# " +
        items.find((item) => item.id === args?.id)?.name +
        "\n\nЦе демонстраційний текст у браузерному режимі.\n") as T;
    case "get_budget":
      return budget() as T;
    case "get_settings":
      return settings as T;
    case "save_profile": {
      await delay(200);
      const profile = args?.profile as Profile;
      profiles = [profile, ...profiles.filter((p) => p.id !== profile.id)];
      return profiles as T;
    }
    case "delete_profile": {
      profiles = profiles.filter((p) => p.id !== args?.id);
      return profiles as T;
    }
    case "apply_profile": {
      await delay(400);
      const profile = profiles.find((p) => p.id === args?.id);
      items = items.map((item) =>
        profile?.itemIds.includes(item.id) ? { ...item, enabled: true, scopes: ["global"] } : item,
      );
      return items as T;
    }
    case "save_settings": {
      await delay(300);
      settings = { ...settings, ...(args?.next as Settings) };
      return settings as T;
    }
    case "set_secret": {
      await delay(300);
      return { githubToken: false, deepseekKey: true } as T;
    }
    case "clear_secret":
      return { githubToken: false, deepseekKey: false } as T;
    case "github_repos":
      return [
        {
          name: "skill-hub",
          fullName: "demo/skill-hub",
          url: "https://github.com/demo/skill-hub",
          private: true,
          stars: 12,
          updatedAt: iso(1),
          description: "Skill library",
        },
      ] as T;
    case "projects_list": {
      await delay(300);
      return [
        {
          path: `${settings.root}\\projects\\telegram-shop-bot`,
          name: "telegram-shop-bot",
          isRepo: true,
          branch: "main",
          remote: "https://github.com/demo/telegram-shop-bot.git",
          status: "changes",
          dirtyCount: 3,
          ahead: 1,
          behind: 0,
          languages: ["Python"],
          lastCommit: "feat: cart flow",
          lastCommitAt: iso(0),
        },
        {
          path: `${settings.root}\\projects\\saas-api`,
          name: "saas-api",
          isRepo: true,
          branch: "main",
          remote: "https://github.com/demo/saas-api.git",
          status: "clean",
          dirtyCount: 0,
          ahead: 0,
          behind: 0,
          languages: ["TypeScript", "Rust"],
          lastCommit: "chore: bump deps",
          lastCommitAt: iso(2),
        },
        {
          path: `${settings.root}\\projects\\landing`,
          name: "landing",
          isRepo: false,
          branch: "",
          remote: null,
          status: "no-repo",
          dirtyCount: 0,
          ahead: 0,
          behind: 0,
          languages: ["TypeScript"],
          lastCommit: null,
          lastCommitAt: null,
        },
      ] as T;
    }
    case "project_plan": {
      await delay(600);
      return {
        path: String(args?.path),
        name: "telegram-shop-bot",
        isRepo: true,
        branch: "main",
        files: ["bot.py", "handlers/start.py", "db.py", "requirements.txt", "README.md"],
        secrets: [],
        gitignoreCreated: false,
        languages: ["Python"],
        defaultMessage: "chore: publish telegram-shop-bot",
        remote: null,
        totalSize: 82_000,
      } as T;
    }
    case "project_publish":
      await delay(1400);
      return {
        repoUrl: "https://github.com/demo/telegram-shop-bot",
        branch: "main",
        commit: "abc1234",
        pushedFiles: 5,
        message: "Запушено 5 файлів",
      } as T;
    case "project_init": {
      await delay(400);
      const name = String(args?.name ?? "project");
      return `${settings.root}\\projects\\${name}` as T;
    }
    case "project_sync":
      await delay(900);
      return { status: "clean" } as T;
    case "discover_feed": {
      await delay(900);
      const cards: FeedCard[] = [
        {
          url: "https://github.com/example/opencode-memory",
          name: "opencode-memory",
          owner: "example",
          summary: "Persistent project memory for OpenCode with a tiny token footprint.",
          stars: 1240,
          pushedAt: iso(3),
          kind: "plugin",
          tags: ["memory", "plugin"],
          license: "MIT",
        },
        {
          url: "https://github.com/example/skill-telegram",
          name: "skill-telegram",
          owner: "example",
          summary: "aiogram 3 skill with FSM, aiosqlite and scheduler patterns.",
          stars: 860,
          pushedAt: iso(9),
          kind: "skill",
          tags: ["telegram", "aiogram"],
          license: "MIT",
        },
        {
          url: "https://github.com/example/mcp-sqlite",
          name: "mcp-sqlite",
          owner: "example",
          summary: "SQLite MCP server with safe read-only queries.",
          stars: 640,
          pushedAt: iso(14),
          kind: "mcp",
          tags: ["mcp", "sqlite"],
          license: "Apache-2.0",
        },
      ];
      return cards as T;
    }
    case "get_stats": {
      await delay(350);
      const stats: Stats = {
        total: items.length,
        byKind: ["skill", "plugin", "agent", "mcp", "token-saver", "prompt"].map((kind) => [
          kind,
          items.filter((item) => item.kind === kind).length,
        ]) as [string, number][],
        enabled: items.filter((item) => item.enabled).length,
        favorites: items.filter((item) => item.favorite).length,
        totalSize: items.reduce((sum, item) => sum + item.sizeBytes, 0),
        savedTokens: 18_400,
        mcpCalls: 62,
        topSkills: [
          ["Telegram Bot Kit", 24],
          ["Context Compressor", 17],
          ["Deepseek Cheap Review", 11],
        ],
        budget: budget(),
      };
      return stats as T;
    }
    case "get_duplicates": {
      await delay(300);
      const group: DuplicateGroup = {
        reason: "Схожі теги",
        items: items.slice(0, 2),
      };
      return [group] as T;
    }
    case "check_updates": {
      await delay(1100);
      return items.slice(0, 3).map((item, index) => ({
        id: item.id,
        name: item.name,
        current: item.commit,
        latest: index === 0 ? "newsha" : item.commit,
        behind: index === 0,
        error: null,
      })) as T;
    }
    case "update_library_item": {
      await delay(900);
      return { added: [], removed: [], changed: ["SKILL.md"], commit: "newsha" } as T;
    }
    case "export_library":
      return "C:\\Users\\demo\\Documents\\skillhub-backup.zip" as T;
    case "import_library":
      return { imported: 12, skipped: 0, structuralErrors: [] } as T;
    case "backup_library":
      return "https://github.com/demo/skillhub-library" as T;
    case "connect_opencode":
      return "C:\\Users\\demo\\.config\\opencode\\opencode.json" as T;
    case "opencode_status":
      return { connected: true, cliPath: "C:\\SkillHub\\.skillhub\\bin\\skillhub-cli.exe", configPath: "~/.config/opencode/opencode.json" } as T;
    case "choose_folder":
      return "C:\\Users\\demo\\Documents\\SkillHub" as T;
    case "agents_list":
      return mockAgents as T;
    case "agent_tasks":
      return mockAgentTasks.filter((task) => task.agentId === String(args?.id ?? "")) as T;
    case "agent_templates":
      return [
        {
          id: "developer",
          name: "Розробник",
          description: "Пише й редагує код, дотримується стилю та тестів.",
          body: "You are a careful software developer. Read the code before changing it.",
          mode: "primary",
        },
        {
          id: "reviewer",
          name: "Рев'юер",
          description: "Перевіряє зміни на регресії, нічого не редагуючи.",
          body: "Review the current changes. List findings in severity order.",
          mode: "subagent",
        },
      ] as T;
    case "agents_runtime":
      return "C:\\Users\\demo\\AppData\\Roaming\\ai.opencode.desktop\\cli\\2.2.7-x64\\opencode-cli.exe" as T;
    case "agent_create": {
      const input = (args?.input ?? {}) as Record<string, unknown>;
      const name = String(input.name ?? "agent");
      const agent: Agent = {
        ...mockAgents[0],
        id: `g:${name}`,
        key: name,
        techName: name,
        name: String(input.displayName ?? name),
        description: String(input.description ?? ""),
        mode: String(input.mode ?? "subagent"),
        model: (input.model as string | null) ?? null,
        icon: "🛠️|#5b8cff",
        tags: (input.tags as string[]) ?? [],
        skills: [],
        projects: [],
        status: "idle",
        activity: null,
        lastRunAt: null,
        lastStatus: null,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        enabled: true,
        path: `C:\\Users\\demo\\.config\\opencode\\agents\\${name}.md`,
        fileName: `${name}.md`,
        updatedAt: new Date().toISOString(),
      };
      mockAgents = [agent, ...mockAgents];
      return agent as T;
    }
    case "agent_update": {
      const id = String(args?.id ?? "");
      const patch = (args?.patch ?? {}) as Record<string, unknown>;
      mockAgents = mockAgents.map((agent) =>
        agent.id === id
          ? {
              ...agent,
              name: (patch.displayName as string) ?? agent.name,
              description: (patch.description as string) ?? agent.description,
              icon: (patch.icon as string) ?? agent.icon,
              tags: (patch.tags as string[]) ?? agent.tags,
              autoApprove: (patch.autoApprove as boolean) ?? agent.autoApprove,
            }
          : agent,
      );
      return mockAgents.find((agent) => agent.id === id) as T;
    }
    case "agent_toggle": {
      const id = String(args?.id ?? "");
      const enabled = Boolean(args?.enabled);
      mockAgents = mockAgents.map((agent) => (agent.id === id ? { ...agent, enabled } : agent));
      return mockAgents.find((agent) => agent.id === id) as T;
    }
    case "agent_delete": {
      const id = String(args?.id ?? "");
      mockAgents = mockAgents.filter((agent) => agent.id !== id);
      return mockAgents as T;
    }
    case "agent_link_project": {
      const id = String(args?.id ?? "");
      const path = String(args?.path ?? "");
      mockAgents = mockAgents.map((agent) =>
        agent.id === id ? { ...agent, projects: [...new Set([...agent.projects, path])] } : agent,
      );
      return mockAgents.find((agent) => agent.id === id) as T;
    }
    case "agent_unlink_project": {
      const id = String(args?.id ?? "");
      const path = String(args?.path ?? "");
      mockAgents = mockAgents.map((agent) =>
        agent.id === id ? { ...agent, projects: agent.projects.filter((entry) => entry !== path) } : agent,
      );
      return mockAgents.find((agent) => agent.id === id) as T;
    }
    case "agent_link_skill": {
      const id = String(args?.id ?? "");
      const itemId = String(args?.itemId ?? "");
      mockAgents = mockAgents.map((agent) =>
        agent.id === id ? { ...agent, skills: [...new Set([...agent.skills, itemId])] } : agent,
      );
      return mockAgents.find((agent) => agent.id === id) as T;
    }
    case "agent_unlink_skill": {
      const id = String(args?.id ?? "");
      const itemId = String(args?.itemId ?? "");
      mockAgents = mockAgents.map((agent) =>
        agent.id === id ? { ...agent, skills: agent.skills.filter((entry) => entry !== itemId) } : agent,
      );
      return mockAgents.find((agent) => agent.id === id) as T;
    }
    case "agent_choose_icon":
      return null as T;
    case "agent_export":
      return "C:\\Users\\demo\\Documents\\agent.md" as T;
    case "agent_import":
      return mockAgents[0] as T;
    case "agent_run_task": {
      const id = String(args?.id ?? "");
      const agent = mockAgents.find((entry) => entry.id === id) ?? mockAgents[0];
      const task: AgentTask = {
        id: `task-${Date.now()}`,
        agentId: id,
        agentName: agent.name,
        projectPath: String(args?.project ?? ""),
        prompt: String(args?.prompt ?? ""),
        status: "running",
        output: "",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        durationMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        exitCode: null,
      };
      mockAgentTasks.unshift(task);
      mockAgents = mockAgents.map((entry) =>
        entry.id === id ? { ...entry, status: "working", activity: "Виконую завдання…" } : entry,
      );
      return task as T;
    }
    case "agent_cancel_task":
      return undefined as T;
    case "open_path":
    case "open_url":
      return undefined as T;
    default:
      throw new Error(`Mock не реалізує команду ${command}`);
  }
}

export function mockItems(): Item[] {
  return items;
}

export function mockProjects(): ProjectInfo[] {
  return [];
}
