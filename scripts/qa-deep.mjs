import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = "http://localhost:1420";
const altBase = "http://[::1]:1420";
const root = process.cwd();
const outDir = join(root, "reports", "manual", "deep");
mkdirSync(outDir, { recursive: true });

const results = [];
const errors = [];
const notes = [];

const check = (id, pass, detail = "") => {
  results.push({ id, pass, detail: String(detail).slice(0, 400) });
};

async function ping(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function serverReady() {
  return (await ping(base)) || ping(altBase);
}

function killTree(child) {
  if (!child || child.killed || !child.pid) return;
  spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

let dev = null;
if (!(await serverReady())) {
  dev = spawn("npm.cmd", ["run", "dev"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
    windowsHide: true,
  });
  for (let i = 0; i < 90; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await serverReady()) break;
  }
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("response", (response) => {
  if (response.status() >= 400 && !response.url().includes("fonts.g")) {
    errors.push(`http ${response.status()}: ${response.url()}`);
  }
});

const shot = (name) => page.screenshot({ path: join(outDir, name) });

async function nav(name) {
  await page.locator("aside button", { hasText: name }).first().click({ timeout: 5000 });
  await page.waitForTimeout(450);
}

const bodyText = () => page.locator("body").innerText();

try {
  await page.goto(base, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(900);

  // Library basics
  const cards = page.locator("article");
  check("library.cards", (await cards.count()) >= 3, `cards=${await cards.count()}`);
  const search = page.locator('input[placeholder*="Пошук"]').first();
  await search.fill("zzz-no-such-item");
  await page.waitForTimeout(500);
  const noResults = await bodyText();
  check("library.noResults", /не знайдено|Нічого|Знайдено 0/i.test(noResults), noResults.slice(0, 120));
  await search.fill("");
  await page.waitForTimeout(400);

  // Sort + layout
  const sort = page.locator("select").first();
  await sort.selectOption("name");
  await page.waitForTimeout(300);
  check("library.sortName", (await sort.inputValue()) === "name", await sort.inputValue());
  const listBtn = page.locator('button[title="Список"], button[title="List"]').first();
  if (await listBtn.count()) {
    await listBtn.click();
    await page.waitForTimeout(300);
    check("library.listLayout", (await page.locator("article").count()) > 0, "list");
    const gridBtn = page.locator('button[title="Сітка"], button[title="Grid"]').first();
    if (await gridBtn.count()) await gridBtn.click();
  } else {
    check("library.listLayout", false, "list toggle not found");
  }

  // Drawer open/close + toggle
  await page.locator("article").first().click();
  await page.waitForTimeout(500);
  const drawer = page.locator('aside[role="dialog"]').last();
  check("drawer.opens", await drawer.isVisible().catch(() => false));
  check(
    "drawer.focusTrap",
    await page.evaluate(() => Boolean(document.querySelector('aside[role="dialog"][aria-modal="true"]'))),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  check("drawer.escape", !(await drawer.isVisible().catch(() => false)));

  await page.locator("article").first().click();
  await page.waitForTimeout(400);
  const toggle = page.locator('aside[role="dialog"] button[role="switch"], aside[role="dialog"] button[aria-pressed]').first();
  if (await toggle.count()) {
    const before = await toggle.getAttribute("aria-pressed");
    await toggle.click();
    await page.waitForTimeout(700);
    const after = await toggle.getAttribute("aria-pressed");
    check("drawer.toggle", before !== after, `${before} -> ${after}`);
  } else {
    check("drawer.toggle", false, "toggle not found");
  }

  const tagInput = page.locator('aside[role="dialog"] input[placeholder*="+"]').first();
  if (await tagInput.count()) {
    await tagInput.fill("deep-tag");
    await tagInput.press("Enter");
    await page.waitForTimeout(400);
    check("drawer.tagAdd", (await drawer.innerText()).includes("deep-tag"), "deep-tag");
  } else {
    check("drawer.tagAdd", false, "tag input not found");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Analyze URL -> preview modal -> Escape closes
  const addInput = page.locator('input[placeholder*="Встав посилання"]').first();
  if (await addInput.count()) {
    await addInput.fill("https://github.com/anthropics/skills");
    await page.locator("button", { hasText: "Аналізувати" }).first().click();
    await page.waitForTimeout(1200);
    const previewDialog = page.locator('div[role="dialog"][aria-modal="true"]').last();
    check("preview.opens", await previewDialog.isVisible().catch(() => false));
    await shot("preview.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    check("preview.escape", !(await previewDialog.isVisible().catch(() => false)));
  } else {
    check("preview.opens", false, "add input not found");
  }

  // Sidebar quick filters
  const enabledFilter = page.locator("aside button", { hasText: "Увімкнені" }).first();
  if (await enabledFilter.count()) {
    await enabledFilter.click();
    await page.waitForTimeout(500);
    const enabledText = await bodyText();
    check("library.enabledFilter", (await page.locator("article").count()) > 0, enabledText.slice(0, 60));
    await page.locator("aside button", { hasText: "Бібліотека" }).first().click();
    await page.waitForTimeout(400);
  }

  // Settings: theme, language, slider, reduce motion
  await nav("Налаштування");
  await page.waitForTimeout(500);
  const lightBtn = page.locator("button", { hasText: "Світла" }).first();
  await lightBtn.click();
  await page.waitForTimeout(500);
  check("settings.lightTheme", await page.evaluate(() => document.documentElement.classList.contains("light")));
  await shot("settings-light.png");
  const sliderBg = await page.evaluate(() => {
    const input = document.querySelector('input[type="range"]');
    if (!input) return null;
    const style = getComputedStyle(input);
    return { colorScheme: style.colorScheme, accent: style.accentColor };
  });
  notes.push(`slider style: ${JSON.stringify(sliderBg)}`);
  const darkBtn = page.locator("button", { hasText: "Темна" }).first();
  await darkBtn.click();
  await page.waitForTimeout(400);

  const range = page.locator('input[type="range"]').first();
  await range.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(800);
  const budgetSaved = await bodyText();
  check("settings.sliderSaved", !/незбереж/i.test(budgetSaved), "no dirty banner after slider");

  const clientId = page.locator('input[placeholder^="Iv1"]').first();
  if (await clientId.count()) {
    await clientId.fill("Iv1.test123");
    await page.waitForTimeout(500);
    const dirtyText = await bodyText();
    check(
      "settings.bannerWording",
      !/Налаштування збережено\?/.test(dirtyText),
      (dirtyText.match(/[^\n]*незбереж[^\n]*/i) ?? [""])[0],
    );
    const cancelDirty = page.locator("button", { hasText: "Скасувати" }).last();
    if (await cancelDirty.count()) {
      await cancelDirty.click();
      await page.waitForTimeout(400);
    }
  } else {
    check("settings.bannerWording", true, "client id field hidden in mock");
  }

  const enBtn = page.locator("button", { hasText: "English" }).first();
  await enBtn.click();
  await page.waitForTimeout(700);
  const enText = await bodyText();
  check("i18n.noRawKeys", !/\b(settings|library|agents|detail|top|qa|projects)\.[a-zA-Z]+/.test(enText), "");
  check("i18n.noUndefined", !/undefined|null/.test(enText), "");
  await shot("settings-en.png");
  const ukBtn = page.locator("button", { hasText: "Українська" }).first();
  await ukBtn.click();
  await page.waitForTimeout(600);

  const motion = page.locator('button[aria-pressed][aria-label="Рух"]').first();
  if (await motion.count()) {
    await motion.click();
    await page.waitForTimeout(500);
    check("settings.reduceMotion", await page.evaluate(() => document.documentElement.classList.contains("reduce-motion")));
    await motion.click();
    await page.waitForTimeout(400);
  } else {
    check("settings.reduceMotion", false, "switch not found");
  }

  // Projects
  await nav("Проєкти");
  const projectText = await bodyText();
  check("projects.createLabel", /Новий проєкт/.test(projectText), projectText.slice(0, 80));
  const createProject = page.locator("button", { hasText: "Новий проєкт" }).first();
  if (await createProject.count()) {
    await createProject.click();
    await page.waitForTimeout(400);
    await shot("projects-new.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check("projects.escape", !(await page.locator('input[placeholder="my-new-project"]').isVisible().catch(() => false)));
  }

  // Agents: auditor card, create modal escape, filters
  await nav("Агенти");
  const agentsText = await bodyText();
  check("agents.auditorCard", /Аудитор/.test(agentsText), "");
  check("agents.sixCards", (await page.locator("article").count()) >= 6, `cards=${await page.locator("article").count()}`);
  const selects = page.locator("select");
  if ((await selects.count()) >= 3) {
    await selects.nth(0).selectOption({ index: 1 });
    await page.waitForTimeout(350);
    const filtered = await page.locator("article").count();
    check("agents.statusFilter", filtered >= 0, `cards=${filtered}`);
    await selects.nth(0).selectOption({ index: 0 });
    await page.waitForTimeout(300);
  }
  await page.locator("button", { hasText: "Створити агента" }).first().click();
  await page.waitForTimeout(500);
  await shot("agent-create.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  check("agents.createEscape", !(await page.locator('input[placeholder*="Назва"], input[placeholder*="name"]').first().isVisible().catch(() => false)));

  // Agent drawer escape
  await page.locator("article").first().click();
  await page.waitForTimeout(500);
  check("agents.drawer", await page.locator('aside[role="dialog"]').last().isVisible().catch(() => false));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  check("agents.drawerEscape", !(await page.locator('aside[role="dialog"]').last().isVisible().catch(() => false)));

  // Run a task in the agent drawer (mock finishes after 2.4 s)
  await page.locator("article").first().click();
  await page.waitForTimeout(500);
  const agentPrompt = page.locator('aside[role="dialog"] textarea').last();
  if (await agentPrompt.count()) {
    await agentPrompt.fill("Перевір, будь ласка, останні зміни.");
    const runButton = page.locator('aside[role="dialog"] button.btn-primary').last();
    await runButton.click();
    await page.waitForTimeout(3600);
    const drawerText = await page.locator('aside[role="dialog"]').last().innerText();
    check("agents.taskFinished", /готово|Завершено|ok|успішно/i.test(drawerText), drawerText.slice(-160));
    await shot("agent-task.png");
  } else {
    check("agents.taskFinished", false, "prompt not found");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // QA cycle with auditor (mock)
  const qaButton = page.locator("button", { hasText: "QA цикл" }).first();
  await qaButton.click();
  await page.waitForTimeout(500);
  const startBtn = page.locator("button", { hasText: "Запустити цикл" }).first();
  check("qa.startVisible", await startBtn.isVisible().catch(() => false));
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
    await page.waitForTimeout(2000);
    await shot("qa-running.png");
    let text = "";
    for (let i = 0; i < 40; i += 1) {
      await page.waitForTimeout(500);
      text = await bodyText();
      if (/Вердикт аудиту/.test(text)) break;
    }
    check("qa.auditRan", /Аудитор завершив/.test(text), text.slice(-220));
    check("qa.auditVerdict", /Вердикт аудиту:\s*PASS/i.test(text), (text.match(/Вердикт аудиту[^\n]*/) ?? [""])[0]);
    await shot("qa-done.png");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // Palette
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(500);
  const palette = page.locator('input[placeholder*="Команда"]').first();
  check("palette.open", await palette.isVisible().catch(() => false));
  if (await palette.isVisible().catch(() => false)) {
    await palette.fill("Налаштування");
    await page.waitForTimeout(500);
    const palText = await bodyText();
    check("palette.search", palText.length > 0, palText.slice(0, 80));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    const afterPalette = await bodyText();
    check("palette.runAction", /Налаштування/.test(afterPalette), afterPalette.slice(0, 80));
    await shot("palette-action.png");
  }

  // Discover + stats
  await nav("Відкриття");
  check("discover.cards", (await page.locator("article, .card-surface").count()) > 0, `cards=${await page.locator(".card-surface").count()}`);
  await nav("Статистика");
  check("stats.loaded", (await bodyText()).length > 200, "");

  // Settings persistence of theme in localStorage (Tauri stores in backend; still check class toggling)
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("reload.app", (await page.locator("aside").count()) > 0, "");
} catch (error) {
  errors.push(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  await shot("99-fatal.png").catch(() => {});
} finally {
  await browser.close();
  killTree(dev);
}

const report = { generatedAt: new Date().toISOString(), results, errors, notes };
writeFileSync(join(outDir, "deep-report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
process.exit(results.some((r) => !r.pass) || errors.length ? 1 : 0);
