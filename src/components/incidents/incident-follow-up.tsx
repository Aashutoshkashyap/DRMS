"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RotateCw } from "lucide-react";
import { FOLLOW_UP_REASON_LABEL, type IncidentAttentionItem, type loadOperationsOverview } from "@/lib/operations/overview";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Overview = Awaited<ReturnType<typeof loadOperationsOverview>>;

export function IncidentFollowUp({ dealId }: { dealId: string }) {
  const [item, setItem] = useState<IncidentAttentionItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/follow-up/overview", { method: "POST" });
      if (!response.ok) throw new Error("Could not load incident follow-up");
      const overview = await response.json() as Overview;
      setItem(overview.attentionItems.find((candidate) => candidate.incident.id === dealId) ?? null);
    } catch (error) {
      console.error("[incident-follow-up]", error);
      setItem(null);
    } finally { setLoading(false); }
  }, [dealId]);

  // Fetch coordinator-only follow-up state after the case identity is known.
  useEffect(() => { void load(); }, [load]);

  async function review() {
    setActing(true);
    try {
      const response = await fetch(`/api/incidents/${dealId}/follow-up/review`, { method: "POST" });
      if (!response.ok) throw new Error("Could not mark follow-up reviewed");
      toast.success("Follow-up reviewed. It remains active until its underlying condition clears.");
      await load();
    } catch { toast.error("Could not mark this follow-up reviewed."); }
    finally { setActing(false); }
  }

  async function retry() {
    setActing(true);
    try {
      const response = await fetch(`/api/incidents/${dealId}/status-notification/retry`, { method: "POST" });
      if (!response.ok) throw new Error("Could not retry notification");
      toast.success("Citizen notification was accepted by WhatsApp transport; delivery is not yet confirmed.");
      await load();
    } catch { toast.error("Could not retry the citizen notification."); }
    finally { setActing(false); }
  }

  if (loading) return <section className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">Loading follow-up status…</section>;
  if (!item) return <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"><div className="flex items-center gap-2 text-sm font-semibold text-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Follow-up</div><p className="mt-1 text-xs text-muted-foreground">No active follow-up is required from the stored incident and delivery state.</p></section>;

  const canRetry = item.reasons.includes("communication_failed");
  const canReview = item.reasons.includes("overdue") && item.followUp?.status !== "reviewed";
  return <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"><div className="flex items-center gap-2 text-sm font-semibold text-foreground"><AlertTriangle className="h-4 w-4 text-amber-600" />Follow-up required</div><div className="mt-2 space-y-1">{item.reasons.map((reason) => <p key={reason} className="text-xs text-muted-foreground">{FOLLOW_UP_REASON_LABEL[reason]}</p>)}</div>{item.followUp?.reviewed_at && <p className="mt-2 text-xs text-muted-foreground">Reviewed {new Date(item.followUp.reviewed_at).toLocaleString()}. The underlying condition remains active.</p>}<div className="mt-3 flex gap-2">{canRetry && <Button size="sm" onClick={retry} disabled={acting}><RotateCw className="mr-1 h-3.5 w-3.5" />Retry notification</Button>}{canReview && <Button size="sm" variant="outline" onClick={review} disabled={acting}>Mark reviewed</Button>}</div></section>;
}
