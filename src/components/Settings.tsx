import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Github,
  KeyRound,
  Loader2,
  LogOut,
  Bot,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";
import type { Settings as SettingsType } from "@/lib/types";
import { call } from "@/lib/api";
import { ACCENTS, cn, formatNumber } from "@/lib/utils";
import { useApp, useT } from "@/store";
import { BudgetBar, Toggle } from "./common";

export function Settings() {
  const t = useT();
  const settings = useApp((state) => state.settings);
  const secrets = useApp((state) => state.secrets);
  const opencode = useApp((state) => state.opencode);
  const gitVersion = useApp((state) => state.gitVersion);
  const appVersion = useApp((state) => state.appVersion);
  const tokensIn = useApp((state) => state.analysisTokensIn);
  const tokensOut = useApp((state) => state.analysisTokensOut);
  const budget = useApp((state) => state.budget);
  const saveSettings = useApp((state) => state.saveSettings);
  const setSecret = useApp((state) => state.setSecret);
  const clearSecret = useApp((state) => state.clearSecret);
  const startGithub = useApp((state) => state.startGithub);
  const pollGithub = useApp((state) => state.pollGithub);
  const logoutGithub = useApp((state) => state.logoutGithub);
  const connectOpencode = useApp((state) => state.connectOpencode);
  const chooseFolder = useApp((state) => state.chooseFolder);
  const exportLibrary = useApp((state) => state.exportLibrary);
  const importLibrary = useApp((state) => state.importLibrary);
  const backupLibrary = useApp((state) => state.backupLibrary);
  const refreshItems = useApp((state) => state.refreshItems);
  const openPath = useApp((state) => state.openPath);
  const openUrl = useApp((state) => state.openUrl);
  const device = useApp((state) => state.device);
  const pushToast = useApp((state) => state.pushToast);
  const agentModels = useApp((state) => state.agentModels);
  const loadAgentModels = useApp((state) => state.loadAgentModels);
  const voiceLanguages = useApp((state) => state.voiceLanguages);
  const loadVoiceLanguages = useApp((state) => state.loadVoiceLanguages);

  const [draft, setDraft] = useState<SettingsType | null>(settings);
  const [deepseekKey, setDeepseekKey] = useState("");
  const [token, setToken] = useState("");
  const [deviceWaiting, setDeviceWaiting] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => setDraft(settings), [settings]);

  useEffect(() => {
    void loadAgentModels();
    void loadVoiceLanguages();
  }, [loadAgentModels, loadVoiceLanguages]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    },
    [],
  );

  const dirty = useMemo(
    () => Boolean(draft && settings && JSON.stringify(draft) !== JSON.stringify(settings)),
    [draft, settings],
  );

  if (!draft) return null;

  const patch = (value: Partial<SettingsType>) => setDraft({ ...draft, ...value });

  const persist = async (value: Partial<SettingsType>) => {
    const next = { ...draft, ...value };
    setDraft(next);
    await saveSettings(next);
  };

  const pickRoot = async () => {
    const folder = await chooseFolder();
    if (folder) await saveSettings({ ...draft, root: folder });
  };

  const beginDevice = async () => {
    const started = await startGithub();
    if (!started) return;
    setDeviceWaiting(true);
    if (timerRef.current) window.clearInterval(timerRef.current);
    const interval = Math.max(started.interval, 5) * 1000;
    timerRef.current = window.setInterval(async () => {
      const result = await pollGithub();
      if (!result) return;
      if (result.state !== "pending" && result.state !== "slow_down") {
        if (timerRef.current) window.clearInterval(timerRef.current);
        setDeviceWaiting(false);
      }
    }, interval);
  };

  const copyCode = async () => {
    if (!device) return;
    await navigator.clipboard.writeText(device.userCode);
    setCopied(true);
    pushToast(t("toast.copied"));
    window.setTimeout(() => setCopied(false), 1800);
  };

  const accent = ACCENTS[draft.accent] ? draft.accent : "violet";

  return (
    <div className="scroll-area h-full px-7 pb-10">
      <div className="mx-auto max-w-[760px] space-y-3">
        <Section title={t("settings.librarySection")} hint={t("settings.libraryHint")} icon={<FolderOpen size={14} />}>
          <div className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] bg-white/[0.02] px-3 py-2">
            <FolderOpen size={13} className="shrink-0 text-[var(--faint)]" />
            <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-[var(--muted)]">
              {draft.root}
            </span>
            <button className="btn !px-2.5 !py-1 text-[11px]" onClick={() => void pickRoot()}>
              {t("settings.changeFolder")}
            </button>
          </div>

          <div className="grid gap-3 pt-1 sm:grid-cols-2">
            <Field label={t("settings.theme")}>
              <div className="flex rounded-[10px] border border-[var(--line)] p-0.5">
                {(["dark", "light"] as const).map((theme) => (
                  <button
                    key={theme}
                    onClick={() => void persist({ theme })}
                    className={cn(
                      "flex-1 rounded-[8px] px-2 py-1.5 text-[11.5px] font-medium transition-colors",
                      draft.theme === theme
                        ? "bg-white/[0.08] text-[var(--text)]"
                        : "text-[var(--faint)] hover:text-[var(--text)]",
                    )}
                  >
                    {theme === "dark" ? t("settings.dark") : t("settings.light")}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={t("settings.language")}>
              <div className="flex rounded-[10px] border border-[var(--line)] p-0.5">
                {(["uk", "en"] as const).map((language) => (
                  <button
                    key={language}
                    onClick={() => void persist({ language })}
                    className={cn(
                      "flex-1 rounded-[8px] px-2 py-1.5 text-[11.5px] font-medium transition-colors",
                      draft.language === language
                        ? "bg-white/[0.08] text-[var(--text)]"
                        : "text-[var(--faint)] hover:text-[var(--text)]",
                    )}
                  >
                    {language === "uk" ? t("settings.ukrainian") : t("settings.english")}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <Field label={t("settings.accent")}>
            <div className="flex flex-wrap gap-2">
              {Object.entries(ACCENTS).map(([key, value]) => (
                <button
                  key={key}
                  onClick={() => void persist({ accent: key })}
                  title={value.name}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full border-2 transition-transform hover:scale-105",
                    accent === key ? "border-[var(--text)]" : "border-transparent",
                  )}
                  style={{ background: `linear-gradient(135deg, ${value.from}, ${value.to})` }}
                >
                  {accent === key ? <Check size={12} className="text-white" /> : null}
                </button>
              ))}
            </div>
          </Field>

          <Row
            label={t("settings.reduceMotion")}
            hint={t("settings.motionHint")}
            control={
              <Toggle
                checked={draft.reduceMotion}
                onChange={(next) => void persist({ reduceMotion: next })}
                label={t("settings.motion")}
              />
            }
          />
        </Section>

        <Section
          title={t("settings.budgetSection")}
          hint={t("settings.budgetHint")}
          icon={<Zap size={14} />}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="label">{t("settings.budgetThreshold")}</span>
              <span className="text-[12px] tabular-nums text-[var(--muted)]">
                {formatNumber(draft.contextBudget)} {t("common.tokens")}
              </span>
            </div>
            <input
              type="range"
              min={1000}
              max={60000}
              step={500}
              value={draft.contextBudget}
              onChange={(event) => patch({ contextBudget: Number(event.target.value) })}
              onMouseUp={() => void saveSettings(draft)}
              className="w-full accent-[var(--accent)]"
            />
            {budget ? (
              <div className="space-y-1.5 rounded-[10px] border border-[var(--line)] bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--faint)]">{t("stats.budgetUsed")}</span>
                  <span className="tabular-nums">
                    {budget.advertisedTokens} / {budget.threshold}
                  </span>
                </div>
                <BudgetBar used={budget.advertisedTokens} limit={budget.threshold} level={budget.level} />
                <div className="text-[10.5px] text-[var(--faint)]">
                  {budget.enabledCount} · {t("nav.enabled").toLowerCase()} · {budget.onDemandTokens}{" "}
                  {t("common.tokens")} {t("detail.tokensFull").toLowerCase()}
                </div>
              </div>
            ) : null}
          </div>
        </Section>

        <Section
          title={t("settings.agentsSection")}
          hint={t("settings.agentsHint")}
          icon={<Bot size={14} />}
        >
          <Field label={t("settings.agentModel")} hint={t("settings.agentModelHint")}>
            <select
              className="input h-[32px] !py-0 text-[11.5px]"
              value={draft.agentModel}
              onChange={(event) => void persist({ agentModel: event.target.value })}
            >
              <option value="">{t("settings.inheritModel")}</option>
              {agentModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
              {draft.agentModel && !agentModels.includes(draft.agentModel) ? (
                <option value={draft.agentModel}>{draft.agentModel}</option>
              ) : null}
            </select>
          </Field>
          <Field label={t("settings.voiceLanguage")} hint={t("settings.voiceLanguageHint")}>
            <select
              className="input h-[32px] !py-0 text-[11.5px]"
              value={draft.voiceLanguage}
              onChange={(event) => void persist({ voiceLanguage: event.target.value })}
            >
              {(voiceLanguages.length > 0 ? voiceLanguages : ["uk-UA", "ru-RU", "en-US"]).map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
              {draft.voiceLanguage && !voiceLanguages.includes(draft.voiceLanguage) ? (
                <option value={draft.voiceLanguage}>{draft.voiceLanguage}</option>
              ) : null}
            </select>
          </Field>
          <Row
            label={t("settings.voiceEconomical")}
            hint={t("settings.voiceEconomicalHint")}
            control={
              <Toggle
                checked={draft.voiceEconomical}
                onChange={(next) => void persist({ voiceEconomical: next })}
                label={t("settings.voiceEconomical")}
              />
            }
          />
          <div className="text-[10px] text-[var(--faint)]">
            {t("settings.voiceInstallHint")} {voiceLanguages.join(", ") || "—"}
          </div>
        </Section>

        <Section
          title={t("settings.analysisSection")}
          hint={secrets.deepseekKey ? t("settings.keySaved") : t("settings.keyMissing")}
          icon={<Sparkles size={14} />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("settings.model")}>
              <select
                className="input h-[32px] !py-0 text-[11.5px]"
                value={draft.deepseekModel}
                onChange={(event) => void persist({ deepseekModel: event.target.value })}
              >
                <option value="deepseek-chat">deepseek-chat</option>
                <option value="deepseek-reasoner">deepseek-reasoner</option>
              </select>
            </Field>
            <Field label={t("settings.deepseekKey")}>
              <div className="flex gap-1.5">
                <input
                  type="password"
                  value={deepseekKey}
                  onChange={(event) => setDeepseekKey(event.target.value)}
                  placeholder="sk-…"
                  className="input h-[32px] min-w-0 flex-1 font-mono text-[11px]"
                />
                <button
                  className="btn !px-2.5 !py-1 text-[11px]"
                  disabled={!deepseekKey.trim()}
                  onClick={async () => {
                    const ok = await setSecret("deepseek", deepseekKey.trim());
                    if (ok) {
                      setDeepseekKey("");
                      pushToast(t("settings.keySaved"));
                    }
                  }}
                >
                  <KeyRound size={11} />
                  {t("settings.saveKey")}
                </button>
                {secrets.deepseekKey ? (
                  <button
                    className="btn !px-2 !py-1 text-[11px]"
                    onClick={() => void clearSecret("deepseek")}
                    title={t("settings.clearKey")}
                  >
                    <LogOut size={11} />
                  </button>
                ) : null}
              </div>
            </Field>
          </div>
          <div className="flex items-center gap-2 pt-0.5 text-[10.5px] text-[var(--faint)]">
            <ShieldCheck size={12} style={{ color: secrets.deepseekKey ? "var(--ok)" : "var(--faint)" }} />
            {secrets.deepseekKey ? t("settings.keySaved") : t("settings.keyMissing")}
            <span className="ml-auto tabular-nums">
              {t("settings.tokensUsed", { in: formatNumber(tokensIn), out: formatNumber(tokensOut) })}
            </span>
          </div>
        </Section>

        <Section
          title={t("settings.githubSection")}
          hint={
            secrets.githubToken
              ? t("settings.githubConnected", { login: draft.githubLogin ?? "GitHub" })
              : t("settings.githubNotConnected")
          }
          icon={<Github size={14} />}
        >
          {secrets.githubToken ? (
            <div className="flex items-center justify-between rounded-[10px] border border-[var(--line)] bg-white/[0.02] px-3 py-2">
              <div className="flex items-center gap-2 text-[12px]">
                <Check size={13} style={{ color: "var(--ok)" }} />
                <span>{t("settings.githubConnected", { login: draft.githubLogin ?? "GitHub" })}</span>
              </div>
              <button
                className="btn !py-1 text-[11px]"
                onClick={() => void logoutGithub()}
              >
                <LogOut size={11} />
                {t("settings.logout")}
              </button>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("settings.clientId")} hint={t("settings.clientIdHint")}>
              <input
                className="input h-[32px] mono text-[11px]"
                value={draft.githubClientId}
                onChange={(event) => patch({ githubClientId: event.target.value })}
                onBlur={() => void saveSettings(draft)}
                placeholder="Iv1.…"
              />
            </Field>
            <div className="flex items-end">
              <button
                className="btn w-full !py-2 text-[12px]"
                disabled={deviceWaiting || !draft.githubClientId.trim()}
                onClick={() => void beginDevice()}
              >
                {deviceWaiting ? <Loader2 size={13} className="spin-slow" /> : <Github size={13} />}
                {deviceWaiting ? t("settings.deviceWaiting") : t("settings.connectGithub")}
              </button>
            </div>
          </div>

          {device ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-2 rounded-[10px] border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-2.5"
            >
              <div className="text-[11.5px] font-medium">{t("settings.deviceTitle")}</div>
              <div className="flex items-center gap-2">
                <span className="mono rounded-[7px] border border-[var(--line)] bg-black/25 px-3 py-1.5 text-[16px] tracking-[0.2em]">
                  {device.userCode}
                </span>
                <button className="btn !p-1.5" onClick={() => void copyCode()}>
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
                <button
                  className="btn !py-1 text-[11px]"
                  onClick={() => void openUrl(device.verificationUri)}
                >
                  <ExternalLink size={11} />
                  github.com
                </button>
              </div>
              <p className="text-[10.5px] leading-relaxed text-[var(--muted)]">{t("settings.deviceHint")}</p>
            </motion.div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Field label={t("settings.tokenFallback")} hint={t("settings.tokenHint")}>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={t("settings.tokenPlaceholder")}
                className="input h-[32px] mono text-[11px]"
              />
            </Field>
            <div className="flex items-end">
              <button
                className="btn !py-2 text-[11.5px]"
                disabled={!token.trim()}
                onClick={async () => {
                  const ok = await setSecret("github", token.trim());
                  if (ok) {
                    setToken("");
                    try {
                      const fresh = await call<SettingsType>("get_settings");
                      setDraft(fresh);
                    } catch {
                      /* налаштування підтягнуться при наступному запуску */
                    }
                  }
                }}
              >
                {t("settings.saveToken")}
              </button>
            </div>
          </div>
        </Section>

        <Section
          title={t("settings.opencodeSection")}
          hint={opencode?.connected ? t("settings.opencodeConnected") : t("settings.opencodeNotConnected")}
          icon={<Zap size={14} />}
        >
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary !py-2 text-[12px]" onClick={() => void connectOpencode("global")}>
              <Zap size={13} />
              {t("settings.connectOpencode")}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--faint)]">{t("settings.opencodeHint")}</p>
          <div className="flex items-center gap-2 text-[10.5px] text-[var(--faint)]">
            <span>{t("settings.configPath")}:</span>
            <span className="mono truncate">{opencode?.configPath ?? "—"}</span>
          </div>
          {opencode?.cliPath ? (
            <div className="flex items-center gap-2 text-[10.5px] text-[var(--faint)]">
              <span>CLI:</span>
              <span className="mono truncate">{opencode.cliPath}</span>
            </div>
          ) : (
            <p className="text-[10.5px]" style={{ color: "var(--warn)" }}>
              {t("settings.cliMissing")}
            </p>
          )}
        </Section>

        <Section
          title={t("settings.dataSection")}
          hint={t("settings.backupHint")}
          icon={<Download size={14} />}
        >
          <Row
            label={t("settings.autoUpdates")}
            control={
              <Toggle
                checked={draft.autoCheckUpdates}
                onChange={(next) => void persist({ autoCheckUpdates: next })}
                label={t("settings.autoUpdates")}
              />
            }
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <button className="btn !py-1.5 text-[11.5px]" onClick={() => void exportLibrary()}>
              <Download size={12} />
              {t("settings.exportLibrary")}
            </button>
            <button className="btn !py-1.5 text-[11.5px]" onClick={() => void importLibrary()}>
              <Upload size={12} />
              {t("settings.importLibrary")}
            </button>
            <button className="btn !py-1.5 text-[11.5px]" onClick={() => void backupLibrary()}>
              <Github size={12} />
              {t("settings.backupLibrary")}
            </button>
            <button className="btn !py-1.5 text-[11.5px]" onClick={() => void refreshItems()}>
              <RefreshCw size={12} />
              {t("settings.rescan")}
            </button>
            <button className="btn !py-1.5 text-[11.5px]" onClick={() => void openPath(draft.root)}>
              <FolderOpen size={12} />
              {t("common.openFolder")}
            </button>
          </div>
        </Section>

        <Section title={t("settings.about")} icon={<ShieldCheck size={14} />}>
          <div className="grid gap-1.5 text-[11.5px] sm:grid-cols-2">
            <InfoRow label={t("settings.appVersion")} value={appVersion || "0.1.0"} />
            <InfoRow label={t("settings.gitVersion")} value={gitVersion || "—"} />
            <InfoRow label="Tauri" value="2 · WebView2" />
            <InfoRow label={t("nav.budget")} value={budget ? `${budget.advertisedTokens}/${budget.threshold}` : "—"} />
          </div>
        </Section>

        {dirty ? (
          <div className="sticky bottom-2 flex items-center justify-between rounded-[12px] border border-[var(--accent)]/35 bg-[var(--accent-soft)] px-3.5 py-2.5 backdrop-blur">
            <span className="text-[11.5px]">{t("settings.saved")}?</span>
            <div className="flex gap-2">
              <button className="btn !py-1 text-[11px]" onClick={() => setDraft(settings)}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary !py-1 text-[11px]" onClick={() => void saveSettings(draft)}>
                {t("common.save")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card-surface space-y-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 text-[13px] font-semibold">
          <span style={{ color: "var(--accent)" }}>{icon}</span>
          {title}
        </h2>
        {hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--faint)]">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="block text-[10px] leading-relaxed text-[var(--faint)]">{hint}</span> : null}
    </label>
  );
}

function Row({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[12px] font-medium">{label}</div>
        {hint ? <div className="text-[10.5px] text-[var(--faint)]">{hint}</div> : null}
      </div>
      {control}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[8px] border border-[var(--line)] bg-white/[0.02] px-2.5 py-1.5">
      <span className="text-[var(--faint)]">{label}</span>
      <span className="mono truncate text-[var(--muted)]">{value}</span>
    </div>
  );
}
