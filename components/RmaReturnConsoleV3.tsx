"use client";

import { FormEvent, useMemo, useState } from "react";

type OrderLine = {
  product_id: string;
  products?: { sku?: string; name?: string; is_serialized?: boolean } | null;
};
type ShippedOrder = {
  id: string;
  order_number: string;
  customer_name?: string | null;
  order_items?: OrderLine[] | null;
};
type Bin = {
  id: string;
  location_code: string;
  display_code?: string | null;
  warehouse_zones?: { zone_type?: string | null } | { zone_type?: string | null }[] | null;
};

function zoneType(bin: Bin) {
  const zone = Array.isArray(bin.warehouse_zones) ? bin.warehouse_zones[0] : bin.warehouse_zones;
  return zone?.zone_type ?? "";
}

function normalizeSerials(value: string) {
  return value
    .split(/[\n,;]+/)
    .map((serial) => serial.trim().toUpperCase())
    .filter(Boolean);
}

export function RmaReturnConsoleV3({
  orgId,
  salesOrders,
  bins,
}: {
  orgId: string;
  salesOrders: ShippedOrder[];
  bins: Bin[];
}) {
  const [salesOrderId, setSalesOrderId] = useState("");
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [disposition, setDisposition] = useState<"PUTAWAY" | "QUARANTINE">("QUARANTINE");
  const [reason, setReason] = useState("DAMAGED");
  const [serialInput, setSerialInput] = useState("");
  const [returnSerials, setReturnSerials] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const order = useMemo(() => salesOrders.find((item) => item.id === salesOrderId), [salesOrders, salesOrderId]);
  const orderProducts = useMemo(() => {
    const unique = new Map<string, OrderLine>();
    for (const item of order?.order_items ?? []) unique.set(item.product_id, item);
    return [...unique.values()];
  }, [order]);
  const selectedLine = useMemo(() => orderProducts.find((item) => item.product_id === productId), [orderProducts, productId]);
  const isSerialized = Boolean(selectedLine?.products?.is_serialized);
  const parsedQuantity = Number(quantity);
  const eligibleBins = useMemo(
    () => bins.filter((bin) => zoneType(bin) === (disposition === "PUTAWAY" ? "STORAGE" : "QUARANTINE")),
    [bins, disposition],
  );

  function clearSerials() {
    setSerialInput("");
    setReturnSerials([]);
  }

  function addSerials(value = serialInput) {
    const additions = normalizeSerials(value);
    if (!additions.length) return;
    const existing = new Set(returnSerials.map((serial) => serial.toLowerCase()));
    const duplicates = additions.filter((serial) => existing.has(serial.toLowerCase()));
    if (duplicates.length) {
      setMessage(`Serial ${duplicates[0]} has already been scanned for this return.`);
      return;
    }
    setReturnSerials((current) => [...current, ...additions]);
    setSerialInput("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!salesOrderId || !productId || !locationId || !Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
      setMessage("Select a shipped sales order, its SKU, a valid destination bin, and a quantity.");
      return;
    }
    if (isSerialized && returnSerials.length !== parsedQuantity) {
      setMessage(`Scan exactly ${parsedQuantity} unique serial number${parsedQuantity === 1 ? "" : "s"} before receiving this return.`);
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          action: "createRma",
          salesOrderId,
          customerName: order?.customer_name ?? "",
          lines: [{
            productId,
            locationId,
            quantity: parsedQuantity,
            disposition,
            reason,
            serialNumbers: isSerialized ? returnSerials : [],
          }],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to receive the RMA.");
      setMessage(
        disposition === "QUARANTINE"
          ? "Damaged return received into the selected quarantine bin."
          : "Restockable return received into the selected putaway bin.",
      );
      clearSerials();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to receive the RMA.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl rounded-lg border border-line bg-panel p-6">
      <h2 className="font-semibold">Customer return (RMA)</h2>
      <p className="mt-1 text-sm text-graphite">
        Every return must be tied to a verified shipped sales order. Serialized products require the exact serials that shipped on that order.
      </p>
      {message && <p role="alert" className="mt-4 rounded-md bg-paper px-3 py-2 text-sm text-alert">{message}</p>}
      {!salesOrders.length && <p className="mt-4 rounded-md border border-line p-3 text-sm text-graphite">No shipped sales orders are available for this organization.</p>}

      <div className="mt-5 grid gap-4">
        <label className="block text-sm">Shipped sales order
          <select
            required
            value={salesOrderId}
            onChange={(event) => {
              setSalesOrderId(event.target.value);
              setProductId("");
              setLocationId("");
              clearSerials();
              setMessage("");
            }}
            className="input-field mt-1"
          >
            <option value="">Select shipped sales order…</option>
            {salesOrders.map((item) => (
              <option key={item.id} value={item.id}>
                {item.order_number}{item.customer_name ? ` · ${item.customer_name}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">SKU shipped on this order
          <select
            required
            value={productId}
            onChange={(event) => {
              setProductId(event.target.value);
              clearSerials();
              setMessage("");
            }}
            disabled={!order}
            className="input-field mt-1"
          >
            <option value="">Select SKU…</option>
            {orderProducts.map((item) => (
              <option key={item.product_id} value={item.product_id}>
                {item.products?.sku ?? "SKU"}{item.products?.name ? ` — ${item.products.name}` : ""}{item.products?.is_serialized ? " · Serialized" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">Condition decision
            <select
              value={disposition}
              onChange={(event) => {
                setDisposition(event.target.value as "PUTAWAY" | "QUARANTINE");
                setLocationId("");
              }}
              className="input-field mt-1"
            >
              <option value="QUARANTINE">Damaged → quarantine</option>
              <option value="PUTAWAY">Good → putaway / restock</option>
            </select>
          </label>
          <label className="block text-sm">Destination bin
            <select required value={locationId} onChange={(event) => setLocationId(event.target.value)} className="input-field mt-1">
              <option value="">Select {disposition === "QUARANTINE" ? "quarantine" : "putaway"} bin…</option>
              {eligibleBins.map((bin) => <option key={bin.id} value={bin.id}>{bin.display_code ?? bin.location_code}</option>)}
            </select>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">Return quantity
            <input required type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="input-field mt-1" />
          </label>
          <label className="block text-sm">Reason
            <input required value={reason} onChange={(event) => setReason(event.target.value)} className="input-field mt-1" placeholder="DAMAGED" />
          </label>
        </div>

        {isSerialized && (
          <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-violet-900">Return serial validation</p>
                <p className="mt-1 text-xs text-violet-800">Scan or paste the exact serials shipped on this sales order. Wrong, duplicate, or previously returned serials are blocked.</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${returnSerials.length === parsedQuantity ? "bg-emerald-100 text-go" : "bg-amber/20 text-amber-dark"}`}>
                {returnSerials.length} / {Number.isInteger(parsedQuantity) ? parsedQuantity : 0} scanned
              </span>
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={serialInput}
                onChange={(event) => setSerialInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addSerials();
                  }
                }}
                placeholder="Scan serial then press Enter"
                className="input-field"
              />
              <button type="button" onClick={() => addSerials()} className="btn-secondary">Add</button>
            </div>
            {returnSerials.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {returnSerials.map((serial) => (
                  <span key={serial} className="inline-flex items-center gap-2 rounded bg-panel px-2 py-1 text-xs ring-1 ring-inset ring-violet-200">
                    <span className="code-label">{serial}</span>
                    <button
                      type="button"
                      onClick={() => setReturnSerials((current) => current.filter((item) => item !== serial))}
                      className="text-alert"
                      aria-label={`Remove ${serial}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <button
        disabled={busy || !salesOrders.length || !eligibleBins.length || (isSerialized && returnSerials.length !== parsedQuantity)}
        className="btn-primary mt-5"
      >
        {busy ? "Receiving…" : "Receive customer return"}
      </button>
    </form>
  );
}
