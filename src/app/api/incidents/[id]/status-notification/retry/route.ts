import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { retryFailedIncidentStatusUpdate } from "@/lib/incidents/status-communication";

/** Explicit coordinator retry of the existing predefined WhatsApp status
 * message. Nothing is retried automatically. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole("agent");
    const result = await retryFailedIncidentStatusUpdate(supabase, accountId, id);
    const status = result.delivered ? 200 : result.reason === "retry_in_progress" ? 409 : 422;
    return NextResponse.json(result, { status });
  } catch (error) {
    console.error("[incident-status-notification-retry] delivery failed:", error);
    return toErrorResponse(error);
  }
}
