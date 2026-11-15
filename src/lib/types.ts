export type Kind =
  | "skill"
  | "plugin"
  | "agent"
  | "command"
  | "token-saver"
  | "mcp"
  | "prompt"
  | "theme"
  | "other";

export type RiskLevel = "unknown" | "clean" | "low" | "medium" | "high";

export interface Finding {
  severity: string;
  title: string;
  detail: string;
  line?: number;
  file?: string;
}

export interface Risk {
  level: RiskLevel;
  findings: Finding[];
  scannedAt?: string;
}

export interface Item {
  id: string;
  name: string;
  kind: Kind;
  sourceUrl?: string | null;
  sourceRef?: string | null;
  commit?: string | null;
  version?: string | null;
  path: string;
  summaryUk: string;
  summaryEn: string;
  tags: string[];
  license?: string | null;
  stars: number;
  pushedAt?: string | null;
  sizeBytes: number;
  tokensEst: number;
  contentHash: string;
  favorite: boolean;
  rating: number;
  notes: string;
  archived: boolean;
  installState: string;
  risk: Risk;
  addedAt: string;
  updatedAt: string;
  enabled: boolean;
  scopes: string[];
  hasLocalFiles: boolean;
}

export interface Preview {
  url: string;
  kind: Kind;
  name: string;
  owner: string;
  repo: string;
  branch: string;
  subPath?: string | null;
  subIsFile: boolean;
  commit?: string | null;
  summaryUk: string;
  summaryEn: string;
  tags: string[];
  license?: string | null;
  stars: number;
  pushedAt?: string | null;
  sizeBytes: number;
  defaultFolder: string;
  defaultId: string;
  risk: Risk;
  warnings: string[];
  descriptionSource: "ai" | "rules" | string;
  tokensUsed: number;
  cached: boolean;
  fileCount: number;
  isGist: boolean;
  isAwesome: boolean;
}

export interface PreviewFailure {
  url: string;
  error: string;
}

export interface BatchPreview {
  previews: Preview[];
  failures: PreviewFailure[];
}

export interface AwesomeCandidate {
  url: string;
  name: string;
  description: string;
}

export interface Budget {
  enabledCount: number;
  advertisedTokens: number;
  onDemandTokens: number;
  threshold: number;
  level: "ok" | "warn" | "over";
}

export interface LinkInfo {
  itemId: string;
  scope: string;
  projectPath?: string | null;
  linkType: string;
  target: string;
}

export interface Profile {
  id: string;
  name: string;
  description: string;
  itemIds: string[];
  createdAt: string;
}

export interface Settings {
  root: string;
  theme: "dark" | "light";
  accent: string;
  language: "uk" | "en";
  deepseekModel: string;
  agentModel: string;
  voiceLanguage: string;
  voiceEconomical: boolean;
  contextBudget: number;
  autoCheckUpdates: boolean;
  lastUpdateCheck?: string | null;
  githubClientId: string;
  githubLogin?: string | null;
  githubBackupRepo?: string | null;
  reduceMotion: boolean;
  onboarded: boolean;
  projectDir?: string | null;
}

export interface Secrets {
  githubToken: boolean;
  deepseekKey: boolean;
}

export interface OpencodeInfo {
  connected: boolean;
  cliPath?: string | null;
  configPath: string;
}

export interface Bootstrap {
  settings: Settings;
  secrets: Secrets;
  items: Item[];
  profiles: Profile[];
  budget: Budget;
  opencode: OpencodeInfo;
  gitVersion: string;
  appVersion: string;
  startupError?: string | null;
  analysisTokensIn: number;
  analysisTokensOut: number;
}

export interface ToggleResult {
  item: Item;
  budget: Budget;
}

export interface ProjectInfo {
  path: string;
  name: string;
  isRepo: boolean;
  branch: string;
  remote?: string | null;
  status: "clean" | "changes" | "conflict" | "no-repo" | "error" | string;
  dirtyCount: number;
  ahead: number;
  behind: number;
  languages: string[];
  lastCommit?: string | null;
  lastCommitAt?: string | null;
}

