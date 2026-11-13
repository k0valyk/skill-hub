import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  Link2,
  ListTree,
  Loader2,
  Package,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { call, onEvent } from "@/lib/api";
import type { AwesomeCandidate, Preview } from "@/lib/types";
import { cn, formatBytes, relativeDate } from "@/lib/utils";
import { useApp, useT } from "@/store";
import { KindIcon, RiskDot } from "./common";

export function AddPreview() {
  const t = useT();
  const previews = useApp((state) => state.previews);
  const previewLoading = useApp((state) => state.previewLoading);
  const previewError = useApp((state) => state.previewError);
  const batchFailures = useApp((state) => state.batchFailures);
  const clearPreviews = useApp((state) => state.clearPreviews);
  const installPreview = useApp((state) => state.installPreview);
  const savePreview = useApp((state) => state.savePreview);
  const setProgress = useApp((state) => state.setProgress);
  const [batchBusy, setBatchBusy] = useState(false);

  const open =
    previewLoading || Boolean(previewError) || previews.length > 0 || batchFailures.length > 0;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onEvent<{ url: string; stage: string; pct: number }>("install:progress", (payload) => {
      setProgress(payload.url, payload.stage, payload.pct);
    }).then((off) => {
      unlisten = off;
    });
    return () => unlisten?.();
  }, [setProgress]);

  const installAll = async () => {
    setBatchBusy(true);
    for (const preview of previews) {
      await installPreview(preview);
    }
    setBatchBusy(false);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6 pt-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="fixed inset-0 bg-black/55 backdrop-blur-sm" onClick={clearPreviews} />
          <motion.div
            initial={{ opacity: 0, y: 22, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="card-surface relative z-10 flex max-h-[86vh] w-full max-w-[720px] flex-col overflow-hidden"
          >
            <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                  <Sparkles size={15} style={{ color: "var(--accent)" }} />
                  {previews.length > 1 ? t("preview.batchTitle") : t("preview.title")}
                </h2>
                <p className="mt-0.5 text-[11.5px] text-[var(--faint)]">
                  {previewLoading
                    ? t("preview.analyzingHint")
                    : previews.length > 1
                      ? t("preview.addSelected")
                      : t("preview.analyzingHint")}
                </p>
              </div>
              <button className="btn btn-ghost !p-2" onClick={clearPreviews}>
                <X size={16} />
              </button>
            </header>

            <div className="scroll-area flex-1 space-y-3 px-4 py-4">
              {previewLoading ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-3">
                  <div className="relative flex size-14 items-center justify-center">
                    <span
                      className="absolute inset-0 rounded-full opacity-30 blur-xl"
                      style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}
                    />
                    <Loader2 size={26} className="spin-slow" style={{ color: "var(--accent)" }} />
                  </div>
                  <p className="text-[13px] font-medium">{t("preview.analyzing")}</p>
                  <p className="text-[11.5px] text-[var(--faint)]">{t("preview.analyzingHint")}</p>
                </div>
              ) : null}

              {previewError ? (
                <div className="rounded-[12px] border border-[var(--danger)]/35 bg-[var(--danger)]/8 px-4 py-3">
                  <div className="flex items-center gap-2 text-[12.5px] font-medium" style={{ color: "var(--danger)" }}>
                    <AlertTriangle size={14} />
                    {t("preview.failed")}
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">{previewError}</p>
                </div>
              ) : null}

              {previews.map((preview) => (
                <PreviewCard
                  key={`${preview.url}-${preview.subPath ?? ""}`}
                  preview={preview}
                  onInstall={() => void installPreview(preview)}
                  onSave={() => void savePreview(preview)}
                />
              ))}

              {batchFailures.length > 0 ? (
                <div className="space-y-1.5 rounded-[12px] border border-[var(--line)] bg-white/[0.02] px-3 py-2.5">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--faint)]">
                    {t("preview.failed")}
                  </div>
                  {batchFailures.map((failure) => (
                    <div key={failure.url} className="text-[11.5px] leading-relaxed">
                      <span className="mono break-all text-[var(--muted)]">{failure.url}</span>
                      <span className="text-[var(--danger)]"> — {failure.error}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {previews.length > 0 ? (
              <footer className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3">
                <span className="text-[11.5px] text-[var(--faint)]">
                  {previews.length} · {t("preview.download")}
                </span>
                <div className="flex gap-2">
                  <button className="btn" onClick={clearPreviews}>
                    {t("common.cancel")}
                  </button>
                  {previews.length > 1 ? (
                    <button className="btn btn-primary" disabled={batchBusy} onClick={() => void installAll()}>
                      {batchBusy ? <Loader2 size={13} className="spin-slow" /> : <Download size={13} />}
                      {t("preview.addSelected")} ({previews.length})
                    </button>
                  ) : null}
                </div>
              </footer>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function PreviewCard({
  preview,
  onInstall,
  onSave,
}: {
  preview: Preview;
  onInstall: () => void;
  onSave: () => void;
}) {
  const t = useT();
  const lang = useApp((state) => state.settings?.language ?? "uk");
  const installing = useApp((state) => state.installing[preview.url]);
  const analyzeBatch = useApp((state) => state.analyzeBatch);
  const openUrl = useApp((state) => state.openUrl);

  const [awesome, setAwesome] = useState<AwesomeCandidate[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [awesomeBusy, setAwesomeBusy] = useState(false);
  const [awesomeError, setAwesomeError] = useState<string | null>(null);

  const summary = lang === "en" ? preview.summaryEn : preview.summaryUk;

  const loadAwesome = async () => {
    setAwesomeBusy(true);
    setAwesomeError(null);
    try {
      const list = await call<AwesomeCandidate[]>("awesome_candidates", { url: preview.url });
      setAwesome(list);
      setSelected(list.slice(0, 8).map((entry) => entry.url));
    } catch (error) {
      setAwesomeError(error instanceof Error ? error.message : String(error));
    } finally {
      setAwesomeBusy(false);
    }
  };

  const addSelected = async () => {
    if (selected.length === 0) return;
    await analyzeBatch(selected.join("\n"));
  };

  const allSelected = useMemo(
    () => Boolean(awesome) && awesome !== null && selected.length === awesome.length,
    [awesome, selected],
  );

  return (
    <div className="rounded-[14px] border border-[var(--line)] bg-white/[0.02] p-4">
      <div className="flex items-start gap-3">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-[11px] border border-[var(--line)]"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          <KindIcon kind={preview.kind} size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold">{preview.name}</h3>
            <span className="chip !py-0.5 !text-[10px]">
              <KindIcon kind={preview.kind} size={10} />
              {t(`kind.${preview.kind}.one` as Parameters<typeof t>[0])}
            </span>
            {preview.isGist ? <span className="chip !py-0.5 !text-[10px]">gist</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-[var(--faint)]">
            <span className="mono">
              {preview.owner}/{preview.repo}
            </span>
            <span>·</span>
            <span className="tabular-nums">★ {preview.stars}</span>
            <span>·</span>
            <span>{formatBytes(preview.sizeBytes)}</span>
            <span>·</span>
            <span>{preview.fileCount} · {t("preview.files").toLowerCase()}</span>
            {preview.pushedAt ? (
              <>
                <span>·</span>
                <span>{relativeDate(preview.pushedAt, lang)}</span>
              </>
            ) : null}
            {preview.license ? (
              <>
                <span>·</span>
                <span>{preview.license}</span>
              </>
            ) : null}
          </div>
        </div>
        <button
          className="btn btn-ghost !p-1.5"
          title={t("preview.openSource")}
          onClick={() => void openUrl(preview.url)}
        >
          <ExternalLink size={13} />
        </button>
      </div>

      <p className="mt-3 whitespace-pre-line text-[12.5px] leading-relaxed text-[var(--muted)]">
        {summary}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {preview.tags.map((tag) => (
          <span key={tag} className="chip !py-0.5 !text-[10px]">
            {tag}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-[var(--faint)]">
          {preview.cached ? <Check size={10} /> : <Sparkles size={10} />}
          {preview.descriptionSource === "ai" ? t("preview.sourceAi") : t("preview.sourceRules")}
          {preview.cached ? ` · ${t("preview.cached")}` : ""}
          {preview.tokensUsed > 0 ? ` · ${preview.tokensUsed} ${t("common.tokens")}` : ""}
        </span>
      </div>

      {preview.subPath ? (
        <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-[var(--faint)]">
          <ListTree size={11} />
          <span className="mono">{preview.subPath}</span>
          {preview.subIsFile ? <span className="chip !py-0 !text-[9.5px]">file</span> : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--line)] bg-black/15 px-3 py-2">
        <div className="flex items-center gap-1.5">
          {preview.risk.level === "clean" ? (
            <Check size={12} style={{ color: "var(--ok)" }} />
          ) : (
            <ShieldAlert
              size={12}
              style={{
                color: preview.risk.level === "high" ? "var(--danger)" : "var(--warn)",
              }}
            />
          )}
          <span className="text-[11px]">{t("preview.risk")}</span>
        </div>
        <RiskDot level={preview.risk.level} />
        {preview.warnings.length > 0 ? (
          <ul className="w-full space-y-1 border-t border-[var(--line)] pt-2">
            {preview.warnings.map((warning) => (
              <li key={warning} className="flex gap-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
                <span style={{ color: "var(--warn)" }}>•</span>
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
        {preview.risk.findings.length > 0 ? (
          <ul className="w-full space-y-1 border-t border-[var(--line)] pt-2">
            {preview.risk.findings.slice(0, 4).map((finding, index) => (
              <li
                key={`${finding.title}-${index}`}
                className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-[var(--faint)]"
              >
                <span style={{ color: finding.severity === "high" ? "var(--danger)" : "var(--warn)" }}>
                  !
                </span>
                <span>
                  <span className="text-[var(--muted)]">{finding.title}</span> — {finding.detail}
                  {finding.file ? <span className="mono"> ({finding.file})</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {preview.isAwesome ? (
        <div className="mt-3 space-y-2 rounded-[10px] border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[12px] font-medium">
            <ListTree size={13} style={{ color: "var(--accent)" }} />
            {t("preview.awesomeTitle")}
          </div>
          <p className="text-[11px] text-[var(--muted)]">{t("preview.awesomeHint")}</p>
          {awesome === null ? (
            <button className="btn !py-1 text-[11px]" disabled={awesomeBusy} onClick={() => void loadAwesome()}>
              {awesomeBusy ? <Loader2 size={11} className="spin-slow" /> : <ListTree size={11} />}
              {t("top.awesome")}
            </button>
          ) : awesome.length === 0 ? (
            <p className="text-[11px] text-[var(--faint)]">{t("preview.noLinks")}</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <button
                  className="text-[10.5px] text-[var(--accent)]"
                  onClick={() =>
                    setSelected(allSelected ? [] : (awesome ?? []).map((entry) => entry.url))
                  }
                >
                  {t("preview.selectAll")}
                </button>
                <span className="text-[10.5px] text-[var(--faint)]">
                  {selected.length} / {awesome.length}
                </span>
              </div>
              <div className="scroll-area max-h-[210px] space-y-0.5">
                {awesome.map((entry) => {
                  const active = selected.includes(entry.url);
                  return (
                    <button
                      key={entry.url}
                      onClick={() =>
                        setSelected((current) =>
                          current.includes(entry.url)
                            ? current.filter((value) => value !== entry.url)
                            : [...current, entry.url],
                        )
                      }
                      className={cn(
                        "flex w-full items-start gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors",
                        active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
                          active
                            ? "border-transparent text-white"
                            : "border-[var(--line-strong)] text-transparent",
                        )}
                        style={
                          active
                            ? { background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }
                            : undefined
                        }
                      >
                        <Check size={9} strokeWidth={3} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] font-medium">{entry.name}</span>
                        <span className="block truncate text-[10.5px] text-[var(--faint)]">
                          {entry.description || entry.url}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                className="btn btn-primary w-full !py-1.5 text-[11.5px]"
                disabled={selected.length === 0}
                onClick={() => void addSelected()}
              >
                <Sparkles size={12} />
                {t("preview.addSelected")} ({selected.length})
              </button>
            </>
          )}
          {awesomeError ? (
            <p className="text-[11px] text-[var(--danger)]">{awesomeError}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="btn btn-primary flex-1 !py-2 text-[12px]"
          disabled={Boolean(installing)}
          onClick={onInstall}
        >
          {installing ? <Loader2 size={13} className="spin-slow" /> : <Download size={13} />}
          {installing ? t("preview.installProgress") : t("preview.download")}
        </button>
        <button className="btn !py-2 text-[12px]" onClick={onSave}>
          <Link2 size={13} />
          {t("preview.saveLink")}
        </button>
      </div>

      {installing ? (
        <div className="mt-2.5 space-y-1">
          <div className="h-1 overflow-hidden rounded-full bg-white/8">
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, var(--accent), var(--accent-2))" }}
              animate={{ width: `${installing.pct}%` }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-[var(--faint)]">
            <span>{installing.stage}</span>
            <span className="tabular-nums">{installing.pct}%</span>
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-1 text-[10px] text-[var(--faint)]">
        <Package size={10} />
        <span className="mono">{preview.defaultFolder}</span>
        <span>·</span>
        <span className="mono">{preview.defaultId}</span>
      </div>
    </div>
  );
}
