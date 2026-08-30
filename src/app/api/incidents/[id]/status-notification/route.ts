import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { deliverIncidentStatusUpdate } from "@/lib/incidents/status-communication";

/** Coordinator-only dispatcher for a status event already queued by the DB. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole("agent");
    const result = await deliverIncidentStatusUpdate(supabase, accountId, id);
    return NextResponse.json(result, { status: result.delivered || result.reason ? 200 : 500 });
  } catch (error) {
    console.error("[incident-status-notification] delivery failed:", error);
    return toErrorResponse(error);
  }
}
