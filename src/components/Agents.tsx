import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Clock,
  Coins,
  Download,
  FileText,
  FlaskConical,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  Mic,
  Network,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { isTauri } from "@/lib/api";
import type { Agent, AgentTask } from "@/lib/types";
import {
  compressVoiceText,
  estimateVoiceTokens,
  getAgentVoice,
  getVoiceAutoSend,
  setAgentVoice,
  setVoiceAutoSend,
  speechSupported,
  stopSpeaking,
} from "@/lib/voice";
import { cn, formatNumber, relativeDate } from "@/lib/utils";
import { useApp, useT } from "@/store";
import { AgentQaCycle } from "./AgentQaCycle";
import { KindIcon, Toggle, useEscape, useFocusTrap } from "./common";

const STATUS_FILTERS = ["all", "idle", "working", "waiting", "error", "disabled"] as const;

function iconParts(icon: string) {
  if (icon.startsWith("img:")) {
    return { image: icon.slice(4), emoji: "🖼️", color: "#8b7cff" };
  }
  const [emoji, color] = icon.split("|");
  return { image: null as string | null, emoji: emoji || "🤖", color: color || "#8b7cff" };
}

function AgentIcon({ icon, size = 40 }: { icon: string; size?: number }) {
  const parts = iconParts(icon);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (parts.image) {
      if (!isTauri) {
        setSrc(parts.image);
      } else {
        void import("@tauri-apps/api/core").then(({ convertFileSrc }) => {
          if (active) setSrc(convertFileSrc(parts.image as string));
        });
      }
    } else {
      setSrc(null);
    }
    return () => {
      active = false;
    };
  }, [parts.image]);
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-[13px] border border-[var(--line)] text-[20px]"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(140deg, ${parts.color}33, ${parts.color}12)`,
        color: parts.color,
      }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span>{parts.emoji}</span>
      )}
    </div>
  );
}

function statusTone(status: string, enabled: boolean) {
  if (!enabled) return "var(--faint)";
  if (status === "working") return "var(--accent)";
  if (status === "waiting") return "var(--warn)";
  if (status === "error") return "var(--danger)";
  return "var(--ok)";
}

function StatusDot({ agent }: { agent: Agent }) {
  const t = useT();
  const color = statusTone(agent.status, agent.enabled);
  const key = !agent.enabled
    ? "agents.statusDisabled"
    : agent.status === "working"
      ? "agents.statusWorking"
      : agent.status === "waiting"
        ? "agents.statusWaiting"
        : agent.status === "error"
          ? "agents.statusError"
          : "agents.statusIdle";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10.5px]" style={{ color }}>
      <span className="relative flex size-2 items-center justify-center">
        {agent.enabled && agent.status === "working" ? (
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ background: color }}
            animate={{ scale: [1, 2.1], opacity: [0.55, 0] }}
            transition={{ repeat: Infinity, duration: 1.6, ease: "easeOut" }}
          />
        ) : null}
        <span className="size-1.5 rounded-full" style={{ background: color }} />
      </span>
      {t(key as Parameters<typeof t>[0])}
    </span>
  );
}

function permissionTone(effect: string) {
  if (effect === "deny") return "var(--danger)";
  if (effect === "ask") return "var(--warn)";
  return "var(--ok)";
}

function formatDuration(ms: number, lang: "uk" | "en" = "uk") {
  if (!ms) return "—";
  if (lang === "en") {
    if (ms < 1000) return `${ms} ms`;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} min ${seconds % 60} s`;
  }
  if (ms < 1000) return `${ms} мс`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} хв ${seconds % 60} с`;
}

function taskTone(status: string) {
  if (status === "ok") return "var(--ok)";
  if (status === "error") return "var(--danger)";
  if (status === "running") return "var(--accent)";
  return "var(--faint)";
}

