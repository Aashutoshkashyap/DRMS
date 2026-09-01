import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type HealthComponent = "webhook" | "storage" | "outbound";

function fingerprint(component: HealthComponent, message: string) {
  return crypto.createHash("sha256").update(`${component}:${message.slice(0, 180)}`).digest("hex").slice(0, 32);
}

/** Best-effort grouped health signal. It never changes an incident or blocks
 * citizen persistence; repeated identical failures increment one alert. */
export async function recordHealthFailure(db: SupabaseClient, accountId: string, component: HealthComponent, message: string) {
  try {
    const safeMessage = message.slice(0, 300) || "Unknown operational failure";
    const key = fingerprint(component, safeMessage);
    const { data: prior } = await db.from("operational_health_events")
      .select("id,event_count").eq("account_id", accountId).eq("component", component).eq("fingerprint", key).maybeSingle();
    const query = prior
      ? db.from("operational_health_events").update({ event_count: Number(prior.event_count) + 1, last_seen_at: new Date().toISOString(), recovered_at: null, severity: Number(prior.event_count) >= 2 ? "incident" : "degraded" }).eq("id", prior.id)
      : db.from("operational_health_events").insert({ account_id: accountId, component, fingerprint: key, message: safeMessage, severity: "degraded", event_count: 1 });
    const { error } = await query;
    if (error) console.warn("[operations-health] could not record failure:", error.message);
  } catch (error) { console.warn("[operations-health] failure recorder unavailable:", error); }
}

/** A later verified success closes grouped warnings for that component. */
export async function recordHealthRecovery(db: SupabaseClient, accountId: string, component: HealthComponent) {
  try {
    const { error } = await db.from("operational_health_events")
      .update({ recovered_at: new Date().toISOString() })
      .eq("account_id", accountId).eq("component", component).is("recovered_at", null);
    if (error) console.warn("[operations-health] could not record recovery:", error.message);
  } catch (error) { console.warn("[operations-health] recovery recorder unavailable:", error); }
}
