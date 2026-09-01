import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { reconcileIncidentFollowUps } from "@/lib/incidents/follow-up";
import { loadOperationsOverview } from "@/lib/operations/overview";

/** A review is a coordinator acknowledgement only; it never clears an
 * unresolved delivery, assignment, or configured overdue condition. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, accountId, userId } = await requireRole("agent");
    const overview = await loadOperationsOverview(supabase);
    await reconcileIncidentFollowUps(supabase, accountId, overview.attentionItems, overview.followUps);
    const active = overview.attentionItems.find((item) => item.incident.id === id);
    if (!active) return NextResponse.json({ error: "No active follow-up is required for this incident." }, { status: 409 });

    const { error } = await supabase.from("incident_follow_ups").upsert({
      account_id: accountId,
      deal_id: id,
      status: "reviewed",
      reason_codes: active.reasons,
      reviewed_at: new Date().toISOString(),
      reviewed_by_user_id: userId,
      cleared_at: null,
    }, { onConflict: "account_id,deal_id" });
    if (error) throw error;
    return NextResponse.json({ reviewed: true });
  } catch (error) {
    console.error("[incident-follow-up-review] failed:", error);
    return toErrorResponse(error);
  }
}