export interface PublishPlan {
  path: string;
  name: string;
  isRepo: boolean;
  branch: string;
  files: string[];
  secrets: { path: string; line: number; reason: string }[];
  gitignoreCreated: boolean;
  languages: string[];
  defaultMessage: string;
  remote?: string | null;
  totalSize: number;
}

export interface PublishResult {
  repoUrl: string;
  branch: string;
  commit?: string | null;
  pushedFiles: number;
  message: string;
}

export interface GithubRepo {
  name: string;
  fullName: string;
  url: string;
  private: boolean;
  stars: number;
  updatedAt?: string | null;
  description: string;
}

export interface Stats {
  total: number;
  byKind: [string, number][];
  enabled: number;
  favorites: number;
  totalSize: number;
  savedTokens: number;
  mcpCalls: number;
  topSkills: [string, number][];
  budget: Budget;
}

export interface DuplicateGroup {
  reason: string;
  items: Item[];
}

export interface FeedCard {
  url: string;
  name: string;
  owner: string;
  summary: string;
  stars: number;
  pushedAt?: string | null;
  kind: Kind;
  tags: string[];
  license?: string | null;
}

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface DevicePoll {
  state: "ok" | "pending" | "slow_down" | "expired" | "denied" | "error";
  token?: string | null;
  interval?: number | null;
  message?: string | null;
}

export interface UpdateInfo {
  id: string;
  name: string;
  current?: string | null;
  latest?: string | null;
  behind: boolean;
  error?: string | null;
}

export interface UpdateResult {
  added: string[];
  removed: string[];
  changed: string[];
  commit?: string | null;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  structuralErrors: string[];
}

export interface ItemPatch {
  name?: string;
  kind?: Kind;
  tags?: string[];
  summaryUk?: string;
  summaryEn?: string;
  favorite?: boolean;
  rating?: number;
  notes?: string;
}

export type AgentStatus = "idle" | "working" | "waiting" | "error";

export interface AgentPermission {
  action: string;
  resource: string;
  effect: string;
}

export interface Agent {
  id: string;
  key: string;
  path: string;
  fileName: string;
  scope: "global" | "project" | string;
  projectPath?: string | null;
  name: string;
  techName: string;
  description: string;
  icon: string;
  mode: string;
  model?: string | null;
  color?: string | null;
  hidden: boolean;
  steps?: number | null;
  permissions: AgentPermission[];
  tags: string[];
  skills: string[];
  projects: string[];
  enabled: boolean;
  status: AgentStatus | string;
  activity?: string | null;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  bodyTokens: number;
  bodyPreview: string;
  updatedAt: string;
  autoApprove: boolean;
}

export interface AgentTask {
  id: string;
  agentId: string;
  agentName: string;
  projectPath: string;
  prompt: string;
  status: string;
  output: string;
  startedAt: string;
  finishedAt?: string | null;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  exitCode?: number | null;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  body: string;
  mode: string;
}

export interface AgentCreateInput {
  name: string;
  displayName?: string | null;
  description: string;
  mode?: string | null;
  model?: string | null;
  color?: string | null;
  body?: string | null;
  scope?: string | null;
  project?: string | null;
  template?: string | null;
  tags?: string[] | null;
}

export interface AgentPatch {
  displayName?: string | null;
  description?: string | null;
  icon?: string | null;
  tags?: string[] | null;
  autoApprove?: boolean | null;
}

export interface QaReportSummary {
  path: string;
  exists: boolean;
  total: number;
  openCritical: number;
  openHigh: number;
  openMedium: number;
  openLow: number;
  generatedAt?: string | null;
}

export interface AuditReportSummary {
  path: string;
  exists: boolean;
  verdict: "pass" | "warn" | "fail" | "missing";
  verified: number;
  partial: number;
  falseFixes: number;
  testsOk: boolean;
  agentsFail: number;
  generatedAt?: string | null;
}
