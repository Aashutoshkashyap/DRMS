import type { SupabaseClient } from "@supabase/supabase-js";
import { nearestAvailable } from "./distance";

type LocationRow = {
  id: string;
  name: string;
  location_type: "relief_center" | "shelter" | "medical_facility" | "team_location";
  latitude: number | string | null;
  longitude: number | string | null;
  availability: string;
};

/** Return only operational locations whose current database availability and
 * coordinates support a factual proximity response. */
export async function findNearestVerifiedLocations(
  db: SupabaseClient,
  accountId: string,
  origin: { latitude: number; longitude: number },
): Promise<{ reliefCenter?: { name: string; distanceKm: number }; shelter?: { name: string; distanceKm: number }; medicalFacility?: { name: string; distanceKm: number } }> {
  const { data, error } = await db
    .from("operational_locations")
    .select("id,name,location_type,latitude,longitude,availability")
    .eq("account_id", accountId)
    .eq("availability", "available")
    .in("location_type", ["relief_center", "shelter", "medical_facility"]);
  if (error) throw new Error(`Could not find verified locations: ${error.message}`);

  const locations = ((data ?? []) as LocationRow[])
    .filter((location) => location.latitude != null && location.longitude != null)
    .map((location) => ({ ...location, latitude: Number(location.latitude), longitude: Number(location.longitude) }));
  const nearest = (type: LocationRow["location_type"]) => nearestAvailable(origin, locations.filter((location) => location.location_type === type));
  const center = nearest("relief_center");
  const shelter = nearest("shelter");
  const medical = nearest("medical_facility");
  return {
    reliefCenter: center ? { name: center.name, distanceKm: center.distanceKm } : undefined,
    shelter: shelter ? { name: shelter.name, distanceKm: shelter.distanceKm } : undefined,
    medicalFacility: medical ? { name: medical.name, distanceKm: medical.distanceKm } : undefined,
  };
}
