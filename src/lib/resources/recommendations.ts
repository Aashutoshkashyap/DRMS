import type { IncidentCategory } from "@/types";
import { distanceKm, type Coordinates } from "./distance";

export type ResourceAvailability = "available" | "limited" | "assigned" | "unavailable" | "maintenance";
export type RecommendedResourceKind = "team" | "vehicle" | "location" | "inventory";

export type ResourceRecommendation = {
  id: string;
  kind: RecommendedResourceKind;
  label: string;
  resourceType: string;
  distanceKm: number;
  reason: string;
};

export type RecommendationInputs = {
  category: IncidentCategory;
  origin: Coordinates;
  teams: Array<{ id: string; name: string; availability: ResourceAvailability; latitude: number | null; longitude: number | null }>;
  vehicles: Array<{ id: string; identifier: string; vehicleType: string; availability: ResourceAvailability; latitude: number | null; longitude: number | null; teamAvailability?: ResourceAvailability | null }>;
  locations: Array<{ id: string; name: string; locationType: string; availability: ResourceAvailability; latitude: number | null; longitude: number | null }>;
  inventory: Array<{ id: string; itemName: string; itemCategory: string; quantity: number; availability: ResourceAvailability; locationId: string | null }>;
};

const CATEGORY_LABEL: Record<IncidentCategory, string> = {
  rescue: "rescue assistance",
  food_water: "food or water assistance",
  medicine: "medical assistance",
  shelter: "shelter assistance",
  missing_person: "missing-person assistance",
  information: "information assistance",
};

function includesAny(value: string, terms: string[]) {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function coordinates(value: { latitude: number | null; longitude: number | null }): Coordinates | null {
  return value.latitude == null || value.longitude == null ? null : { latitude: Number(value.latitude), longitude: Number(value.longitude) };
}

function candidate(
  input: RecommendationInputs,
  item: { id: string; label: string; resourceType: string; kind: RecommendedResourceKind; latitude: number | null; longitude: number | null },
): ResourceRecommendation | null {
  const point = coordinates(item);
  if (!point) return null;
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    resourceType: item.resourceType,
    distanceKm: distanceKm(input.origin, point),
    reason: `Nearest available resource matching the requested ${CATEGORY_LABEL[input.category]}.`,
  };
}

/**
 * Deterministic, conservative matching over fields already held in Supabase.
 * A resource is never inferred to be compatible from proximity alone: a team
 * or vehicle must state a matching type in its stored name/type, and inventory
 * must use the existing inventory category. Unknown categories remain absent.
 */
export function recommendCompatibleResources(input: RecommendationInputs): ResourceRecommendation[] {
  const result: ResourceRecommendation[] = [];
  const availableLocations = new Map(
    input.locations
      .filter((location) => location.availability === "available" && coordinates(location))
      .map((location) => [location.id, location]),
  );
  const push = (value: ResourceRecommendation | null) => { if (value) result.push(value); };

  if (input.category === "medicine") {
    for (const team of input.teams) {
      if (team.availability === "available" && includesAny(team.name, ["medical", "health", "doctor"])) {
        push(candidate(input, { ...team, label: team.name, resourceType: "Medical team", kind: "team" }));
      }
    }
    for (const vehicle of input.vehicles) {
      if (vehicle.availability === "available" && vehicle.teamAvailability !== "assigned" && vehicle.teamAvailability !== "unavailable" && includesAny(vehicle.vehicleType, ["ambulance", "medical", "health"])) {
        push(candidate(input, { ...vehicle, label: vehicle.identifier, resourceType: vehicle.vehicleType, kind: "vehicle" }));
      }
    }
    for (const location of availableLocations.values()) {
      if (location.locationType === "medical_facility") {
        push(candidate(input, { ...location, label: location.name, resourceType: "Medical facility", kind: "location" }));
      }
    }
  }

  if (input.category === "rescue" || input.category === "missing_person") {
    for (const team of input.teams) {
      if (team.availability === "available" && includesAny(team.name, ["rescue", "search", "missing"])) {
        push(candidate(input, { ...team, label: team.name, resourceType: "Response team", kind: "team" }));
      }
    }
    for (const vehicle of input.vehicles) {
      if (vehicle.availability === "available" && vehicle.teamAvailability !== "assigned" && vehicle.teamAvailability !== "unavailable" && includesAny(vehicle.vehicleType, ["rescue", "search"])) {
        push(candidate(input, { ...vehicle, label: vehicle.identifier, resourceType: vehicle.vehicleType, kind: "vehicle" }));
      }
    }
  }

  if (input.category === "shelter") {
    for (const location of availableLocations.values()) {
      if (location.locationType === "shelter") {
        push(candidate(input, { ...location, label: location.name, resourceType: "Shelter", kind: "location" }));
      }
    }
  }

  const inventoryCategories = input.category === "food_water"
    ? new Set(["food", "water"])
    : input.category === "medicine"
      ? new Set(["medicine"])
      : new Set<string>();
  for (const item of input.inventory) {
    const location = item.locationId ? availableLocations.get(item.locationId) : null;
    if (item.availability === "available" && item.quantity > 0 && inventoryCategories.has(item.itemCategory) && location) {
      push(candidate(input, {
        id: item.id,
        label: `${item.itemName} — ${location.name}`,
        resourceType: item.itemCategory.replaceAll("_", " "),
        kind: "inventory",
        latitude: location.latitude,
        longitude: location.longitude,
      }));
    }
  }

  return result.sort((left, right) => left.distanceKm - right.distanceKm || left.label.localeCompare(right.label));
}

export function recommendationFor(input: RecommendationInputs): ResourceRecommendation | null {
  return recommendCompatibleResources(input)[0] ?? null;
}
