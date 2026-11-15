import { create } from "zustand";
import { call, errorText, isTauri } from "./lib/api";
import { translate, type Lang, type TranslationKey } from "./lib/i18n";
import type {
  Agent,
  AgentCreateInput,
  AgentPatch,
  AgentTask,
  AgentTemplate,
  BatchPreview,
  Bootstrap,
  Budget,
  DevicePoll,
  DeviceStart,
  DuplicateGroup,
  FeedCard,
  ImportResult,
  Item,
  ItemPatch,
  Kind,
  Preview,
  Profile,
  ProjectInfo,
  PublishPlan,
  PublishResult,
  Secrets,
  Settings,
  Stats,
  UpdateInfo,
} from "./lib/types";

export type View = "library" | "discover" | "agents" | "projects" | "stats" | "settings";
export type Layout = "grid" | "list";
export type SortKey = "recent" | "name" | "stars" | "size";
export type KindFilter = Kind | "all" | "enabled" | "favorites";
export type ToastTone = "ok" | "error" | "info";

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
}

export interface InstallState {
  stage: string;
  pct: number;
}

interface AppStore {
  ready: boolean;
  fatal: string | null;
  busy: boolean;

  settings: Settings | null;
  secrets: Secrets;
  items: Item[];
  profiles: Profile[];
  budget: Budget | null;
  opencode: { connected: boolean; cliPath?: string | null; configPath: string } | null;
  gitVersion: string;
  appVersion: string;
  startupError: string | null;
  analysisTokensIn: number;
  analysisTokensOut: number;

  view: View;
  query: string;
  kindFilter: KindFilter;
  sort: SortKey;
  layout: Layout;
  selectedId: string | null;
  paletteOpen: boolean;
  addFocus: number;

  previews: Preview[];
  previewLoading: boolean;
  previewError: string | null;
  batchFailures: { url: string; error: string }[];
  installing: Record<string, InstallState>;

  projects: ProjectInfo[];
  projectsLoading: boolean;
  feed: FeedCard[];
  feedLoading: boolean;
  stats: Stats | null;
  duplicates: DuplicateGroup[];
  updates: UpdateInfo[];
  device: DeviceStart | null;
  agents: Agent[];
  agentsLoading: boolean;
  agentTemplates: AgentTemplate[];
  agentActivity: Record<string, { taskId: string; activity: string; waiting: boolean }>;
  agentRuntime: string | null;
  agentModels: string[];

  toasts: Toast[];

