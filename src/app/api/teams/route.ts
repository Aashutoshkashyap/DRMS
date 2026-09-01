import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";

const MAX_TEAM_NAME_LENGTH = 120;

/** Workspace-scoped response teams and their member relationships. The
 * database RLS remains authoritative; this route provides a focused contract
 * for the shared operations UI rather than another identity system. */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const [teamsResult, membershipsResult, membersResult] = await Promise.all([
      ctx.supabase
        .from("response_teams")
        .select("id,name,availability,location_id,created_at")
        .eq("account_id", ctx.accountId)
        .order("name"),
      ctx.supabase
        .from("response_team_members")
        .select("team_id,user_id,is_primary,created_at")
        .eq("account_id", ctx.accountId)
        .order("created_at"),
      ctx.supabase
        .from("profiles")
        .select("user_id,full_name,email,account_role")
        .eq("account_id", ctx.accountId)
        .order("created_at"),
    ]);
    const error = teamsResult.error || membershipsResult.error || membersResult.error;
    if (error) {
      console.error("[GET /api/teams] fetch error:", error);
      return NextResponse.json({ error: "Failed to load response teams" }, { status: 500 });
    }
    return NextResponse.json({
      teams: teamsResult.data ?? [],
      memberships: membershipsResult.data ?? [],
      members: membersResult.data ?? [],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = await request.json().catch(() => null) as { name?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > MAX_TEAM_NAME_LENGTH) {
      return NextResponse.json({ error: `Team name must be 1–${MAX_TEAM_NAME_LENGTH} characters.` }, { status: 400 });
    }
    const { data, error } = await ctx.supabase
      .from("response_teams")
      .insert({ account_id: ctx.accountId, user_id: ctx.userId, name, availability: "available" })
      .select("id,name,availability,location_id,created_at")
      .single();
    if (error) {
      console.error("[POST /api/teams] insert error:", error);
      return NextResponse.json({ error: "Could not create response team" }, { status: 400 });
    }
    return NextResponse.json({ team: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
