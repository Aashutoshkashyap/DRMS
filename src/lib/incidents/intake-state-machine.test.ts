import { describe, expect, it } from "vitest";
import { transitionIntake } from "./intake-state-machine";

describe("deterministic disaster intake", () => {
  it("collects a rescue request through confirmation", () => {
    const selected = transitionIntake("start", {}, { interactionId: "emergency:service:rescue" })!;
    expect(selected.state).toBe("collect_name");

    const named = transitionIntake(selected.state, selected.data, { text: "Sita Rai" })!;
    const located = transitionIntake(named.state, named.data, { text: "Ward 5, Bhaktapur", latitude: 27.67, longitude: 85.43 })!;
    const counted = transitionIntake(located.state, located.data, { text: "3" })!;
    const detailed = transitionIntake(counted.state, counted.data, { text: "Trapped after landslide" })!;
    const submitted = transitionIntake(detailed.state, detailed.data, { interactionId: "emergency:confirm" })!;

    expect(submitted.action).toBe("create_request");
    expect(submitted.data).toMatchObject({ category: "rescue", requesterName: "Sita Rai", peopleAffected: 3, latitude: 27.67 });
  });

  it("keeps invalid affected-person input in the same state", () => {
    const result = transitionIntake("collect_people", { category: "shelter", requesterName: "A", location: "Patan" }, { text: "zero" })!;
    expect(result.state).toBe("collect_people");
    expect(result.action).toBeNull();
  });

  it("uses the request identity flow for status lookups", () => {
    const request = transitionIntake("start", {}, { interactionId: "emergency:status" })!;
    expect(request.action).toBe("check_active_request");
    const byId = transitionIntake("collect_request_id", {}, { text: "drms-abcd1234" })!;
    expect(byId.action).toBe("check_request_id");
  });
});
