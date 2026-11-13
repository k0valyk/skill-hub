import { AnimatePresence, motion } from "framer-motion";
import { Check, Info, TriangleAlert, X } from "lucide-react";
import { useApp } from "@/store";

export function Toasts() {
  const toasts = useApp((state) => state.toasts);
  const dismissToast = useApp((state) => state.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[320px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="glass pointer-events-auto flex items-start gap-2.5 rounded-[12px] border border-[var(--line)] px-3.5 py-2.5 shadow-xl"
          >
            <span className="mt-0.5 shrink-0">
              {toast.tone === "ok" ? (
                <Check size={14} style={{ color: "var(--ok)" }} />
              ) : toast.tone === "error" ? (
                <TriangleAlert size={14} style={{ color: "var(--danger)" }} />
              ) : (
                <Info size={14} style={{ color: "var(--accent)" }} />
              )}
            </span>
            <p className="min-w-0 flex-1 text-[12px] leading-relaxed">{toast.message}</p>
            <button
              className="shrink-0 rounded p-0.5 text-[var(--faint)] transition-colors hover:text-[var(--text)]"
              onClick={() => dismissToast(toast.id)}
            >
              <X size={12} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
