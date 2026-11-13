import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Compass, Loader2, Plus, RefreshCw, Star } from "lucide-react";
import type { FeedCard } from "@/lib/types";
import { relativeDate } from "@/lib/utils";
import { useApp, useT } from "@/store";
import { KindIcon } from "./common";

export function Discover() {
  const t = useT();
  const lang = useApp((state) => state.settings?.language ?? "uk");
  const feed = useApp((state) => state.feed);
  const loading = useApp((state) => state.feedLoading);
  const loadFeed = useApp((state) => state.loadFeed);
  const analyze = useApp((state) => state.analyze);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);

  useEffect(() => {
    if (feed.length === 0) void loadFeed();
  }, [feed.length, loadFeed]);

  const add = async (card: FeedCard) => {
    setBusyUrl(card.url);
    await analyze(card.url);
    setBusyUrl(null);
  };

  return (
    <div className="scroll-area h-full px-7 pb-10">
      <div className="mx-auto max-w-[980px] space-y-3">
        <div className="flex items-center gap-2">
          <button className="btn !py-1.5 text-[11.5px]" disabled={loading} onClick={() => void loadFeed(true)}>
            <RefreshCw size={12} className={loading ? "spin-slow" : undefined} />
            {t("discover.refresh")}
          </button>
          <span className="ml-auto flex items-center gap-1 text-[10.5px] text-[var(--faint)]">
            <Compass size={11} />
            {t("discover.fromGithub")}
          </span>
        </div>

        {loading && feed.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-3">
            <Loader2 size={24} className="spin-slow" style={{ color: "var(--accent)" }} />
            <p className="text-[12px] text-[var(--faint)]">{t("discover.loadingFeed")}</p>
          </div>
        ) : feed.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
            <Compass size={30} strokeWidth={1.4} style={{ color: "var(--accent)" }} />
            <div>
              <h3 className="text-[14px] font-semibold">{t("discover.noFeed")}</h3>
              <p className="mt-1 text-[11.5px] text-[var(--faint)]">{t("discover.noFeedHint")}</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {feed.map((card, index) => (
              <motion.div
                key={card.url}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: Math.min(index * 0.03, 0.22) }}
                className="card-surface flex flex-col gap-2.5 p-3.5"
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-[var(--line)]"
                    style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                  >
                    <KindIcon kind={card.kind} size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[12.5px] font-semibold">{card.name}</h3>
                    <div className="truncate text-[10.5px] text-[var(--faint)]">{card.owner}</div>
                  </div>
                  <span className="flex shrink-0 items-center gap-0.5 text-[10.5px] tabular-nums text-[var(--faint)]">
                    <Star size={9} fill="currentColor" />
                    {card.stars}
                  </span>
                </div>

                <p className="line-clamp-3 min-h-[46px] text-[11.5px] leading-relaxed text-[var(--muted)]">
                  {card.summary}
                </p>

                <div className="flex flex-wrap gap-1">
                  {card.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="chip !py-0 !text-[9.5px]">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-auto flex items-center justify-between border-t border-[var(--line)] pt-2">
                  <span className="text-[10px] text-[var(--faint)]">
                    {card.pushedAt ? relativeDate(card.pushedAt, lang) : card.license ?? ""}
                  </span>
                  <button
                    className="btn !py-1 text-[10.5px]"
                    disabled={busyUrl === card.url}
                    onClick={() => void add(card)}
                  >
                    {busyUrl === card.url ? (
                      <Loader2 size={10} className="spin-slow" />
                    ) : (
                      <Plus size={10} />
                    )}
                    {t("discover.addToLibrary")}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
