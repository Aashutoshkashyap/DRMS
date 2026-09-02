import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

/** Authenticated, grouped operational failures. It deliberately reports only
 * observed dependency outcomes; a page load alone cannot claim health. */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { data, error } = await supabase.from("operational_health_events")
      .select("component,severity,message,event_count,first_seen_at,last_seen_at")
      .eq("account_id", accountId).is("recovered_at", null).order("last_seen_at", { ascending: false }).limit(10);
    if (error) throw error;
    const alerts = data ?? [];
    return NextResponse.json({ status: alerts.some((item) => item.severity === "incident") ? "incident" : alerts.length ? "degraded" : "operational", alerts });
  } catch (error) { return toErrorResponse(error); }
}
