import "server-only";

import type { ShipmentRequest } from "./types";

function escapePdf(value: string) {
  return value.replace(/[^\x20-\x7e]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** A compact 4x6in PDF used by the sandbox adapters and local test printing. */
export function createThermalLabelPdf(input: ShipmentRequest, carrierName: string, trackingNumber: string) {
  const lines = [
    `${carrierName} · SHIPPING LABEL`,
    `AWB: ${trackingNumber}`,
    `ORDER: ${input.orderNumber}`,
    "",
    `TO: ${input.customerName}`,
    input.shippingAddress,
    [input.shippingCity, input.shippingPostcode].filter(Boolean).join(" "),
    "",
    `ITEMS: ${input.itemCount}    WEIGHT: ${input.weightKg.toFixed(2)} kg`,
    input.serviceCode ? `SERVICE: ${input.serviceCode}` : "SERVICE: STANDARD",
    "",
    "Sandbox label — replace with the carrier production adapter before live dispatch.",
  ].map(escapePdf);
  const content = ["BT", "/F1 13 Tf", "36 395 Td", "16 TL", ...lines.map((line, index) => `${index ? "T* " : ""}(${line}) Tj`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8").toString("base64");
}