export function Agents() {
  const t = useT();
  const lang = useApp((state) => state.settings?.language ?? "uk");
  const agents = useApp((state) => state.agents);
  const loading = useApp((state) => state.agentsLoading);
  const agentActivity = useApp((state) => state.agentActivity);
  const runtime = useApp((state) => state.agentRuntime);
  const loadAgents = useApp((state) => state.loadAgents);
  const loadAgentTemplates = useApp((state) => state.loadAgentTemplates);
  const loadAgentRuntime = useApp((state) => state.loadAgentRuntime);
  const importAgent = useApp((state) => state.importAgent);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [project, setProject] = useState("all");
  const [skill, setSkill] = useState("all");
  const [layout, setLayout] = useState<"grid" | "graph">("grid");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const refreshRef = useRef(false);

  useEffect(() => {
    const refresh = async (background = true) => {
      if (refreshRef.current) return;
      refreshRef.current = true;
      try {
        await loadAgents(background);
      } finally {
        refreshRef.current = false;
      }
    };
    void refresh(false);
    void loadAgentTemplates();
    void loadAgentRuntime();
    const timer = window.setInterval(() => void refresh(true), 6000);
    return () => window.clearInterval(timer);
  }, [loadAgents, loadAgentTemplates, loadAgentRuntime]);

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const agent of agents) {
      for (const path of agent.projects) set.add(path);
      if (agent.projectPath) set.add(agent.projectPath);
    }
    return [...set].sort();
  }, [agents]);

  const skillOptions = useMemo(() => {
    const set = new Set<string>();
    for (const agent of agents) for (const id of agent.skills) set.add(id);
    return [...set];
  }, [agents]);

  const visible = useMemo(() => {
    const value = query.trim().toLowerCase();
    return agents.filter((agent) => {
      if (status === "disabled" && agent.enabled) return false;
      if (status !== "all" && status !== "disabled" && agent.status !== status) return false;
      if (project !== "all") {
        const paths = [...agent.projects, agent.projectPath ?? ""];
        if (!paths.some((path) => path === project)) return false;
      }
      if (skill !== "all" && !agent.skills.includes(skill)) return false;
      if (!value) return true;
      return `${agent.name} ${agent.techName} ${agent.description} ${agent.tags.join(" ")}`
        .toLowerCase()
        .includes(value);
    });
  }, [agents, query, status, project, skill]);

  const selected = agents.find((agent) => agent.id === selectedId) ?? null;

  return (
    <div className="scroll-area h-full px-7 pb-10">
      <div className="mx-auto max-w-[1180px] space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]">
              <Search size={13} />
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("agents.search")}
              className="input h-[32px] w-[230px] pl-8 text-[11.5px]"
            />
          </div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            className="input h-[32px] w-auto !py-0 text-[11.5px]"
          >
            {STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>
                {t(`agents.filter${value === "all" ? "All" : value[0].toUpperCase() + value.slice(1)}` as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>
          <select
            value={project}
            onChange={(event) => setProject(event.target.value)}
            className="input h-[32px] max-w-[220px] !py-0 text-[11.5px]"
          >
            <option value="all">{t("agents.allProjects")}</option>
            {projectOptions.map((path) => (
              <option key={path} value={path}>
                {path.split(/[\\/]/).filter(Boolean).pop() ?? path}
              </option>
            ))}
          </select>
          <select
            value={skill}
            onChange={(event) => setSkill(event.target.value)}
            className="input h-[32px] max-w-[180px] !py-0 text-[11.5px]"
          >
            <option value="all">{t("agents.allSkills")}</option>
            {skillOptions.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>

          <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-[var(--faint)]">
            <Bot size={11} />
            {t("agents.count", { n: agents.length })}
          </span>
          <span
            className="hidden items-center gap-1.5 rounded-full border border-[var(--line)] px-2 py-1 text-[10px] text-[var(--faint)] lg:flex"
            title={runtime ?? t("agents.runtimeMissing")}
          >
            <span className={cn("size-1.5 rounded-full", runtime ? "bg-[var(--ok)]" : "bg-[var(--danger)]")} />
            OpenCode CLI
          </span>
          <div className="flex rounded-[10px] border border-[var(--line)] p-0.5">
            <button
              onClick={() => setLayout("grid")}
              className={cn(
                "rounded-[8px] p-1.5 transition-colors",
                layout === "grid" ? "bg-[var(--active)] text-[var(--text)]" : "text-[var(--faint)]",
              )}
              title={t("agents.grid")}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => setLayout("graph")}
              className={cn(
                "rounded-[8px] p-1.5 transition-colors",
                layout === "graph" ? "bg-[var(--active)] text-[var(--text)]" : "text-[var(--faint)]",
              )}
              title={t("agents.graph")}
            >
              <Network size={14} />
            </button>
          </div>
          <button
            className="btn !h-[32px] !px-2.5 !py-0 text-[11px]"
            onClick={() => void loadAgents()}
            disabled={loading}
            title={t("agents.refresh")}
          >
            <RefreshCw size={12} className={loading ? "spin-fast" : undefined} />
          </button>
          <button
            className="btn !h-[32px] !px-2.5 !py-0 text-[11px]"
            onClick={() => void importAgent("global")}
            title={t("agents.import")}
          >
            <Upload size={12} />
          </button>
          <button
            className="btn !h-[32px] !px-2.5 !py-0 text-[11px]"
            onClick={() => setQaOpen(true)}
            title={t("qa.title")}
          >
            <FlaskConical size={12} />
            <span className="hidden xl:inline">{t("qa.cycleButton")}</span>
          </button>
          <button className="btn btn-primary !h-[32px] !py-0 text-[11.5px]" onClick={() => setCreateOpen(true)}>
            <Plus size={13} />
            {t("agents.create")}
          </button>
        </div>

        {agents.length === 0 ? (
          <div className="flex min-h-[380px] flex-col items-center justify-center gap-4 text-center">
            <div className="relative flex size-20 items-center justify-center">
              <span
                className="absolute inset-0 rounded-[26px] opacity-30 blur-2xl"
                style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}
              />
              <div className="card-surface relative flex size-16 items-center justify-center rounded-[22px]">
                <Bot size={30} style={{ color: "var(--accent)" }} strokeWidth={1.5} />
              </div>
            </div>
            <div className="max-w-md">
              <h3 className="text-[15px] font-semibold">{t("agents.emptyTitle")}</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--faint)]">{t("agents.emptyText")}</p>
            </div>
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={14} />
              {t("agents.emptyCta")}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="card-surface p-8 text-center text-[12px] text-[var(--faint)]">
            {t("agents.noResults")}
          </div>
        ) : layout === "grid" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visible.map((agent, index) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                index={index}
                activity={agentActivity[agent.id]?.activity ?? agent.activity ?? null}
                onOpen={() => setSelectedId(agent.id)}
              />
            ))}
          </div>
        ) : (
          <AgentGraph agents={visible} onOpen={setSelectedId} />
        )}
      </div>

      <AgentDrawer
        agent={selected}
        onClose={() => setSelectedId(null)}
        lang={lang}
        activity={selected ? agentActivity[selected.id]?.activity ?? selected.activity ?? null : null}
      />
      <AgentCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(agent) => {
          setCreateOpen(false);
          setSelectedId(agent.id);
        }}
      />
      <AgentQaCycle open={qaOpen} onClose={() => setQaOpen(false)} />
    </div>
  );
}

