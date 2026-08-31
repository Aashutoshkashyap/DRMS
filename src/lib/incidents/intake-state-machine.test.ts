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

  it("extracts a deterministic multi-field food request in one message", () => {
    const result = transitionIntake("start", { requesterName: "Sita Rai" }, {
      text: "Need food for 5 people at Kalanki",
    })!;
    expect(result.state).toBe("confirm_request");
    expect(result.data).toMatchObject({
      category: "food_water",
      requesterName: "Sita Rai",
      location: "Kalanki",
      peopleAffected: 5,
      description: "Food / water assistance requested.",
    });
    expect(result.prompt.body).toContain("REQUEST SUMMARY");
  });

  it("asks only for the next missing field after partial deterministic input", () => {
    const result = transitionIntake("start", { requesterName: "Sita Rai" }, { text: "Need food" })!;
    expect(result.state).toBe("collect_location");
    expect(result.prompt.body).toContain("Where is help needed");
  });

  it("accepts a map pin without asking for location again", () => {
    const result = transitionIntake("collect_location", {
      category: "food_water", requesterName: "Sita Rai", peopleAffected: 3,
    }, {
      text: "Kathmandu Durbar Square", latitude: 27.7172, longitude: 85.324,
    })!;
    expect(result.state).toBe("confirm_request");
    expect(result.data).toMatchObject({ location: "Kathmandu Durbar Square", latitude: 27.7172, longitude: 85.324 });
  });

  it("edits only the selected field and returns to the summary", () => {
    const base = {
      category: "food_water" as const, requesterName: "Sita Rai", location: "Kalanki", peopleAffected: 5,
      description: "Food / water assistance requested.",
    };
    const menu = transitionIntake("confirm_request", base, { interactionId: "emergency:edit" })!;
    const edit = transitionIntake(menu.state, menu.data, { interactionId: "emergency:edit:location" })!;
    const updated = transitionIntake(edit.state, edit.data, { text: "Lalitpur" })!;
    expect(updated.state).toBe("confirm_request");
    expect(updated.data).toMatchObject({ ...base, location: "Lalitpur" });
  });

  it("keeps an invalid value on the current field instead of restarting", () => {
    const result = transitionIntake("collect_location", { category: "rescue", requesterName: "Sita Rai" }, { text: "hi" })!;
    expect(result.state).toBe("collect_location");
    expect(result.prompt.body).toContain("still need the location");
  });

  it("offers an explicit restart decision without creating a request", () => {
    const data = { category: "rescue" as const, requesterName: "Sita Rai", location: "Kalanki", peopleAffected: 1 };
    const restart = transitionIntake("collect_details", data, { text: "START" })!;
    expect(restart.state).toBe("restart_choice");
    const continued = transitionIntake(restart.state, restart.data, { interactionId: "emergency:continue" })!;
    expect(continued.state).toBe("collect_details");
    const reset = transitionIntake(restart.state, restart.data, { interactionId: "emergency:restart" })!;
    expect(reset).toMatchObject({ state: "start", data: {} });
  });
});
