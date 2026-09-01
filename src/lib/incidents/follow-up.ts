import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncidentAttentionItem, IncidentFollowUp } from "@/lib/operations/overview";

/** Persist only lifecycle metadata for the attention items derived from the
 * current incident state. The conditions themselves remain computed from the
 * source incident/delivery records, so a review cannot hide an unresolved case. */
export async function reconcileIncidentFollowUps(
  db: SupabaseClient,
  accountId: string,
  items: IncidentAttentionItem[],
  existing: IncidentFollowUp[],
): Promise<void> {
  const activeByDeal = new Map(items.map((item) => [item.incident.id, item]));

  for (const item of items) {
    const previous = existing.find((followUp) => followUp.deal_id === item.incident.id);
    const payload = {
      account_id: accountId,
      deal_id: item.incident.id,
      reason_codes: item.reasons,
      status: "active" as const,
      reviewed_at: null,
      reviewed_by_user_id: null,
      cleared_at: null,
    };
    if (!previous) {
      const { error } = await db.from("incident_follow_ups").upsert(payload, {
        onConflict: "account_id,deal_id",
        ignoreDuplicates: true,
      });
      if (error) throw error;
      continue;
    }
    const changedReasons = previous.reason_codes.join(",") !== item.reasons.join(",");
    if (previous.status === "cleared") {
      const { error } = await db.from("incident_follow_ups").update(payload).eq("id", previous.id);
      if (error) throw error;
    } else if (changedReasons) {
      const { error } = await db.from("incident_follow_ups").update({ reason_codes: item.reasons }).eq("id", previous.id);
      if (error) throw error;
    }
  }

  for (const followUp of existing) {
    if (activeByDeal.has(followUp.deal_id) || followUp.status === "cleared") continue;
    const { error } = await db.from("incident_follow_ups").update({ status: "cleared", cleared_at: new Date().toISOString() }).eq("id", followUp.id);
    if (error) throw error;
  }
}