const AgentCard = memo(function AgentCard({
  agent,
  index,
  activity,
  onOpen,
}: {
  agent: Agent;
  index: number;
  activity: string | null;
  onOpen: () => void;
}) {
  const t = useT();
  const lang = useApp((state) => state.settings?.language ?? "uk");
  const toggleAgent = useApp((state) => state.toggleAgent);
  const color = statusTone(agent.status, agent.enabled);
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.025, 0.22), ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      onClick={onOpen}
      className={cn(
        "card-surface group relative flex cursor-pointer flex-col gap-3 p-4 transition-colors hover:border-[var(--line-strong)]",
        !agent.enabled && "opacity-65",
        agent.status === "working" && "ring-1 ring-[var(--accent-soft)]",
      )}
    >
      <span
        className="pointer-events-none absolute inset-x-4 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)`, opacity: agent.enabled ? 0.8 : 0.2 }}
      />
      <div className="flex items-start gap-2.5">
        <AgentIcon icon={agent.icon} size={38} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold leading-tight">{agent.name}</h3>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--faint)]">
            <span className="mono truncate">{agent.techName}</span>
            <span>·</span>
            <span>{t(`agents.mode${agent.mode === "primary" ? "Primary" : agent.mode === "all" ? "All" : "Subagent"}` as Parameters<typeof t>[0])}</span>
          </div>
        </div>
        <Toggle
          checked={agent.enabled}
          onChange={(next) => void toggleAgent(agent.id, next)}
          label={agent.enabled ? t("agents.disable") : t("agents.enable")}
        />
      </div>

      <p className="line-clamp-2 min-h-[34px] text-[11.5px] leading-relaxed text-[var(--muted)]">
        {agent.description || t("agents.descriptionPlaceholder")}
      </p>

      <div className="flex min-h-[18px] items-center gap-1.5 text-[10.5px]" style={{ color }}>
        <StatusDot agent={agent} />
        <span className="mx-1 text-[var(--faint)]">·</span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={activity ?? "idle"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className={cn("min-w-0 flex-1 truncate", !agent.enabled && "text-[var(--faint)]")}
            style={{ color: agent.enabled ? color : "var(--faint)" }}
          >
            {agent.enabled ? activity ?? t("agents.activityIdle") : t("agents.statusDisabled")}
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="flex flex-wrap gap-1">
        <span className="chip !py-0.5 !text-[9.5px]">
          {agent.scope === "project" ? t("agents.scopeProject") : t("agents.scopeGlobal")}
        </span>
        {agent.model ? <span className="chip mono !py-0.5 !text-[9.5px]">{agent.model}</span> : null}
        {agent.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="chip !py-0.5 !text-[9.5px]">
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-auto grid grid-cols-3 gap-1.5 border-t border-[var(--line)] pt-2 text-[10px] text-[var(--faint)]">
        <span className="flex items-center gap-1" title={t("agents.skills")}>
          <Sparkles size={10} /> {agent.skills.length}
        </span>
        <span className="flex items-center gap-1" title={t("agents.projects")}>
          <FolderGit2 size={10} />{" "}
          {new Set([...agent.projects, agent.projectPath].filter(Boolean)).size}
        </span>
        <span className="flex items-center justify-end gap-1" title={t("agents.tokens")}>
          <Coins size={10} /> {formatNumber(agent.tokensIn + agent.tokensOut, lang)}
        </span>
      </div>
      <div className="flex items-center justify-between text-[9.5px] text-[var(--faint)]">
        <span>
          {agent.lastRunAt ? `${t("agents.lastRun")}: ${relativeDate(agent.lastRunAt, lang)}` : t("agents.never")}
        </span>
        <span className="flex items-center gap-1 text-[var(--accent)] opacity-0 transition-opacity group-hover:opacity-100">
          <ArrowUpRight size={10} /> {t("agents.open")}
        </span>
      </div>
    </motion.article>
  );
});

