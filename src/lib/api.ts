import { mockCall } from "./mock";

export const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? "Невідома помилка");
}

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw new Error(normalizeError(error));
    }
  }
  try {
    return await mockCall<T>(command, args);
  } catch (error) {
    throw new Error(normalizeError(error));
  }
}

type Unlisten = () => void;

export async function onEvent<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<Unlisten> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (payload) => handler(payload.payload));
}

export function errorText(error: unknown): string {
  return normalizeError(error);
}
