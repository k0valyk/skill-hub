import { describe, expect, it } from "vitest";
import { compressVoiceText, estimateVoiceTokens, prepareSpeech } from "./voice";

describe("compressVoiceText", () => {
  it("removes filler words and repeated words", () => {
    expect(compressVoiceText("Ну, типу, це це тест, як би, просто перевірка")).toBe(
      "це тест, перевірка",
    );
    expect(compressVoiceText("um, like, basically test test this")).toBe("test this");
  });

  it("collapses spaces and leaves normal text intact", () => {
    expect(compressVoiceText("  привіт   світ  ")).toBe("привіт світ");
    expect(compressVoiceText("")).toBe("");
  });
});

describe("prepareSpeech", () => {
  it("strips code blocks, tables and lists", () => {
    const text = [
      "Ось результат.",
      "```ts",
      "const secret = 1;",
      "```",
      "| a | b |",
      "| - | - |",
      "- пункт один",
      "- пункт два",
      "Кінець.",
    ].join("\n");
    const spoken = prepareSpeech(text, true);
    expect(spoken).not.toContain("const secret");
    expect(spoken).not.toContain("|");
    expect(spoken).not.toContain("пункт один");
    expect(spoken).toContain("Ось результат.");
    expect(spoken).toContain("Кінець.");
  });

  it("keeps only three sentences in economical mode", () => {
    const text = "Перше. Друге. Третє. Четверте. П'яте.";
    expect(prepareSpeech(text, true)).toBe("Перше. Друге. Третє.");
    expect(prepareSpeech(text, false)).toBe(text);
  });

  it("skips a response that is mostly code", () => {
    const code = "```ts\n" + "const value = 1;\n".repeat(40) + "```";
    expect(prepareSpeech(code, true)).toBe("");
  });
});

describe("estimateVoiceTokens", () => {
  it("estimates tokens from characters", () => {
    expect(estimateVoiceTokens("")).toBe(0);
    expect(estimateVoiceTokens("12345678")).toBe(2);
  });
});
