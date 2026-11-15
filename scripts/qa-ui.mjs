import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = "http://localhost:1420";
const altBase = "http://[::1]:1420";
const root = process.cwd();
const outDir = join(root, "reports", "ui");
mkdirSync(outDir, { recursive: true });

const errors = [];
const steps = [];

async function ping(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

// Vite може зайняти ::1, тому перевіряємо обидві адреси.
async function serverReady() {
  if (await ping(base)) return true;
  return ping(altBase);
}

function killTree(child) {
  if (!child || child.killed || !child.pid) return;
  try {
    if (process.platform === "win32") {
      // Синхронно, інакше процес завершиться раніше, ніж taskkill встигне прибрати дерево.
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    /* процес уже завершився */
  }
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

if (!(await serverReady())) {
  console.error(`Vite dev server is not available on ${base} or ${altBase}`);
  killTree(dev);
  process.exit(1);
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("response", (response) => {
  if (response.status() >= 400) {
    errors.push(`http ${response.status()}: ${response.url()}`);
  }
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("requestfailed", (request) => {
  if (!request.url().includes("fonts.g")) {
    errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ""}`);
  }
});

async function shot(name) {
  await page.screenshot({ path: join(outDir, name), fullPage: false });
}

async function clickNav(name) {
  const button = page.locator("aside button", { hasText: name }).first();
  await button.click({ timeout: 5000 });
  await page.waitForTimeout(450);
  steps.push(`nav: ${name}`);
}

try {
  await page.goto(base, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(700);
  await shot("01-library.png");

  for (const [name, file] of [
    ["Відкриття", "02-discover.png"],
    ["Агенти", "03-agents.png"],
    ["Проєкти", "04-projects.png"],
    ["Статистика", "05-stats.png"],
  ]) {
    await clickNav(name);
    await shot(file);
  }

  await clickNav("Агенти");
  const card = page.locator("article").first();
  if (await card.count()) {
    await card.click();
    await page.waitForTimeout(500);
    await shot("06-agent-drawer.png");
    const voice = page.locator("button", { hasText: "Голос" }).first();
    if (await voice.count()) {
      await voice.click();
      await page.waitForTimeout(700);
      const recognized = await page.locator("textarea").last().inputValue();
      if (!recognized.includes("Привіт")) {
        errors.push("voice input did not fill the prompt");
      } else {
        steps.push("voice: prompt filled");
      }
      await shot("06b-agent-voice.png");
    } else {
      errors.push("voice button not found");
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);

    const qaButton = page.locator("button", { hasText: "QA цикл" }).first();
    if (await qaButton.count()) {
      await qaButton.click();
      await page.waitForTimeout(600);
      const qaTitle = page.getByText("Повний цикл QA", { exact: false }).first();
      if (await qaTitle.isVisible().catch(() => false)) {
        steps.push("qa: cycle modal opened");
        await shot("06c-qa-cycle.png");
        const startCycle = page.locator("button", { hasText: "Запустити цикл" }).first();
        if (await startCycle.isVisible().catch(() => false)) {
          await startCycle.click();
          let verdict = false;
          for (let i = 0; i < 40; i += 1) {
            await page.waitForTimeout(500);
            if ((await page.locator("body").innerText()).includes("Вердикт аудиту")) {
              verdict = true;
              break;
            }
          }
          if (verdict) {
            steps.push("qa: auditor verdict shown");
            await shot("06d-qa-audit.png");
          } else {
            errors.push("QA cycle did not reach the auditor verdict");
          }
        }
      } else {
        errors.push("QA cycle modal did not open");
      }
      const close = page.locator("button", { hasText: "Закрити" }).first();
      if (await close.count()) await close.click();
      await page.waitForTimeout(400);
    } else {
      errors.push("QA cycle button not found");
    }
  }

  await page.keyboard.press("Control+k");
  await page.waitForTimeout(500);
  const palette = page.locator('input[placeholder*="Команда"]').first();
  if (await palette.isVisible().catch(() => false)) {
    steps.push("palette: open");
  } else {
    errors.push("palette did not open on Ctrl+K");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  if (await palette.isVisible().catch(() => false)) {
    errors.push("palette did not close on Escape");
  } else {
    steps.push("palette: closed by Escape");
  }

  await page.keyboard.press("Control+k");
  await page.waitForTimeout(500);
  if (await palette.isVisible().catch(() => false)) {
    await page.mouse.click(720, 760);
    await page.waitForTimeout(500);
    if (await palette.isVisible().catch(() => false)) {
      errors.push("palette did not close on outside click");
    } else {
      steps.push("palette: closed by outside click");
    }
  }

  await clickNav("Налаштування");
  await page.getByText("Налаштування", { exact: false }).first().waitFor({ timeout: 5000 });
  await page.waitForTimeout(800);
  await shot("07-settings.png");

  const light = page.locator("aside button", { hasText: "Світла" }).first();
  if (await light.count()) {
    await light.click();
    await page.waitForTimeout(500);
    await shot("08-settings-light.png");
    const dark = page.locator("aside button", { hasText: "Темна" }).first();
    if (await dark.count()) await dark.click();
    await page.waitForTimeout(400);
  }

  await clickNav("Бібліотека");
  await shot("09-library-final.png");
} catch (error) {
  errors.push(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  await shot("99-failure.png").catch(() => {});
} finally {
  await browser.close();
  killTree(dev);
}

const report = {
  generatedAt: new Date().toISOString(),
  base,
  steps,
  errors,
  screenshots: outDir,
  ok: errors.length === 0,
};
writeFileSync(join(outDir, "ui-report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
