import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

export type Notice = { kind: "error" | "success" | "info"; text: string } | null;

export function WorkflowNotice({ notice }: { notice: Notice }) {
  if (!notice?.text) return null;
  const Icon = notice.kind === "error" ? AlertTriangle : notice.kind === "success" ? CheckCircle2 : Info;
  return <div role={notice.kind === "error" ? "alert" : "status"} aria-atomic="true" className={`my-3 flex items-start gap-3 rounded-lg border-l-4 p-4 text-sm ${notice.kind === "error" ? "border-alert bg-red-50 text-red-900" : notice.kind === "success" ? "border-go bg-emerald-50 text-emerald-900" : "border-rack bg-slate-50 text-ink"}`}><Icon size={21} className="mt-0.5 shrink-0" /><div className="min-w-0 break-words"><p className="font-semibold">{notice.kind === "error" ? "Action blocked" : notice.kind === "success" ? "Completed" : "Before you continue"}</p><p className="mt-1">{notice.text}</p></div></div>;
}
