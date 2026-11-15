import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, TriangleAlert } from "lucide-react";
import { AddPreview } from "@/components/AddPreview";
import { Agents } from "@/components/Agents";
import { CommandPalette } from "@/components/CommandPalette";
import { DetailDrawer } from "@/components/DetailDrawer";
import { Discover } from "@/components/Discover";
import { LibraryView } from "@/components/LibraryView";
import { Projects } from "@/components/Projects";
import { Settings } from "@/components/Settings";
import { Sidebar } from "@/components/Sidebar";
import { Stats } from "@/components/Stats";
import { Toasts } from "@/components/Toasts";
import { TopBar } from "@/components/TopBar";
import { onEvent } from "@/lib/api";
import { applyAccent } from "@/lib/utils";
import { useApp, useT } from "@/store";

export default function App() {
  const ready = useApp((state) => state.ready);
  const fatal = useApp((state) => state.fatal);
  const startupError = useApp((state) => state.startupError);
  const settings = useApp((state) => state.settings);
  const view = useApp((state) => state.view);
  const bootstrap = useApp((state) => state.bootstrap);
  const refreshItems = useApp((state) => state.refreshItems);
  const focusAdd = useApp((state) => state.focusAdd);
  const setView = useApp((state) => state.setView);
  const pushToast = useApp((state) => state.pushToast);
  const setAgentActivity = useApp((state) => state.setAgentActivity);
  const finishAgentTask = useApp((state) => state.finishAgentTask);
  const t = useT();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    root.classList.toggle("light", settings.theme === "light");
    root.classList.toggle("dark", settings.theme !== "light");
    root.classList.toggle("reduce-motion", settings.reduceMotion);
    root.lang = settings.language === "en" ? "en" : "uk";
    applyAccent(settings.accent);
    if (settings.theme === "light") {
      window.setTimeout(() => applyAccent(settings.accent), 0);
    }
  }, [settings]);

  useEffect(() => {
    const offs: Array<() => void> = [];
    void onEvent("quick-add", () => {
      setView("library");
      focusAdd();
    }).then((off) => offs.push(off));
    void onEvent("library:changed", () => {
      void refreshItems();
    }).then((off) => offs.push(off));
    void onEvent<number>("updates:found", (count) => {
      if (count > 0) pushToast(t("toast.updatesFound", { n: count }), "info");
    }).then((off) => offs.push(off));
    void onEvent<{
      agentId: string;
      taskId: string;
      activity: string;
      waiting: boolean;
    }>("agent:activity", (payload) => setAgentActivity(payload)).then((off) => offs.push(off));
    void onEvent<{
      agentId: string;
      taskId: string;
      status: string;
      exitCode?: number | null;
      durationMs: number;
      tokensIn: number;
      tokensOut: number;
      costUsd: number;
    }>("agent:finished", (payload) => finishAgentTask(payload)).then((off) => offs.push(off));
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative flex size-16 items-center justify-center rounded-[20px] text-white shadow-xl"
          style={{ background: "linear-gradient(140deg, var(--accent), var(--accent-2))" }}
        >
          <Loader2 size={24} className="spin-slow" />
        </motion.div>
        <p className="text-[12px] text-[var(--faint)]">{t("common.loading")}</p>
      </div>
    );
  }

  if (fatal) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <TriangleAlert size={30} style={{ color: "var(--danger)" }} />
        <div>
          <h1 className="text-[16px] font-semibold">{t("error.title")}</h1>
          <p className="mt-1 max-w-md text-[12px] leading-relaxed text-[var(--muted)]">{fatal}</p>
        </div>
        <button className="btn btn-primary" onClick={() => void bootstrap()}>
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="relative z-10 flex h-full overflow-hidden">
      <Sidebar />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <TopBar />

        {startupError ? (
          <div className="mx-7 mb-2 flex items-start gap-2 rounded-[10px] border border-[var(--warn)]/35 bg-[var(--warn)]/8 px-3 py-2 text-[11.5px]">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} />
            <span className="text-[var(--muted)]">
              {t("error.startup")}: {startupError}
            </span>
          </div>
        ) : null}

        <div className="min-h-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="h-full"
            >
              {view === "library" ? (
                <div className="scroll-area h-full">
                  <LibraryView />
                </div>
              ) : view === "discover" ? (
                <Discover />
              ) : view === "agents" ? (
                <Agents />
              ) : view === "projects" ? (
                <Projects />
              ) : view === "stats" ? (
                <Stats />
              ) : (
                <Settings />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <DetailDrawer />
      <AddPreview />
      <CommandPalette />
      <Toasts />
    </div>
  );
}
