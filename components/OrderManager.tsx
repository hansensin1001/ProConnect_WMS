"use client";

import { FormEvent, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge } from "@/components/ui/StatusBadge";

type Product = { id: string; sku: string; name: string; unit_of_measure: string };
type Line = { productId: string; quantity: number };
type Order = { id: string; order_number: string; platform: string; customer_name: string | null; shipping_address?: string | null; shipping_city?: string | null; shipping_postcode?: string | null; status: string; created_at: string; order_items?: { id: string; product_id: string; quantity_requested: number; quantity_picked: number }[] };

export function OrderManager({ orgId, orgName, canManage, initialOrders, products }: { orgId: string; orgName: string; canManage: boolean; initialOrders: Order[]; products: Product[] }) {
  const supabase = createClient(); const [orders, setOrders] = useState(initialOrders); const [drawer, setDrawer] = useState<"create" | "view" | null>(null); const [selected, setSelected] = useState<Order | null>(null); const [step, setStep] = useState(1); const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: 1 }]); const [message, setMessage] = useState(""); const [page, setPage] = useState(0); const pageSize = 10; const rows = orders.slice(page * pageSize, page * pageSize + pageSize);
  function openCreate() { setStep(1); setLines([{ productId: "", quantity: 1 }]); setSelected(null); setDrawer("create"); }
  function openView(order: Order) { setSelected(order); setDrawer("view"); }
  function updateLine(index: number, patch: Partial<Line>) { setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line)); }
  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const validLines = lines.filter((line) => line.productId && line.quantity > 0);
    if (!validLines.length) return setMessage("Add at least one product and quantity.");
    try {
      const { data: orderId, error } = await (supabase.rpc as any)("create_sales_order_with_lines", {
        p_org_id: orgId,
        p_customer_name: form.get("customer"),
        p_platform: form.get("carrier") || "MANUAL",
        p_shipping_address: form.get("address") || null,
        p_shipping_city: form.get("city") || null,
        p_shipping_postcode: form.get("postcode") || null,
        p_lines: validLines,
      });
      if (error) throw error;
      const { data: created, error: readError } = await (supabase.from("sales_orders") as any)
        .select("id, order_number, platform, customer_name, shipping_address, shipping_city, shipping_postcode, status, created_at, order_items(id, product_id, quantity_requested, quantity_picked)")
        .eq("id", orderId).single();
      if (readError) throw readError;
      setOrders((current) => [created, ...current]);
      setMessage("");
      setDrawer(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create the sales order."); }
  }
  async function updateStatus(order: Order, status: "ALLOCATED" | "SHIPPED") {
    try {
      const { error } = await (supabase.rpc as any)(status === "ALLOCATED" ? "allocate_sales_order" : "fulfill_sales_order", { p_sales_order_id: order.id });
      if (error) throw error;
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status } : item));
      setSelected((current) => current?.id === order.id ? { ...current, status } : current);
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update this order."); }
  }
  async function remove(id: string) { try { const { error } = await (supabase.from("sales_orders") as any).delete().eq("id", id); if (error) throw error; setOrders(current => current.filter(item => item.id !== id)); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to delete this order."); } }
  async function duplicate(order: Order) { setMessage("Use Create order to duplicate a header with a new generated sequence."); openView(order); }
  const productFor = (id: string) => products.find(product => product.id === id);

  return <div className="space-y-4"><div className="flex items-center justify-between"><p className="text-sm text-graphite">{orders.length} orders · <span className="font-medium text-ink">{orgName}</span></p>{canManage && <button onClick={openCreate} className="btn-primary"><Plus size={16}/>Create order</button>}</div>{message && <p role="alert" className="text-sm text-alert">{message}</p>}<div className="overflow-hidden rounded-lg border border-line bg-panel"><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-sm"><thead className="sticky top-0 z-10 bg-paper text-left text-[11px] uppercase tracking-wide text-graphite"><tr><th className="px-5 py-3">Order ID</th><th className="px-5 py-3">Organization</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Carrier</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Created</th><th className="px-5 py-3"/></tr></thead><tbody>{rows.map(order => <tr key={order.id} className="border-t border-line transition hover:bg-paper/70"><td className="px-5 py-3"><button onClick={() => openView(order)} className="code-label font-medium text-rack hover:underline">{order.order_number}</button></td><td className="px-5 py-3"><span className="rounded-full bg-rack/10 px-2.5 py-1 text-xs font-medium text-rack">{orgName}</span></td><td className="px-5 py-3">{order.customer_name ?? "—"}</td><td className="px-5 py-3 text-graphite">{order.platform}</td><td className="px-5 py-3"><div className="flex items-center gap-2"><StatusBadge status={order.status}/>{canManage && order.status === "NEW" && <button onClick={() => updateStatus(order, "ALLOCATED")} className="btn-secondary py-1 text-xs">Reserve</button>}{canManage && order.status === "ALLOCATED" && <button onClick={() => updateStatus(order, "SHIPPED")} className="btn-primary py-1 text-xs">Fulfill</button>}</div></td><td className="px-5 py-3 text-graphite">{new Date(order.created_at).toLocaleDateString()}</td><td className="px-5 py-3"><RowActions onView={() => openView(order)} onEdit={canManage ? () => openView(order) : undefined} onDuplicate={canManage ? () => duplicate(order) : undefined} onDelete={canManage && order.status === "NEW" ? () => remove(order.id) : undefined}/></td></tr>)}</tbody></table></div><div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-graphite"><span>Showing {orders.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, orders.length)} of {orders.length}</span><div className="flex gap-1"><button disabled={!page} onClick={() => setPage(value => value - 1)} className="btn-secondary p-2"><ChevronLeft size={16}/></button><button disabled={(page + 1) * pageSize >= orders.length} onClick={() => setPage(value => value + 1)} className="btn-secondary p-2"><ChevronRight size={16}/></button></div></div></div>
  <Drawer open={drawer !== null} onClose={() => setDrawer(null)} title={drawer === "create" ? "Create sales order" : "Order details"} description={drawer === "create" ? `Step ${step} of 2 · ${orgName}` : selected?.order_number}>{drawer === "view" && selected ? <div className="space-y-6"><section><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Order header</p><p className="mt-2 text-lg font-medium">{selected.customer_name ?? "Customer not set"}</p><p className="text-sm text-graphite">{[selected.shipping_address, selected.shipping_city, selected.shipping_postcode].filter(Boolean).join(", ") || "Shipping details not recorded"}</p><div className="mt-3"><StatusBadge status={selected.status}/></div></section><section><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Line items / pick list</p><div className="mt-2 overflow-hidden rounded-md border border-line"><table className="w-full text-sm"><thead className="bg-paper text-left text-xs text-graphite"><tr><th className="px-4 py-3">SKU</th><th className="px-4 py-3">Product</th><th className="px-4 py-3 text-right">Requested</th><th className="px-4 py-3 text-right">Picked</th></tr></thead><tbody>{(selected.order_items ?? []).map(line => <tr key={line.id} className="border-t border-line"><td className="px-4 py-3 code-label">{productFor(line.product_id)?.sku ?? "—"}</td><td className="px-4 py-3">{productFor(line.product_id)?.name ?? "Product unavailable"}</td><td className="px-4 py-3 text-right">{line.quantity_requested}</td><td className="px-4 py-3 text-right">{line.quantity_picked}</td></tr>)}</tbody></table></div></section></div> : <form onSubmit={createOrder} className="space-y-6">{step === 1 ? <section className="space-y-4"><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Order header</p><label className="block text-sm">Customer name<input name="customer" required className="input-field mt-1"/></label><label className="block text-sm">Shipping address<textarea name="address" className="input-field mt-1 min-h-20"/></label><div className="grid grid-cols-2 gap-3"><label className="block text-sm">City<input name="city" className="input-field mt-1"/></label><label className="block text-sm">Postcode<input name="postcode" className="input-field mt-1"/></label></div><label className="block text-sm">Carrier / channel<input name="carrier" defaultValue="MANUAL" className="input-field mt-1"/></label></section> : <section><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Order line items</p><div className="mt-3 space-y-3">{lines.map((line, index) => <div key={index} className="grid grid-cols-[1fr_100px_36px] gap-2"><select value={line.productId} onChange={event => updateLine(index, { productId: event.target.value })} className="input-field"><option value="">Select SKU…</option>{products.map(product => <option key={product.id} value={product.id}>{product.sku} — {product.name}</option>)}</select><input type="number" min="1" value={line.quantity} onChange={event => updateLine(index, { quantity: Number(event.target.value) })} className="input-field"/><button type="button" onClick={() => setLines(current => current.filter((_, i) => i !== index))} className="rounded border border-line text-alert hover:bg-alert/5" aria-label="Remove line"><Trash2 size={16} className="mx-auto"/></button></div>)}</div><button type="button" onClick={() => setLines(current => [...current, { productId: "", quantity: 1 }])} className="btn-secondary mt-3">Add line item</button></section>}<div className="flex justify-between border-t border-line pt-5"><button type="button" onClick={() => step === 1 ? setDrawer(null) : setStep(1)} className="btn-secondary">{step === 1 ? "Cancel" : "Back"}</button>{step === 1 ? <button type="button" onClick={() => setStep(2)} className="btn-primary">Continue to items</button> : <button className="btn-primary">Create order</button>}</div></form>}</Drawer></div>;
}
