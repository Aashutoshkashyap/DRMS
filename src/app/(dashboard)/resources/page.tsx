"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recommendCompatibleResources, type ResourceAvailability } from "@/lib/resources/recommendations";

type Availability = ResourceAvailability;
type Location = { id: string; name: string; location_type: string; latitude: number | null; longitude: number | null; availability: Availability; contact: string | null };
type Vehicle = { id: string; identifier: string; vehicle_type: string; availability: Availability; team_id: string | null; location_id: string | null; location: Location | Location[] | null };
type Incident = { id: string; request_id: string; title: string; category: "rescue" | "food_water" | "medicine" | "shelter" | "missing_person" | "information"; location: string | null; latitude: number | null; longitude: number | null; incident_status: string };
type Team = { id: string; name: string; availability: Availability; location_id: string | null };
type Inventory = { id: string; item_category: string; item_name: string; quantity: number; unit: string; location_id: string | null; availability: Availability };
const AVAILABILITY_OPTIONS: { value: Availability; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "assigned", label: "Assigned" },
  { value: "limited", label: "Limited" },
  { value: "unavailable", label: "Unavailable" },
  { value: "maintenance", label: "Maintenance" },
];

export default function ResourcesPage() {
  const db = createClient();
  const { accountId } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationType, setLocationType] = useState("relief_center");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [vehicleIdentifier, setVehicleIdentifier] = useState("");
  const [vehicleType, setVehicleType] = useState("ambulance");
  const [vehicleLocationId, setVehicleLocationId] = useState("");
  const [vehicleTeamId, setVehicleTeamId] = useState("");
  const [inventoryName, setInventoryName] = useState("");
  const [inventoryCategory, setInventoryCategory] = useState("food");
  const [inventoryQuantity, setInventoryQuantity] = useState("0");
  const [inventoryUnit, setInventoryUnit] = useState("units");
  const [inventoryLocationId, setInventoryLocationId] = useState("");
  const [availability, setAvailability] = useState<Availability>("available");

  const load = useCallback(async () => {
    const [locationResult, vehicleResult, incidentResult, teamResult, inventoryResult] = await Promise.all([
      db.from("operational_locations").select("id,name,location_type,latitude,longitude,availability,contact").order("name"),
      db.from("vehicles").select("id,identifier,vehicle_type,availability,team_id,location_id,location:operational_locations(id,name,location_type,latitude,longitude,availability,contact)").order("identifier"),
      db.from("deals").select("id,request_id,title,category,location,latitude,longitude,incident_status").neq("incident_status", "resolved").order("created_at", { ascending: false }),
      db.from("response_teams").select("id,name,availability,location_id").order("name"),
      db.from("relief_inventory").select("id,item_category,item_name,quantity,unit,location_id,availability").order("item_name"),
    ]);
    setLocations((locationResult.data ?? []) as Location[]);
    setVehicles((vehicleResult.data ?? []) as Vehicle[]);
    setIncidents((incidentResult.data ?? []) as Incident[]);
    setTeams((teamResult.data ?? []) as Team[]);
    setInventory((inventoryResult.data ?? []) as Inventory[]);
  }, [db]);

  // `load` updates state only after its three remote Supabase queries settle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId);
  const nearby = useMemo(() => {
    if (!selectedIncident || selectedIncident.latitude == null || selectedIncident.longitude == null) return null;
    const origin = { latitude: Number(selectedIncident.latitude), longitude: Number(selectedIncident.longitude) };
    const byLocation = new Map(locations.map((location) => [location.id, location]));
    const byTeam = new Map(teams.map((team) => [team.id, team]));
    const recommendations = recommendCompatibleResources({
      category: selectedIncident.category,
      origin,
      teams: teams.map((team) => { const location = team.location_id ? byLocation.get(team.location_id) : null; return { id: team.id, name: team.name, availability: team.availability, latitude: location?.latitude == null ? null : Number(location.latitude), longitude: location?.longitude == null ? null : Number(location.longitude) }; }),
      vehicles: vehicles.map((vehicle) => { const location = vehicle.location_id ? byLocation.get(vehicle.location_id) : (Array.isArray(vehicle.location) ? vehicle.location[0] : vehicle.location); return { id: vehicle.id, identifier: vehicle.identifier, vehicleType: vehicle.vehicle_type, availability: vehicle.availability, latitude: location?.latitude == null ? null : Number(location.latitude), longitude: location?.longitude == null ? null : Number(location.longitude), teamAvailability: vehicle.team_id ? byTeam.get(vehicle.team_id)?.availability ?? null : null }; }),
      locations: locations.map((location) => ({ id: location.id, name: location.name, locationType: location.location_type, availability: location.availability, latitude: location.latitude == null ? null : Number(location.latitude), longitude: location.longitude == null ? null : Number(location.longitude) })),
      inventory: inventory.map((item) => ({ id: item.id, itemName: item.item_name, itemCategory: item.item_category, quantity: Number(item.quantity), availability: item.availability, locationId: item.location_id })),
    });
    return { recommendations };
  }, [selectedIncident, vehicles, locations, teams, inventory]);

  async function createLocation() {
    if (!accountId || !locationName.trim()) return;
    const user = (await db.auth.getSession()).data.session?.user;
    if (!user) return;
    await db.from("operational_locations").insert({ account_id: accountId, user_id: user.id, name: locationName.trim(), location_type: locationType, latitude: latitude ? Number(latitude) : null, longitude: longitude ? Number(longitude) : null, availability });
    setLocationName(""); setLatitude(""); setLongitude(""); void load();
  }

  async function createVehicle() {
    if (!accountId || !vehicleIdentifier.trim()) return;
    const user = (await db.auth.getSession()).data.session?.user;
    if (!user) return;
    await db.from("vehicles").insert({ account_id: accountId, user_id: user.id, identifier: vehicleIdentifier.trim(), vehicle_type: vehicleType.trim() || "vehicle", team_id: vehicleTeamId || null, location_id: vehicleLocationId || null, availability });
    setVehicleIdentifier(""); void load();
  }

  async function createInventory() {
    if (!accountId || !inventoryName.trim() || Number(inventoryQuantity) < 0) return;
    const user = (await db.auth.getSession()).data.session?.user;
    if (!user) return;
    await db.from("relief_inventory").insert({ account_id: accountId, user_id: user.id, item_category: inventoryCategory, item_name: inventoryName.trim(), quantity: Number(inventoryQuantity), unit: inventoryUnit.trim() || "units", location_id: inventoryLocationId || null, availability });
    setInventoryName(""); setInventoryQuantity("0"); void load();
  }

  async function updateAvailability(table: "operational_locations" | "vehicles" | "response_teams" | "relief_inventory", id: string, nextAvailability: Availability) {
    const { error } = await db.from(table).update({ availability: nextAvailability }).eq("id", id);
    if (!error) void load();
  }

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold text-foreground">Resources & locations</h1><p className="mt-1 text-sm text-muted-foreground">Availability is coordinator-maintained. Proximity results assist review and never dispatch a resource automatically.</p></div>
    <section className="rounded-xl border border-border bg-card p-4"><h2 className="font-semibold">Incident-oriented resource review</h2><p className="mt-1 text-xs text-muted-foreground">Only available resources with an explicit stored category/type match are ranked. Recommendation — coordinator confirmation required.</p><select value={selectedIncidentId} onChange={(event) => setSelectedIncidentId(event.target.value)} className="mt-3 h-9 w-full rounded-lg border border-border bg-muted px-2 text-sm"><option value="">Select an active incident with coordinates</option>{incidents.map((incident) => <option key={incident.id} value={incident.id}>{incident.request_id} — {incident.title}</option>)}</select>{selectedIncident && (selectedIncident.latitude == null || selectedIncident.longitude == null) && <p className="mt-3 text-sm text-amber-600">Add incident coordinates before distance ranking is available.</p>}{nearby && (nearby.recommendations.length ? <ul className="mt-4 grid gap-3 sm:grid-cols-2">{nearby.recommendations.slice(0, 4).map((resource) => <li key={`${resource.kind}-${resource.id}`}><Result label={`${resource.resourceType} · ${resource.kind}`} value={`${resource.label}: ${resource.distanceKm.toFixed(1)} km`} detail={`Compatible with ${(selectedIncident?.category ?? "incident").replaceAll("_", " ")}; available at the last coordinator update. Review before assignment.`} /></li>)}</ul> : <p className="mt-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">No verified compatible resource found.</p>)}</section>
    <div className="grid gap-6 lg:grid-cols-2"><section className="rounded-xl border border-border bg-card p-4"><h2 className="font-semibold">Operational locations</h2><div className="mt-3 grid gap-2"><Input value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder="Relief center or facility name" /><select value={locationType} onChange={(event) => setLocationType(event.target.value)} className="h-9 rounded-lg border border-border bg-muted px-2 text-sm"><option value="relief_center">Relief center</option><option value="shelter">Shelter</option><option value="medical_facility">Medical facility</option><option value="team_location">Team location</option></select><div className="grid grid-cols-2 gap-2"><Input type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} placeholder="Latitude" /><Input type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} placeholder="Longitude" /></div><AvailabilitySelect value={availability} onChange={setAvailability} /><Button onClick={createLocation}>Add location</Button></div><ul className="mt-4 space-y-2 text-sm">{locations.map((location) => <li key={location.id} className="flex items-center justify-between gap-2 rounded border border-border p-2"><span><strong>{location.name}</strong> · {location.location_type.replaceAll("_", " ")}</span><AvailabilitySelect value={location.availability} onChange={(next) => void updateAvailability("operational_locations", location.id, next)} /></li>)}</ul></section>
    <section className="rounded-xl border border-border bg-card p-4"><h2 className="font-semibold">Vehicles</h2><div className="mt-3 grid gap-2"><Input value={vehicleIdentifier} onChange={(event) => setVehicleIdentifier(event.target.value)} placeholder="Vehicle identifier" /><Input value={vehicleType} onChange={(event) => setVehicleType(event.target.value)} placeholder="Vehicle type, e.g. ambulance" /><select value={vehicleTeamId} onChange={(event) => setVehicleTeamId(event.target.value)} className="h-9 rounded-lg border border-border bg-muted px-2 text-sm"><option value="">No team assigned</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><select value={vehicleLocationId} onChange={(event) => setVehicleLocationId(event.target.value)} className="h-9 rounded-lg border border-border bg-muted px-2 text-sm"><option value="">Current location unknown</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select><AvailabilitySelect value={availability} onChange={setAvailability} /><Button onClick={createVehicle}>Register vehicle</Button></div><ul className="mt-4 space-y-2 text-sm">{vehicles.map((vehicle) => <li key={vehicle.id} className="flex items-center justify-between gap-2 rounded border border-border p-2"><span><strong>{vehicle.identifier}</strong> · {vehicle.vehicle_type}</span><AvailabilitySelect value={vehicle.availability} onChange={(next) => void updateAvailability("vehicles", vehicle.id, next)} /></li>)}</ul></section></div>
    <div className="grid gap-6 lg:grid-cols-2"><section className="rounded-xl border border-border bg-card p-4"><h2 className="font-semibold">Response teams</h2><p className="mt-2 text-sm text-muted-foreground">Team identity and workspace membership are managed in one shared directory, so the operational board and its accountability log use the same team records.</p><Link href="/teams" className="mt-4 inline-flex rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted">Open response teams</Link><ul className="mt-4 space-y-2 text-sm">{teams.map((team) => <li key={team.id} className="flex items-center justify-between gap-2 rounded border border-border p-2"><strong>{team.name}</strong><AvailabilitySelect value={team.availability} onChange={(next) => void updateAvailability("response_teams", team.id, next)} /></li>)}</ul></section><section className="rounded-xl border border-border bg-card p-4"><h2 className="font-semibold">Relief inventory</h2><div className="mt-3 grid gap-2"><Input value={inventoryName} onChange={(event) => setInventoryName(event.target.value)} placeholder="Item name" /><div className="grid grid-cols-3 gap-2"><select value={inventoryCategory} onChange={(event) => setInventoryCategory(event.target.value)} className="h-9 rounded-lg border border-border bg-muted px-2 text-sm"><option value="food">Food</option><option value="water">Water</option><option value="medicine">Medicine</option><option value="relief_package">Relief package</option></select><Input type="number" min="0" value={inventoryQuantity} onChange={(event) => setInventoryQuantity(event.target.value)} placeholder="Quantity" /><Input value={inventoryUnit} onChange={(event) => setInventoryUnit(event.target.value)} placeholder="Unit" /></div><select value={inventoryLocationId} onChange={(event) => setInventoryLocationId(event.target.value)} className="h-9 rounded-lg border border-border bg-muted px-2 text-sm"><option value="">Stored location unknown</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select><AvailabilitySelect value={availability} onChange={setAvailability} /><Button onClick={createInventory}>Record inventory</Button></div><ul className="mt-4 space-y-2 text-sm">{inventory.map((item) => <li key={item.id} className="flex items-center justify-between gap-2 rounded border border-border p-2"><span><strong>{item.item_name}</strong> · {item.quantity} {item.unit}</span><AvailabilitySelect value={item.availability} onChange={(next) => void updateAvailability("relief_inventory", item.id, next)} /></li>)}</ul></section></div>
  </div>;
}

function Result({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium text-foreground">{value}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>; }

function AvailabilitySelect({ value, onChange }: { value: Availability; onChange: (value: Availability) => void }) {
  return <select aria-label="Availability" value={value} onChange={(event) => onChange(event.target.value as Availability)} className="h-9 rounded-lg border border-border bg-muted px-2 text-sm">{AVAILABILITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}
