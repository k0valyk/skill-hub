import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import {
  Bot,
  Boxes,
  Coins,
  MessageSquareQuote,
  Package,
  Palette,
  Plug,
  Server,
  Sparkles,
  Terminal,
} from "lucide-react";
import type { Kind, RiskLevel } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useT } from "@/store";

const ICONS: Record<Kind, typeof Sparkles> = {
  skill: Sparkles,
  plugin: Plug,
  agent: Bot,
  command: Terminal,
  "token-saver": Coins,
  mcp: Server,
  prompt: MessageSquareQuote,
  theme: Palette,
  other: Package,
};

export function KindIcon({
  kind,
  className,
  size = 16,
}: {
  kind: Kind;
  className?: string;
  size?: number;
}) {
  const Icon = ICONS[kind] ?? Boxes;
  return <Icon size={size} className={className} strokeWidth={1.9} />;
}

export function KindBadge({ kind }: { kind: Kind }) {
  const t = useT();
  return (
    <span className="chip">
      <KindIcon kind={kind} size={12} />
      {t(`kind.${kind}.one` as TranslationKey)}
    </span>
  );
}

export function RiskDot({ level }: { level: RiskLevel | string }) {
  const t = useT();
  const color =
    level === "high"
      ? "var(--danger)"
      : level === "medium" || level === "low"
        ? "var(--warn)"
        : level === "clean"
          ? "var(--ok)"
          : "var(--faint)";
  const label =
    level === "high"
      ? t("card.riskHigh")
      : level === "medium"
        ? t("card.riskMedium")
        : level === "low"
          ? t("card.riskLow")
          : level === "clean"
            ? t("card.riskClean")
            : t("card.riskUnknown");
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color }}>
      <span
        className="inline-block size-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      {label}
    </span>
  );
}

export function BudgetBar({
  used,
  limit,
  level,
  compact = false,
}: {
  used: number;
  limit: number;
  level?: string;
  compact?: boolean;
}) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const tone =
    level === "over" ? "var(--danger)" : level === "warn" ? "var(--warn)" : "var(--accent)";
  return (
    <div className="w-full">
      <div
        className={cn("w-full overflow-hidden rounded-full bg-[var(--track)]", compact ? "h-1" : "h-1.5")}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${Math.max(ratio * 100, used > 0 ? 3 : 0)}%`,
            background: `linear-gradient(90deg, ${tone}, color-mix(in srgb, ${tone} 55%, white))`,
            boxShadow: `0 0 12px color-mix(in srgb, ${tone} 55%, transparent)`,
          }}
        />
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors duration-200",
        checked ? "border-transparent" : "border-[var(--line-strong)] bg-[var(--track)]",
        disabled && "opacity-50",
      )}
      style={
        checked
          ? { background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }
          : undefined
      }
    >
      <span
        className={cn(
          "inline-block size-[16px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-out",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="card-surface flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between text-[var(--muted)]">
        <span className="text-xs font-medium">{label}</span>
        {icon}
      </div>
      <div className="text-[22px] font-semibold tracking-tight">{value}</div>
      {hint ? <div className="text-[11.5px] text-[var(--faint)]">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="relative flex size-24 items-center justify-center">
        <div
          className="absolute inset-0 rounded-[32px] opacity-30 blur-2xl"
          style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}
        />
        <div className="card-surface float-slow relative flex size-20 items-center justify-center rounded-[26px]">
          <Boxes size={34} strokeWidth={1.4} style={{ color: "var(--accent)" }} />
        </div>
        <span
          className="pulse-ring absolute inset-2 rounded-full border"
          style={{ borderColor: "var(--accent)" }}
        />
      </div>
      <div className="max-w-sm space-y-1.5">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <p className="text-[12.5px] leading-relaxed text-[var(--muted)]">{text}</p>
      </div>
      {action}
    </div>
  );
}

/** Закриває модалку/drawer по Escape, якщо вона відкрита. */
export function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}

/** Тримає Tab у межах діалогу й повертає фокус на тригер після закриття. */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(active: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!node.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [active]);
  return ref;
}
