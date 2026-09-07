"use client";

import { useCallback, useMemo, useState } from "react";
import { CameraScanner } from "@/components/CameraScanner";
import { createClient } from "@/lib/supabase/client";
import { clsx } from "clsx";

type Mode = "PUTAWAY" | "PICK";
type Step = "product" | "location" | "quantity" | "done";

export function ScanConsole({
  orgId,
  warehouseId,
}: {
  orgId: string;
  warehouseId: string;
}) {
  // Keep one browser client for the component lifetime. Recreating it changed
  // scan callbacks on every render and could restart the camera while routing.
  const supabase = useMemo(() => createClient(), []);

  const [mode, setMode] = useState<Mode>("PUTAWAY");
  const [step, setStep] = useState<Step>("product");
  const [scanning, setScanning] = useState(true);
  const [product, setProduct] = useState<{ id: string; sku: string; name: string } | null>(null);
  const [location, setLocation] = useState<{ id: string; location_code: string } | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [manualValue, setManualValue] = useState("");
  const [status, setStatus] = useState<{ type: "error" | "ok"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep("product");
    setProduct(null);
    setLocation(null);
    setQuantity("1");
    setManualValue("");
    setStatus(null);
    setScanning(true);
  }

  const lookupProduct = useCallback(
    async (code: string) => {
      const { data, error } = await supabase
        .from("products")
        .select("id, sku, name")
        .eq("org_id", orgId)
        .or(`barcode.eq.${code},sku.eq.${code}`)
        .maybeSingle();

      if (error || !data) {
        setStatus({ type: "error", message: `No product found for "${code}".` });
        return;
      }
      setProduct(data);
      setStep("location");
      setScanning(true);
      setStatus(null);
      setManualValue("");
    },
    [orgId, supabase]
  );

  const lookupLocation = useCallback(
    async (code: string) => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, location_code")
        .eq("location_code", code)
        .maybeSingle();

      if (error || !data) {
        setStatus({ type: "error", message: `No location found for "${code}".` });
        return;
      }
      setLocation(data);
      setStep("quantity");
      setScanning(false);
      setStatus(null);
      setManualValue("");
    },
    [supabase]
  );

  async function handleConfirm() {
    if (!product || !location) return;
    setBusy(true);
    const { error } = await (supabase.rpc as any)("apply_scan_event", {
      p_org_id: orgId,
      p_warehouse_id: warehouseId,
      p_event_type: mode,
      p_product_id: product.id,
      p_location_id: location.id,
      p_quantity: Number(quantity) || 0,
    });
    setBusy(false);

    if (error) {
      setStatus({ type: "error", message: error.message });
      return;
    }
    setStatus({ type: "ok", message: `${mode === "PUTAWAY" ? "Put away" : "Picked"} ${quantity} × ${product.sku} at ${location.location_code}.` });
    setStep("done");
  }

  return (
    <div className="max-w-lg">
      <div className="flex gap-2 mb-6">
        {(["PUTAWAY", "PICK"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              reset();
            }}
            className={clsx(
              "px-4 py-2 text-sm font-medium border",
              mode === m
                ? "bg-ink text-white border-ink"
                : "bg-panel text-graphite border-line hover:border-ink"
            )}
          >
            {m === "PUTAWAY" ? "Put-away" : "Pick"}
          </button>
        ))}
      </div>

      <div className="bg-panel border border-line p-6">
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-5 text-xs code-label text-graphite">
          <span className={step === "product" ? "text-ink font-medium" : ""}>1. Product</span>
          <span>—</span>
          <span className={step === "location" ? "text-ink font-medium" : ""}>2. Location</span>
          <span>—</span>
          <span className={step === "quantity" ? "text-ink font-medium" : ""}>3. Quantity</span>
        </div>

        {product && (
          <div className="mb-4 text-sm bg-paper border border-line px-3 py-2">
            <span className="text-graphite">Product:</span>{" "}
            <span className="code-label">{product.sku}</span> — {product.name}
          </div>
        )}
        {location && (
          <div className="mb-4 text-sm bg-paper border border-line px-3 py-2">
            <span className="text-graphite">Location:</span>{" "}
            <span className="code-label">{location.location_code}</span>
          </div>
        )}

        {(step === "product" || step === "location") && (
          <>
            <CameraScanner
              active={scanning}
              onDetected={step === "product" ? lookupProduct : lookupLocation}
            />
            <div className="mt-4 flex gap-2">
              <input
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualValue.trim()) {
                    step === "product" ? lookupProduct(manualValue.trim()) : lookupLocation(manualValue.trim());
                  }
                }}
                placeholder={step === "product" ? "Or type SKU / barcode" : "Or type location code"}
                className="flex-1 px-3 py-2 border border-line bg-paper text-sm code-label"
              />
              <button
                onClick={() =>
                  manualValue.trim() &&
                  (step === "product" ? lookupProduct(manualValue.trim()) : lookupLocation(manualValue.trim()))
                }
                className="px-4 py-2 border border-line text-sm hover:border-ink"
              >
                Go
              </button>
            </div>
          </>
        )}

        {step === "quantity" && (
          <div>
            <label className="block text-xs font-medium text-graphite mb-1">Quantity</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-32 px-3 py-2 border border-line bg-paper text-sm mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={handleConfirm}
                disabled={busy}
                className="px-4 py-2 bg-ink text-white text-sm font-medium hover:bg-graphite disabled:opacity-60"
              >
                {busy ? "Saving…" : `Confirm ${mode === "PUTAWAY" ? "put-away" : "pick"}`}
              </button>
              <button onClick={reset} className="px-4 py-2 border border-line text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <button
            onClick={reset}
            className="px-4 py-2 bg-ink text-white text-sm font-medium hover:bg-graphite"
          >
            Scan next
          </button>
        )}

        {status && (
          <p
            className={clsx(
              "mt-4 text-sm px-3 py-2 border",
              status.type === "error"
                ? "text-alert border-alert/30 bg-alert/5"
                : "text-go border-go/30 bg-go/5"
            )}
          >
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}
