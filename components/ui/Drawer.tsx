"use client";

import { X } from "lucide-react";
import { ReactNode, useEffect } from "react";

export function Drawer({ open, onClose, title, description, children }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[120] flex justify-end bg-ink/35 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label={title}>
    <button className="flex-1 cursor-default" onClick={onClose} aria-label="Close panel" />
    <aside className="relative z-[121] h-full w-full max-w-xl overflow-y-auto pointer-events-auto bg-panel shadow-2xl animate-[slide-in_.18s_ease-out]">
      <div className="sticky top-0 z-[122] flex items-start justify-between border-b border-line bg-panel px-6 py-5">
        <div><h2 className="stencil text-2xl text-ink">{title}</h2>{description && <p className="mt-1 text-sm text-graphite">{description}</p>}</div>
        <button onClick={onClose} className="rounded p-2 text-graphite hover:bg-paper hover:text-ink" aria-label="Close panel"><X size={20} /></button>
      </div>
      <div className="p-6">{children}</div>
    </aside>
  </div>;
}
