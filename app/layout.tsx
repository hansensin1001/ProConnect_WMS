import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ProConnect WMS | Warehouse operations, connected", template: "%s | ProConnect WMS" },
  description: "ProConnect WMS brings inventory, locations, receiving, fulfilment and traceability into one warehouse operations platform.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
