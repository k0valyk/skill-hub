import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Github,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Upload,
  X,
} from "lucide-react";
import type { ProjectInfo, PublishPlan } from "@/lib/types";
import { cn, formatBytes, relativeDate } from "@/lib/utils";
import { useApp, useT } from "@/store";

const STATUS_TONE: Record<string, { color: string; key: string }> = {
  clean: { color: "var(--ok)", key: "projects.statusClean" },
  changes: { color: "var(--warn)", key: "projects.statusChanges" },
  conflict: { color: "var(--danger)", key: "projects.statusConflict" },
  "no-repo": { color: "var(--faint)", key: "projects.statusNoRepo" },
  error: { color: "var(--danger)", key: "projects.statusError" },
};

export function Projects() {
  const t = useT();
  const lang = useApp((state) => state.settings?.language ?? "uk");
  const projects = useApp((state) => state.projects);
  const loading = useApp((state) => state.projectsLoading);
  const loadProjects = useApp((state) => state.loadProjects);
  const syncProject = useApp((state) => state.syncProject);
  const initProject = useApp((state) => state.initProject);
  const openPath = useApp((state) => state.openPath);
  const settings = useApp((state) => state.settings);

  const [publishTarget, setPublishTarget] = useState<ProjectInfo | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  return (
    <div className="scroll-area h-full px-7 pb-10">
      <div className="mx-auto max-w-[900px] space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn !py-1.5 text-[11.5px]" onClick={() => void loadProjects()}>
            <RefreshCw size={12} className={loading ? "spin-slow" : undefined} />
            {t("common.refresh")}
          </button>
          <button className="btn !py-1.5 text-[11.5px]" onClick={() => setCreating((value) => !value)}>
            <Plus size={12} />
            {t("profiles.create")}
          </button>
          <button
            className="btn !py-1.5 text-[11.5px]"
            onClick={() => void openPath(`${settings?.root ?? ""}\\projects`)}
          >
            <FolderOpen size={12} />
            {t("projects.openFolder")}
          </button>
          <span className="ml-auto text-[11px] text-[var(--faint)]">{projects.length}</span>
        </div>

        <AnimatePresence>
          {creating ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="card-surface flex items-center gap-2 p-3">
                <input
                  className="input h-[32px] flex-1 text-[12px]"
                  value={newName}
                  placeholder="my-new-project"
                  autoFocus
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newName.trim()) {
                      void initProject(newName.trim());
                      setNewName("");
                      setCreating(false);
                    }
                  }}
                />
                <button
                  className="btn btn-primary !py-1.5 text-[11.5px]"
                  disabled={!newName.trim()}
                  onClick={async () => {
                    await initProject(newName.trim());
                    setNewName("");
                    setCreating(false);
                  }}
                >
                  <Plus size={12} />
                  {t("common.add")}
                </button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {projects.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 text-center">
            <FolderGit2 size={32} strokeWidth={1.4} style={{ color: "var(--accent)" }} />
            <div>
              <h3 className="text-[14px] font-semibold">{t("projects.noProjects")}</h3>
              <p className="mt-1 max-w-sm text-[11.5px] leading-relaxed text-[var(--faint)]">
                {t("projects.noProjectsHint")}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-2.5 md:grid-cols-2">
            {projects.map((project, index) => {
              const tone = STATUS_TONE[project.status] ?? STATUS_TONE.error;
              return (
                <motion.div
                  key={project.path}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: Math.min(index * 0.04, 0.2) }}
                  className="card-surface space-y-2.5 p-3.5"
                >
                  <div className="flex items-start gap-2">
                    <div
                      className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-[var(--line)]"
                      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                    >
                      <FolderGit2 size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[13px] font-semibold">{project.name}</h3>
                      <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--faint)]">
                        <span className="inline-flex items-center gap-1" style={{ color: tone.color }}>
                          <span
                            className="size-1.5 rounded-full"
                            style={{ background: tone.color }}
                          />
                          {t(tone.key as Parameters<typeof t>[0])}
                        </span>
                        {project.isRepo ? (
                          <>
                            <span>·</span>
                            <GitBranch size={9} />
                            <span className="mono">{project.branch}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {project.remote ? (
                    <div className="mono truncate text-[10px] text-[var(--faint)]">{project.remote}</div>
                  ) : (
                    <div className="text-[10.5px] text-[var(--faint)]">{t("projects.emptyRemote")}</div>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5">
                    {project.languages.map((language) => (
                      <span key={language} className="chip !py-0.5 !text-[9.5px]">
                        {language}
                      </span>
                    ))}
                    {project.dirtyCount > 0 ? (
                      <span className="chip !py-0.5 !text-[9.5px]" style={{ color: "var(--warn)" }}>
                        {project.dirtyCount} · {t("projects.statusChanges").toLowerCase()}
                      </span>
                    ) : null}
                    {project.behind > 0 ? (
                      <span className="chip !py-0.5 !text-[9.5px]">↓ {project.behind}</span>
                    ) : null}
                    {project.ahead > 0 ? (
                      <span className="chip !py-0.5 !text-[9.5px]">↑ {project.ahead}</span>
                    ) : null}
                  </div>

                  {project.lastCommit ? (
                    <div className="truncate text-[10.5px] text-[var(--muted)]">
                      <span className="text-[var(--faint)]">{t("projects.lastCommit")}: </span>
                      {project.lastCommit}
                      {project.lastCommitAt ? (
                        <span className="text-[var(--faint)]"> · {relativeDate(project.lastCommitAt, lang)}</span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="flex items-center gap-1.5 border-t border-[var(--line)] pt-2">
                    <button
                      className="btn !py-1 text-[10.5px]"
                      onClick={() => void openPath(project.path)}
                    >
                      <FolderOpen size={11} />
                      {t("projects.openFolder")}
                    </button>
                    <button
                      className="btn !py-1 text-[10.5px]"
                      disabled={!project.isRepo}
                      onClick={() => void syncProject(project.path)}
                    >
                      <RefreshCw size={11} />
                      {t("projects.sync")}
                    </button>
                    <button
                      className="btn btn-primary ml-auto !py-1 text-[10.5px]"
                      onClick={() => setPublishTarget(project)}
                    >
                      <Upload size={11} />
                      {t("projects.publish")}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <PublishDialog project={publishTarget} onClose={() => setPublishTarget(null)} />
    </div>
  );
}

function PublishDialog({ project, onClose }: { project: ProjectInfo | null; onClose: () => void }) {
  const t = useT();
  const loadPlan = useApp((state) => state.loadPlan);
  const publishProject = useApp((state) => state.publishProject);
  const pushToast = useApp((state) => state.pushToast);
  const secretsSet = useApp((state) => state.secrets.githubToken);

  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [allowSecrets, setAllowSecrets] = useState(false);
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDescription("");
    setMessage("");
    setIsPrivate(true);
    setAllowSecrets(false);
    setConfirmPublic(false);
    setPlan(null);
    setPlanning(true);
    void (async () => {
      const result = await loadPlan(project.path);
      setPlan(result);
      if (result) {
        setMessage(result.defaultMessage);
        if (!result.isRepo) setMessage(result.defaultMessage);
      }
      setPlanning(false);
    })();
  }, [project, loadPlan]);

  const canPublish =
    plan !== null &&
    name.trim().length > 0 &&
    !publishing &&
    (isPrivate || confirmPublic) &&
    (plan.secrets.length === 0 || allowSecrets);

  return (
    <AnimatePresence>
      {project ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6 pt-[8vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="fixed inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="card-surface relative z-10 flex max-h-[84vh] w-full max-w-[620px] flex-col overflow-hidden"
          >
            <header className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                  <Github size={15} />
                  {t("projects.publishTitle")}
                </h2>
                <p className="mt-0.5 text-[11.5px] text-[var(--faint)]">{t("projects.publishHint")}</p>
              </div>
              <button className="btn btn-ghost !p-2" onClick={onClose}>
                <X size={16} />
              </button>
            </header>

            <div className="scroll-area flex-1 space-y-3 px-5 py-4">
              {!secretsSet ? (
                <div className="flex items-center gap-2 rounded-[10px] border border-[var(--warn)]/35 bg-[var(--warn)]/8 px-3 py-2 text-[11.5px]">
                  <AlertTriangle size={13} style={{ color: "var(--warn)" }} />
                  {t("settings.githubNotConnected")}
                </div>
              ) : null}

              {planning ? (
                <div className="flex min-h-[160px] flex-col items-center justify-center gap-2">
                  <Loader2 size={20} className="spin-slow" style={{ color: "var(--accent)" }} />
                  <span className="text-[11.5px] text-[var(--faint)]">{t("projects.generating")}</span>
                </div>
              ) : plan ? (
                <>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="label">{t("projects.repoName")}</span>
                      <input
                        className="input h-[32px] mono text-[11.5px]"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="label">{t("projects.commitMessage")}</span>
                      <input
                        className="input h-[32px] text-[11.5px]"
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                      />
                    </label>
                  </div>

                  <label className="space-y-1.5">
                    <span className="label">{t("profiles.description")}</span>
                    <input
                      className="input h-[32px] text-[11.5px]"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder={t("projects.publishHint")}
                    />
                  </label>

                  <div className="flex rounded-[10px] border border-[var(--line)] p-0.5">
                    {[
                      { value: true, label: t("projects.repoPrivate") },
                      { value: false, label: t("projects.repoPublic") },
                    ].map((option) => (
                      <button
                        key={String(option.value)}
                        onClick={() => setIsPrivate(option.value)}
                        className={cn(
                          "flex-1 rounded-[8px] px-2 py-1.5 text-[11.5px] font-medium transition-colors",
                          isPrivate === option.value
                            ? "bg-white/[0.08] text-[var(--text)]"
                            : "text-[var(--faint)] hover:text-[var(--text)]",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {!isPrivate ? (
                    <div className="space-y-2 rounded-[10px] border border-[var(--danger)]/35 bg-[var(--danger)]/8 px-3 py-2">
                      <div className="flex items-center gap-2 text-[11.5px] font-medium" style={{ color: "var(--danger)" }}>
                        <ShieldAlert size={13} />
                        {t("projects.repoPublicWarning")}
                      </div>
                      <label className="flex items-center gap-2 text-[11.5px]">
                        <input
                          type="checkbox"
                          checked={confirmPublic}
                          onChange={(event) => setConfirmPublic(event.target.checked)}
                        />
                        {t("projects.confirmPublic")}
                      </label>
                    </div>
                  ) : null}

                  <div className="rounded-[10px] border border-[var(--line)] bg-white/[0.02] px-3 py-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--faint)]">{t("projects.filesCount")}</span>
                      <span className="tabular-nums">{plan.files.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--faint)]">{t("projects.size")}</span>
                      <span className="tabular-nums">{formatBytes(plan.totalSize)}</span>
                    </div>
                    {plan.gitignoreCreated ? (
                      <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--ok)]">
                        <Check size={10} />
                        {t("projects.gitignore")}
                      </div>
                    ) : null}
                    <div className="mono mt-1 max-h-[110px] space-y-0.5 overflow-auto text-[10px] text-[var(--faint)]">
                      {plan.files.slice(0, 60).map((file) => (
                        <div key={file} className="truncate">
                          {file}
                        </div>
                      ))}
                      {plan.files.length > 60 ? <div>+{plan.files.length - 60}</div> : null}
                    </div>
                  </div>

                  {plan.secrets.length > 0 ? (
                    <div className="space-y-2 rounded-[10px] border border-[var(--danger)]/35 bg-[var(--danger)]/8 px-3 py-2">
                      <div className="flex items-center gap-2 text-[11.5px] font-medium" style={{ color: "var(--danger)" }}>
                        <ShieldAlert size={13} />
                        {t("projects.secretsFound")}
                      </div>
                      <div className="space-y-0.5">
                        {plan.secrets.map((secret, index) => (
                          <div key={`${secret.path}-${index}`} className="mono text-[10px] text-[var(--muted)]">
                            {secret.path}:{secret.line} — {secret.reason}
                          </div>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 text-[11px]">
                        <input
                          type="checkbox"
                          checked={allowSecrets}
                          onChange={(event) => setAllowSecrets(event.target.checked)}
                        />
                        {t("projects.allowSecrets")}
                      </label>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-[11.5px] text-[var(--danger)]">{t("preview.failed")}</p>
              )}
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3">
              <span className="text-[10.5px] text-[var(--faint)]">
                {plan?.branch ? (
                  <>
                    {t("projects.branch")}: <span className="mono">{plan.branch}</span>
                  </>
                ) : null}
              </span>
              <div className="flex gap-2">
                <button className="btn !py-1.5 text-[11.5px]" onClick={onClose}>
                  {t("common.cancel")}
                </button>
                <button
                  className="btn btn-primary !py-1.5 text-[11.5px]"
                  disabled={!canPublish}
                  onClick={async () => {
                    if (!project) return;
                    setPublishing(true);
                    const result = await publishProject({
                      path: project.path,
                      name: name.trim(),
                      private: isPrivate,
                      description,
                      message,
                      allowSecrets,
                      confirmPublic,
                    });
                    setPublishing(false);
                    if (result) {
                      pushToast(t("toast.copied"), "info");
                      onClose();
                    }
                  }}
                >
                  {publishing ? <Loader2 size={12} className="spin-slow" /> : <Upload size={12} />}
                  {publishing ? t("projects.publishing") : t("projects.publishNow")}
                </button>
              </div>
            </footer>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
