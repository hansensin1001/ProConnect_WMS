"use client";

import { useEffect, useRef, useState } from "react";

export function CameraScanner({
  active,
  onDetected,
}: {
  active: boolean;
  onDetected: (text: string) => void;
}) {
  const regionId = useRef(`scanner-${Math.random().toString(36).slice(2)}`);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let scannerInstance: any;

    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (cancelled) return;
      const scanner = new Html5Qrcode(regionId.current);
      scannerInstance = scanner;

      scanner
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 160 } },
          (decodedText: string) => {
            onDetected(decodedText);
            scanner.stop().catch(() => {});
          },
          () => {
            // per-frame decode failures are expected — ignore
          }
        )
        .catch(() => {
          setError(
            "Camera unavailable. Grant camera permission, or use manual entry below."
          );
        });
    });

    return () => {
      cancelled = true;
      scannerInstance?.stop().catch(() => {});
    };
  }, [active, onDetected]);

  if (!active) return null;

  return (
    <div>
      <div id={regionId.current} className="w-full max-w-sm border border-line" />
      {error && <p className="text-xs text-alert mt-2">{error}</p>}
    </div>
  );
}
