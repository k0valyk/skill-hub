import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bug, Check, FolderOpen, Loader2, Play, RotateCw, ShieldAlert, Square, X } from "lucide-react";
import { call } from "@/lib/api";
import type { AuditReportSummary, QaReportSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApp, useT } from "@/store";

type Phase = "idle" | "qa" | "fix" | "audit" | "report" | "done" | "error";

interface LogLine {
  id: string;
  time: string;
  text: string;
  tone: "info" | "ok" | "error" | "muted";
}

export function AgentQaCycle({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const agents = useApp((state) => state.agents);
  const settings = useApp((state) => state.settings);
  const runAgentTaskAndWait = useApp((state) => state.runAgentTaskAndWait);
  const cancelAgentTask = useApp((state) => state.cancelAgentTask);
  const chooseFolder = useApp((state) => state.chooseFolder);
  const openPath = useApp((state) => state.openPath);

  const qa = agents.find((agent) => agent.techName === "qa-tester" || agent.key === "qa-tester");
  const fixer = agents.find((agent) => agent.techName === "fixer" || agent.key === "fixer");
  const auditor = agents.find((agent) => agent.techName === "auditor" || agent.key === "auditor");

  const [project, setProject] = useState("");
  const [rounds, setRounds] = useState(5);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [report, setReport] = useState<QaReportSummary | null>(null);
  const [audit, setAudit] = useState<AuditReportSummary | null>(null);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [doneStages, setDoneStages] = useState(0);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setProject(qa?.projects[0] ?? fixer?.projects[0] ?? settings?.projectDir ?? "");
    setRounds(5);
    setRound(0);
    setPhase("idle");
    setRunning(false);
    setLogs([]);
    setReport(null);
    setAudit(null);
    setCurrentAgent(null);
    setDoneStages(0);
    cancelRef.current = false;
  }, [open, qa?.id, fixer?.id, settings?.projectDir]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelRef.current = true;
      if (running && currentAgent) void cancelAgentTask(currentAgent);
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, running, currentAgent, cancelAgentTask, onClose]);

  const log = (text: string, tone: LogLine["tone"] = "info") => {
    setLogs((current) => [
      ...current.slice(-120),
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        time: new Date().toLocaleTimeString(),
        text,
        tone,
      },
    ]);
  };

  const readReport = async () => {
    const summary = await call<QaReportSummary>("agent_qa_report", { project });
    setReport(summary);
    return summary;
  };

  const readAudit = async () => {
    const summary = await call<AuditReportSummary>("agent_audit_report", { project });
    setAudit(summary);
    return summary;
  };

  const auditPassed = (summary: AuditReportSummary | null) =>
    Boolean(summary?.exists && summary.verdict === "pass" && summary.falseFixes === 0);

  const openIssues = (summary: QaReportSummary | null) =>
    (summary?.openCritical ?? 0) + (summary?.openHigh ?? 0);

  const start = async () => {
    if (!qa || !fixer || !project.trim()) return;
    const stagesPerRound = auditor ? 3 : 2;
    cancelRef.current = false;
    setRunning(true);
    setLogs([]);
    setReport(null);
    setAudit(null);
    setDoneStages(0);
    let lastReport: QaReportSummary | null = null;
    let outcome: "done" | "error" | "max" = "max";
    try {
      for (let index = 1; index <= rounds; index += 1) {
        if (cancelRef.current) break;
        setRound(index);
        setPhase("qa");
        setCurrentAgent(qa.id);
        log(t("qa.logQa", { round: index, rounds }), "info");
        const qaResult = await runAgentTaskAndWait(
          qa.id,
          [
            `Круг ${index}/${rounds}. Проєкт: ${project}.`,
            "Виконай повну QA-перевірку Skill Hub за своєю інструкцією: автоматичні тести, ключові UI-сценарії, крайні випадки.",
            "Запиши структурований звіт у reports/qa-report.json (status: open для кожного бага) і відповідай коротко.",
          ].join("\n"),
          project,
          true,
        );
        if (!qaResult || qaResult.status !== "ok") {
          log(t("qa.failed", { phase: t("qa.phaseQa") }), "error");
          setPhase("error");
          outcome = "error";
          break;
        }
        log(
          `${t("qa.qaDone")} · ${qaResult.tokensIn + qaResult.tokensOut} ${t("common.tokens")}`,
          "ok",
        );
        setPhase("report");
        setDoneStages((index - 1) * stagesPerRound + 1);
        lastReport = await readReport();
        if (!lastReport.exists) {
          log(t("qa.reportMissing"), "error");
          setPhase("error");
          outcome = "error";
          break;
        }
        log(
          `${t("qa.critical")}: ${lastReport.openCritical} · ${t("qa.high")}: ${lastReport.openHigh} · ${t("qa.medium")}: ${lastReport.openMedium} · ${t("qa.low")}: ${lastReport.openLow}`,
          openIssues(lastReport) > 0 ? "error" : "ok",
        );

        if (openIssues(lastReport) > 0) {
          if (cancelRef.current) break;
          setPhase("fix");
          setCurrentAgent(fixer.id);
          log(t("qa.logFix", { round: index }), "info");
          const fixResult = await runAgentTaskAndWait(
            fixer.id,
            [
              `Круг ${index}. Проєкт: ${project}.`,
              "Прочитай reports/qa-report.json. Виправ відкриті баги за пріоритетом critical → high → medium → low.",
              "Після кожного виправлення запускай тести, оновлюй status/fixSummary/files у звіті.",
              "Перед великими змінами зроби git-коміт або резервну копію. Напиши короткий підсумок.",
            ].join("\n"),
            project,
            true,
          );
          if (!fixResult || fixResult.status !== "ok") {
            log(t("qa.failed", { phase: t("qa.phaseFix") }), "error");
            setPhase("error");
            outcome = "error";
            break;
          }
          log(
            `${t("qa.fixDone")} · ${fixResult.tokensIn + fixResult.tokensOut} ${t("common.tokens")}`,
            "ok",
          );
          setPhase("report");
          setDoneStages((index - 1) * stagesPerRound + 2);
          lastReport = await readReport();
          if (!lastReport.exists) {
            log(t("qa.reportMissing"), "error");
            setPhase("error");
            outcome = "error";
            break;
          }
          log(
            `${t("qa.critical")}: ${lastReport.openCritical} · ${t("qa.high")}: ${lastReport.openHigh} · ${t("qa.medium")}: ${lastReport.openMedium} · ${t("qa.low")}: ${lastReport.openLow}`,
            openIssues(lastReport) > 0 ? "error" : "ok",
          );
        }

        // Аудитор перевіряє не лише звіт, а й реальність виправлень: код, тести, регресії.
        if (auditor) {
          if (cancelRef.current) break;
          setPhase("audit");
          setCurrentAgent(auditor.id);
          log(t("qa.logAudit", { round: index }), "info");
          const auditResult = await runAgentTaskAndWait(
            auditor.id,
            [
              `Круг ${index}. Проєкт: ${project}.`,
              "Перевір роботу Тестувальника і Виправляча: reports/qa-report.json, reports/fix-report.md, git diff і тести.",
              "Нічого не виправляй. Запиши вердикт у reports/audit-report.json за своєю інструкцією.",
            ].join("\n"),
            project,
            true,
          );
          if (!auditResult || auditResult.status !== "ok") {
            log(t("qa.failed", { phase: t("qa.auditor") }), "error");
            setPhase("error");
            outcome = "error";
            break;
          }
          setPhase("report");
          setDoneStages(index * stagesPerRound);
          const summary = await readAudit();
          if (!summary.exists) {
            log(t("qa.auditMissing"), "error");
            if (openIssues(lastReport) === 0) {
              setPhase("done");
              outcome = "done";
              break;
            }
          } else {
            log(
              `${t("qa.auditDone")} · ${t("qa.auditStats", {
                verified: summary.verified,
                partial: summary.partial,
                false: summary.falseFixes,
              })}`,
              summary.verdict === "pass" ? "ok" : "error",
            );
            log(
              summary.testsOk ? t("qa.auditTestsOk") : t("qa.auditTestsFail"),
              summary.testsOk ? "ok" : "error",
            );
            log(
              t("qa.auditVerdict", { verdict: summary.verdict.toUpperCase() }),
              summary.verdict === "pass" ? "ok" : "error",
            );
            if (openIssues(lastReport) === 0 && auditPassed(summary)) {
              setPhase("done");
              log(t("qa.logDone"), "ok");
              outcome = "done";
              break;
            }
            if (openIssues(lastReport) === 0) {
              log(t("qa.auditFailed"), "error");
            }
          }
          continue;
        }

        if (openIssues(lastReport) === 0) {
          setPhase("done");
          log(t("qa.logDone"), "ok");
          outcome = "done";
          break;
        }
      }
      if (cancelRef.current) {
        setPhase("error");
        log(t("qa.cancelled"), "muted");
      } else if (outcome === "max") {
        log(t("qa.roundsExhausted"), "error");
        setPhase("done");
      }
    } catch (error) {
      log(String(error), "error");
      setPhase("error");
    } finally {
      setCurrentAgent(null);
      setRunning(false);
    }
  };

  const stop = () => {
    cancelRef.current = true;
    if (currentAgent) void cancelAgentTask(currentAgent);
    log(t("qa.stopping"), "muted");
  };

  const close = () => {
    if (running) stop();
    onClose();
  };

  const canStart = Boolean(qa && fixer && project.trim());
  const totalStages = Math.max(1, rounds * (auditor ? 3 : 2));
  const progress =
    phase === "done"
      ? 100
      : Math.min(
          99,
          Math.max(running ? 6 : 0, Math.round((doneStages / totalStages) * 100)),
        );

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6 pt-[7vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="fixed inset-0 bg-black/55 backdrop-blur-sm" onClick={close} />
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="card-surface relative z-10 flex max-h-[86vh] w-full max-w-[680px] flex-col overflow-hidden"
          >
            <header className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                  <Bug size={15} style={{ color: "var(--accent)" }} />
                  {t("qa.title")}
                </h2>
                <p className="mt-0.5 text-[11.5px] text-[var(--faint)]">{t("qa.hint")}</p>
              </div>
              <button className="btn btn-ghost !p-2" onClick={close}>
                <X size={16} />
              </button>
            </header>

            <div className="scroll-area flex-1 space-y-3 px-5 py-4">
              {!qa || !fixer ? (
                <div className="flex items-start gap-2 rounded-[10px] border border-[var(--warn)]/35 bg-[var(--warn)]/8 px-3 py-2 text-[11.5px]">
                  <ShieldAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} />
                  {t("qa.missing")}
                </div>
              ) : !auditor ? (
                <div className="flex items-start gap-2 rounded-[10px] border border-[var(--warn)]/35 bg-[var(--warn)]/8 px-3 py-2 text-[11.5px]">
                  <ShieldAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} />
                  {t("qa.auditMissing")}
                </div>
              ) : null}

              <div className="grid gap-2.5 sm:grid-cols-[1fr_110px]">
                <label className="space-y-1.5">
                  <span className="label">{t("qa.project")}</span>
                  <div className="flex gap-1.5">
                    <input
                      className="input h-[32px] mono min-w-0 flex-1 text-[10.5px]"
                      value={project}
                      onChange={(event) => setProject(event.target.value)}
                      placeholder="D:\\plugin hub"
                      disabled={running}
                    />
                    <button
                      className="btn !px-2 !py-1 text-[10.5px]"
                      disabled={running}
                      onClick={async () => {
                        const folder = await chooseFolder();
                        if (folder) setProject(folder);
                      }}
                    >
                      <FolderOpen size={11} />
                    </button>
                  </div>
                </label>
                <label className="space-y-1.5">
                  <span className="label">{t("qa.rounds")}</span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    className="input h-[32px] text-[11.5px]"
                    value={rounds}
                    disabled={running}
                    onChange={(event) =>
                      setRounds(Math.min(5, Math.max(1, Number(event.target.value) || 1)))
                    }
                  />
                </label>
              </div>

              <div className="space-y-2 rounded-[10px] border border-[var(--line)] bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5">
                    {running ? (
                      <Loader2 size={12} className="spin-fast" style={{ color: "var(--accent)" }} />
                    ) : phase === "done" ? (
                      <Check size={12} style={{ color: "var(--ok)" }} />
                    ) : phase === "error" ? (
                      <ShieldAlert size={12} style={{ color: "var(--danger)" }} />
                    ) : (
                      <RotateCw size={12} className="text-[var(--faint)]" />
                    )}
                    {t(`qa.phase${phase[0].toUpperCase() + phase.slice(1)}` as Parameters<typeof t>[0])}
                  </span>
                  <span className="tabular-nums text-[var(--faint)]">
                    {round}/{rounds}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-[var(--track)]">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg, var(--accent), var(--accent-2))" }}
                    animate={{ width: `${phase === "done" ? 100 : progress}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
                {report ? (
                  <div className="grid grid-cols-4 gap-1.5 pt-1 text-center text-[10px]">
                    {[
                      ["qa.critical", report.openCritical, "var(--danger)"],
                      ["qa.high", report.openHigh, "var(--warn)"],
                      ["qa.medium", report.openMedium, "var(--accent)"],
                      ["qa.low", report.openLow, "var(--faint)"],
                    ].map(([key, value, color]) => (
                      <div key={key as string} className="rounded-[8px] border border-[var(--line)] px-1.5 py-1">
                        <div className="tabular-nums text-[13px] font-semibold" style={{ color: color as string }}>
                          {value as number}
                        </div>
                        <div className="text-[var(--faint)]">{t(key as Parameters<typeof t>[0])}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {audit?.exists ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] border border-[var(--line)] px-2 py-1.5 text-[10px]">
                    <span
                      className="flex items-center gap-1 font-semibold"
                      style={{
                        color:
                          audit.verdict === "pass"
                            ? "var(--ok)"
                            : audit.verdict === "fail"
                              ? "var(--danger)"
                              : "var(--warn)",
                      }}
                    >
                      {audit.verdict === "pass" ? <Check size={11} /> : <ShieldAlert size={11} />}
                      {t("qa.auditVerdict", { verdict: audit.verdict.toUpperCase() })}
                    </span>
                    <span className="text-[var(--faint)]">
                      {t("qa.auditStats", {
                        verified: audit.verified,
                        partial: audit.partial,
                        false: audit.falseFixes,
                      })}
                    </span>
                    <span className="text-[var(--faint)]">
                      {audit.testsOk ? t("qa.auditTestsOk") : t("qa.auditTestsFail")}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="scroll-area max-h-[240px] space-y-1 rounded-[10px] border border-[var(--line)] bg-black/20 px-3 py-2">
                {logs.length === 0 ? (
                  <p className="text-[11px] text-[var(--faint)]">{t("qa.logsEmpty")}</p>
                ) : (
                  logs.map((line) => (
                    <div key={line.id} className="flex gap-2 text-[10.5px] leading-relaxed">
                      <span className="shrink-0 tabular-nums text-[var(--faint)]">{line.time}</span>
                      <span
                        className={cn(
                          line.tone === "ok" && "text-[var(--ok)]",
                          line.tone === "error" && "text-[var(--danger)]",
                          line.tone === "muted" && "text-[var(--faint)]",
                          line.tone === "info" && "text-[var(--muted)]",
                        )}
                      >
                        {line.text}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3">
              <button
                className="btn !py-1.5 text-[11px]"
                disabled={!project.trim()}
                onClick={() => void openPath(`${project.replace(/[\\/]$/, "")}/reports`)}
              >
                <FolderOpen size={12} /> {t("qa.openReports")}
              </button>
              <div className="flex gap-2">
                <button className="btn !py-1.5 text-[11.5px]" onClick={close}>
                  {t("common.close")}
                </button>
                {running ? (
                  <button
                    className="btn !py-1.5 text-[11.5px]"
                    style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                    onClick={stop}
                  >
                    <Square size={11} /> {t("qa.stop")}
                  </button>
                ) : (
                  <button
                    className="btn btn-primary !py-1.5 text-[11.5px]"
                    disabled={!canStart}
                    onClick={() => void start()}
                  >
                    <Play size={12} /> {t("qa.start")}
                  </button>
                )}
              </div>
            </footer>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
