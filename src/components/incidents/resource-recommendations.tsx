"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Deal, IncidentCategory } from "@/types";
import {
  recommendCompatibleResources,
  type ResourceAvailability,
  type ResourceRecommendation,
} from "@/lib/resources/recommendations";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Location = { id: string; name: string; location_type: string; latitude: number | string | null; longitude: number | string | null; availability: ResourceAvailability };
type Team = { id: string; name: string; availability: ResourceAvailability; location_id: string | null };
type Vehicle = { id: string; identifier: string; vehicle_type: string; availability: ResourceAvailability; team_id: string | null; location_id: string | null };
type Inventory = { id: string; item_name: string; item_category: string; quantity: number | string; availability: ResourceAvailability; location_id: string | null };
type Selection = { teamId: string; vehicleId: string; locationId: string; inventoryId: string };

const emptySelection: Selection = { teamId: "", vehicleId: "", locationId: "", inventoryId: "" };

function availabilityLabel(value: ResourceAvailability) {
  return value.replaceAll("_", " ").toUpperCase();
}

/** Incident-specific recommendation and confirmation. This does not alter a
 * resource until the coordinator explicitly confirms through the server RPC. */
export function ResourceRecommendations({ deal, onConfirmed }: { deal: Deal; onConfirmed: () => void }) {
  const db = createClient();
  const [locations, setLocations] = useState<Location[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [locationResult, teamResult, vehicleResult, inventoryResult] = await Promise.all([
      db.from("operational_locations").select("id,name,location_type,latitude,longitude,availability").order("name"),
      db.from("response_teams").select("id,name,availability,location_id").order("name"),
      db.from("vehicles").select("id,identifier,vehicle_type,availability,team_id,location_id").order("identifier"),
      db.from("relief_inventory").select("id,item_name,item_category,quantity,availability,location_id").order("item_name"),
    ]);
    setLocations((locationResult.data ?? []) as Location[]);
    setTeams((teamResult.data ?? []) as Team[]);
    setVehicles((vehicleResult.data ?? []) as Vehicle[]);
    setInventory((inventoryResult.data ?? []) as Inventory[]);
  }, [db]);

  // The async loader updates state only after its Supabase reads settle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    // Intentional prop-to-draft synchronization: no database write occurs
    // until the coordinator presses Confirm assignment.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelection({
      teamId: deal.assigned_team_id ?? "",
      vehicleId: deal.assigned_vehicle_id ?? "",
      locationId: deal.assigned_location_id ?? "",
      inventoryId: deal.assigned_inventory_id ?? "",
    });
  }, [deal.assigned_inventory_id, deal.assigned_location_id, deal.assigned_team_id, deal.assigned_vehicle_id, deal.id]);

  const recommendations = useMemo(() => {
    if (deal.latitude == null || deal.longitude == null) return [];
    const byLocation = new Map(locations.map((location) => [location.id, location]));
    const byTeam = new Map(teams.map((team) => [team.id, team]));
    return recommendCompatibleResources({
      category: deal.category as IncidentCategory,
      origin: { latitude: Number(deal.latitude), longitude: Number(deal.longitude) },
      teams: teams.map((team) => {
        const location = team.location_id ? byLocation.get(team.location_id) : null;
        return { id: team.id, name: team.name, availability: team.availability, latitude: location?.latitude == null ? null : Number(location.latitude), longitude: location?.longitude == null ? null : Number(location.longitude) };
      }),
      vehicles: vehicles.map((vehicle) => {
        const location = vehicle.location_id ? byLocation.get(vehicle.location_id) : null;
        return { id: vehicle.id, identifier: vehicle.identifier, vehicleType: vehicle.vehicle_type, availability: vehicle.availability, latitude: location?.latitude == null ? null : Number(location.latitude), longitude: location?.longitude == null ? null : Number(location.longitude), teamAvailability: vehicle.team_id ? byTeam.get(vehicle.team_id)?.availability ?? null : null };
      }),
      locations: locations.map((location) => ({ id: location.id, name: location.name, locationType: location.location_type, availability: location.availability, latitude: location.latitude == null ? null : Number(location.latitude), longitude: location.longitude == null ? null : Number(location.longitude) })),
      inventory: inventory.map((item) => ({ id: item.id, itemName: item.item_name, itemCategory: item.item_category, quantity: Number(item.quantity), availability: item.availability, locationId: item.location_id })),
    });
  }, [deal.category, deal.latitude, deal.longitude, inventory, locations, teams, vehicles]);

  function selectRecommendation(recommendation: ResourceRecommendation) {
    setSelection((current) => ({
      ...current,
      teamId: recommendation.kind === "team" ? recommendation.id : current.teamId,
      vehicleId: recommendation.kind === "vehicle" ? recommendation.id : current.vehicleId,
      locationId: recommendation.kind === "location" ? recommendation.id : current.locationId,
      inventoryId: recommendation.kind === "inventory" ? recommendation.id : current.inventoryId,
    }));
  }

  async function confirm() {
    if (!Object.values(selection).some(Boolean)) return;
    setSaving(true);
    const response = await fetch(`/api/incidents/${deal.id}/confirm-response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection),
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    setSaving(false);
    if (!response.ok) {
      toast.error(payload?.error ?? "Could not confirm this response.");
      await load();
      return;
    }
    toast.success("Assignment confirmed. Coordinator confirmation does not dispatch a response.");
    await load();
    onConfirmed();
  }

  if (deal.latitude == null || deal.longitude == null) {
    return <section className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">Add verified incident coordinates before calculating distance-based recommendations.</section>;
  }

  const canConfirm = deal.incident_status === "verified" || deal.incident_status === "assigned";
  return <section className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
    <div>
      <h3 className="text-sm font-semibold text-foreground">Response recommendation</h3>
      <p className="text-xs text-muted-foreground">Recommendation — Coordinator confirmation required. Distance uses stored coordinates and does not confirm suitability, availability, or dispatch.</p>
    </div>
    {recommendations.length === 0 ? <p className="rounded-lg bg-card p-3 text-sm text-muted-foreground">No verified compatible resource found.</p> : <ul className="space-y-2">{recommendations.slice(0, 5).map((recommendation) => <li key={`${recommendation.kind}-${recommendation.id}`} className="flex items-center justify-between gap-3 rounded-lg bg-card p-3"><div><p className="font-medium text-foreground">{recommendation.label}</p><p className="text-xs text-muted-foreground">{recommendation.resourceType} · {recommendation.distanceKm.toFixed(1)} km</p><p className="mt-1 text-xs text-muted-foreground">{recommendation.reason}</p></div><Button type="button" variant="outline" size="sm" onClick={() => selectRecommendation(recommendation)}>Review</Button></li>)}</ul>}
    <div className="grid gap-2 sm:grid-cols-2">
      <Choice label="Team" value={selection.teamId} onChange={(teamId) => setSelection((current) => ({ ...current, teamId }))} items={teams} currentId={deal.assigned_team_id} render={(item) => `${item.name} (${availabilityLabel(item.availability)})`} />
      <Choice label="Vehicle" value={selection.vehicleId} onChange={(vehicleId) => setSelection((current) => ({ ...current, vehicleId }))} items={vehicles} currentId={deal.assigned_vehicle_id} render={(item) => `${item.vehicle_type} — ${item.identifier} (${availabilityLabel(item.availability)})`} />
      <Choice label="Operational location" value={selection.locationId} onChange={(locationId) => setSelection((current) => ({ ...current, locationId }))} items={locations} currentId={deal.assigned_location_id} render={(item) => `${item.name} (${availabilityLabel(item.availability)})`} />
      <Choice label="Relief inventory" value={selection.inventoryId} onChange={(inventoryId) => setSelection((current) => ({ ...current, inventoryId }))} items={inventory} currentId={deal.assigned_inventory_id} render={(item) => `${item.item_name} (${availabilityLabel(item.availability)})`} />
    </div>
    {deal.assigned_team && !deal.assigned_team_id && <p className="text-xs text-muted-foreground">Existing team assignment: {deal.assigned_team}</p>}
    {deal.assigned_resource && !deal.assigned_vehicle_id && !deal.assigned_location_id && !deal.assigned_inventory_id && <p className="text-xs text-muted-foreground">Existing resource assignment: {deal.assigned_resource}</p>}
    {!canConfirm && <p className="text-xs text-amber-700 dark:text-amber-300">Verify this incident before confirming a response. Recommendation is not assignment.</p>}
    <Button type="button" onClick={confirm} disabled={!canConfirm || saving || !Object.values(selection).some(Boolean)}>{saving ? "Confirming…" : "Confirm assignment"}</Button>
  </section>;
}

function Choice<T extends { id: string; availability: ResourceAvailability }>({ label, value, onChange, items, currentId, render }: { label: string; value: string; onChange: (value: string) => void; items: T[]; currentId?: string | null; render: (item: T) => string }) {
  return <label className="grid gap-1 text-xs font-medium text-muted-foreground">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"><option value="">Leave unassigned</option>{items.filter((item) => item.availability === "available" || item.id === currentId || item.id === value).map((item) => <option key={item.id} value={item.id}>{render(item)}</option>)}</select></label>;
}
