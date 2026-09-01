import { describe, expect, it } from "vitest";
import { findCitizenIncident } from "./request-service";

describe("findCitizenIncident", () => {
  it("always scopes a status lookup to the requesting contact before request ID", async () => {
    const conditions: Array<[string, string, unknown]> = [];
    const builder = {
      select: () => builder,
      eq: (field: string, value: unknown) => { conditions.push(["eq", field, value]); return builder; },
      neq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const db = { from: () => builder } as never;

    await findCitizenIncident(db, "account-1", "citizen-contact-1", "drms-other-person");

    expect(conditions).toEqual([
      ["eq", "account_id", "account-1"],
      ["eq", "contact_id", "citizen-contact-1"],
      ["eq", "request_id", "DRMS-OTHER-PERSON"],
    ]);
  });
});
