import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { parseResponseSelection } from "./selection";

/** Coordinator-only, atomic confirmation. The RPC owns the stale-resource
 * check and writes the existing incident assignment fields plus activity. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const selection = parseResponseSelection(await request.json().catch(() => null));
    if (!selection) {
      return NextResponse.json({ error: "Select at least one valid team, vehicle, location, or inventory resource." }, { status: 400 });
    }

    const { supabase } = await requireRole("agent");
    const { data, error } = await supabase.rpc("confirm_incident_response_with_remark", {
      p_deal_id: id,
      p_team_id: selection.teamId,
      p_vehicle_id: selection.vehicleId,
      p_location_id: selection.locationId,
      p_inventory_id: selection.inventoryId,
      p_remark: selection.remark,
    });
    if (error) {
      const stale = error.message.includes("Resource is no longer available");
      return NextResponse.json(
        { error: stale ? "Resource is no longer available. Please select another resource." : "Could not confirm this response." },
        { status: stale ? 409 : 400 },
      );
    }
    return NextResponse.json({ ok: true, result: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
