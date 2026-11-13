// Копіює зібраний CLI туди, звідки Tauri бере його як externalBin.
// Запускається з beforeBuildCommand (release) або beforeDevCommand (--debug).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const version = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
const host = /host:\s*(\S+)/.exec(version)?.[1];
if (!host) {
  console.error("Не вдалося визначити target triple з `rustc -vV`.");
  process.exit(1);
}

const debug = process.argv.includes("--debug");
const profile = debug ? "debug" : "release";
const ext = host.includes("windows") ? ".exe" : "";
const source = `src-tauri/target/${profile}/skillhub-cli${ext}`;
if (!existsSync(source)) {
  console.error(`Немає ${source}. Спершу: cargo build --bin skillhub-cli`);
  process.exit(1);
}

mkdirSync("src-tauri/binaries", { recursive: true });
const target = `src-tauri/binaries/skillhub-cli-${host}${ext}`;
copyFileSync(source, target);
console.log(`CLI (${profile}) → ${target}`);
