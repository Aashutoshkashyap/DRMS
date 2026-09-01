import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { ensureOpenWaInboundWebhook, getOpenWaSession } from "@/lib/whatsapp/openwa";

/** Account-scoped OpenWA session registry. Gateway credentials stay only in
 * deployment environment variables; this route stores a non-secret routing
 * record so the shared inbox can select the originating session on replies. */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole("admin");
    const { data, error } = await supabase.from("whatsapp_config")
      .select("id,label,transport,openwa_session_id,phone_number_id,status,connected_at,is_primary,created_at")
      .eq("account_id", accountId).order("is_primary", { ascending: false }).order("created_at");
    if (error) throw error;
    return NextResponse.json({ sessions: data ?? [] });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole("admin");
    const body = await request.json().catch(() => null) as { sessionId?: unknown; label?: unknown; primary?: unknown } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    const label = typeof body?.label === "string" ? body.label.trim().slice(0, 80) : null;
    if (!sessionId) return NextResponse.json({ error: "OpenWA session ID is required." }, { status: 400 });
    const gatewaySession = await getOpenWaSession(sessionId);
    if (gatewaySession.status !== "ready") return NextResponse.json({ error: `OpenWA session is ${gatewaySession.status}; connect it before adding it.` }, { status: 400 });
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (!siteUrl) return NextResponse.json({ error: "NEXT_PUBLIC_SITE_URL is not configured." }, { status: 500 });
    await ensureOpenWaInboundWebhook({ sessionId, webhookUrl: new URL("/api/whatsapp/openwa/webhook", siteUrl).toString() });
    const { data: claimed } = await supabase.from("whatsapp_config").select("account_id").eq("transport", "openwa").eq("openwa_session_id", sessionId).maybeSingle();
    if (claimed && claimed.account_id !== accountId) return NextResponse.json({ error: "This OpenWA session is linked to another DRMS account." }, { status: 409 });
    const primary = body?.primary === true;
    if (primary) {
      const { error } = await supabase.from("whatsapp_config").update({ is_primary: false }).eq("account_id", accountId).eq("is_primary", true);
      if (error) throw error;
    }
    const row = {
      account_id: accountId, user_id: userId, transport: "openwa", openwa_session_id: sessionId,
      phone_number_id: gatewaySession.phone, access_token: null, waba_id: null, verify_token: null,
      label, is_primary: primary, status: "connected", connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const result = claimed
      ? await supabase.from("whatsapp_config").update(row).eq("transport", "openwa").eq("openwa_session_id", sessionId)
      : await supabase.from("whatsapp_config").insert(row);
    if (result.error) throw result.error;
    const { data, error } = await supabase.from("whatsapp_config").select("id,label,transport,openwa_session_id,phone_number_id,status,connected_at,is_primary").eq("transport", "openwa").eq("openwa_session_id", sessionId).single();
    if (error) throw error;
    return NextResponse.json({ session: data }, { status: 201 });
  } catch (error) { return toErrorResponse(error); }
}
