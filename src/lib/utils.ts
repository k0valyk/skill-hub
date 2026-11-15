import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Item, Kind } from "./types";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const ACCENTS: Record<string, { from: string; to: string; name: string }> = {
  violet: { from: "#8b7cff", to: "#5b8cff", name: "Violet" },
  blue: { from: "#4f9dff", to: "#38d9ff", name: "Blue" },
  teal: { from: "#2dd4bf", to: "#22d3ee", name: "Teal" },
  rose: { from: "#ff7aa2", to: "#ff4d6d", name: "Rose" },
  amber: { from: "#ffb86b", to: "#ff8a3d", name: "Amber" },
  emerald: { from: "#43e97b", to: "#38f9d7", name: "Emerald" },
};

export const KIND_ORDER: Kind[] = [
  "skill",
  "plugin",
  "agent",
  "command",
  "token-saver",
  "mcp",
  "prompt",
  "theme",
  "other",
];

export function applyAccent(accent: string) {
  const value = ACCENTS[accent] ?? ACCENTS.violet;
  document.documentElement.style.setProperty("--accent", value.from);
  document.documentElement.style.setProperty("--accent-2", value.to);
  document.documentElement.style.setProperty(
    "--accent-soft",
    hexToRgba(value.from, document.documentElement.classList.contains("light") ? 0.14 : 0.16),
  );
}

function hexToRgba(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function formatBytes(bytes: number, lang: "uk" | "en" = "uk"): string {
  if (!bytes || bytes <= 0) return "—";
  const units = lang === "en" ? ["B", "KB", "MB", "GB"] : ["Б", "КБ", "МБ", "ГБ"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 || Number.isInteger(value)
    ? Math.round(value)
    : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

export function formatNumber(value: number, lang: "uk" | "en" = "uk"): string {
  return new Intl.NumberFormat(lang === "en" ? "en-GB" : "uk-UA").format(Math.round(value));
}

export function formatDate(iso?: string | null, lang: "uk" | "en" = "uk"): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "uk-UA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function relativeDate(iso?: string | null, lang: "uk" | "en" = "uk"): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return lang === "en" ? "today" : "сьогодні";
  if (days === 1) return lang === "en" ? "yesterday" : "вчора";
  if (days < 30) return lang === "en" ? `${days} d ago` : `${days} дн. тому`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return lang === "en" ? `${months} mo ago` : `${months} міс. тому`;
  }
  const years = Math.floor(days / 365);
  return lang === "en" ? `${years} y ago` : `${years} р. тому`;
}

export function splitSentences(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  return matches.map((s) => s.trim()).filter(Boolean);
}

export function firstSentence(text: string): string {
  return splitSentences(text)[0] ?? "";
}

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-");
}

export function hostOf(url?: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

export type SortKey = "recent" | "name" | "stars" | "size";
export type KindFilter = Kind | "all" | "enabled" | "favorites";

export interface FilterState {
  query: string;
  kind: KindFilter;
  favoritesOnly?: boolean;
}

export function filterItems(items: Item[], filter: FilterState): Item[] {
  const query = filter.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter.kind === "enabled" && !item.enabled) return false;
    if (filter.kind === "favorites" && !item.favorite) return false;
    if (filter.kind !== "all" && filter.kind !== "enabled" && filter.kind !== "favorites" && item.kind !== filter.kind) {
      return false;
    }
    if (filter.favoritesOnly && !item.favorite) return false;
    if (!query) return true;
    const haystack = [item.name, item.summaryUk, item.summaryEn, item.tags.join(" ")]
      .join(" ")
      .toLowerCase();
    return query.split(/\s+/).every((token) => haystack.includes(token));
  });
}

export function sortItems(items: Item[], sort: SortKey): Item[] {
  const copy = [...items];
  switch (sort) {
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case "stars":
      return copy.sort((a, b) => b.stars - a.stars);
    case "size":
      return copy.sort((a, b) => b.sizeBytes - a.sizeBytes);
    case "recent":
    default:
      return copy.sort((a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""));
  }
}

export function itemSummary(item: Item, lang: "uk" | "en"): string {
  return lang === "en" ? item.summaryEn || item.summaryUk : item.summaryUk || item.summaryEn;
}

export function riskTone(level: string): "ok" | "warn" | "danger" | "muted" {
  switch (level) {
    case "high":
      return "danger";
    case "medium":
      return "warn";
    case "low":
      return "warn";
    case "clean":
      return "ok";
    default:
      return "muted";
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
