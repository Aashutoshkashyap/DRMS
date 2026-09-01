import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { parseStatusTransition } from "./selection";

/** Coordinator-only stage selection. The account-scoped RPC keeps stage,
 * incident-status, activity, and existing notification-outbox triggers aligned. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const transition = parseStatusTransition(await request.json().catch(() => null));
    if (!transition) {
      return NextResponse.json({ error: "Select a workflow stage and use a coordinator remark of 1000 characters or fewer." }, { status: 400 });
    }

    const { supabase } = await requireRole("agent");
    const { data, error } = await supabase.rpc("transition_incident_response_status", {
      p_deal_id: id,
      p_stage_id: transition.stageId,
      p_remark: transition.remark,
    });
    if (error) return NextResponse.json({ error: "Could not change this incident status." }, { status: 400 });
    return NextResponse.json({ ok: true, result: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
