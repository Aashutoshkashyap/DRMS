import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

export const dynamic = "force-dynamic";

/** Resolves a private evidence object only after the signed-in coordinator's
 * account-scoped message read. The object path is never accepted from the URL. */
export async function GET(_request: Request, context: { params: Promise<{ messageId: string }> }) {
  try {
    const { messageId } = await context.params;
    const { supabase } = await requireRole("viewer");
    const { data: message, error } = await supabase.from("messages")
      .select("media_storage_path")
      .eq("id", messageId).maybeSingle();
    if (error) throw error;
    if (!message?.media_storage_path) return NextResponse.json({ error: "Evidence is unavailable." }, { status: 404 });
    const { data, error: signError } = await supabase.storage.from("drms-evidence")
      .createSignedUrl(message.media_storage_path, 60);
    if (signError || !data?.signedUrl) return NextResponse.json({ error: "Evidence is temporarily unavailable." }, { status: 503 });
    return NextResponse.redirect(data.signedUrl);
  } catch (error) { return toErrorResponse(error); }
}
