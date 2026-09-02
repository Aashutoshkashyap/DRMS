import { describe, expect, it } from "vitest";
import { operationalLabel } from "./operational-language";

describe("operationalLabel", () => {
  it("uses reviewed Nepali for core shell labels", () => {
    expect(operationalLabel("ne", "pipelines", "Incidents")).toBe("घटनाहरू");
  });

  it("keeps untranslated labels in their source language", () => {
    expect(operationalLabel("ne", "menuProfile", "Profile")).toBe("Profile");
    expect(operationalLabel("en", "pipelines", "Incidents")).toBe("Incidents");
  });
});