function AgentGraph({ agents, onOpen }: { agents: Agent[]; onOpen: (id: string) => void }) {
  const t = useT();
  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const agent of agents) {
      for (const path of agent.projects) set.add(path);
      if (agent.projectPath) set.add(agent.projectPath);
    }
    return [...set];
  }, [agents]);
  const skills = useMemo(() => {
    const set = new Set<string>();
    for (const agent of agents) for (const id of agent.skills) set.add(id);
    return [...set];
  }, [agents]);

  const agentY = (index: number) => 34 + index * 94;
  const projectY = (index: number) => 40 + index * 66;
  const skillY = (index: number) => 40 + index * 66;
  const height = Math.max(agents.length * 94 + 40, projects.length * 66 + 40, skills.length * 66 + 40, 260);
  const leftX = 230;
  const projectX = 470;
  const skillX = 760;

  const links = useMemo(() => {
    const out: { key: string; d: string }[] = [];
    agents.forEach((agent, index) => {
      const y = agentY(index) + 37;
      for (const path of [...new Set([...agent.projects, agent.projectPath ?? ""].filter(Boolean))]) {
        const target = projects.indexOf(path);
        if (target < 0) continue;
        const ty = projectY(target) + 24;
        out.push({
          key: `${agent.id}-p-${path}`,
          d: `M ${leftX} ${y} C ${leftX + 90} ${y}, ${projectX - 90} ${ty}, ${projectX} ${ty}`,
        });
      }
      for (const id of agent.skills) {
        const target = skills.indexOf(id);
        if (target < 0) continue;
        const ty = skillY(target) + 20;
        out.push({
          key: `${agent.id}-s-${id}`,
          d: `M ${leftX} ${y} C ${leftX + 170} ${y}, ${skillX - 170} ${ty}, ${skillX} ${ty}`,
        });
      }
    });
    return out;
  }, [agents, projects, skills]);

  return (
    <div className="card-surface relative overflow-auto p-4">
      <p className="absolute left-5 top-4 z-10 text-[10.5px] text-[var(--faint)]">{t("agents.graphHint")}</p>
      {links.length === 0 ? (
        <p className="py-20 text-center text-[11.5px] text-[var(--faint)]">{t("agents.graphEmpty")}</p>
      ) : null}
      <div className="relative mt-7" style={{ minWidth: 980, height }}>
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={980}
          height={height}
          viewBox={`0 0 980 ${height}`}
        >
          <defs>
            <linearGradient id="agent-link" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.7" />
              <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0.15" />
            </linearGradient>
          </defs>
          {links.map((link) => (
            <motion.path
              key={link.key}
              d={link.d}
              fill="none"
              stroke="url(#agent-link)"
              strokeWidth={1.4}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            />
          ))}
        </svg>
        {agents.map((agent, index) => (
          <button
            key={agent.id}
            onClick={() => onOpen(agent.id)}
            className="absolute flex w-[210px] items-center gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--panel-solid)] px-2.5 py-2 text-left transition-colors hover:border-[var(--accent)]"
            style={{ left: 8, top: agentY(index) }}
          >
            <AgentIcon icon={agent.icon} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11.5px] font-medium">{agent.name}</span>
              <span className="flex items-center gap-1 text-[9.5px] text-[var(--faint)]">
                <StatusDot agent={agent} />
              </span>
            </span>
          </button>
        ))}
        {projects.map((path, index) => (
          <div
            key={path}
            className="absolute flex w-[220px] items-center gap-2 rounded-[10px] border border-[var(--line)] bg-white/[0.02] px-2.5 py-2"
            style={{ left: projectX, top: projectY(index) }}
          >
            <FolderGit2 size={13} style={{ color: "var(--accent)" }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[10.5px]">{path.split(/[\\/]/).filter(Boolean).pop() ?? path}</span>
              <span className="mono block truncate text-[8.5px] text-[var(--faint)]">{path}</span>
            </span>
          </div>
        ))}
        {skills.map((id, index) => (
          <div
            key={id}
            className="absolute flex w-[200px] items-center gap-2 rounded-[10px] border border-[var(--line)] bg-white/[0.02] px-2.5 py-2"
            style={{ left: skillX, top: skillY(index) }}
          >
            <Sparkles size={12} style={{ color: "var(--accent-2)" }} />
            <span className="truncate text-[10.5px]">{id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentDrawer({
  agent,
  onClose,
  lang,
  activity,
}: {
  agent: Agent | null;
  onClose: () => void;
  lang: "uk" | "en";
  activity: string | null;
}) {
  const t = useT();
  const items = useApp((state) => state.items);
  const chooseFolder = useApp((state) => state.chooseFolder);
  const updateAgent = useApp((state) => state.updateAgent);
  const toggleAgent = useApp((state) => state.toggleAgent);
  const deleteAgent = useApp((state) => state.deleteAgent);
  const linkAgentProject = useApp((state) => state.linkAgentProject);
  const unlinkAgentProject = useApp((state) => state.unlinkAgentProject);
  const linkAgentSkill = useApp((state) => state.linkAgentSkill);
  const unlinkAgentSkill = useApp((state) => state.unlinkAgentSkill);
  const pickAgentIcon = useApp((state) => state.pickAgentIcon);
  const exportAgent = useApp((state) => state.exportAgent);
  const runAgentTask = useApp((state) => state.runAgentTask);
  const cancelAgentTask = useApp((state) => state.cancelAgentTask);
  const loadAgentTasks = useApp((state) => state.loadAgentTasks);
  const openPath = useApp((state) => state.openPath);
  const defaultModel = useApp((state) => state.settings?.agentModel ?? "");
  const settings = useApp((state) => state.settings);
  const listenVoice = useApp((state) => state.listenVoice);

  const [description, setDescription] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [prompt, setPrompt] = useState("");
  const [project, setProject] = useState("");
  const [auto, setAuto] = useState(false);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [autoSend, setAutoSend] = useState(getVoiceAutoSend());
  const [voiceOn, setVoiceOn] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const trapRef = useFocusTrap<HTMLElement>(Boolean(agent));

  useEffect(() => {
    if (!agent) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agent?.id, onClose]);

  useEffect(() => {
    if (!agent) return;
    setDescription(agent.description);
    setDisplayName(agent.name);
    setTagDraft("");
    setConfirmDelete(false);
    setProject(agent.projects[0] ?? agent.projectPath ?? "");
    setAuto(agent.autoApprove);
    setVoiceOn(getAgentVoice(agent.id));
    setPrompt("");
    void loadAgentTasks(agent.id).then(setTasks);
  }, [agent?.id, loadAgentTasks]);

  useEffect(() => {
    if (!agent) return;
    void loadAgentTasks(agent.id).then(setTasks);
  }, [agent?.lastRunAt, agent?.id, loadAgentTasks]);

  const availableSkills = items.filter((item) => !agent?.skills.includes(item.id));
  const active = agent ? agent.status === "working" || agent.status === "waiting" : false;

  const send = async (value = prompt) => {
    const text = value.trim();
    if (!agent || !text) return;
    setBusy(true);
    const task = await runAgentTask(agent.id, text, project || undefined, auto);
    setBusy(false);
    if (task) {
      setPrompt("");
      setTimeout(() => void loadAgentTasks(agent.id).then(setTasks), 800);
    }
  };

  const listen = async () => {
    if (!agent || listening || active) return;
    setListening(true);
    const lang = settings?.voiceLanguage ?? "uk-UA";
    const heard = await listenVoice(lang);
    setListening(false);
    if (!heard) return;
    const clean = settings?.voiceEconomical ?? true ? compressVoiceText(heard) : heard;
    setPrompt(clean);
    if (autoSend) void send(clean);
  };

  return (
    <AnimatePresence>
      {agent ? (
        <motion.div
          key="agent-drawer"
          className="fixed inset-0 z-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
          <motion.aside
            ref={trapRef}
            role="dialog"
            aria-modal="true"
            aria-label={agent.name}
            initial={{ x: 60, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="glass absolute right-0 top-0 flex h-full w-full max-w-[600px] flex-col border-l border-[var(--line)]"
          >
            <header className="flex items-start gap-3 border-b border-[var(--line)] px-5 py-4">
              <AgentIcon icon={agent.icon} size={44} />
              <div className="min-w-0 flex-1">
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  onBlur={() => {
                    if (displayName.trim() && displayName !== agent.name) {
                      void updateAgent(agent.id, { displayName: displayName.trim() });
                    }
                  }}
                  className="w-full bg-transparent text-[16px] font-semibold leading-tight outline-none"
                />
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-[var(--faint)]">
                  <span className="mono">{agent.techName}</span>
                  <span>·</span>
                  <span>{agent.scope === "project" ? t("agents.scopeProject") : t("agents.scopeGlobal")}</span>
                  <span>·</span>
                  <span>{agent.mode}</span>
                  <StatusDot agent={agent} />
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button className="btn btn-ghost !p-1.5" onClick={() => void pickAgentIcon(agent.id)} title={t("agents.changeIcon")}>
                  <ImageIcon size={15} />
                </button>
                <button className="btn btn-ghost !p-1.5" onClick={() => void exportAgent(agent.id)} title={t("agents.export")}>
                  <Download size={15} />
                </button>
                <button
                  className="btn btn-ghost !p-1.5"
                  style={{ color: voiceOn ? "var(--accent)" : undefined }}
                  onClick={() => {
                    const next = !voiceOn;
                    setVoiceOn(next);
                    setAgentVoice(agent.id, next);
                    if (!next) stopSpeaking();
                  }}
                  title={voiceOn ? t("agents.voiceOn") : t("agents.voiceOff")}
                >
                  {voiceOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
                </button>
                {voiceOn ? (
                  <button className="btn btn-ghost !p-1.5" onClick={stopSpeaking} title={t("agents.voiceStop")}>
                    <Square size={12} />
                  </button>
                ) : null}
                <button className="btn btn-ghost !p-1.5" onClick={onClose}>
                  <X size={16} />
                </button>
              </div>
            </header>

            <div className="scroll-area flex-1 space-y-5 px-5 py-4">
              <div className="flex items-center justify-between rounded-[12px] border border-[var(--line)] bg-white/[0.025] px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium">{agent.enabled ? t("agents.disable") : t("agents.enable")}</div>
                  <div className="text-[10.5px] text-[var(--faint)]">
                    {agent.enabled ? activity ?? t("agents.activityIdle") : t("agents.statusDisabled")}
                  </div>
                </div>
                <button
                  className={cn("btn !py-1.5 text-[11px]", agent.enabled ? "" : "btn-primary")}
                  onClick={() => void toggleAgent(agent.id, !agent.enabled)}
                >
                  {agent.enabled ? <Square size={11} /> : <Play size={11} />}
                  {agent.enabled ? t("agents.disable") : t("agents.enable")}
                </button>
              </div>

              <section className="space-y-2">
                <h3 className="label">{t("agents.description")}</h3>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  onBlur={() => {
                    if (description.trim() !== agent.description.trim()) {
                      void updateAgent(agent.id, { description });
                    }
                  }}
                  placeholder={t("agents.descriptionPlaceholder")}
                  className="input min-h-[76px] resize-none text-[12px] leading-relaxed"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {agent.tags.map((tag) => (
                    <span key={tag} className="chip group/tag">
                      {tag}
                      <button
                        className="ml-0.5 text-[var(--faint)] opacity-0 transition-opacity group-hover/tag:opacity-100"
                        onClick={() => void updateAgent(agent.id, { tags: agent.tags.filter((entry) => entry !== tag) })}
                      >
                        <X size={9} />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      const tag = tagDraft.trim().toLowerCase();
                      if (tag && !agent.tags.includes(tag)) {
                        void updateAgent(agent.id, { tags: [...agent.tags, tag] });
                      }
                      setTagDraft("");
                    }}
                    placeholder={t("agents.addTag")}
                    className="input h-[24px] w-[110px] !rounded-full !px-2.5 !text-[11px]"
                  />
                </div>
              </section>

              <section className="grid grid-cols-2 gap-2 text-[11px]">
                <Meta label={t("agents.techName")} value={agent.techName} mono />
                <Meta label={t("agents.model")} value={agent.model || defaultModel || t("agents.noModel")} mono />
                <Meta label={t("agents.steps")} value={agent.steps ? String(agent.steps) : "—"} />
                <Meta label={t("agents.tokens")} value={formatNumber(agent.bodyTokens, lang)} />
                <Meta label={t("agents.updated")} value={relativeDate(agent.updatedAt, lang)} />
                <Meta label={t("agents.scope")} value={agent.scope === "project" ? t("agents.scopeProject") : t("agents.scopeGlobal")} />
              </section>

              <button
                className="flex w-full items-center gap-2 rounded-[9px] border border-[var(--line)] bg-white/[0.02] px-3 py-2 text-left text-[10.5px] transition-colors hover:border-[var(--line-strong)]"
                onClick={() => void openPath(agent.path.replace(/[\\/][^\\/]+$/, ""))}
              >
                <FileText size={12} className="shrink-0 text-[var(--faint)]" />
                <span className="mono min-w-0 flex-1 truncate text-[var(--muted)]">{agent.path}</span>
                <FolderOpen size={12} className="shrink-0 text-[var(--faint)]" />
              </button>

              <section className="space-y-2">
                <h3 className="label flex items-center gap-2">
                  <ShieldCheck size={12} /> {t("agents.permissions")}
                </h3>
                {agent.permissions.length === 0 ? (
                  <p className="text-[11px] text-[var(--faint)]">—</p>
                ) : (
                  <div className="space-y-1">
                    {agent.permissions.map((permission, index) => (
                      <div
                        key={`${permission.action}-${index}`}
                        className="flex items-center gap-2 rounded-[8px] border border-[var(--line)] bg-white/[0.02] px-2.5 py-1.5 text-[10.5px]"
                      >
                        <span className="mono shrink-0">{permission.action}</span>
                        <span className="mono min-w-0 flex-1 truncate text-[var(--faint)]">{permission.resource}</span>
                        <span style={{ color: permissionTone(permission.effect) }}>
                          {t(`agents.permission${permission.effect[0].toUpperCase() + permission.effect.slice(1)}` as Parameters<typeof t>[0])}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="label">{t("agents.skillsTitle")}</h3>
                  <span className="text-[10px] text-[var(--faint)]">{agent.skills.length}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {agent.skills.map((id) => {
                    const item = items.find((entry) => entry.id === id);
                    return (
                      <span key={id} className="chip group/skill !py-1">
                        <KindIcon kind={item?.kind ?? "skill"} size={10} />
                        {item?.name ?? id}
                        <button
                          className="ml-1 text-[var(--faint)] opacity-60 transition-opacity group-hover/skill:opacity-100"
                          onClick={() => void unlinkAgentSkill(agent.id, id)}
                        >
                          <X size={9} />
                        </button>
                      </span>
                    );
                  })}
                  {agent.skills.length === 0 ? <p className="text-[11px] text-[var(--faint)]">{t("agents.noSkills")}</p> : null}
                </div>
                <select
                  value=""
                  onChange={(event) => {
                    if (event.target.value) void linkAgentSkill(agent.id, event.target.value);
                  }}
                  className="input h-[30px] w-full !py-0 text-[11px]"
                >
                  <option value="">{t("agents.pickSkill")}</option>
                  {availableSkills.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.kind}
                    </option>
                  ))}
                </select>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="label">{t("agents.projectsTitle")}</h3>
                  <button
                    className="btn !py-1 text-[10.5px]"
                    onClick={async () => {
                      const folder = await chooseFolder();
                      if (folder) await linkAgentProject(agent.id, folder);
                    }}
                  >
                    <FolderPlus size={11} /> {t("agents.addProject")}
                  </button>
                </div>
                {agent.projects.length === 0 ? (
                  <p className="text-[11px] text-[var(--faint)]">{t("agents.noProjects")}</p>
                ) : (
                  <div className="space-y-1">
                    {agent.projects.map((path) => (
                      <div
                        key={path}
                        className="flex items-center gap-2 rounded-[8px] border border-[var(--line)] bg-white/[0.02] px-2.5 py-1.5"
                      >
                        <FolderGit2 size={11} className="shrink-0 text-[var(--accent)]" />
                        <span className="mono min-w-0 flex-1 truncate text-[10px] text-[var(--muted)]">{path}</span>
                        <button
                          className="text-[var(--faint)] transition-colors hover:text-[var(--danger)]"
                          onClick={() => void unlinkAgentProject(agent.id, path)}
                          title={t("agents.unlink")}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="label flex items-center gap-1.5">
                    <Clock size={12} /> {t("agents.history")}
                  </h3>
                  <span className="text-[10px] text-[var(--faint)]">
                    {t("agents.tasksCount", { n: tasks.length })}
                  </span>
                </div>
                {tasks.length === 0 ? (
                  <p className="text-[11px] text-[var(--faint)]">{t("agents.noHistory")}</p>
                ) : (
                  <div className="space-y-1.5">
                    {tasks.map((task) => (
                      <div key={task.id} className="rounded-[9px] border border-[var(--line)] bg-white/[0.02] px-2.5 py-2">
                        <div className="flex items-center gap-2 text-[10.5px]">
                          <span
                            className="size-1.5 rounded-full"
                            style={{ background: taskTone(task.status) }}
                          />
                          <span className="min-w-0 flex-1 truncate">{task.prompt}</span>
                          <span style={{ color: taskTone(task.status) }}>
                            {t(`agents.task${task.status === "ok" ? "Ok" : task.status === "error" ? "Error" : task.status === "running" ? "Running" : "Cancelled"}` as Parameters<typeof t>[0])}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[9.5px] text-[var(--faint)]">
                          <span>{relativeDate(task.startedAt, lang)}</span>
                          <span>· {formatDuration(task.durationMs, lang)}</span>
                          <span>· {formatNumber(task.tokensIn + task.tokensOut, lang)} {t("common.tokens")}</span>
                          {task.projectPath ? <span className="mono truncate">· {task.projectPath}</span> : null}
                          {task.status === "error" ? (
                            <button
                              className="text-[var(--accent)]"
                              onClick={() => {
                                setPrompt(task.prompt);
                                promptRef.current?.focus();
                              }}
                            >
                              {t("agents.retry")}
                            </button>
                          ) : null}
                          {task.output ? (
                            <button
                              className="ml-auto text-[var(--accent)]"
                              onClick={() => setExpanded(expanded === task.id ? null : task.id)}
                            >
                              {expanded === task.id ? t("agents.hideOutput") : t("agents.showOutput")}
                            </button>
                          ) : null}
                        </div>
                        {expanded === task.id ? (
                          <pre className="mono mt-1.5 max-h-[220px] overflow-auto rounded-[7px] border border-[var(--line)] bg-black/30 p-2 text-[10px] leading-relaxed text-[var(--muted)]">
                            {task.output || t("agents.noOutput")}
                          </pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {confirmDelete ? (
                <section className="space-y-2 rounded-[10px] border border-[var(--danger)]/35 bg-[var(--danger)]/8 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: "var(--danger)" }}>
                    <AlertTriangle size={13} /> {t("agents.deleteTitle")}
                  </div>
                  <p className="text-[11px] leading-relaxed text-[var(--muted)]">{t("agents.deleteText")}</p>
                  <div className="flex justify-end gap-2">
                    <button className="btn !py-1 text-[11px]" onClick={() => setConfirmDelete(false)}>
                      {t("common.cancel")}
                    </button>
                    <button
                      className="btn !py-1 text-[11px]"
                      style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                      onClick={async () => {
                        const ok = await deleteAgent(agent.id);
                        if (ok) onClose();
                      }}
                    >
                      <Trash2 size={11} /> {t("agents.deleteConfirm")}
                    </button>
                  </div>
                </section>
              ) : (
                <button
                  className="flex items-center gap-1.5 text-[11px]"
                  style={{ color: "var(--danger)" }}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={12} /> {t("agents.delete")}
                </button>
              )}
            </div>

            <div className="border-t border-[var(--line)] px-5 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-medium">{t("agents.runTitle")}</span>
                {active ? (
                  <button
                    className="btn !py-1 text-[10.5px]"
                    style={{ color: "var(--danger)" }}
                    onClick={() => void cancelAgentTask(agent.id)}
                  >
                    <Square size={10} /> {t("agents.stop")}
                  </button>
                ) : null}
              </div>
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t("agents.runPlaceholder")}
                rows={2}
                className="input resize-none text-[11.5px] leading-relaxed"
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void send();
                }}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={project}
                  onChange={(event) => setProject(event.target.value)}
                  className="input h-[28px] max-w-[240px] !py-0 text-[10.5px]"
                >
                  <option value="">{t("agents.globalScope")}</option>
                  {agent.projects.map((path) => (
                    <option key={path} value={path}>
                      {path.split(/[\\/]/).filter(Boolean).pop() ?? path}
                    </option>
                  ))}
                  {agent.projectPath && !agent.projects.includes(agent.projectPath) ? (
                    <option value={agent.projectPath}>
                      {agent.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? agent.projectPath}
                    </option>
                  ) : null}
                </select>
                <label className="flex items-center gap-1.5 text-[10px] text-[var(--faint)]" title={t("agents.autoApproveHint")}>
                  <input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} />
                  {t("agents.autoApprove")}
                </label>
                <button
                  className={cn(
                    "btn !py-1.5 text-[11px]",
                    listening && "border-[var(--accent)] text-[var(--accent)]",
                  )}
                  disabled={listening || active}
                  onClick={() => void listen()}
                  title={t("agents.listenHint")}
                >
                  {listening ? <Loader2 size={11} className="spin-fast" /> : <Mic size={11} />}
                  {listening ? t("agents.listening") : t("agents.listen")}
                </button>
                <label className="flex items-center gap-1.5 text-[10px] text-[var(--faint)]" title={t("agents.autoSendHint")}>
                  <input
                    type="checkbox"
                    checked={autoSend}
                    onChange={(event) => {
                      setAutoSend(event.target.checked);
                      setVoiceAutoSend(event.target.checked);
                    }}
                  />
                  {t("agents.autoSend")}
                </label>
                <button
                  className="btn btn-primary ml-auto !py-1.5 text-[11px]"
                  disabled={!prompt.trim() || busy || active}
                  onClick={() => void send()}
                >
                  {busy ? <Loader2 size={11} className="spin-fast" /> : <Send size={11} />}
                  {t("agents.send")}
                </button>
              </div>
              {prompt.trim() ? (
                <div className="mt-1 text-right text-[9.5px] text-[var(--faint)]">
                  ≈ {estimateVoiceTokens(prompt)} {t("common.tokens")}
                  {settings?.voiceEconomical ? ` · ${t("agents.voiceEconomicalShort")}` : ""}
                  {!speechSupported() ? ` · ${t("agents.voiceUnsupported")}` : ""}
                </div>
              ) : null}
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[8px] border border-[var(--line)] bg-white/[0.02] px-2.5 py-1.5">
      <div className="text-[9.5px] text-[var(--faint)]">{label}</div>
      <div className={cn("truncate text-[11px] text-[var(--muted)]", mono && "mono")}>{value}</div>
    </div>
  );
}

function AgentCreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (agent: Agent) => void;
}) {
  const t = useT();
  const agents = useApp((state) => state.agents);
  const templates = useApp((state) => state.agentTemplates);
  const createAgent = useApp((state) => state.createAgent);
  const runAgentTask = useApp((state) => state.runAgentTask);
  const chooseFolder = useApp((state) => state.chooseFolder);
  const pushToast = useApp((state) => state.pushToast);
  const defaultModel = useApp((state) => state.settings?.agentModel ?? "");

  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState("subagent");
  const [model, setModel] = useState("");
  const [template, setTemplate] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState("global");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  useEscape(open, onClose);
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDisplayName("");
    setDescription("");
    setMode("subagent");
    setModel(defaultModel);
    setTemplate("");
    setBody("");
    setScope("global");
    setProject("");
    setTags("");
    setBusy(false);
  }, [open]);

  const factory = agents.find((agent) => agent.techName === "agent-factory" || agent.key === "agent-factory");
  const applyTemplate = (id: string) => {
    setTemplate(id);
    const template = templates.find((entry) => entry.id === id);
    if (!template) return;
    if (!body.trim()) setBody(template.body);
    if (!description.trim()) setDescription(template.description);
    setMode(template.mode);
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const agent = await createAgent({
      name: name.trim(),
      displayName: displayName.trim() || null,
      description,
      mode,
      model: model.trim() || null,
      body: body.trim() || null,
      scope,
      project: scope === "project" ? project : null,
      template: template || null,
      tags: tags
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    });
    setBusy(false);
    if (agent) onCreated(agent);
  };

  const createWithFactory = async () => {
    if (!factory || !name.trim()) return;
    const prompt = [
      `Створи нового агента OpenCode з назвою "${name.trim()}".`,
      description.trim() ? `Опис: ${description.trim()}` : "",
      `Режим: ${mode}.`,
      scope === "project" && project ? `Розташуй у проєкті: ${project} (.opencode/agents).` : "Розташуй глобально в ~/.config/opencode/agents.",
      body.trim() ? `Системна інструкція:\n${body.trim()}` : "",
      "Використай шаблони з ~/.config/opencode/agent-templates, дотримуйся формату OpenCode V2 і після створення напиши шлях до файлу.",
    ]
      .filter(Boolean)
      .join("\n");
    setBusy(true);
    const task = await runAgentTask(factory.id, prompt, scope === "project" ? project : undefined, true);
    setBusy(false);
    if (task) {
      pushToast(t("agents.taskRunning"), "info");
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6 pt-[8vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="fixed inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={trapRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("agents.createTitle")}
            initial={{ opacity: 0, y: 20, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="card-surface relative z-10 flex max-h-[84vh] w-full max-w-[620px] flex-col overflow-hidden"
          >
            <header className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                  <Bot size={15} style={{ color: "var(--accent)" }} />
                  {t("agents.createTitle")}
                </h2>
                <p className="mt-0.5 text-[11.5px] text-[var(--faint)]">{t("agents.createHint")}</p>
              </div>
              <button className="btn btn-ghost !p-2" onClick={onClose}>
                <X size={16} />
              </button>
            </header>
            <div className="scroll-area flex-1 space-y-3 px-5 py-4">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="label">{t("agents.name")}</span>
                  <input className="input h-[32px] mono text-[11.5px]" value={name} onChange={(event) => setName(event.target.value)} placeholder="reviewer" />
                  <span className="block text-[9.5px] text-[var(--faint)]">{t("agents.nameHint")}</span>
                </label>
                <label className="space-y-1.5">
                  <span className="label">{t("agents.displayName")}</span>
                  <input className="input h-[32px] text-[11.5px]" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t("agents.displayNameHint")} />
                </label>
              </div>
              <label className="space-y-1.5">
                <span className="label">{t("agents.description")}</span>
                <textarea className="input min-h-[56px] resize-none text-[11.5px]" value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
              <div className="grid gap-2.5 sm:grid-cols-3">
                <label className="space-y-1.5">
                  <span className="label">{t("agents.mode")}</span>
                  <select className="input h-[32px] !py-0 text-[11.5px]" value={mode} onChange={(event) => setMode(event.target.value)}>
                    <option value="subagent">{t("agents.modeSubagent")}</option>
                    <option value="primary">{t("agents.modePrimary")}</option>
                    <option value="all">{t("agents.modeAll")}</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="label">{t("agents.template")}</span>
                  <select className="input h-[32px] !py-0 text-[11.5px]" value={template} onChange={(event) => applyTemplate(event.target.value)}>
                    <option value="">{t("agents.templateNone")}</option>
                    {templates.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="label">{t("agents.model")}</span>
                  <input className="input h-[32px] mono text-[11px]" value={model} onChange={(event) => setModel(event.target.value)} placeholder="deepseek/deepseek-chat" />
                </label>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="label">{t("agents.scope")}</span>
                  <select className="input h-[32px] !py-0 text-[11.5px]" value={scope} onChange={(event) => setScope(event.target.value)}>
                    <option value="global">{t("agents.scopeGlobal")}</option>
                    <option value="project">{t("agents.scopeProject")}</option>
                  </select>
                </label>
                {scope === "project" ? (
                  <div className="space-y-1.5">
                    <span className="label">{t("agents.project")}</span>
                    <div className="flex gap-1.5">
                      <input className="input h-[32px] mono min-w-0 flex-1 text-[10.5px]" value={project} onChange={(event) => setProject(event.target.value)} />
                      <button
                        className="btn !px-2 !py-1 text-[10.5px]"
                        onClick={async () => {
                          const folder = await chooseFolder();
                          if (folder) setProject(folder);
                        }}
                      >
                        <FolderOpen size={11} />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <label className="space-y-1.5">
                <span className="label">{t("agents.body")}</span>
                <textarea className="input min-h-[110px] resize-none font-mono text-[10.5px] leading-relaxed" value={body} onChange={(event) => setBody(event.target.value)} placeholder={t("agents.bodyHint")} />
              </label>
              <label className="space-y-1.5">
                <span className="label">{t("agents.tags")}</span>
                <input className="input h-[30px] text-[11px]" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="coding, review" />
              </label>
              <div className="rounded-[9px] border border-[var(--line)] bg-white/[0.02] px-3 py-2 text-[10.5px] leading-relaxed text-[var(--faint)]">
                <Sparkles size={11} className="mr-1 inline" style={{ color: "var(--accent)" }} />
                {t("agents.factoryHint")}
                {!factory ? <span className="block text-[var(--warn)]">{t("agents.factoryMissing")}</span> : null}
              </div>
            </div>
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-3">
              <button className="btn !py-1.5 text-[11.5px]" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button
                className="btn !py-1.5 text-[11.5px]"
                disabled={!factory || !name.trim() || busy}
                onClick={() => void createWithFactory()}
              >
                <Sparkles size={12} /> {t("agents.factory")}
              </button>
              <button
                className="btn btn-primary !py-1.5 text-[11.5px]"
                disabled={!name.trim() || busy || (scope === "project" && !project)}
                onClick={() => void create()}
              >
                {busy ? <Loader2 size={12} className="spin-fast" /> : <Plus size={12} />}
                {t("agents.createSubmit")}
              </button>
            </footer>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
