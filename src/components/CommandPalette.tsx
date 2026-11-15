import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  Bot,
  Compass,
  Download,
  FolderGit2,
  Library,
  Link2,
  Moon,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
} from "lucide-react";
import { cn, itemSummary } from "@/lib/utils";
import { useApp, useT } from "@/store";
import { KindIcon, useFocusTrap } from "./common";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const t = useT();
  const open = useApp((state) => state.paletteOpen);
  const setPalette = useApp((state) => state.setPalette);
  const setView = useApp((state) => state.setView);
  const items = useApp((state) => state.items);
  const selectItem = useApp((state) => state.selectItem);
  const focusAdd = useApp((state) => state.focusAdd);
  const refreshItems = useApp((state) => state.refreshItems);
  const checkUpdates = useApp((state) => state.checkUpdates);
  const exportLibrary = useApp((state) => state.exportLibrary);
  const connectOpencode = useApp((state) => state.connectOpencode);
  const loadFeed = useApp((state) => state.loadFeed);
  const settings = useApp((state) => state.settings);
  const saveSettings = useApp((state) => state.saveSettings);
  const lang = settings?.language ?? "uk";

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      {
        id: "nav.library",
        label: t("nav.library"),
        group: t("palette.nav"),
        icon: <Library size={14} />,
        run: () => setView("library"),
      },
      {
        id: "nav.discover",
        label: t("nav.discover"),
        group: t("palette.nav"),
        icon: <Compass size={14} />,
        run: () => setView("discover"),
      },
      {
        id: "nav.agents",
        label: t("nav.agents"),
        group: t("palette.nav"),
        icon: <Bot size={14} />,
        run: () => setView("agents"),
      },
      {
        id: "nav.projects",
        label: t("nav.projects"),
        group: t("palette.nav"),
        icon: <FolderGit2 size={14} />,
        run: () => setView("projects"),
      },
      {
        id: "nav.stats",
        label: t("nav.stats"),
        group: t("palette.nav"),
        icon: <BarChart3 size={14} />,
        run: () => setView("stats"),
      },
      {
        id: "nav.settings",
        label: t("nav.settings"),
        group: t("palette.nav"),
        icon: <SettingsIcon size={14} />,
        run: () => setView("settings"),
      },
    ];

    const actions: Command[] = [
      {
        id: "act.add",
        label: t("palette.actionAdd"),
        group: t("palette.actions"),
        icon: <Sparkles size={14} />,
        run: () => {
          setView("library");
          focusAdd();
        },
      },
      {
        id: "act.scan",
        label: t("palette.actionScan"),
        group: t("palette.actions"),
        icon: <RefreshCw size={14} />,
        run: () => void refreshItems(),
      },
      {
        id: "act.updates",
        label: t("palette.actionUpdates"),
        group: t("palette.actions"),
        icon: <Download size={14} />,
        run: () => void checkUpdates(),
      },
      {
        id: "act.export",
        label: t("palette.actionExport"),
        group: t("palette.actions"),
        icon: <Library size={14} />,
        run: () => void exportLibrary(),
      },
      {
        id: "act.connect",
        label: t("palette.actionConnect"),
        group: t("palette.actions"),
        icon: <Link2 size={14} />,
        run: () => void connectOpencode("global"),
      },
      {
        id: "act.feed",
        label: t("palette.actionFeed"),
        group: t("palette.actions"),
        icon: <Compass size={14} />,
        run: () => {
          setView("discover");
          void loadFeed(true);
        },
      },
      {
        id: "act.theme",
        label: t("palette.actionTheme"),
        group: t("palette.actions"),
        icon: settings?.theme === "light" ? <Moon size={14} /> : <Sun size={14} />,
        run: () => {
          if (!settings) return;
          void saveSettings({ ...settings, theme: settings.theme === "dark" ? "light" : "dark" });
        },
      },
      {
        id: "act.stats",
        label: t("palette.actionStats"),
        group: t("palette.actions"),
        icon: <BarChart3 size={14} />,
        run: () => setView("stats"),
      },
    ];

    const itemCommands: Command[] = items.map((item) => ({
      id: `item.${item.id}`,
      label: item.name,
      hint: itemSummary(item, lang),
      group: t("palette.items"),
      icon: <KindIcon kind={item.kind} size={14} />,
      run: () => {
        setView("library");
        selectItem(item.id);
      },
    }));

    return [...nav, ...actions, ...itemCommands];
  }, [
    t,
    items,
    lang,
    setView,
    focusAdd,
    refreshItems,
    checkUpdates,
    exportLibrary,
    connectOpencode,
    loadFeed,
    settings,
    saveSettings,
    selectItem,
  ]);

  const filtered = useMemo(() => {
    const value = deferredQuery.trim().toLowerCase();
    if (!value) return commands.slice(0, 40);
    return commands
      .filter((command) =>
        `${command.label} ${command.hint ?? ""} ${command.group}`.toLowerCase().includes(value),
      )
      .slice(0, 40);
  }, [commands, deferredQuery]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    element?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        (event.code === "KeyK" || event.key.toLowerCase() === "k")
      ) {
        event.preventDefault();
        setPalette(!useApp.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setPalette]);

  useEffect(() => {
    if (!open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPalette(false);
      }
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = previous;
      previousFocus?.focus?.();
    };
  }, [open, setPalette]);

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  const run = (command?: Command) => {
    if (!command) return;
    setPalette(false);
    command.run();
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center p-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setPalette(false)} />
          <motion.div
            ref={trapRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("top.palette")}
            initial={{ opacity: 0, y: -12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="card-surface relative z-10 flex max-h-[560px] w-full max-w-[600px] flex-col overflow-hidden"
          >
            <div className="flex items-center gap-2.5 border-b border-[var(--line)] px-4 py-3">
              <Search size={15} className="shrink-0 text-[var(--faint)]" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setIndex((current) => Math.min(current + 1, filtered.length - 1));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setIndex((current) => Math.max(current - 1, 0));
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    run(filtered[index]);
                  }
                  if (event.key === "Escape") setPalette(false);
                }}
                placeholder={t("palette.placeholder")}
                className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[var(--faint)]"
              />
              <span className="chip !py-0.5 !text-[9.5px]">Esc</span>
            </div>

            <div ref={listRef} className="scroll-area flex-1 px-2 py-2">
              {filtered.length === 0 ? (
                <p className="px-3 py-8 text-center text-[12px] text-[var(--faint)]">
                  {t("palette.noResults")}
                </p>
              ) : (
                filtered.map((command, position) => {
                  const showGroup = position === 0 || filtered[position - 1].group !== command.group;
                  return (
                    <div key={command.id}>
                      {showGroup ? (
                        <div className="px-3 pb-1 pt-2.5 text-[9.5px] font-semibold uppercase tracking-widest text-[var(--faint)]">
                          {command.group}
                        </div>
                      ) : null}
                      <button
                        data-index={position}
                        onMouseMove={() => setIndex(position)}
                        onClick={() => run(command)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-left transition-colors",
                          position === index ? "bg-[var(--active)] text-[var(--text)]" : "text-[var(--muted)]",
                        )}
                      >
                        <span
                          className="shrink-0"
                          style={{ color: position === index ? "var(--accent)" : "var(--faint)" }}
                        >
                          {command.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium">{command.label}</span>
                          {command.hint ? (
                            <span className="block truncate text-[10.5px] text-[var(--faint)]">
                              {command.hint}
                            </span>
                          ) : null}
                        </span>
                        {position === index ? (
                          <span className="mono shrink-0 text-[9.5px] text-[var(--faint)]">↵</span>
                        ) : null}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-[var(--line)] px-4 py-2 text-[9.5px] text-[var(--faint)]">
              <span>{t("palette.hintNav")}</span>
              <span>{t("palette.hintOpen")}</span>
              <span>{t("palette.hintClose")}</span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
