"use client";
import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Drawer } from "./Drawer";
type Action = { label: string; onClick: () => void; destructive?: boolean; disabled?: boolean };
export function RowActions({ onView, onEdit, onAdjust, onDuplicate, onDelete, deleteLabel = "Delete", deleteTitle = "Delete this record?", deleteDescription = "This action cannot be undone.", extraActions = [] }: { onView?: () => void; onEdit?: () => void; onAdjust?: () => void; onDuplicate?: () => void; onDelete?: () => void; deleteLabel?: string; deleteTitle?: string; deleteDescription?: string; extraActions?: Action[] }) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const actions: Action[] = [
    ...(onView ? [{label:"View details",onClick:onView}] : []),
    ...(onEdit ? [{label:"Edit",onClick:onEdit}] : []),
    ...(onAdjust ? [{label:"Adjust stock",onClick:onAdjust}] : []),
    ...(onDuplicate ? [{label:"Duplicate",onClick:onDuplicate}] : []),
    ...extraActions,
    ...(onDelete ? [{label:deleteLabel,onClick:onDelete,destructive:true}] : []),
  ];
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if(event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown",outside); document.addEventListener("keydown",key);
    return () => { document.removeEventListener("pointerdown",outside); document.removeEventListener("keydown",key); };
  }, [open]);
  if (!actions.length) return null;
  function toggle() {
    const rect = button.current?.getBoundingClientRect();
    if (rect) setPosition({left: Math.max(8,Math.min(window.innerWidth-224,rect.right-216)),top:Math.max(8,Math.min(rect.bottom+4,window.innerHeight-Math.min(actions.length*44+10,window.innerHeight-16)))});
    setOpen(!open);
  }
  return <div className="flex justify-end">
    <button type="button" ref={button} onClick={toggle} aria-label="Row actions" aria-haspopup="menu" aria-expanded={open} className="flex h-11 w-11 items-center justify-center rounded-md text-graphite hover:bg-paper"><Ellipsis size={22} /></button>
    {open && createPortal(<div ref={menu} role="menu" style={position} className="fixed z-[160] max-h-[calc(100dvh-16px)] w-[216px] overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-xl" onKeyDown={(event) => {
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {event.preventDefault();items[(index+(event.key==="ArrowDown"?1:-1)+items.length)%items.length]?.focus();}
      if(event.key==="Tab") setOpen(false);
    }}>{actions.map((action) => <button type="button" role="menuitem" key={action.label} disabled={action.disabled} onClick={() => { setOpen(false); if(action.destructive) setPending(action); else action.onClick(); }} className={`action-item ${action.destructive ? "text-alert" : ""}`}>{action.label}</button>)}</div>,document.body)}
    <Drawer open={pending !== null} onClose={() => setPending(null)} title={pending?.onClick === onDelete ? deleteTitle : `${pending?.label ?? "Confirm action"}?`}>
      <p className="text-sm text-graphite">{pending?.onClick === onDelete ? deleteDescription : "This action changes this transaction and may reverse its stock movements. Verify the selected record before continuing."}</p>
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setPending(null)} className="btn-secondary">Keep record</button><button type="button" onClick={() => { const action=pending; setPending(null); action?.onClick(); }} className="btn-danger">Confirm {pending?.label.toLowerCase()}</button></div>
    </Drawer>
  </div>;
}
