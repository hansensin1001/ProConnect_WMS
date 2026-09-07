"use client";

import { Copy, Ellipsis, Eye, Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

type ExtraAction = { label: string; onClick: () => void; destructive?: boolean };
type Position = { top: number; left: number };

export function RowActions({ onView, onEdit, onAdjust, onDuplicate, onDelete, deleteLabel = "Delete", deleteTitle = "Delete this record?", deleteDescription = "This action cannot be undone.", extraActions = [] }: { onView?: () => void; onEdit?: () => void; onAdjust?: () => void; onDuplicate?: () => void; onDelete?: () => void; deleteLabel?: string; deleteTitle?: string; deleteDescription?: string; extraActions?: ExtraAction[] }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false); const [confirm, setConfirm] = useState(false); const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  function toggle() { if (!open && buttonRef.current) { const rect = buttonRef.current.getBoundingClientRect(); setPosition({ top: rect.bottom + 4, left: Math.max(8, Math.min(window.innerWidth - 200, rect.right - 192)) }); } setOpen((current) => !current); }
  function run(action: () => void) { setOpen(false); action(); }
  const hasActions = Boolean(onView || onEdit || onAdjust || onDuplicate || onDelete || extraActions.length);
  if (!hasActions) return null;
  return <div className="flex justify-end"><button ref={buttonRef} onClick={toggle} className="rounded p-2 text-graphite hover:bg-paper hover:text-ink" aria-label="Row actions" aria-expanded={open}><Ellipsis size={19} /></button>{open && <div style={{ top: position.top, left: position.left }} className="fixed z-[100] w-48 rounded-lg border border-line bg-panel p-1 shadow-lg">{onView && <button onClick={() => run(onView)} className="action-item"><Eye size={15} />View details</button>}{onEdit && <button onClick={() => run(onEdit)} className="action-item"><Pencil size={15} />Edit</button>}{onAdjust && <button onClick={() => run(onAdjust)} className="action-item"><SlidersHorizontal size={15} />Adjust stock</button>}{onDuplicate && <button onClick={() => run(onDuplicate)} className="action-item"><Copy size={15} />Duplicate</button>}{extraActions.map((action) => <button key={action.label} onClick={() => run(action.onClick)} className={`action-item ${action.destructive ? "text-alert" : ""}`}>{action.label}</button>)}{onDelete && <button onClick={() => { setOpen(false); setConfirm(true); }} className="action-item text-alert"><Trash2 size={15} />{deleteLabel}</button>}</div>}{confirm && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/35 p-4"><div className="w-full max-w-sm rounded-xl bg-panel p-6 shadow-2xl"><h3 className="font-semibold">{deleteTitle}</h3><p className="mt-2 text-sm text-graphite">{deleteDescription}</p><div className="mt-5 flex justify-end gap-2"><button onClick={() => setConfirm(false)} className="btn-secondary">Cancel</button><button onClick={() => { setConfirm(false); onDelete?.(); }} className="btn-danger">{deleteLabel}</button></div></div></div>}</div>;
}
