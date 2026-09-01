import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function DELETE(_request: Request, context: { params: Promise<{ teamId: string; userId: string }> }) {
  try {
    const ctx = await requireRole("admin");
    const { teamId, userId } = await context.params;
    const { error } = await ctx.supabase
      .from("response_team_members")
      .delete()
      .eq("account_id", ctx.accountId)
      .eq("team_id", teamId)
      .eq("user_id", userId);
    if (error) {
      console.error("[DELETE /api/teams/[teamId]/members/[userId]] delete error:", error);
      return NextResponse.json({ error: "Could not remove this team membership." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
