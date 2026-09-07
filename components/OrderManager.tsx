"use client";

import { FormEvent, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge } from "@/components/ui/StatusBadge";

type Order = { id: string; order_number: string; platform: string; customer_name: string | null; status: string; created_at: string };
const STATUSES = ["NEW", "ALLOCATED", "PICKING", "PACKED", "SHIPPED"];

export function OrderManager({ orgId, orgName, canManage, initialOrders }: { orgId: string; orgName: string; canManage: boolean; initialOrders: Order[] }) {
  const supabase = createClient();
  const [orders, setOrders] = useState(initialOrders);
  const [drawer, setDrawer] = useState<"create" | "view" | "edit" | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);
  const [step, setStep] = useState(1);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const visibleRows = orders.slice(page * pageSize, page * pageSize + pageSize);

  function open(kind: "create" | "view" | "edit", order?: Order) { setSelected(order ?? null); setStep(1); setDrawer(kind); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const payload = { order_number: form.get("number"), platform: form.get("carrier") || "MANUAL", customer_name: form.get("customer"), status: selected?.status ?? "NEW" };
    const request = selected ? (supabase.from("sales_orders") as any).update(payload).eq("id", selected.id) : (supabase.from("sales_orders") as any).insert({ ...payload, org_id: orgId });
    const { data, error } = await request.select().single();
    if (error) return setMessage(error.message);
    setOrders(current => selected ? current.map(order => order.id === selected.id ? data : order) : [data, ...current]);
    setDrawer(null);
  }
  async function updateStatus(order: Order, status: string) { const { error } = await (supabase.from("sales_orders") as any).update({ status }).eq("id", order.id); if (error) return setMessage(error.message); setOrders(current => current.map(item => item.id === order.id ? { ...item, status } : item)); }
  async function remove(id: string) { const { error } = await (supabase.from("sales_orders") as any).delete().eq("id", id); if (error) return setMessage(error.message); setOrders(current => current.filter(item => item.id !== id)); }
  async function duplicate(order: Order) { const { data, error } = await (supabase.from("sales_orders") as any).insert({ org_id: orgId, order_number: `${order.order_number}-COPY`, platform: order.platform, customer_name: order.customer_name, status: "NEW" }).select().single(); if (error) return setMessage(error.message); setOrders(current => [data, ...current]); }

  return <div className="space-y-4">
    <div className="flex items-center justify-between"><p className="text-sm text-graphite">{orders.length} orders · <span className="font-medium text-ink">{orgName}</span></p>{canManage && <button onClick={() => open("create")} className="btn-primary"><Plus size={16}/>Create order</button>}</div>
    {message && <p className="text-sm text-alert">{message}</p>}
    <div className="overflow-hidden rounded-lg border border-line bg-panel"><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-sm"><thead className="sticky top-0 z-10 bg-paper text-left text-[11px] uppercase tracking-wide text-graphite"><tr><th className="px-5 py-3">Order</th><th className="px-5 py-3">Organization</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Carrier</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Created</th><th className="px-5 py-3"/></tr></thead><tbody>{visibleRows.map(order => <tr key={order.id} className="border-t border-line transition hover:bg-paper/70"><td className="px-5 py-3"><button onClick={() => open("view", order)} className="code-label font-medium text-rack hover:underline">{order.order_number}</button></td><td className="px-5 py-3"><span className="rounded-full bg-rack/10 px-2.5 py-1 text-xs font-medium text-rack">{orgName}</span></td><td className="px-5 py-3">{order.customer_name ?? "—"}</td><td className="px-5 py-3 text-graphite">{order.platform}</td><td className="px-5 py-3">{canManage ? <select value={order.status} onChange={e => updateStatus(order, e.target.value)} className="rounded-full border border-line bg-panel px-2 py-1 text-xs font-medium"><option value={order.status}>{order.status}</option>{STATUSES.filter(item => item !== order.status).map(item => <option key={item}>{item}</option>)}</select> : <StatusBadge status={order.status}/>}</td><td className="px-5 py-3 text-graphite">{new Date(order.created_at).toLocaleDateString()}</td><td className="px-5 py-3"><RowActions onView={() => open("view", order)} onEdit={canManage ? () => open("edit", order) : undefined} onDuplicate={canManage ? () => duplicate(order) : undefined} onDelete={canManage ? () => remove(order.id) : undefined}/></td></tr>)}</tbody></table></div><div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-graphite"><span>Showing {orders.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, orders.length)} of {orders.length}</span><div className="flex gap-1"><button disabled={!page} onClick={() => setPage(value => value - 1)} className="btn-secondary p-2"><ChevronLeft size={16}/></button><button disabled={(page + 1) * pageSize >= orders.length} onClick={() => setPage(value => value + 1)} className="btn-secondary p-2"><ChevronRight size={16}/></button></div></div></div>
    <Drawer open={drawer !== null} onClose={() => setDrawer(null)} title={drawer === "create" ? "Create sales order" : drawer === "edit" ? "Edit order" : "Order details"} description={drawer === "create" ? `Step ${step} of 3` : selected ? `${selected.order_number} · ${orgName}` : undefined}>
      {drawer === "view" && selected ? <div className="space-y-6"><section><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Shipping customer</p><p className="mt-2 text-lg font-medium">{selected.customer_name ?? "Customer not set"}</p><p className="text-sm text-graphite">Shipping address will appear here when order address fields are enabled.</p></section><section><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Pick list</p><div className="mt-2 rounded-md border border-dashed border-line p-4 text-sm text-graphite">No line items yet. Add products in the order workflow.</div></section><StatusBadge status={selected.status}/></div> : <form onSubmit={save} className="space-y-6">{step === 1 && <><p className="text-sm font-medium">1. Customer details</p><label className="block text-sm">Customer name<input name="customer" defaultValue={selected?.customer_name ?? ""} required className="input-field mt-1"/></label></>}{step === 2 && <><p className="text-sm font-medium">2. Item selection</p><div className="rounded-md border border-dashed border-line p-5 text-sm text-graphite">Order item selection will use the SKU catalog and available stock. This record can be created now and items added next.</div></>}{step === 3 && <><p className="text-sm font-medium">3. Carrier & reference</p><label className="block text-sm">Order number<input name="number" defaultValue={selected?.order_number ?? ""} required className="input-field mt-1 code-label"/></label><label className="mt-4 block text-sm">Carrier / channel<input name="carrier" defaultValue={selected?.platform ?? "MANUAL"} className="input-field mt-1"/></label></>}<div className="flex justify-between border-t border-line pt-5"><button type="button" onClick={() => step > 1 ? setStep(step - 1) : setDrawer(null)} className="btn-secondary">{step > 1 ? "Back" : "Cancel"}</button>{step < 3 ? <button type="button" onClick={() => setStep(step + 1)} className="btn-primary">Continue</button> : <button className="btn-primary">{selected ? "Save changes" : "Create order"}</button>}</div></form>}
    </Drawer>
  </div>;
}
