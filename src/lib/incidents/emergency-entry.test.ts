import { describe, expect, it } from "vitest";
import { classifyCitizenLanguage, isExplicitEmergencyTrigger } from "./emergency-entry";

describe("explicit emergency entry triggers", () => {
  it.each(["START", " start! ", "HELP", "SOS!", "EMERGENCY", "RESCUE", "सहयोग", "मद्दत", "उद्धार", "आपतकाल", "आपतकालीन", "sahayog", "maddat", "uddhar", "apatkal", "apatkaal"])("accepts %s", (value) => {
    expect(isExplicitEmergencyTrigger(value)).toBe(true);
  });

  it.each(["help me", "flood", "water", "fire", "ambulance", "we need rescue now"])("does not treat ordinary content %s as an entry trigger", (value) => {
    expect(isExplicitEmergencyTrigger(value)).toBe(false);
  });

  it("records only deterministic script characteristics", () => {
    expect(classifyCitizenLanguage("मेरो घरमा पानी पस्यो")).toBe("ne");
    expect(classifyCitizenLanguage("Need rescue")).toBe("en");
    expect(classifyCitizenLanguage("Ward 5 मा rescue चाहियो")).toBe("mixed");
    expect(classifyCitizenLanguage("mero ghar ma pani pasyo")).toBe("en");
  });
});
