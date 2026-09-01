import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), toErrorResponse: vi.fn(() => new Response("error", { status: 500 })) }));
vi.mock("@/lib/auth/account", () => mocks);

import { parseResponseSelection, POST } from "./route";

function context(id = "incident-1") {
  return { params: Promise.resolve({ id }) };
}

describe("incident response confirmation route", () => {
  beforeEach(() => mocks.requireRole.mockReset());

  it("requires a concrete resource selection", async () => {
    expect(parseResponseSelection({})).toBeNull();
    const response = await POST(new Request("http://test/api/incidents/incident-1/confirm-response", { method: "POST", body: "{}" }), context());
    expect(response.status).toBe(400);
  });

  it("uses the account-scoped RPC for an authenticated coordinator", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { incident_status: "assigned" }, error: null });
    mocks.requireRole.mockResolvedValue({ supabase: { rpc } });
    const response = await POST(new Request("http://test/api/incidents/incident-1/confirm-response", { method: "POST", body: JSON.stringify({ teamId: "team-1" }) }), context());
    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith("agent");
    expect(rpc).toHaveBeenCalledWith("confirm_incident_response", expect.objectContaining({ p_deal_id: "incident-1", p_team_id: "team-1" }));
  });

  it("returns a safe conflict when the selected resource went stale", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Resource is no longer available. Please select another resource." } });
    mocks.requireRole.mockResolvedValue({ supabase: { rpc } });
    const response = await POST(new Request("http://test/api/incidents/incident-1/confirm-response", { method: "POST", body: JSON.stringify({ vehicleId: "vehicle-1" }) }), context());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Resource is no longer available. Please select another resource." });
  });
});
