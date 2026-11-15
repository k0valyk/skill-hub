import { describe, expect, it } from "vitest";
import type { Item } from "./types";
import { filterItems, formatBytes, formatNumber, sortItems, splitSentences, firstSentence, truncate } from "./utils";

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "demo",
    name: "Demo",
    kind: "skill",
    path: "skills/demo",
    summaryUk: "Це скіл. Він робить речі.",
    summaryEn: "This is a skill. It does things.",
    tags: ["demo"],
    stars: 0,
    sizeBytes: 1024,
    tokensEst: 100,
    contentHash: "abc",
    favorite: false,
    rating: 0,
    notes: "",
    archived: false,
    installState: "local",
    risk: { level: "clean", findings: [] },
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    enabled: false,
    scopes: [],
    hasLocalFiles: true,
    ...overrides,
  };
}

describe("formatBytes", () => {
  it("returns a dash for empty sizes", () => {
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(-4)).toBe("—");
  });

  it("formats bytes, kilobytes and megabytes", () => {
    expect(formatBytes(512)).toBe("512 Б");
    expect(formatBytes(2048)).toBe("2 КБ");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 МБ");
    expect(formatBytes(1536)).toBe("1.5 КБ");
  });

  it("uses english units and number grouping when lang is en", () => {
    expect(formatBytes(2048, "en")).toBe("2 KB");
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatNumber(1234, "en")).toBe("1,234");
    expect(formatNumber(1234, "uk").replace(/\s/g, " ")).toBe("1 234");
  });
});

describe("splitSentences", () => {
  it("splits a three sentence description", () => {
    const text = "Це скіл. Він робить речі. Він потрібен тобі.";
    expect(splitSentences(text)).toEqual([
      "Це скіл.",
      "Він робить речі.",
      "Він потрібен тобі.",
    ]);
    expect(firstSentence(text)).toBe("Це скіл.");
  });

  it("handles text without punctuation and empty input", () => {
    expect(splitSentences("без крапки")).toEqual(["без крапки"]);
    expect(splitSentences("")).toEqual([]);
    expect(firstSentence("")).toBe("");
  });
});

describe("truncate", () => {
  it("keeps short text intact", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("adds an ellipsis when cutting", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("filterItems", () => {
  const items = [
    makeItem({ id: "a", name: "Telegram Bot", kind: "skill", tags: ["telegram", "bot"] }),
    makeItem({
      id: "b",
      name: "React Theme",
      kind: "theme",
      tags: ["react"],
      favorite: true,
      enabled: true,
    }),
    makeItem({ id: "c", name: "MCP Server", kind: "mcp", tags: ["server"], enabled: true }),
  ];

  it("keeps everything with an empty query", () => {
    expect(filterItems(items, { query: "", kind: "all" })).toHaveLength(3);
  });

  it("matches name and tags case-insensitively", () => {
    expect(filterItems(items, { query: "TELEGRAM", kind: "all" }).map((i) => i.id)).toEqual(["a"]);
    expect(filterItems(items, { query: "react", kind: "all" }).map((i) => i.id)).toEqual(["b"]);
  });

  it("requires every token to match", () => {
    expect(filterItems(items, { query: "telegram bot", kind: "all" }).map((i) => i.id)).toEqual([
      "a",
    ]);
    expect(filterItems(items, { query: "telegram react", kind: "all" })).toHaveLength(0);
  });

  it("filters by kind", () => {
    expect(filterItems(items, { query: "", kind: "theme" }).map((i) => i.id)).toEqual(["b"]);
  });

  it("filters enabled and favorites pseudo-kinds", () => {
    expect(filterItems(items, { query: "", kind: "enabled" }).map((i) => i.id)).toEqual([
      "b",
      "c",
    ]);
    expect(filterItems(items, { query: "", kind: "favorites" }).map((i) => i.id)).toEqual(["b"]);
  });

  it("searches both language summaries", () => {
    const english = [makeItem({ id: "x", summaryUk: "нічого", summaryEn: "Only English words" })];
    expect(filterItems(english, { query: "english", kind: "all" })).toHaveLength(1);
  });
});

describe("sortItems", () => {
  const items = [
    makeItem({ id: "a", name: "Beta", stars: 5, sizeBytes: 300, addedAt: "2026-01-02T00:00:00Z" }),
    makeItem({ id: "b", name: "Alpha", stars: 50, sizeBytes: 100, addedAt: "2026-01-03T00:00:00Z" }),
    makeItem({ id: "c", name: "Gamma", stars: 1, sizeBytes: 200, addedAt: "2026-01-01T00:00:00Z" }),
  ];

  it("sorts by name", () => {
    expect(sortItems(items, "name").map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by stars descending", () => {
    expect(sortItems(items, "stars").map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by size descending", () => {
    expect(sortItems(items, "size").map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("sorts recent first by default", () => {
    expect(sortItems(items, "recent").map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("does not mutate the source array", () => {
    const source = [...items];
    sortItems(items, "name");
    expect(items.map((i) => i.id)).toEqual(source.map((i) => i.id));
  });
});
