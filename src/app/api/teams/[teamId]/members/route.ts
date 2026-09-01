import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

/** Adds an existing workspace member to an existing workspace response team.
 * The 053 trigger verifies both sides are in the caller's account. */
export async function POST(request: Request, context: { params: Promise<{ teamId: string }> }) {
  try {
    const ctx = await requireRole("admin");
    const { teamId } = await context.params;
    const body = await request.json().catch(() => null) as { userId?: unknown } | null;
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    if (!teamId || !userId) return NextResponse.json({ error: "Select a workspace member." }, { status: 400 });

    const { error } = await ctx.supabase
      .from("response_team_members")
      .upsert({ team_id: teamId, account_id: ctx.accountId, user_id: userId }, { onConflict: "team_id,user_id", ignoreDuplicates: true });
    if (error) {
      console.error("[POST /api/teams/[teamId]/members] insert error:", error);
      return NextResponse.json({ error: "Could not add this workspace member to the team." }, { status: 400 });
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
