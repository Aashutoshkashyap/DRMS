import { describe, expect, it } from "vitest";
import { recommendCompatibleResources } from "./recommendations";

const origin = { latitude: 27.7172, longitude: 85.324 };
const base = {
  origin,
  teams: [
    { id: "medical", name: "Medical Team A", availability: "available" as const, latitude: 27.73, longitude: 85.33 },
    { id: "rescue", name: "Search & Rescue Team", availability: "available" as const, latitude: 27.72, longitude: 85.325 },
  ],
  vehicles: [
    { id: "ambulance", identifier: "AMB-1", vehicleType: "Ambulance", availability: "available" as const, latitude: 27.721, longitude: 85.326, teamAvailability: "available" as const },
  ],
  locations: [
    { id: "food-centre", name: "Food Centre", locationType: "relief_center", availability: "available" as const, latitude: 27.718, longitude: 85.325 },
    { id: "medical-facility", name: "Medical Facility", locationType: "medical_facility", availability: "available" as const, latitude: 27.74, longitude: 85.35 },
    { id: "shelter", name: "Shelter A", locationType: "shelter", availability: "available" as const, latitude: 27.725, longitude: 85.328 },
  ],
  inventory: [
    { id: "food", itemName: "Food kits", itemCategory: "food", quantity: 20, availability: "available" as const, locationId: "food-centre" },
    { id: "medicine", itemName: "First aid", itemCategory: "medicine", quantity: 10, availability: "available" as const, locationId: "medical-facility" },
  ],
};

describe("deterministic incident resource recommendations", () => {
  it("does not recommend a closer incompatible resource", () => {
    const results = recommendCompatibleResources({ ...base, category: "medicine" });
    expect(results[0]).toMatchObject({ kind: "vehicle", id: "ambulance" });
    expect(results.some((item) => item.id === "food")).toBe(false);
  });

  it("uses stored inventory category and location coordinates for food and water", () => {
    expect(recommendCompatibleResources({ ...base, category: "food_water" })).toEqual([
      expect.objectContaining({ id: "food", kind: "inventory", label: "Food kits — Food Centre" }),
    ]);
  });

  it("excludes unavailable resources and returns no invented match", () => {
    const locations = base.locations.map((location) => location.id === "food-centre" ? { ...location, availability: "unavailable" as const } : location);
    expect(recommendCompatibleResources({ ...base, category: "food_water", locations })).toEqual([]);
    expect(recommendCompatibleResources({ ...base, category: "information" })).toEqual([]);
  });

  it("ranks compatible candidates by deterministic distance", () => {
    const results = recommendCompatibleResources({ ...base, category: "rescue" });
    expect(results.map((item) => item.id)).toEqual(["rescue"]);
    expect(results[0].distanceKm).toBeGreaterThan(0);
  });
});
