export const DEMO_CONFIRMATION = "DEMO DATA";

export type DemoAccount = {
  id: string;
  is_demo: boolean;
};

export function assertDemoCommandInput(input: {
  accountId?: string;
  actorUserId?: string;
  confirmation?: string;
}) {
  if (!input.accountId) throw new Error("DEMO_ACCOUNT_ID is required.");
  if (!input.actorUserId) throw new Error("DEMO_ACTOR_USER_ID is required.");
  if (input.confirmation !== DEMO_CONFIRMATION) {
    throw new Error(`Refusing to operate. Set DEMO_CONFIRM=${DEMO_CONFIRMATION}.`);
  }
}

export function assertDemoAccount(account: DemoAccount | null) {
  if (!account?.is_demo) {
    throw new Error("Refusing to operate: the selected account is not explicitly marked is_demo=true.");
  }
}
