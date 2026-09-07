import { redirect } from "next/navigation";
import { SCAN_MODULE_ENABLED } from "@/lib/features";

export default function ScanPage() {
  // Keep saved /scan URLs safe while the module is temporarily disabled.
  if (!SCAN_MODULE_ENABLED) redirect("/dashboard");
  redirect("/dashboard");
}
