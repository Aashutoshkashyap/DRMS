import { describe, expect, it } from "vitest";
import { isAgeFollowUp, isUnassigned, type OperationsIncident } from "./overview";

const incident: OperationsIncident = {
  id: "case-1", request_id: "DRMS-1", title: "Case", requester_name: null,
  category: "rescue", priority: "high", incident_status: "received", location: null,
  assigned_to: null, assigned_team: null, assigned_resource: null,
  created_at: "2026-08-30T00:00:00.000Z", updated_at: "2026-08-30T00:00:00.000Z",
};

describe("operations follow-up rules", () => {
  it("does not invent an age threshold when none was configured", () => {
    expect(isAgeFollowUp(incident, null, new Date("2026-08-31T00:00:00.000Z"))).toBe(false);
    expect(isAgeFollowUp(incident, { received_after_hours: null, assigned_after_hours: null, dispatched_after_hours: null }, new Date("2026-08-31T00:00:00.000Z"))).toBe(false);
  });

  it("uses only the configured threshold for the incident status", () => {
    expect(isAgeFollowUp(incident, { received_after_hours: 12, assigned_after_hours: null, dispatched_after_hours: null }, new Date("2026-08-30T11:59:00.000Z"))).toBe(false);
    expect(isAgeFollowUp(incident, { received_after_hours: 12, assigned_after_hours: null, dispatched_after_hours: null }, new Date("2026-08-30T12:00:00.000Z"))).toBe(true);
  });

  it("identifies a case as unassigned only when no coordinator, team, or resource is present", () => {
    expect(isUnassigned(incident)).toBe(true);
    expect(isUnassigned({ ...incident, assigned_team: "Team 1" })).toBe(false);
  });
});