  bootstrap: () => Promise<void>;
  refreshItems: () => Promise<void>;
  refreshBudget: () => Promise<void>;
  analyze: (url: string) => Promise<Preview | null>;
  analyzeBatch: (input: string) => Promise<BatchPreview | null>;
  clearPreviews: () => void;
  installPreview: (preview: Preview) => Promise<Item | null>;
  savePreview: (preview: Preview) => Promise<Item | null>;
  patchItem: (id: string, patch: ItemPatch) => Promise<Item | null>;
  toggleItem: (id: string, enabled: boolean, scope?: string, project?: string) => Promise<boolean>;
  removeItem: (id: string, removeFiles: boolean) => Promise<boolean>;
  readText: (id: string) => Promise<string | null>;
  setProgress: (url: string, stage: string, pct: number) => void;
  saveSettings: (next: Settings) => Promise<boolean>;
  setSecret: (kind: "deepseek" | "github", value: string) => Promise<boolean>;
  clearSecret: (kind: "deepseek" | "github") => Promise<void>;
  startGithub: () => Promise<DeviceStart | null>;
  pollGithub: () => Promise<DevicePoll | null>;
  logoutGithub: () => Promise<void>;
  connectOpencode: (scope: string, project?: string) => Promise<string | null>;
  loadProjects: () => Promise<void>;
  loadPlan: (path: string) => Promise<PublishPlan | null>;
  publishProject: (input: {
    path: string;
    name: string;
    private: boolean;
    description: string;
    message: string;
    allowSecrets: boolean;
    confirmPublic: boolean;
  }) => Promise<PublishResult | null>;
  syncProject: (path: string) => Promise<boolean>;
  initProject: (name: string) => Promise<string | null>;
  loadFeed: (force?: boolean) => Promise<void>;
  loadStats: () => Promise<void>;
  loadDuplicates: () => Promise<void>;
  checkUpdates: () => Promise<void>;
  updateItem: (id: string) => Promise<boolean>;
  saveProfile: (profile: Profile) => Promise<boolean>;
  deleteProfile: (id: string) => Promise<boolean>;
  applyProfile: (id: string) => Promise<boolean>;
  exportLibrary: (dest?: string) => Promise<string | null>;
  importLibrary: (src?: string) => Promise<ImportResult | null>;
  backupLibrary: () => Promise<string | null>;
  loadAgents: () => Promise<void>;
  loadAgentTemplates: () => Promise<void>;
  loadAgentRuntime: () => Promise<void>;
  loadAgentModels: () => Promise<void>;
  createAgent: (input: AgentCreateInput) => Promise<Agent | null>;
  updateAgent: (id: string, patch: AgentPatch) => Promise<boolean>;
  toggleAgent: (id: string, enabled: boolean) => Promise<boolean>;
  deleteAgent: (id: string) => Promise<boolean>;
  linkAgentProject: (id: string, path: string) => Promise<boolean>;
  unlinkAgentProject: (id: string, path: string) => Promise<boolean>;
  linkAgentSkill: (id: string, itemId: string) => Promise<boolean>;
  unlinkAgentSkill: (id: string, itemId: string) => Promise<boolean>;
  pickAgentIcon: (id: string) => Promise<boolean>;
  exportAgent: (id: string) => Promise<string | null>;
  importAgent: (scope: string, project?: string) => Promise<boolean>;
  runAgentTask: (
    id: string,
    prompt: string,
    project?: string,
    autoApprove?: boolean,
  ) => Promise<AgentTask | null>;
  cancelAgentTask: (id: string) => Promise<void>;
  loadAgentTasks: (id: string) => Promise<AgentTask[]>;
  setAgentActivity: (payload: {
    agentId: string;
    taskId: string;
    activity: string;
    waiting: boolean;
  }) => void;
  finishAgentTask: (payload: {
    agentId: string;
    taskId: string;
    status: string;
    exitCode?: number | null;
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  }) => void;
  chooseFolder: () => Promise<string | null>;
  openPath: (path: string) => Promise<void>;
  openUrl: (url: string) => Promise<void>;

  setView: (view: View) => void;
  setQuery: (query: string) => void;
  setKindFilter: (kind: KindFilter) => void;
  setSort: (sort: SortKey) => void;
  setLayout: (layout: Layout) => void;
  selectItem: (id: string | null) => void;
  setPalette: (open: boolean) => void;
  focusAdd: () => void;
  pushToast: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: string) => void;
}

