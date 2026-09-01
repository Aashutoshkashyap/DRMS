import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), toErrorResponse: vi.fn(() => new Response("error", { status: 500 })) }));
vi.mock("@/lib/auth/account", () => mocks);

import { parseStatusTransition, POST } from "./route";

function context(id = "incident-1") {
  return { params: Promise.resolve({ id }) };
}

describe("incident status transition route", () => {
  beforeEach(() => mocks.requireRole.mockReset());

  it("accepts a selected stage and an optional bounded coordinator remark", () => {
    expect(parseStatusTransition({ stageId: "stage-verified", remark: "Verified caller location" })).toEqual({ stageId: "stage-verified", remark: "Verified caller location" });
    expect(parseStatusTransition({ stageId: "" })).toBeNull();
    expect(parseStatusTransition({ stageId: "stage", remark: "x".repeat(1001) })).toBeNull();
  });

  it("uses the account-scoped status transition RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { incident_status: "verified" }, error: null });
    mocks.requireRole.mockResolvedValue({ supabase: { rpc } });
    const response = await POST(new Request("http://test/api/incidents/incident-1/status", { method: "POST", body: JSON.stringify({ stageId: "stage-verified", remark: "Verified location" }) }), context());
    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith("agent");
    expect(rpc).toHaveBeenCalledWith("transition_incident_response_status", {
      p_deal_id: "incident-1",
      p_stage_id: "stage-verified",
      p_remark: "Verified location",
    });
  });
});
