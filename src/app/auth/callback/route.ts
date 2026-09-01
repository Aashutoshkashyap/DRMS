import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Completes Supabase's PKCE email flow on the same origin that issued the
 * signup/reset request. The origin itself is configured in Supabase Auth;
 * this route deliberately accepts only an internal next path so a forwarded
 * confirmation link cannot turn into an open redirect.
 */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  const loginUrl = new URL("/login", url.origin);
  loginUrl.searchParams.set("error", "confirmation_failed");
  return NextResponse.redirect(loginUrl);
}
