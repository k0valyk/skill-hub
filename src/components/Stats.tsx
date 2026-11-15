import { useEffect } from "react";
import { motion } from "framer-motion";
import {
  Archive,
  BarChart3,
  Boxes,
  Copy,
  Coins,
  Database,
  RefreshCw,
  Server,
  Star,
  Zap,
} from "lucide-react";
import { KIND_ORDER, cn, formatBytes, formatNumber, riskTone } from "@/lib/utils";
import { useApp, useT } from "@/store";
import { BudgetBar, KindIcon, Stat } from "./common";

export function Stats() {
  const t = useT();
  const lang = useApp((state) => state.settings?.language ?? "uk");
  const stats = useApp((state) => state.stats);
  const duplicates = useApp((state) => state.duplicates);
  const loadStats = useApp((state) => state.loadStats);
  const selectItem = useApp((state) => state.selectItem);
  const budget = useApp((state) => state.budget);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const n = (value: number) => formatNumber(value, lang);
  const bytes = (value: number) => formatBytes(value, lang);

  const byKind = new Map(stats?.byKind ?? []);
  const maxKind = Math.max(1, ...KIND_ORDER.map((kind) => byKind.get(kind) ?? 0));

  return (
    <div className="scroll-area h-full px-7 pb-10">
      <div className="mx-auto max-w-[900px] space-y-3">
        <div className="flex items-center gap-2">
          <button className="btn !py-1.5 text-[11.5px]" onClick={() => void loadStats()}>
            <RefreshCw size={12} />
            {t("stats.refreshStats")}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat
            label={t("stats.totalItems")}
            value={n(stats?.total ?? 0)}
            icon={<Boxes size={15} />}
          />
          <Stat
            label={t("stats.enabledItems")}
            value={n(stats?.enabled ?? 0)}
            hint={budget ? `${budget.enabledCount} → ${n(budget.advertisedTokens)} ${t("common.tokens")}` : undefined}
            icon={<Zap size={15} />}
          />
          <Stat
            label={t("stats.mcpCalls")}
            value={n(stats?.mcpCalls ?? 0)}
            icon={<Server size={15} />}
          />
          <Stat
            label={t("stats.totalSize")}
            value={bytes(stats?.totalSize ?? 0)}
            icon={<Database size={15} />}
          />
        </div>

        <div className="grid gap-2.5 lg:grid-cols-2">
          <section className="card-surface space-y-3 p-4">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold">
              <BarChart3 size={14} style={{ color: "var(--accent)" }} />
              {t("stats.byKind")}
            </h2>
            <div className="space-y-2">
              {KIND_ORDER.map((kind) => {
                const count = byKind.get(kind) ?? 0;
                return (
                  <div key={kind} className="flex items-center gap-2">
                    <KindIcon kind={kind} size={12} className="shrink-0 text-[var(--muted)]" />
                    <span className="w-[104px] shrink-0 truncate text-[11.5px]">{t(`kind.${kind}` as Parameters<typeof t>[0])}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--track)]">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(count / maxKind) * 100}%` }}
                        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                        className="h-full rounded-full"
                        style={{ background: "linear-gradient(90deg, var(--accent), var(--accent-2))" }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right text-[10.5px] tabular-nums text-[var(--faint)]">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card-surface space-y-3 p-4">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold">
              <Coins size={14} style={{ color: "var(--accent)" }} />
              {t("stats.budgetTitle")}
            </h2>
            {budget ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-[22px] font-semibold tabular-nums">
                    {n(budget.advertisedTokens)}
                  </span>
                  <span className="text-[11px] text-[var(--faint)]">
                    / {n(budget.threshold)} {t("common.tokens")}
                  </span>
                </div>
                <BudgetBar used={budget.advertisedTokens} limit={budget.threshold} level={budget.level} />
                <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                  <div className="rounded-[8px] border border-[var(--line)] px-2.5 py-1.5">
                    <div className="text-[var(--faint)]">{t("stats.budgetUsed")}</div>
                    <div className="tabular-nums">{n(budget.advertisedTokens)}</div>
                  </div>
                  <div className="rounded-[8px] border border-[var(--line)] px-2.5 py-1.5">
                    <div className="text-[var(--faint)]">{t("detail.tokensFull")}</div>
                    <div className="tabular-nums">{n(budget.onDemandTokens)}</div>
                  </div>
                </div>
                <p className="text-[10.5px] leading-relaxed text-[var(--faint)]">{t("stats.estimateNote")}</p>
              </>
            ) : (
              <p className="text-[11.5px] text-[var(--faint)]">{t("common.loading")}</p>
            )}
          </section>
        </div>

        <div className="grid gap-2.5 lg:grid-cols-2">
          <section className="card-surface space-y-2.5 p-4">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold">
              <Star size={14} style={{ color: "var(--warn)" }} />
              {t("stats.topSkills")}
            </h2>
            {stats && stats.topSkills.length > 0 ? (
              <div className="space-y-1.5">
                {stats.topSkills.map(([id, count]) => (
                  <button
                    key={id}
                    onClick={() => selectItem(id)}
                    className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--hover)]"
                  >
                    <span className="mono min-w-0 flex-1 truncate text-[11.5px]">{id}</span>
                    <span className="text-[10.5px] tabular-nums text-[var(--faint)]">{count}×</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11.5px] text-[var(--faint)]">{t("stats.noTopSkills")}</p>
            )}
          </section>

          <section className="card-surface space-y-2.5 p-4">
            <div className="flex items-center gap-2">
              <Copy size={14} style={{ color: "var(--accent)" }} />
              <h2 className="text-[13px] font-semibold">{t("stats.duplicatesTitle")}</h2>
              <span className="ml-auto text-[10.5px] text-[var(--faint)]">{t("stats.duplicatesHint")}</span>
            </div>
            {duplicates.length === 0 ? (
              <p className="text-[11.5px] text-[var(--faint)]">{t("stats.noDuplicates")}</p>
            ) : (
              <div className="space-y-2">
                {duplicates.slice(0, 4).map((group, index) => (
                  <div
                    key={`${group.reason}-${index}`}
                    className="rounded-[8px] border border-[var(--line)] bg-white/[0.02] px-2.5 py-1.5"
                  >
                    <div className="text-[10px] uppercase tracking-wide text-[var(--faint)]">
                      {group.reason}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {group.items.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => selectItem(item.id)}
                          className={cn(
                            "chip !py-0.5 !text-[10px] transition-colors hover:border-[var(--accent)]",
                          )}
                          style={{ color: riskTone(item.risk.level) === "ok" ? undefined : undefined }}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] bg-white/[0.02] px-3 py-2 text-[10.5px] text-[var(--faint)]">
          <Archive size={12} />
          {t("stats.estimateNote")}
        </div>
      </div>
    </div>
  );
}
