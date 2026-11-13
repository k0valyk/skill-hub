import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  ChevronRight,
  Compass,
  FolderGit2,
  Layers,
  Library,
  Moon,
  Plus,
  Power,
  Settings as SettingsIcon,
  Star,
  Sun,
} from "lucide-react";
import { KIND_ORDER, cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n";
import { useApp, useT, type View } from "@/store";
import { BudgetBar, KindIcon } from "./common";
import { ProfileEditor } from "./ProfileEditor";

const NAV: { view: View; key: TranslationKey; icon: typeof Library }[] = [
  { view: "library", key: "nav.library", icon: Library },
  { view: "discover", key: "nav.discover", icon: Compass },
  { view: "projects", key: "nav.projects", icon: FolderGit2 },
  { view: "stats", key: "nav.stats", icon: BarChart3 },
];

export function Sidebar() {
  const t = useT();
  const view = useApp((state) => state.view);
  const setView = useApp((state) => state.setView);
  const kindFilter = useApp((state) => state.kindFilter);
  const setKindFilter = useApp((state) => state.setKindFilter);
  const items = useApp((state) => state.items);
  const profiles = useApp((state) => state.profiles);
  const applyProfile = useApp((state) => state.applyProfile);
  const budget = useApp((state) => state.budget);
  const settings = useApp((state) => state.settings);
  const saveSettings = useApp((state) => state.saveSettings);
  const [editorOpen, setEditorOpen] = useState(false);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item.kind, (map.get(item.kind) ?? 0) + 1);
    return map;
  }, [items]);

  const enabledCount = items.filter((item) => item.enabled).length;
  const favoriteCount = items.filter((item) => item.favorite).length;

  const toggleTheme = () => {
    if (!settings) return;
    void saveSettings({ ...settings, theme: settings.theme === "dark" ? "light" : "dark" });
  };

  const goKind = (kind: (typeof KIND_ORDER)[number]) => {
    setView("library");
    setKindFilter(kind);
  };

  return (
    <>
      <aside className="glass relative z-20 flex h-full w-[248px] shrink-0 flex-col border-r border-[var(--line)]">
        <div className="flex items-center gap-3 px-5 pb-5 pt-6">
          <div
            className="relative flex size-10 items-center justify-center rounded-[14px] text-white shadow-lg"
            style={{
              background: "linear-gradient(140deg, var(--accent), var(--accent-2))",
              boxShadow: "0 12px 26px -12px var(--accent)",
            }}
          >
            <Layers size={20} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight">{t("app.name")}</div>
            <div className="truncate text-[11px] text-[var(--faint)]">{t("app.tagline")}</div>
          </div>
        </div>

        <div className="scroll-area flex-1 px-3 pb-4">
          <nav className="space-y-0.5">
            {NAV.map(({ view: target, key, icon: Icon }) => {
              const active = view === target;
              return (
                <button
                  key={target}
                  onClick={() => setView(target)}
                  className={cn(
                    "group relative flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2 text-[13px] transition-colors",
                    active ? "text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]",
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-[11px] border border-[var(--line)] bg-white/[0.06]"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  ) : null}
                  <Icon size={16} strokeWidth={1.9} className="relative shrink-0" />
                  <span className="relative font-medium">{t(key)}</span>
                  {target === "library" ? (
                    <span className="relative ml-auto text-[11px] text-[var(--faint)]">
                      {items.length}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="my-4 divider" />

          <div className="space-y-0.5">
            <button
              onClick={() => {
                setView("library");
                setKindFilter("enabled");
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2 text-[13px] transition-colors",
                kindFilter === "enabled" && view === "library"
                  ? "bg-white/[0.06] text-[var(--text)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]",
              )}
            >
              <Power size={15} strokeWidth={1.9} style={{ color: "var(--ok)" }} />
              <span className="font-medium">{t("nav.enabled")}</span>
              <span className="ml-auto text-[11px] text-[var(--faint)]">{enabledCount}</span>
            </button>
            <button
              onClick={() => {
                setView("library");
                setKindFilter("favorites");
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2 text-[13px] transition-colors",
                kindFilter === "favorites" && view === "library"
                  ? "bg-white/[0.06] text-[var(--text)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]",
              )}
            >
              <Star size={15} strokeWidth={1.9} style={{ color: "var(--warn)" }} />
              <span className="font-medium">{t("nav.favorites")}</span>
              <span className="ml-auto text-[11px] text-[var(--faint)]">{favoriteCount}</span>
            </button>
          </div>

          <div className="mb-1.5 mt-5 flex items-center justify-between px-3">
            <span className="label">{t("nav.kinds")}</span>
            <span className="text-[10.5px] text-[var(--faint)]">{KIND_ORDER.length}</span>
          </div>
          <div className="space-y-0.5">
            {KIND_ORDER.map((kind) => {
              const count = counts.get(kind) ?? 0;
              const active = view === "library" && kindFilter === kind;
              return (
                <button
                  key={kind}
                  onClick={() => goKind(kind)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-[7px] text-[12.5px] transition-colors",
                    active
                      ? "bg-white/[0.06] text-[var(--text)]"
                      : "text-[var(--muted)] hover:bg-white/[0.035] hover:text-[var(--text)]",
                    count === 0 && "opacity-55",
                  )}
                >
                  <KindIcon kind={kind} size={14} />
                  <span className="font-medium">{t(`kind.${kind}` as TranslationKey)}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-[var(--faint)]">{count}</span>
                  <ChevronRight
                    size={12}
                    className={cn("transition-transform", active ? "opacity-100" : "opacity-0")}
                  />
                </button>
              );
            })}
          </div>

          <div className="mb-1.5 mt-5 flex items-center justify-between px-3">
            <span className="label">{t("nav.profiles")}</span>
            <button
              onClick={() => setEditorOpen(true)}
              className="rounded-md p-1 text-[var(--faint)] transition-colors hover:bg-white/6 hover:text-[var(--text)]"
              title={t("profiles.create")}
            >
              <Plus size={13} />
            </button>
          </div>
          <div className="space-y-1">
            {profiles.length === 0 ? (
              <p className="px-3 text-[11.5px] leading-relaxed text-[var(--faint)]">
                {t("profiles.empty")}
              </p>
            ) : (
              profiles.map((profile) => (
                <div
                  key={profile.id}
                  className="group flex items-center gap-2 rounded-[10px] px-3 py-1.5 transition-colors hover:bg-white/[0.04]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium">{profile.name}</div>
                    <div className="truncate text-[10.5px] text-[var(--faint)]">
                      {profile.itemIds.length} · {profile.description || t("profiles.items")}
                    </div>
                  </div>
                  <button
                    onClick={() => void applyProfile(profile.id)}
                    className="rounded-md p-1 text-[var(--faint)] opacity-0 transition-all hover:text-[var(--accent)] group-hover:opacity-100"
                    title={t("profiles.apply")}
                  >
                    <Power size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border-t border-[var(--line)] px-3 py-3">
          <button
            onClick={() => setView("settings")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2 text-[13px] transition-colors",
              view === "settings"
                ? "bg-white/[0.06] text-[var(--text)]"
                : "text-[var(--muted)] hover:text-[var(--text)]",
            )}
          >
            <SettingsIcon size={16} strokeWidth={1.9} />
            <span className="font-medium">{t("nav.settings")}</span>
          </button>

          {budget ? (
            <div className="card-surface mt-2 space-y-2 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-[var(--muted)]">
                  {t("nav.budget")}
                </span>
                <span
                  className="text-[10.5px] tabular-nums"
                  style={{
                    color:
                      budget.level === "over"
                        ? "var(--danger)"
                        : budget.level === "warn"
                          ? "var(--warn)"
                          : "var(--faint)",
                  }}
                >
                  {budget.advertisedTokens} / {budget.threshold}
                </span>
              </div>
              <BudgetBar
                used={budget.advertisedTokens}
                limit={budget.threshold}
                level={budget.level}
                compact
              />
              <div className="text-[10.5px] text-[var(--faint)]">
                {budget.enabledCount} · {t("nav.enabled").toLowerCase()}
              </div>
            </div>
          ) : null}

          <button
            onClick={toggleTheme}
            className="mt-1 flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2 text-[12.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)]"
          >
            {settings?.theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
            {settings?.theme === "light" ? t("settings.dark") : t("settings.light")}
          </button>
        </div>
      </aside>

      <ProfileEditor open={editorOpen} onClose={() => setEditorOpen(false)} />
    </>
  );
}
