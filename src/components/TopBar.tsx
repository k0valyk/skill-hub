import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ClipboardList,
  Command,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp, useT } from "@/store";

const TITLES: Record<string, { title: string; subtitle: string }> = {
  library: { title: "library.title", subtitle: "app.tagline" },
  discover: { title: "discover.title", subtitle: "discover.subtitle" },
  agents: { title: "agents.title", subtitle: "agents.subtitle" },
  projects: { title: "projects.title", subtitle: "projects.subtitle" },
  stats: { title: "stats.title", subtitle: "stats.subtitle" },
  settings: { title: "settings.title", subtitle: "settings.subtitle" },
};

export function TopBar() {
  const t = useT();
  const view = useApp((state) => state.view);
  const query = useApp((state) => state.query);
  const setQuery = useApp((state) => state.setQuery);
  const layout = useApp((state) => state.layout);
  const setLayout = useApp((state) => state.setLayout);
  const sort = useApp((state) => state.sort);
  const setSort = useApp((state) => state.setSort);
  const analyze = useApp((state) => state.analyze);
  const analyzeBatch = useApp((state) => state.analyzeBatch);
  const refreshItems = useApp((state) => state.refreshItems);
  const itemsCount = useApp((state) => state.items.length);
  const scanning = useApp((state) => state.scanning);
  const addFocus = useApp((state) => state.addFocus);
  const setPalette = useApp((state) => state.setPalette);

  const [url, setUrl] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addFocus > 0) inputRef.current?.focus();
  }, [addFocus]);

  const submit = async () => {
    if (!url.trim()) return;
    const value = url.trim();
    setUrl("");
    await analyze(value);
  };

  const submitBatch = async () => {
    if (!batchText.trim()) return;
    const value = batchText;
    setBatchText("");
    setBatchOpen(false);
    await analyzeBatch(value);
  };

  const meta = TITLES[view] ?? TITLES.library;
  const showLibraryControls = view === "library";
  const showAddBar = view !== "agents";

  return (
    <header className="relative z-10 shrink-0 px-7 pb-3 pt-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[21px] font-semibold tracking-tight">
            {t(meta.title as Parameters<typeof t>[0])}
          </h1>
          <p className="mt-0.5 truncate text-[12px] text-[var(--faint)]">
            {t(meta.subtitle as Parameters<typeof t>[0])}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {showLibraryControls ? (
            <div className="relative hidden md:block">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("top.searchPlaceholder")}
                className="input w-[260px] pl-8"
              />
              {query ? (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--faint)] hover:text-[var(--text)]"
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
          ) : null}
          <button
            onClick={() => setPalette(true)}
            className="btn hidden items-center gap-1.5 !px-2.5 !py-2 text-[var(--muted)] sm:flex"
            title={t("top.palette")}
          >
            <Command size={14} />
            <span className="mono text-[10.5px]">K</span>
          </button>
        </div>
      </div>

      {showAddBar ? (
        <>
      <div className="mt-4 flex items-center gap-2">
        <div className="group relative flex flex-1 items-center">
          <Sparkles
            size={15}
            className="pointer-events-none absolute left-3.5 text-[var(--faint)] transition-colors group-focus-within:text-[var(--accent)]"
          />
          <input
            ref={inputRef}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder={t("top.addPlaceholder")}
            className="input h-[42px] flex-1 pl-10 pr-[130px]"
          />
          <button
            onClick={() => void submit()}
            disabled={!url.trim()}
            className="btn btn-primary absolute right-1.5 !h-[32px] !py-0"
          >
            <Sparkles size={13} />
            {t("top.analyze")}
          </button>
        </div>
        <button
          onClick={() => setBatchOpen((open) => !open)}
          className={cn("btn !h-[42px]", batchOpen && "border-[var(--accent)] text-[var(--text)]")}
          title={t("top.batchHint")}
        >
          <ClipboardList size={15} />
          <span className="hidden lg:inline">{t("top.batch")}</span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {batchOpen ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="card-surface mt-2 space-y-2 p-3">
              <textarea
                value={batchText}
                onChange={(event) => setBatchText(event.target.value)}
                placeholder={t("top.batchHint")}
                rows={4}
                className="input resize-none font-mono text-[12px]"
                autoFocus
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[var(--faint)]">{t("top.batchHint")}</span>
                <div className="flex gap-2">
                  <button className="btn !py-1.5" onClick={() => setBatchOpen(false)}>
                    {t("common.cancel")}
                  </button>
                  <button
                    className="btn btn-primary !py-1.5"
                    disabled={!batchText.trim()}
                    onClick={() => void submitBatch()}
                  >
                    {t("top.analyze")}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
        </>
      ) : null}

      {showLibraryControls ? (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11.5px] text-[var(--faint)]">
            {t("library.count", { n: itemsCount })}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              className="input h-[30px] w-auto !py-0 text-[11.5px]"
              title={t("top.sort")}
            >
              <option value="recent">{t("top.sortRecent")}</option>
              <option value="name">{t("top.sortName")}</option>
              <option value="stars">{t("top.sortStars")}</option>
              <option value="size">{t("top.sortSize")}</option>
            </select>
            <div className="flex rounded-[10px] border border-[var(--line)] p-0.5">
              <button
                onClick={() => setLayout("grid")}
                className={cn(
                  "rounded-[8px] p-1.5 transition-colors",
                  layout === "grid"
                    ? "bg-[var(--active)] text-[var(--text)]"
                    : "text-[var(--faint)] hover:text-[var(--text)]",
                )}
                title={t("top.grid")}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => setLayout("list")}
                className={cn(
                  "rounded-[8px] p-1.5 transition-colors",
                  layout === "list"
                    ? "bg-[var(--active)] text-[var(--text)]"
                    : "text-[var(--faint)] hover:text-[var(--text)]",
                )}
                title={t("top.list")}
              >
                <List size={14} />
              </button>
            </div>
            <button
              onClick={() => void refreshItems()}
              disabled={scanning}
              className="btn !h-[30px] !px-2.5 !py-0 text-[11.5px]"
              title={t("top.scan")}
            >
              <RefreshCw size={13} className={scanning ? "spin-fast" : undefined} />
              <span className="hidden lg:inline">{scanning ? t("top.scanning") : t("top.scan")}</span>
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
