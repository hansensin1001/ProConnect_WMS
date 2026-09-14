"use client";

import { X } from "lucide-react";
import { ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export function Drawer({ open, onClose, title, description, children }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  const titleId = useId();
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      const target = panel.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)');
      (target ?? panel.current)?.focus();
    });
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter((item) => item.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); panel.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", onKey); document.body.style.overflow = scroll; if (previous?.isConnected) previous.focus(); };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(<div className="fixed inset-0 z-[120] flex justify-end bg-ink/35 backdrop-blur-[1px]">
    <div className="hidden flex-1 sm:block" onClick={() => close.current()} aria-hidden="true" />
    <aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative flex h-[100dvh] w-full max-w-2xl flex-col bg-panel shadow-2xl animate-[slide-in_.18s_ease-out]">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-panel px-4 py-4 sm:px-6">
        <div className="min-w-0"><h2 id={titleId} className="stencil break-words text-2xl text-ink">{title}</h2>{description && <p className="mt-1 break-words text-sm text-graphite">{description}</p>}</div>
        <button type="button" onClick={() => close.current()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-graphite hover:bg-paper" aria-label="Close panel"><X size={22} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">{children}</div>
    </aside>
  </div>, document.body);
}
