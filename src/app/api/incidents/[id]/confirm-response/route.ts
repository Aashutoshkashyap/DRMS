import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

type ResponseSelection = {
  teamId: string | null;
  vehicleId: string | null;
  locationId: string | null;
  inventoryId: string | null;
};

function optionalId(value: unknown): string | null | undefined {
  if (value == null || value === "") return null;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseResponseSelection(value: unknown): ResponseSelection | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const teamId = optionalId(body.teamId);
  const vehicleId = optionalId(body.vehicleId);
  const locationId = optionalId(body.locationId);
  const inventoryId = optionalId(body.inventoryId);
  if ([teamId, vehicleId, locationId, inventoryId].some((item) => item === undefined)) return null;
  if (!teamId && !vehicleId && !locationId && !inventoryId) return null;
  return { teamId: teamId ?? null, vehicleId: vehicleId ?? null, locationId: locationId ?? null, inventoryId: inventoryId ?? null };
}

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
    const { data, error } = await supabase.rpc("confirm_incident_response", {
      p_deal_id: id,
      p_team_id: selection.teamId,
      p_vehicle_id: selection.vehicleId,
      p_location_id: selection.locationId,
      p_inventory_id: selection.inventoryId,
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
