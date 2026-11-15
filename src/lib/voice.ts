export type VoiceLang = "uk-UA" | "ru-RU" | "en-US" | string;

const VOICE_KEY = "skillhub.voiceAgents";
const AUTO_SEND_KEY = "skillhub.voiceAutoSend";

export function speechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function getAgentVoice(id: string): boolean {
  try {
    const raw = localStorage.getItem(VOICE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    return Boolean(map[id]);
  } catch {
    return false;
  }
}

export function setAgentVoice(id: string, enabled: boolean) {
  try {
    const raw = localStorage.getItem(VOICE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    map[id] = enabled;
    localStorage.setItem(VOICE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage може бути недоступним */
  }
}

export function getVoiceAutoSend(): boolean {
  try {
    return localStorage.getItem(AUTO_SEND_KEY) === "1";
  } catch {
    return false;
  }
}

export function setVoiceAutoSend(enabled: boolean) {
  try {
    localStorage.setItem(AUTO_SEND_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
    window.setTimeout(finish, 700);
  });
  return voicesReady;
}

export function pickVoice(voices: SpeechSynthesisVoice[], lang: VoiceLang) {
  const normalized = lang.toLowerCase();
  const base = normalized.split("-")[0];
  return (
    voices.find((voice) => voice.lang.toLowerCase() === normalized) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(base)) ??
    voices.find((voice) => voice.default) ??
    voices[0] ??
    null
  );
}

export function compressVoiceText(input: string): string {
  let text = input.trim();
  if (!text) return "";
  text = text.replace(
    /(?<![\p{L}\p{N}])(ну|типу|типа|як\s+би|как\s+бы|ось|вот|значить|значит|коротше|короче|взагалі|вообще|просто|просто-напросто|um+|uh+|like|you\s+know|basically|actually)(?![\p{L}\p{N}])[,]?\s*/giu,
    " ",
  );
  text = text.replace(/(?<![\p{L}\p{N}])([\p{L}\p{N}]+)(?:\s+\1)+(?![\p{L}\p{N}])/giu, "$1");
  text = text.replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1");
  return text.trim();
}

function stripCodeAndNoise(input: string) {
  let text = input;
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/~~~[\s\S]*?~~~/g, " ");
  text = text.replace(/`[^`\n]+`/g, " ");
  text = text.replace(/https?:\/\/\S+/g, " ");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.split("\n").filter((line) => {
    const pipes = (line.match(/\|/g) ?? []).length;
    if (pipes >= 2) return false;
    if (/^\s*[-*+]\s+/.test(line)) return false;
    if (/^\s*\d+[.)]\s+/.test(line)) return false;
    if (/^\s*#{1,6}\s/.test(line)) return false;
    if (/^\s*!\[/.test(line)) return false;
    return true;
  }).join(" ");
  text = text
    .replace(/[*_~#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

export function prepareSpeech(input: string, economical: boolean): string {
  const original = input.trim();
  if (!original) return "";
  const cleaned = stripCodeAndNoise(original);
  if (cleaned.length < 24 && original.length > 160) return "";
  if (!economical) return cleaned.slice(0, 2000);
  const sentences = cleaned.match(/[^.!?…]+[.!?…]+/g) ?? [cleaned];
  return sentences
    .slice(0, 3)
    .map((sentence) => sentence.trim())
    .join(" ")
    .trim()
    .slice(0, 700);
}

export async function speak(
  text: string,
  lang: VoiceLang,
  economical: boolean,
  handlers?: { onStart?: () => void; onEnd?: () => void },
): Promise<boolean> {
  if (!speechSupported()) return false;
  const spoken = prepareSpeech(text, economical);
  if (!spoken) return false;
  const voices = await loadVoices();
  const voice = pickVoice(voices, lang);
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(spoken);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = lang;
  }
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.onstart = () => handlers?.onStart?.();
  utterance.onend = () => handlers?.onEnd?.();
  utterance.onerror = () => handlers?.onEnd?.();
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking() {
  if (speechSupported()) window.speechSynthesis.cancel();
}

export function estimateVoiceTokens(text: string): number {
  return Math.max(0, Math.ceil(text.trim().length / 4));
}
