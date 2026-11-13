import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Link2,
  Loader2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import type { Item, ItemPatch } from "@/lib/types";
import {
  cn,
  formatBytes,
  formatDate,
  itemSummary,
  relativeDate,
  splitSentences,
} from "@/lib/utils";
import { useApp, useT } from "@/store";
import { BudgetBar, KindIcon, RiskDot, Toggle } from "./common";

export function DetailDrawer() {
  const t = useT();
  const selectedId = useApp((state) => state.selectedId);
  const items = useApp((state) => state.items);
  const selectItem = useApp((state) => state.selectItem);
  const lang = useApp((state) => state.settings?.language ?? "uk");
  const item = items.find((entry) => entry.id === selectedId) ?? null;

  return (
    <AnimatePresence>
      {item ? (
        <motion.div
          key="drawer"
          className="fixed inset-0 z-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={() => selectItem(null)} />
          <motion.aside
            initial={{ x: 60, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="glass absolute right-0 top-0 flex h-full w-full max-w-[520px] flex-col border-l border-[var(--line)]"
          >
            <DetailContent item={item} lang={lang} onClose={() => selectItem(null)} t={t} />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

type TFn = ReturnType<typeof useT>;

function DetailContent({
  item,
  lang,
  onClose,
  t,
}: {
  item: Item;
  lang: "uk" | "en";
  onClose: () => void;
  t: TFn;
}) {
  const patchItem = useApp((state) => state.patchItem);
  const toggleItem = useApp((state) => state.toggleItem);
  const removeItem = useApp((state) => state.removeItem);
  const readText = useApp((state) => state.readText);
  const installPreview = useApp((state) => state.installPreview);
  const updateItem = useApp((state) => state.updateItem);
  const openPath = useApp((state) => state.openPath);
  const openUrl = useApp((state) => state.openUrl);
  const updates = useApp((state) => state.updates);
  const budget = useApp((state) => state.budget);

  const [notes, setNotes] = useState(item.notes);
  const [tagDraft, setTagDraft] = useState("");
  const [name, setName] = useState(item.name);
  const [editingName, setEditingName] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removeFiles, setRemoveFiles] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    setNotes(item.notes);
    setName(item.name);
    setContent(null);
    setConfirmDelete(false);
    setRemoveFiles(false);
  }, [item.id, item.notes, item.name]);

  const update = updates.find((entry) => entry.id === item.id);
  const sentences = useMemo(() => splitSentences(itemSummary(item, lang)), [item, lang]);
  const what = sentences[0] ?? "";
  const does = sentences[1] ?? "";
  const why = sentences.slice(2).join(" ") || sentences[0] || "";

  const patch = (value: ItemPatch) => void patchItem(item.id, value);

  const addTag = () => {
    const tag = tagDraft.trim().toLowerCase().replace(/\s+/g, "-");
    if (!tag || item.tags.includes(tag)) {
      setTagDraft("");
      return;
    }
    patch({ tags: [...item.tags, tag] });
    setTagDraft("");
  };

  const toggleContent = async () => {
    if (content !== null) {
      setContent(null);
      return;
    }
    setContentLoading(true);
    const text = await readText(item.id);
    setContent(text ?? "");
    setContentLoading(false);
  };

  return (
    <>
      <div className="flex items-start gap-3 border-b border-[var(--line)] px-5 py-4">
        <div
          className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-[var(--line)]"
          style={{
            background: item.enabled ? "var(--accent-soft)" : "rgba(255,255,255,0.04)",
            color: item.enabled ? "var(--accent)" : "var(--muted)",
          }}
        >
          <KindIcon kind={item.kind} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          {editingName ? (
            <input
              className="input h-8 text-[15px] font-semibold"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              onBlur={() => {
                setEditingName(false);
                if (name.trim() && name !== item.name) patch({ name: name.trim() });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setName(item.name);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <h2
              className="cursor-text truncate text-[16px] font-semibold leading-tight"
              onClick={() => setEditingName(true)}
              title={t("common.edit")}
            >
              {item.name}
            </h2>
          )}
          <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--faint)]">
            <KindIcon kind={item.kind} size={11} />
            <span>{t(`kind.${item.kind}.one` as TranslationKey)}</span>
            {item.sourceUrl ? (
              <>
                <span>·</span>
                <span className="tabular-nums">★ {item.stars}</span>
              </>
            ) : null}
            <RiskDot level={item.risk.level} />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className={cn("btn btn-ghost !p-1.5", item.favorite && "text-[var(--warn)]")}
            onClick={() => patch({ favorite: !item.favorite })}
            title={t("detail.favorite")}
          >
            <Star size={15} fill={item.favorite ? "currentColor" : "none"} />
          </button>
          <button className="btn btn-ghost !p-1.5" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="scroll-area flex-1 space-y-5 px-5 py-4">
        <div className="flex items-center justify-between rounded-[12px] border border-[var(--line)] bg-white/[0.025] px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="text-[12px] font-medium">
              {item.enabled ? t("card.disable") : t("card.enable")}
            </div>
            <div className="text-[10.5px] text-[var(--faint)]">
              {item.enabled
                ? t("detail.enabledIn") + `: ${item.scopes.join(", ") || t("card.global")}`
                : t("detail.budgetImpact", { n: item.tokensEst })}
            </div>
          </div>
          <Toggle
            checked={item.enabled}
            onChange={(next) => void toggleItem(item.id, next)}
            label={t("card.enable")}
          />
        </div>

        {budget && item.enabled ? (
          <div className="space-y-1.5">
            <BudgetBar used={budget.advertisedTokens} limit={budget.threshold} level={budget.level} />
            <div className="flex justify-between text-[10.5px] text-[var(--faint)]">
              <span>{t("stats.budgetUsed")}</span>
              <span className="tabular-nums">
                {budget.advertisedTokens} / {budget.threshold}
              </span>
            </div>
          </div>
        ) : null}

        {!item.hasLocalFiles ? (
          <div className="flex items-start gap-2 rounded-[10px] border border-[var(--warn)]/30 bg-[var(--warn)]/8 px-3 py-2 text-[11.5px] leading-relaxed">
            <Link2 size={13} className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} />
            <div className="space-y-1.5">
              <p>{t("detail.notDownloaded")}</p>
              {item.sourceUrl ? (
                <button
                  className="btn !py-1 text-[11px]"
                  onClick={() =>
                    void installPreview({
                      url: item.sourceUrl ?? "",
                      name: item.name,
                      kind: item.kind,
                      owner: "",
                      repo: item.name,
                      branch: "main",
                      subPath: null,
                      subIsFile: false,
                      summaryUk: item.summaryUk,
                      summaryEn: item.summaryEn,
                      tags: item.tags,
                      license: item.license,
                      stars: item.stars,
                      pushedAt: item.pushedAt,
                      sizeBytes: item.sizeBytes,
                      defaultFolder: item.kind,
                      defaultId: item.id,
                      risk: item.risk,
                      warnings: [],
                      descriptionSource: "rules",
                      tokensUsed: 0,
                      cached: false,
                      fileCount: 0,
                      isGist: false,
                      isAwesome: false,
                    })
                  }
                >
                  <Download size={12} />
                  {t("detail.downloadNow")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="label">{t("detail.about")}</h3>
            {update?.behind ? (
              <button
                className="btn !py-1 text-[10.5px]"
                disabled={updating}
                onClick={async () => {
                  setUpdating(true);
                  await updateItem(item.id);
                  setUpdating(false);
                }}
              >
                {updating ? <Loader2 size={11} className="spin-slow" /> : <Download size={11} />}
                {updating ? t("common.updating") : t("common.update")}
              </button>
            ) : null}
          </div>
          <div className="space-y-2.5">
            {what ? (
              <DetailBlock icon={<FileText size={12} />} title={t("detail.whatItDoes")} text={what} />
            ) : null}
            {does ? (
              <DetailBlock icon={<Code2 size={12} />} title={t("detail.whatItDoes")} text={does} />
            ) : null}
            {why ? (
              <DetailBlock icon={<Sparkles size={12} />} title={t("detail.whyUseful")} text={why} />
            ) : (
              <p className="text-[12px] text-[var(--faint)]">{t("detail.emptySummary")}</p>
            )}
          </div>
          {item.sourceRef ? (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-[var(--faint)]">
              <span className="chip !py-0.5">
                <span className="mono">{item.sourceRef.slice(0, 7)}</span>
              </span>
              {item.license ? <span className="chip !py-0.5">{item.license}</span> : null}
              <span>{formatBytes(item.sizeBytes)}</span>
              <span>·</span>
              <span>{t("detail.tokensShort")}: ≈{item.tokensEst}</span>
            </div>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="label">{t("detail.tags")}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {item.tags.map((tag) => (
              <span key={tag} className="chip group/tag">
                {tag}
                <button
                  className="ml-0.5 text-[var(--faint)] opacity-0 transition-opacity group-hover/tag:opacity-100"
                  onClick={() => patch({ tags: item.tags.filter((entry) => entry !== tag) })}
                >
                  <X size={9} />
                </button>
              </span>
            ))}
            <input
              className="input h-[24px] w-[120px] !rounded-full !px-2.5 !text-[11px]"
              value={tagDraft}
              placeholder="+ тег"
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addTag();
                if (event.key === "Backspace" && !tagDraft && item.tags.length > 0) {
                  patch({ tags: item.tags.slice(0, -1) });
                }
              }}
              onBlur={addTag}
            />
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="label">{t("detail.notes")}</h3>
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  onClick={() => patch({ rating: item.rating === value ? 0 : value })}
                  className="p-0.5"
                  style={{ color: value <= item.rating ? "var(--warn)" : "var(--faint)" }}
                >
                  <Star size={11} fill={value <= item.rating ? "currentColor" : "none"} />
                </button>
              ))}
            </div>
          </div>
          <textarea
            className="input min-h-[74px] resize-none text-[12px] leading-relaxed"
            value={notes}
            placeholder={t("detail.notesPlaceholder")}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => notes !== item.notes && patch({ notes })}
          />
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="label">{t("detail.riskTitle")}</h3>
            <RiskDot level={item.risk.level} />
          </div>
          {item.risk.findings.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--ok)]">
              <ShieldCheck size={13} />
              {t("detail.noFindings")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {item.risk.findings.map((finding, index) => (
                <div
                  key={`${finding.title}-${index}`}
                  className="rounded-[9px] border border-[var(--line)] bg-white/[0.02] px-2.5 py-2"
                >
                  <div className="flex items-center gap-1.5 text-[11.5px] font-medium">
                    <CircleAlert
                      size={11}
                      style={{
                        color: finding.severity === "high" ? "var(--danger)" : "var(--warn)",
                      }}
                    />
                    {finding.title}
                    {finding.file ? (
                      <span className="mono ml-auto text-[9.5px] text-[var(--faint)]">
                        {finding.file}
                        {finding.line ? `:${finding.line}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted)]">
                    {finding.detail}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <button className="flex w-full items-center justify-between" onClick={() => void toggleContent()}>
            <h3 className="label">{t("detail.content")}</h3>
            <span className="flex items-center gap-1 text-[11px] text-[var(--faint)]">
              {contentLoading ? (
                <Loader2 size={11} className="spin-slow" />
              ) : (
                <ChevronRight
                  size={12}
                  className={cn("transition-transform", content !== null && "rotate-90")}
                />
              )}
              {content !== null ? t("detail.hideContent") : t("detail.showContent")}
            </span>
          </button>
          {content !== null ? (
            <pre className="mono max-h-[300px] overflow-auto rounded-[10px] border border-[var(--line)] bg-black/30 p-3 text-[10.5px] leading-relaxed text-[var(--muted)]">
              {content || t("preview.clean")}
            </pre>
          ) : null}
        </section>

        <section className="space-y-1.5">
          <h3 className="label">{t("detail.manifest")}</h3>
          <div className="space-y-1 rounded-[10px] border border-[var(--line)] bg-white/[0.02] p-3 text-[11px]">
            <MetaRow label={t("detail.path")} value={item.path} mono />
            <MetaRow label={t("detail.added")} value={formatDate(item.addedAt, lang)} />
            <MetaRow label={t("detail.updated")} value={relativeDate(item.updatedAt, lang)} />
            <MetaRow label={t("detail.size")} value={formatBytes(item.sizeBytes)} />
            <MetaRow label={t("detail.license")} value={item.license || t("detail.noLicense")} />
            <MetaRow label={t("detail.tokensFull")} value={`≈${item.tokensEst * 12} ${t("common.tokens")}`} />
            {item.commit ? (
              <MetaRow label={t("detail.commit")} value={item.commit.slice(0, 10)} mono />
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button className="btn !py-1.5 text-[11.5px]" onClick={() => void openPath(item.path)}>
              <FolderOpen size={12} />
              {t("common.openFolder")}
            </button>
            {item.sourceUrl ? (
              <button className="btn !py-1.5 text-[11.5px]" onClick={() => void openUrl(item.sourceUrl ?? "")}>
                <ExternalLink size={12} />
                {t("detail.openSource")}
              </button>
            ) : null}
          </div>
        </section>
      </div>

      <div className="border-t border-[var(--line)] px-5 py-3">
        {confirmDelete ? (
          <div className="space-y-2.5">
            <div className="flex items-start gap-2">
              <Trash2 size={14} className="mt-0.5 shrink-0" style={{ color: "var(--danger)" }} />
              <div>
                <div className="text-[12.5px] font-medium">{t("detail.deleteTitle")}</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--faint)]">
                  {t("detail.deleteText")}
                </p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-[11.5px] text-[var(--muted)]">
              <input
                type="checkbox"
                checked={removeFiles}
                onChange={(event) => setRemoveFiles(event.target.checked)}
              />
              {t("detail.deleteFiles")}
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn !py-1.5" onClick={() => setConfirmDelete(false)}>
                <Undo2 size={12} />
                {t("common.cancel")}
              </button>
              <button
                className="btn !py-1.5"
                style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                onClick={async () => {
                  const ok = await removeItem(item.id, removeFiles);
                  if (ok) onClose();
                }}
              >
                <Trash2 size={12} />
                {t("common.delete")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <button
              className="btn btn-ghost !py-1.5 text-[11.5px]"
              style={{ color: "var(--danger)" }}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={12} />
              {t("common.delete")}
            </button>
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--faint)]">
              <Check size={11} style={{ color: "var(--ok)" }} />
              {item.installState === "linked" ? t("card.linkOnly") : t("card.local")}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function DetailBlock({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-[10px] border border-[var(--line)] bg-white/[0.02] px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--faint)]">
        {icon}
        {title}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{text}</p>
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-[var(--faint)]">{label}</span>
      <span className={cn("min-w-0 text-right text-[var(--muted)]", mono && "mono break-all")}>
        {value}
      </span>
    </div>
  );
}
