import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Search, X } from "lucide-react";
import type { Profile } from "@/lib/types";
import { cn, itemSummary } from "@/lib/utils";
import { useApp, useT } from "@/store";
import { KindIcon, useEscape, useFocusTrap } from "./common";

export function ProfileEditor({
  open,
  onClose,
  profile,
}: {
  open: boolean;
  onClose: () => void;
  profile?: Profile | null;
}) {
  const t = useT();
  const items = useApp((state) => state.items);
  const saveProfile = useApp((state) => state.saveProfile);
  const settings = useApp((state) => state.settings);
  const lang = settings?.language ?? "uk";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEscape(open, onClose);
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? "");
    setDescription(profile?.description ?? "");
    setSelected(profile?.itemIds ?? []);
    setQuery("");
  }, [open, profile]);

  const filtered = items.filter((item) => {
    const haystack = `${item.name} ${item.tags.join(" ")} ${itemSummary(item, lang)}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const id =
      profile?.id ??
      `${name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9а-яіїєґ]+/gi, "-")
        .replace(/^-|-$/g, "")}-${Date.now().toString(36).slice(-4)}`;
    const ok = await saveProfile({
      id,
      name: name.trim(),
      description: description.trim(),
      itemIds: selected,
      createdAt: profile?.createdAt ?? new Date().toISOString(),
    });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={trapRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("profiles.title")}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="card-surface relative flex max-h-[76vh] w-full max-w-[560px] flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
              <div>
                <h2 className="text-[15px] font-semibold">
                  {profile ? t("profiles.save") : t("profiles.create")}
                </h2>
                <p className="mt-0.5 text-[11.5px] text-[var(--faint)]">{t("profiles.hint")}</p>
              </div>
              <button className="btn btn-ghost !p-2" onClick={onClose}>
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 border-b border-[var(--line)] px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="label">{t("profiles.name")}</span>
                  <input
                    className="input"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t("profiles.namePlaceholder")}
                    autoFocus
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="label">{t("profiles.description")}</span>
                  <input
                    className="input"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={t("profiles.descPlaceholder")}
                  />
                </label>
              </div>
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]"
                />
                <input
                  className="input pl-8"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("profiles.selectItems")}
                />
              </div>
            </div>

            <div className="scroll-area flex-1 px-2 py-2">
              {filtered.length === 0 ? (
                <p className="px-3 py-8 text-center text-[12px] text-[var(--faint)]">
                  {t("palette.noResults")}
                </p>
              ) : (
                filtered.map((item) => {
                  const active = selected.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => toggle(item.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left transition-colors",
                        active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-4 items-center justify-center rounded-[5px] border",
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
                        <Check size={11} strokeWidth={3} />
                      </span>
                      <KindIcon kind={item.kind} size={14} className="text-[var(--muted)]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-medium">{item.name}</div>
                        <div className="truncate text-[11px] text-[var(--faint)]">
                          {itemSummary(item, lang)}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--line)] px-5 py-3">
              <span className="text-[11.5px] text-[var(--faint)]">
                {selected.length} × {t("profiles.items").toLowerCase()}
              </span>
              <div className="flex gap-2">
                <button className="btn" onClick={onClose}>
                  {t("common.cancel")}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!name.trim() || saving}
                  onClick={() => void submit()}
                >
                  {t("profiles.save")}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
