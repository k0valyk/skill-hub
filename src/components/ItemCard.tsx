import { memo } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, Link2, Star } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import type { Item } from "@/lib/types";
import { cn, formatBytes, itemSummary, relativeDate } from "@/lib/utils";
import { useApp, useT } from "@/store";
import { KindIcon, RiskDot, Toggle } from "./common";

function ItemCardBase({ item, index }: { item: Item; index: number }) {
  const t = useT();
  const lang = useApp((state) => state.settings?.language ?? "uk");
  const selectItem = useApp((state) => state.selectItem);
  const toggleItem = useApp((state) => state.toggleItem);
  const patchItem = useApp((state) => state.patchItem);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{
        duration: 0.3,
        delay: Math.min(index * 0.025, 0.24),
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -3 }}
      onClick={() => selectItem(item.id)}
      className={cn(
        "card-surface group relative flex cursor-pointer flex-col gap-3 p-4 transition-colors",
        item.enabled ? "ring-1 ring-[var(--accent-soft)]" : "hover:border-[var(--line-strong)]",
      )}
    >
      {item.enabled ? (
        <span
          className="absolute inset-x-4 top-0 h-px opacity-80"
          style={{ background: "linear-gradient(90deg, transparent, var(--accent), transparent)" }}
        />
      ) : null}

      <div className="flex items-start gap-2.5">
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-[var(--line)]"
          style={{
            background: item.enabled ? "var(--accent-soft)" : "rgba(255,255,255,0.035)",
            color: item.enabled ? "var(--accent)" : "var(--muted)",
          }}
        >
          <KindIcon kind={item.kind} size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold leading-tight">{item.name}</h3>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[var(--faint)]">
            <span className="truncate">{t(`kind.${item.kind}.one` as TranslationKey)}</span>
            {item.sourceUrl ? (
              <>
                <span>·</span>
                <span className="truncate tabular-nums">★ {item.stars}</span>
              </>
            ) : null}
            {!item.hasLocalFiles ? (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-0.5 text-[var(--warn)]">
                  <Link2 size={9} />
                  {t("card.linkOnly")}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <button
          onClick={(event) => {
            event.stopPropagation();
            void patchItem(item.id, { favorite: !item.favorite });
          }}
          className={cn(
            "rounded-md p-1 transition-colors",
            item.favorite
              ? "text-[var(--warn)]"
              : "text-[var(--faint)] opacity-0 hover:text-[var(--warn)] group-hover:opacity-100",
          )}
          title={t("card.favorite")}
        >
          <Star size={13} fill={item.favorite ? "currentColor" : "none"} />
        </button>
      </div>

      <p className="line-clamp-3 min-h-[48px] text-[12px] leading-relaxed text-[var(--muted)]">
        {itemSummary(item, lang) || t("detail.emptySummary")}
      </p>

      <div className="flex flex-wrap gap-1">
        {item.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="chip !py-0.5 !text-[10px]">
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--line)] pt-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10.5px] tabular-nums text-[var(--faint)]">
            {t("card.tokens", { n: item.tokensEst })} · {formatBytes(item.sizeBytes, lang)}
          </span>
          <RiskDot level={item.risk.level} />
        </div>
        <div className="flex items-center gap-2">
          <ArrowUpRight
            size={13}
            className="text-[var(--faint)] opacity-0 transition-opacity group-hover:opacity-100"
          />
          <Toggle
            checked={item.enabled}
            onChange={(next) => void toggleItem(item.id, next)}
            label={item.enabled ? t("card.disable") : t("card.enable")}
          />
        </div>
      </div>

      {item.pushedAt ? (
        <span className="pointer-events-none absolute right-4 top-[52px] text-[9.5px] text-[var(--faint)] opacity-0 transition-opacity group-hover:opacity-100">
          {relativeDate(item.pushedAt, lang)}
        </span>
      ) : null}
    </motion.article>
  );
}

export const ItemCard = memo(ItemCardBase);

export function ItemRow({ item, index }: { item: Item; index: number }) {
  const t = useT();
  const lang = useApp((state) => state.settings?.language ?? "uk");
  const selectItem = useApp((state) => state.selectItem);
  const toggleItem = useApp((state) => state.toggleItem);
  const patchItem = useApp((state) => state.patchItem);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24, delay: Math.min(index * 0.015, 0.18) }}
      onClick={() => selectItem(item.id)}
      className="card-surface group flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors hover:border-[var(--line-strong)]"
    >
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded-[9px] border border-[var(--line)]"
        style={{
          background: item.enabled ? "var(--accent-soft)" : "rgba(255,255,255,0.03)",
          color: item.enabled ? "var(--accent)" : "var(--muted)",
        }}
      >
        <KindIcon kind={item.kind} size={13} />
      </div>
      <div className="min-w-0 flex-[1.4]">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium">{item.name}</span>
          {item.favorite ? <Star size={10} fill="currentColor" style={{ color: "var(--warn)" }} /> : null}
        </div>
        <div className="truncate text-[10.5px] text-[var(--faint)]">{itemSummary(item, lang)}</div>
      </div>
      <div className="hidden min-w-0 flex-1 flex-wrap gap-1 lg:flex">
        {item.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="chip !py-0 !text-[9.5px]">
            {tag}
          </span>
        ))}
      </div>
      <RiskDot level={item.risk.level} />
      <span className="hidden w-[92px] text-right text-[10.5px] tabular-nums text-[var(--faint)] md:block">
        {t("card.tokens", { n: item.tokensEst })}
      </span>
      <button
        onClick={(event) => {
          event.stopPropagation();
          void patchItem(item.id, { favorite: !item.favorite });
        }}
        className={cn(
          "rounded p-1",
          item.favorite ? "text-[var(--warn)]" : "text-[var(--faint)] opacity-0 group-hover:opacity-100",
        )}
      >
        <Star size={12} fill={item.favorite ? "currentColor" : "none"} />
      </button>
      <Toggle
        checked={item.enabled}
        onChange={(next) => void toggleItem(item.id, next)}
        label={item.enabled ? t("card.disable") : t("card.enable")}
      />
    </motion.div>
  );
}