export const useApp = create<AppStore>((set, get) => {
  const lang = (): Lang => get().settings?.language ?? "uk";

  const say = (key: TranslationKey, vars?: Record<string, string | number>, tone: ToastTone = "ok") => {
    get().pushToast(translate(lang(), key, vars), tone);
  };

  const upsertItem = (items: Item[], item: Item): Item[] => {
    const rest = items.filter((existing) => existing.id !== item.id);
    return [item, ...rest];
  };

  const upsertAgent = (agents: Agent[], agent: Agent): Agent[] => {
    const rest = agents.filter((existing) => existing.id !== agent.id);
    return [agent, ...rest];
  };

  return {
    ready: false,
    fatal: null,
    busy: false,

    settings: null,
    secrets: { githubToken: false, deepseekKey: false },
    items: [],
    profiles: [],
    budget: null,
    opencode: null,
    gitVersion: "",
    appVersion: "",
    startupError: null,
    analysisTokensIn: 0,
    analysisTokensOut: 0,

    view: "library",
    query: "",
    kindFilter: "all",
    sort: "recent",
    layout: "grid",
    selectedId: null,
    paletteOpen: false,
    addFocus: 0,

    previews: [],
    previewLoading: false,
    previewError: null,
    batchFailures: [],
    installing: {},

    projects: [],
    projectsLoading: false,
    feed: [],
    feedLoading: false,
    stats: null,
    duplicates: [],
    updates: [],
    device: null,
    agents: [],
    agentsLoading: false,
    agentTemplates: [],
    agentActivity: {},
    agentRuntime: null,
    agentModels: [],

    toasts: [],

    bootstrap: async () => {
      try {
        const data = await call<Bootstrap>("app_bootstrap");
        set({
          ready: true,
          fatal: null,
          settings: data.settings,
          secrets: data.secrets,
          items: data.items,
          profiles: data.profiles,
          budget: data.budget,
          opencode: data.opencode,
          gitVersion: data.gitVersion,
          appVersion: data.appVersion,
          startupError: data.startupError ?? null,
          analysisTokensIn: data.analysisTokensIn,
          analysisTokensOut: data.analysisTokensOut,
        });
      } catch (error) {
        set({ ready: true, fatal: errorText(error) });
      }
    },

    refreshItems: async () => {
      try {
        const items = await call<Item[]>("scan_library");
        set({ items });
        await get().refreshBudget();
      } catch (error) {
        get().pushToast(errorText(error), "error");
      }
    },

    refreshBudget: async () => {
      try {
        const budget = await call<Budget>("get_budget");
        set({ budget });
      } catch {
        /* бюджет не критичний */
      }
    },

    analyze: async (url) => {
      const trimmed = url.trim();
      if (!trimmed) return null;
      set({ previewLoading: true, previewError: null, previews: [], batchFailures: [] });
      try {
        const preview = await call<Preview>("preview_link", { url: trimmed });
        set({ previews: [preview], previewLoading: false });
        return preview;
      } catch (error) {
        set({ previewLoading: false, previewError: errorText(error) });
        return null;
      }
    },

    analyzeBatch: async (input) => {
      set({ previewLoading: true, previewError: null, previews: [], batchFailures: [] });
      try {
        const result = await call<BatchPreview>("preview_batch", { input });
        set({
          previewLoading: false,
          previews: result.previews,
          batchFailures: result.failures,
        });
        return result;
      } catch (error) {
        set({ previewLoading: false, previewError: errorText(error) });
        return null;
      }
    },

    clearPreviews: () => set({ previews: [], previewError: null, batchFailures: [] }),

    installPreview: async (preview) => {
      set((state) => ({
        installing: { ...state.installing, [preview.url]: { stage: "start", pct: 4 } },
      }));
      try {
        const item = await call<Item>("install_preview", { preview });
        set((state) => {
          const installing = { ...state.installing };
          delete installing[preview.url];
          return {
            items: upsertItem(state.items, item),
            previews: state.previews.filter((p) => p.url !== preview.url),
            installing,
          };
        });
        await get().refreshBudget();
        say("toast.installed", { name: item.name });
        return item;
      } catch (error) {
        set((state) => {
          const installing = { ...state.installing };
          delete installing[preview.url];
          return { installing };
        });
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    savePreview: async (preview) => {
      try {
        const item = await call<Item>("save_preview", { preview });
        set((state) => ({
          items: upsertItem(state.items, item),
          previews: state.previews.filter((p) => p.url !== preview.url),
        }));
        say("toast.savedLink");
        return item;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    patchItem: async (id, patch) => {
      try {
        const item = await call<Item>("update_item_fields", { id, patch });
        set((state) => ({ items: upsertItem(state.items, item) }));
        return item;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    toggleItem: async (id, enabled, scope = "global", project) => {
      try {
        const result = await call<{ item: Item; budget: Budget }>("set_enabled", {
          id,
          enabled,
          scope,
          project: project ?? null,
        });
        set((state) => ({
          items: state.items.map((item) => (item.id === result.item.id ? result.item : item)),
          budget: result.budget,
        }));
        const name = result.item.name;
        say(enabled ? "toast.enabled" : "toast.disabled", { name });
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    removeItem: async (id, removeFiles) => {
      try {
        const items = await call<Item[]>("delete_library_item", { id, removeFiles });
        set((state) => ({
          items,
          selectedId: state.selectedId === id ? null : state.selectedId,
        }));
        await get().refreshBudget();
        say("toast.deleted");
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    readText: async (id) => {
      try {
        return await call<string>("read_item_text", { id });
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    setProgress: (url, stage, pct) =>
      set((state) => ({
        installing: { ...state.installing, [url]: { stage, pct } },
      })),

    saveSettings: async (next) => {
      try {
        const saved = await call<Settings>("save_settings", { next });
        set({ settings: saved });
        say("toast.settingsSaved");
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    setSecret: async (kind, value) => {
      try {
        const secrets = await call<Secrets>("set_secret", { kind, value });
        set({ secrets });
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    clearSecret: async (kind) => {
      try {
        const secrets = await call<Secrets>("clear_secret", { kind });
        set({ secrets });
      } catch (error) {
        get().pushToast(errorText(error), "error");
      }
    },

    startGithub: async () => {
      try {
        const device = await call<DeviceStart>("github_device_start");
        set({ device });
        return device;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    pollGithub: async () => {
      const device = get().device;
      if (!device) return null;
      try {
        const result = await call<DevicePoll>("github_device_poll", {
          deviceCode: device.deviceCode,
        });
        if (result.state === "ok") {
          set({ device: null, secrets: { ...get().secrets, githubToken: true } });
          try {
            const fresh = await call<Settings>("get_settings");
            set({ settings: fresh });
          } catch {
            /* налаштування підтягнуться при наступному запуску */
          }
          say("settings.deviceSuccess");
        }
        return result;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return { state: "error", message: errorText(error) } as DevicePoll;
      }
    },

    logoutGithub: async () => {
      try {
        const secrets = await call<Secrets>("github_logout");
        set((state) => ({
          secrets,
          settings: state.settings ? { ...state.settings, githubLogin: null } : state.settings,
        }));
      } catch (error) {
        get().pushToast(errorText(error), "error");
      }
    },

    connectOpencode: async (scope, project) => {
      try {
        const path = await call<string>("connect_opencode", { scope, project: project ?? null });
        set((state) => ({
          opencode: state.opencode
            ? { ...state.opencode, connected: true }
            : { connected: true, cliPath: null, configPath: path },
        }));
        say("toast.linkConnected");
        return path;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    loadProjects: async () => {
      set({ projectsLoading: true });
      try {
        const projects = await call<ProjectInfo[]>("projects_list");
        set({ projects, projectsLoading: false });
      } catch (error) {
        set({ projectsLoading: false });
        get().pushToast(errorText(error), "error");
      }
    },

    loadPlan: async (path) => {
      try {
        return await call<PublishPlan>("project_plan", { path });
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    publishProject: async (input) => {
      try {
        const result = await call<PublishResult>("project_publish", {
          path: input.path,
          name: input.name,
          private: input.private,
          description: input.description,
          message: input.message,
          allowSecrets: input.allowSecrets,
          confirmPublic: input.confirmPublic,
        });
        get().pushToast(translate(lang(), "projects.published", { url: result.repoUrl }), "ok");
        await get().loadProjects();
        return result;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    syncProject: async (path) => {
      try {
        const info = await call<ProjectInfo>("project_sync", { path });
        set((state) => ({
          projects: state.projects.map((project) => (project.path === info.path ? info : project)),
        }));
        say("toast.projectSynced");
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    initProject: async (name) => {
      try {
        const path = await call<string>("project_init", { name });
        await get().loadProjects();
        get().pushToast(translate(lang(), "projects.synced"), "ok");
        return path;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    loadFeed: async (force = false) => {
      set({ feedLoading: true });
      try {
        const feed = await call<FeedCard[]>("discover_feed", { force });
        set({ feed, feedLoading: false });
      } catch (error) {
        set({ feedLoading: false });
        get().pushToast(errorText(error), "error");
      }
    },

    loadStats: async () => {
      try {
        const [stats, duplicates] = await Promise.all([
          call<Stats>("get_stats"),
          call<DuplicateGroup[]>("get_duplicates").catch(() => [] as DuplicateGroup[]),
        ]);
        set({ stats, duplicates });
      } catch (error) {
        get().pushToast(errorText(error), "error");
      }
    },

    loadDuplicates: async () => {
      try {
        const duplicates = await call<DuplicateGroup[]>("get_duplicates");
        set({ duplicates });
      } catch (error) {
        get().pushToast(errorText(error), "error");
      }
    },

    checkUpdates: async () => {
      set({ busy: true });
      try {
        const updates = await call<UpdateInfo[]>("check_updates");
        set({ updates, busy: false });
        const behind = updates.filter((update) => update.behind).length;
        if (behind > 0) {
          say("toast.updatesFound", { n: behind });
        } else {
          get().pushToast(
            lang() === "en" ? "Everything is up to date" : "Усе актуально",
            "info",
          );
        }
      } catch (error) {
        set({ busy: false });
        get().pushToast(errorText(error), "error");
      }
    },

    updateItem: async (id) => {
      try {
        await call("update_library_item", { id });
        await get().refreshItems();
        say("toast.updated", { name: get().items.find((item) => item.id === id)?.name ?? id });
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    saveProfile: async (profile) => {
      try {
        const profiles = await call<Profile[]>("save_profile", { profile });
        set({ profiles });
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    deleteProfile: async (id) => {
      try {
        const profiles = await call<Profile[]>("delete_profile", { id });
        set({ profiles });
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    applyProfile: async (id) => {
      set({ busy: true });
      try {
        const items = await call<Item[]>("apply_profile", { id, scope: "global" });
        set({ items, busy: false });
        await get().refreshBudget();
        const profile = get().profiles.find((entry) => entry.id === id);
        say("toast.profileApplied", { name: profile?.name ?? id });
        return true;
      } catch (error) {
        set({ busy: false });
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    exportLibrary: async (dest) => {
      try {
        const message = await call<string>("export_library", { dest: dest ?? null });
        get().pushToast(message, "ok");
        return message;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    importLibrary: async (src) => {
      try {
        const result = await call<ImportResult>("import_library", { src: src ?? null });
        await get().refreshItems();
        say("toast.imported", { n: result.imported });
        return result;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    backupLibrary: async () => {
      set({ busy: true });
      try {
        const url = await call<string>("backup_library");
        set({ busy: false });
        get().pushToast(translate(lang(), "settings.backupDone", { url }), "ok");
        return url;
      } catch (error) {
        set({ busy: false });
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    loadAgents: async () => {
      set({ agentsLoading: true });
      try {
        const agents = await call<Agent[]>("agents_list");
        set({ agents, agentsLoading: false });
      } catch (error) {
        set({ agentsLoading: false });
        get().pushToast(errorText(error), "error");
      }
    },

    loadAgentTemplates: async () => {
      try {
        const agentTemplates = await call<AgentTemplate[]>("agent_templates");
        set({ agentTemplates });
      } catch {
        /* шаблони не критичні */
      }
    },

    loadAgentRuntime: async () => {
      try {
        const agentRuntime = await call<string | null>("agents_runtime");
        set({ agentRuntime });
      } catch {
        set({ agentRuntime: null });
      }
    },

    loadAgentModels: async () => {
      try {
        const agentModels = await call<string[]>("opencode_models");
        set({ agentModels });
      } catch {
        set({ agentModels: [] });
      }
    },

    createAgent: async (input) => {
      try {
        const agent = await call<Agent>("agent_create", { input });
        set((state) => ({ agents: upsertAgent(state.agents, agent) }));
        say("agents.created", { name: agent.name });
        return agent;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    updateAgent: async (id, patch) => {
      try {
        const agent = await call<Agent>("agent_update", { id, patch });
        set((state) => ({ agents: upsertAgent(state.agents, agent) }));
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    toggleAgent: async (id, enabled) => {
      try {
        const agent = await call<Agent>("agent_toggle", { id, enabled });
        set((state) => ({ agents: upsertAgent(state.agents, agent) }));
        say(enabled ? "toast.enabled" : "toast.disabled", { name: agent.name });
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    deleteAgent: async (id) => {
      try {
        const agents = await call<Agent[]>("agent_delete", { id, confirm: true });
        set({ agents });
        say("agents.deleted");
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    linkAgentProject: async (id, path) => {
      try {
        const agent = await call<Agent>("agent_link_project", { id, path });
        set((state) => ({ agents: upsertAgent(state.agents, agent) }));
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    unlinkAgentProject: async (id, path) => {
      try {
        const agent = await call<Agent>("agent_unlink_project", { id, path });
        set((state) => ({ agents: upsertAgent(state.agents, agent) }));
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    linkAgentSkill: async (id, itemId) => {
      try {
        const agent = await call<Agent>("agent_link_skill", { id, itemId });
        set((state) => ({ agents: upsertAgent(state.agents, agent) }));
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    unlinkAgentSkill: async (id, itemId) => {
      try {
        const agent = await call<Agent>("agent_unlink_skill", { id, itemId });
        set((state) => ({ agents: upsertAgent(state.agents, agent) }));
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    pickAgentIcon: async (id) => {
      try {
        const agent = await call<Agent | null>("agent_choose_icon", { id });
        if (!agent) return false;
        set((state) => ({ agents: upsertAgent(state.agents, agent) }));
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    exportAgent: async (id) => {
      try {
        const path = await call<string>("agent_export", { id, dest: null });
        get().pushToast(translate(lang(), "agents.exported", { path }), "ok");
        return path;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    importAgent: async (scope, project) => {
      try {
        const agent = await call<Agent | null>("agent_import", {
          scope,
          project: project ?? null,
        });
        if (!agent) return false;
        await get().loadAgents();
        say("agents.imported", { name: agent.name });
        return true;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return false;
      }
    },

    runAgentTask: async (id, prompt, project, autoApprove) => {
      try {
        const task = await call<AgentTask>("agent_run_task", {
          id,
          prompt,
          project: project ?? null,
          autoApprove: autoApprove ?? null,
        });
        set((state) => ({
          agentActivity: {
            ...state.agentActivity,
            [id]: { taskId: task.id, activity: "Запуск…", waiting: false },
          },
          agents: state.agents.map((agent) =>
            agent.id === id
              ? { ...agent, status: "working", activity: "Запуск…" }
              : agent,
          ),
        }));
        if (!isTauri) {
          window.setTimeout(() => {
            get().finishAgentTask({
              agentId: id,
              taskId: task.id,
              status: "ok",
              exitCode: 0,
              durationMs: 2400,
              tokensIn: 820,
              tokensOut: 96,
              costUsd: 0.0004,
            });
          }, 2400);
        }
        return task;
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    cancelAgentTask: async (id) => {
      try {
        await call("agent_cancel_task", { id });
        set((state) => {
          const next = { ...state.agentActivity };
          delete next[id];
          return {
            agentActivity: next,
            agents: state.agents.map((agent) =>
              agent.id === id ? { ...agent, status: "idle", activity: null } : agent,
            ),
          };
        });
      } catch (error) {
        get().pushToast(errorText(error), "error");
      }
    },

    loadAgentTasks: async (id) => {
      try {
        return await call<AgentTask[]>("agent_tasks", { id, limit: 20 });
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return [];
      }
    },

    setAgentActivity: (payload) =>
      set((state) => ({
        agentActivity: {
          ...state.agentActivity,
          [payload.agentId]: {
            taskId: payload.taskId,
            activity: payload.activity,
            waiting: payload.waiting,
          },
        },
        agents: state.agents.map((agent) =>
          agent.id === payload.agentId
            ? {
                ...agent,
                status: payload.waiting ? "waiting" : "working",
                activity: payload.activity,
              }
            : agent,
        ),
      })),

    finishAgentTask: (payload) => {
      const agent = get().agents.find((entry) => entry.id === payload.agentId);
      set((state) => {
        const agentActivity = { ...state.agentActivity };
        delete agentActivity[payload.agentId];
        return {
          agentActivity,
          agents: state.agents.map((entry) =>
            entry.id === payload.agentId
              ? {
                  ...entry,
                  status: payload.status === "error" ? "error" : "idle",
                  activity: null,
                  lastRunAt: new Date().toISOString(),
                  lastStatus: payload.status,
                  tokensIn: entry.tokensIn + payload.tokensIn,
                  tokensOut: entry.tokensOut + payload.tokensOut,
                  costUsd: entry.costUsd + payload.costUsd,
                }
              : entry,
          ),
        };
      });
      if (payload.status === "ok") {
        say("agents.taskDone", { name: agent?.name ?? "Agent" });
      } else if (payload.status === "cancelled") {
        get().pushToast(
          translate(lang(), "agents.taskCancelledToast", { name: agent?.name ?? "Agent" }),
          "info",
        );
      } else {
        get().pushToast(
          translate(lang(), "agents.taskFailed", { name: agent?.name ?? "Agent" }),
          "error",
        );
      }
      void get().loadAgents();
    },

    chooseFolder: async () => {
      try {
        return await call<string | null>("choose_folder");
      } catch (error) {
        get().pushToast(errorText(error), "error");
        return null;
      }
    },

    openPath: async (path) => {
      try {
        await call("open_path", { path });
      } catch (error) {
        get().pushToast(errorText(error), "error");
      }
    },

    openUrl: async (url) => {
      try {
        await call("open_url", { url });
      } catch (error) {
        get().pushToast(errorText(error), "error");
      }
    },

    setView: (view) => set({ view }),
    setQuery: (query) => set({ query }),
    setKindFilter: (kindFilter) => set({ kindFilter }),
    setSort: (sort) => set({ sort }),
    setLayout: (layout) => set({ layout }),
    selectItem: (selectedId) => set({ selectedId }),
    setPalette: (paletteOpen) => set({ paletteOpen }),
    focusAdd: () => set((state) => ({ addFocus: state.addFocus + 1 })),

    pushToast: (message, tone = "ok") => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      set((state) => ({ toasts: [...state.toasts.slice(-4), { id, message, tone }] }));
      window.setTimeout(() => get().dismissToast(id), 4600);
    },

    dismissToast: (id) =>
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  };
});

export function useT() {
  const lang = useApp((state) => state.settings?.language ?? "uk");
  return (key: TranslationKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
}
