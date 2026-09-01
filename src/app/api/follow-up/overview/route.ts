import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { reconcileIncidentFollowUps } from "@/lib/incidents/follow-up";
import { loadOperationsOverview } from "@/lib/operations/overview";

/** Agent-only operational attention snapshot. Reconciliation writes lifecycle
 * metadata but the response is always derived from current incident state. */
export async function POST() {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const before = await loadOperationsOverview(supabase);
    await reconcileIncidentFollowUps(supabase, accountId, before.attentionItems, before.followUps);
    const overview = await loadOperationsOverview(supabase);
    return NextResponse.json(overview);
  } catch (error) {
    console.error("[follow-up-overview] failed:", error);
    return toErrorResponse(error);
  }
}
