import { describe, expect, it } from "vitest";
import { deriveIncidentAttention, groupIncidentsByLocation, isAgeFollowUp, isUnassigned, requiresAssignment, type OperationsIncident } from "./overview";

const incident: OperationsIncident = {
  id: "case-1", request_id: "DRMS-1", title: "Case", requester_name: null, contact_phone: null,
  category: "rescue", priority: "high", people_affected: 1, incident_status: "received", location: null, municipality: null, district: null,
  assigned_to: null, assigned_team: null, assigned_resource: null, assigned_team_id: null, assigned_vehicle_id: null, assigned_location_id: null, assigned_inventory_id: null,
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

  it("requires coordinator assignment only for a verified incident", () => {
    expect(requiresAssignment(incident)).toBe(false);
    expect(requiresAssignment({ ...incident, incident_status: "verified" })).toBe(true);
    expect(requiresAssignment({ ...incident, incident_status: "verified", assigned_team_id: "team-1" })).toBe(false);
  });

  it("combines multiple real conditions for one incident and orders critical first", () => {
    const critical = { ...incident, id: "critical", priority: "critical", incident_status: "verified", created_at: "2026-08-29T00:00:00.000Z" };
    const high = { ...incident, id: "high", priority: "high", incident_status: "verified", created_at: "2026-08-28T00:00:00.000Z" };
    const items = deriveIncidentAttention({
      incidents: [high, critical],
      settings: { received_after_hours: null, assigned_after_hours: null, dispatched_after_hours: null },
      deliveries: [{ id: "delivery-1", deal_id: "critical", incident_status: "verified", error_message: "transport failed", delivery_status: "failed", created_at: "2026-08-31T00:00:00.000Z", updated_at: "2026-08-31T00:00:00.000Z" }],
    });
    expect(items.map((item) => item.incident.id)).toEqual(["critical", "high"]);
    expect(items[0].reasons).toEqual(["communication_failed", "unassigned"]);
  });

  it("does not retain a prior communication failure after a later successful delivery", () => {
    const items = deriveIncidentAttention({
      incidents: [{ ...incident, id: "case-communication", incident_status: "resolved" }],
      settings: null,
      deliveries: [
        { id: "failed", deal_id: "case-communication", incident_status: "dispatched", error_message: "failed", delivery_status: "failed", created_at: "2026-08-30T00:00:00.000Z", updated_at: "2026-08-30T00:00:00.000Z" },
        { id: "sent", deal_id: "case-communication", incident_status: "resolved", error_message: null, delivery_status: "sent", created_at: "2026-08-31T00:00:00.000Z", updated_at: "2026-08-31T00:00:00.000Z" },
      ],
    });
    expect(items).toEqual([]);
  });

  it("keeps a reviewed follow-up active until its underlying condition clears", () => {
    const verified = { ...incident, id: "reviewed-case", incident_status: "verified" };
    const followUp = { id: "follow-up-1", account_id: "account-1", deal_id: verified.id, status: "reviewed" as const, reason_codes: ["unassigned" as const], reviewed_at: "2026-08-31T00:00:00.000Z", reviewed_by_user_id: "agent-1", cleared_at: null, created_at: "2026-08-30T00:00:00.000Z", updated_at: "2026-08-31T00:00:00.000Z" };
    expect(deriveIncidentAttention({ incidents: [verified], settings: null, deliveries: [], followUps: [followUp] })).toMatchObject([{ followUp: { status: "reviewed" }, reasons: ["unassigned"] }]);
    expect(deriveIncidentAttention({ incidents: [{ ...verified, assigned_team_id: "team-1" }], settings: null, deliveries: [], followUps: [followUp] })).toEqual([]);
  });

  it("groups active incidents by only the requested stored location dimension", () => {
    const incidents = [
      { ...incident, id: "a", location: "Kalanki Ward 14", municipality: "Kathmandu", district: "Kathmandu" },
      { ...incident, id: "b", location: "Kalanki Ward 14", municipality: "Kathmandu", district: "Kathmandu" },
      { ...incident, id: "c", location: "Patan Ward 3", municipality: "Lalitpur", district: "Lalitpur" },
    ];
    expect(groupIncidentsByLocation(incidents, "exact")).toEqual([["Kalanki Ward 14", 2], ["Patan Ward 3", 1]]);
    expect(groupIncidentsByLocation(incidents, "municipality")).toEqual([["Kathmandu", 2], ["Lalitpur", 1]]);
  });
});
