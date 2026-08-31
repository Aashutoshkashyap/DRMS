import { describe, expect, it } from "vitest";
import { assertDemoAccount, assertDemoCommandInput, DEMO_CONFIRMATION } from "./guard";

describe("guarded demo-data commands", () => {
  it("requires an explicit target, actor, and confirmation phrase", () => {
    expect(() => assertDemoCommandInput({})).toThrow("DEMO_ACCOUNT_ID");
    expect(() => assertDemoCommandInput({ accountId: "account", actorUserId: "user" })).toThrow("DEMO_CONFIRM");
    expect(() => assertDemoCommandInput({
      accountId: "account",
      actorUserId: "user",
      confirmation: DEMO_CONFIRMATION,
    })).not.toThrow();
  });

  it("refuses every account that is not explicitly marked as a demo account", () => {
    expect(() => assertDemoAccount(null)).toThrow("is_demo=true");
    expect(() => assertDemoAccount({ id: "production", is_demo: false })).toThrow("is_demo=true");
    expect(() => assertDemoAccount({ id: "demo", is_demo: true })).not.toThrow();
  });
});
