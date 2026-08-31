"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { nearestAvailable } from "@/lib/resources/distance";
import { Button } from "@/components/ui/button";

type Availability = "available" | "limited" | "unavailable" | "maintenance";
type Location = { id: string; name: string; location_type: string; latitude: number | null; longitude: number | null; availability: Availability };
type Team = { id: string; name: string; availability: Availability };
type Vehicle = { id: string; identifier: string; vehicle_type: string; availability: Availability; team_id: string | null; location: Location | Location[] | null };

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function ResourceRecommendations({
  latitude,
  longitude,
  onChooseTeam,
  onChooseVehicle,
}: {
  latitude: number | null;
  longitude: number | null;
  onChooseTeam: (teamName: string) => void;
  onChooseVehicle: (identifier: string) => void;
}) {
  const db = createClient();
  const [locations, setLocations] = useState<Location[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  const load = useCallback(async () => {
    const [locationsResult, vehiclesResult, teamsResult] = await Promise.all([
      db.from("operational_locations").select("id,name,location_type,latitude,longitude,availability"),
      db.from("vehicles").select("id,identifier,vehicle_type,availability,team_id,location:operational_locations(id,name,location_type,latitude,longitude,availability)"),
      db.from("response_teams").select("id,name,availability").order("name"),
    ]);
    setLocations((locationsResult.data ?? []) as Location[]);
    setVehicles((vehiclesResult.data ?? []) as Vehicle[]);
    setTeams((teamsResult.data ?? []) as Team[]);
  }, [db]);

  // The asynchronous loader updates local state only after the Supabase reads settle.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const recommendations = useMemo(() => {
    if (latitude == null || longitude == null) return null;
    const origin = { latitude, longitude };
    const ambulances = vehicles.flatMap((vehicle) => {
      const location = one(vehicle.location);
      return vehicle.availability === "available" && location?.latitude != null && location.longitude != null && vehicle.vehicle_type.toLowerCase().includes("ambulance")
        ? [{ ...vehicle, latitude: Number(location.latitude), longitude: Number(location.longitude) }]
        : [];
    });
    const centres = locations
      .filter((location) => location.availability === "available" && location.location_type === "relief_center" && location.latitude != null && location.longitude != null)
      .map((location) => ({ ...location, latitude: Number(location.latitude), longitude: Number(location.longitude) }));
    return { ambulance: nearestAvailable(origin, ambulances), centre: nearestAvailable(origin, centres) };
  }, [latitude, longitude, locations, vehicles]);

  if (latitude == null || longitude == null) {
    return <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">Add incident coordinates to calculate deterministic distance recommendations.</p>;
  }

  const ambulance = recommendations?.ambulance ?? null;
  const centre = recommendations?.centre ?? null;

  return (
    <section className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Nearby suitable resources</h3>
        <p className="text-xs text-muted-foreground">Recommendation from coordinator-maintained availability and stored coordinates. It does not dispatch anything.</p>
      </div>
      <Recommendation label="Nearest suitable ambulance" value={ambulance ? `${ambulance.identifier} · ${ambulance.distanceKm.toFixed(1)} km` : "No available ambulance with coordinates"} onChoose={ambulance ? () => onChooseVehicle(ambulance.identifier) : undefined} />
      <Recommendation label="Nearest suitable relief center" value={centre ? `${centre.name} · ${centre.distanceKm.toFixed(1)} km` : "No available relief center with coordinates"} />
      <div className="grid gap-2">
        <label className="text-xs font-medium text-muted-foreground">Available response team</label>
        <select onChange={(event) => event.target.value && onChooseTeam(event.target.value)} defaultValue="" className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground">
          <option value="">Coordinator may choose a verified team</option>
          {teams.filter((team) => team.availability === "available" || team.availability === "limited").map((team) => <option key={team.id} value={team.name}>{team.name} ({team.availability})</option>)}
        </select>
      </div>
    </section>
  );
}

function Recommendation({ label, value, onChoose }: { label: string; value: string; onChoose?: () => void }) {
  return <div className="flex items-center justify-between gap-2 rounded-lg bg-card p-2"><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-sm font-medium text-foreground">{value}</p></div>{onChoose && <Button type="button" variant="outline" size="sm" onClick={onChoose}>Use selection</Button>}</div>;
}
