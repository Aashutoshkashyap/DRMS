import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

/** Distinguishes a real empty shared workspace from a just-created personal
 * workspace that has not joined an organization. It never grants access and
 * is intentionally derived server-side from the caller's current account. */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const [accountResult, dealsResult, contactsResult, conversationsResult, configResult] = await Promise.all([
      ctx.supabase.from("accounts").select("owner_user_id").eq("id", ctx.accountId).maybeSingle(),
      ctx.supabase.from("deals").select("id", { count: "exact", head: true }),
      ctx.supabase.from("contacts").select("id", { count: "exact", head: true }),
      ctx.supabase.from("conversations").select("id", { count: "exact", head: true }),
      ctx.supabase.from("whatsapp_config").select("id", { count: "exact", head: true }),
    ]);
    const error = accountResult.error || dealsResult.error || contactsResult.error || conversationsResult.error || configResult.error;
    if (error) return NextResponse.json({ error: "Could not determine workspace access" }, { status: 500 });
    const personalEmpty = accountResult.data?.owner_user_id === ctx.userId
      && !dealsResult.count && !contactsResult.count && !conversationsResult.count && !configResult.count;
    return NextResponse.json({ kind: personalEmpty ? "no_shared_workspace" : "operational_workspace", accountName: ctx.account.name });
  } catch (error) {
    return toErrorResponse(error);
  }
}
