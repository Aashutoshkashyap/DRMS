export type ResponseSelection = {
  teamId: string | null;
  vehicleId: string | null;
  locationId: string | null;
  inventoryId: string | null;
  remark: string | null;
};

function optionalId(value: unknown): string | null | undefined {
  if (value == null || value === "") return null;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Validates the coordinator's deterministic resource selection before the
 * account-scoped RPC performs the authoritative availability check. */
export function parseResponseSelection(value: unknown): ResponseSelection | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const teamId = optionalId(body.teamId);
  const vehicleId = optionalId(body.vehicleId);
  const locationId = optionalId(body.locationId);
  const inventoryId = optionalId(body.inventoryId);
  const rawRemark = body.remark;
  if ([teamId, vehicleId, locationId, inventoryId].some((item) => item === undefined) || (rawRemark != null && typeof rawRemark !== "string")) return null;
  if (!teamId && !vehicleId && !locationId && !inventoryId) return null;
  const remark = typeof rawRemark === "string" ? rawRemark.trim() : "";
  if (remark.length > 1000) return null;
  return { teamId: teamId ?? null, vehicleId: vehicleId ?? null, locationId: locationId ?? null, inventoryId: inventoryId ?? null, remark: remark || null };
}
