import { useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { Plus, RotateCcw } from "lucide-react";
import { EmptyState } from "@/components/common";
import { ItemCard, ItemRow } from "@/components/ItemCard";
import { filterItems, sortItems } from "@/lib/utils";
import { useApp, useT } from "@/store";

export function LibraryView() {
  const t = useT();
  const items = useApp((state) => state.items);
  const query = useApp((state) => state.query);
  const kindFilter = useApp((state) => state.kindFilter);
  const sort = useApp((state) => state.sort);
  const layout = useApp((state) => state.layout);
  const setKindFilter = useApp((state) => state.setKindFilter);
  const setQuery = useApp((state) => state.setQuery);
  const focusAdd = useApp((state) => state.focusAdd);

  const visible = useMemo(
    () => sortItems(filterItems(items, { query, kind: kindFilter }), sort),
    [items, query, kindFilter, sort],
  );

  if (items.length === 0) {
    return (
      <EmptyState
        title={t("library.emptyTitle")}
        text={t("library.emptyText")}
        action={
          <button className="btn btn-primary" onClick={focusAdd}>
            <Plus size={14} />
            {t("library.emptyCta")}
          </button>
        }
      />
    );
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        title={t("library.noResultsTitle")}
        text={t("library.noResultsText")}
        action={
          <button
            className="btn"
            onClick={() => {
              setQuery("");
              setKindFilter("all");
            }}
          >
            <RotateCcw size={13} />
            {t("library.resetFilters")}
          </button>
        }
      />
    );
  }

  return (
    <div className="px-7 pb-8">
      <AnimatePresence mode="popLayout" initial={false}>
        {layout === "grid" ? (
          <div
            key="grid"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          >
            {visible.map((item, index) => (
              <ItemCard key={item.id} item={item} index={index} />
            ))}
          </div>
        ) : (
          <div key="list" className="flex flex-col gap-1.5">
            {visible.map((item, index) => (
              <ItemRow key={item.id} item={item} index={index} />
            ))}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
