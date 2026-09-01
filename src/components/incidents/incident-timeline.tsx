"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { IncidentActivity } from "@/types";

const ACTION_LABEL: Record<IncidentActivity["action"], string> = {
  incident_created: "Incident created",
  status_changed: "Response status changed",
  assignment_confirmed: "Assignment confirmed",
  notification_queued: "Citizen notification queued",
  notification_sent: "Citizen notification sent",
  notification_failed: "Citizen notification failed",
  notification_retry_requested: "Citizen notification retry requested",
  case_note_added: "Case note added",
  follow_up_created: "Follow-up required",
  follow_up_reviewed: "Follow-up reviewed",
  follow_up_cleared: "Follow-up cleared",
};

function actorName(activity: IncidentActivity, names: Map<string, string>) {
  if (!activity.actor_user_id) return "System";
  return names.get(activity.actor_user_id) || "Coordinator";
}

function changeSummary(activity: IncidentActivity) {
  if (activity.previous_value && activity.next_value) return `${activity.previous_value.replaceAll("_", " ").toUpperCase()} → ${activity.next_value.replaceAll("_", " ").toUpperCase()}`;
  if (activity.next_value) return activity.next_value.replaceAll("_", " ").toUpperCase();
  const reasons = activity.metadata.reason_codes;
  if (Array.isArray(reasons) && reasons.every((reason): reason is string => typeof reason === "string")) return reasons.map((reason) => reason.replaceAll("_", " ")).join(" · ");
  const fields = ["team", "vehicle", "location", "inventory"]
    .map((field) => activity.metadata[field])
    .filter((value): value is string => typeof value === "string");
  return fields.length ? fields.join(" · ") : null;
}

export function IncidentTimeline({ dealId }: { dealId: string }) {
  const db = createClient();
  const [activity, setActivity] = useState<IncidentActivity[]>([]);
  const [names, setNames] = useState(new Map<string, string>());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db
      .from("incident_activity")
      .select("id,account_id,deal_id,actor_user_id,action,previous_value,next_value,metadata,created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });
    if (error) { setLoading(false); return; }
    const records = (data ?? []) as IncidentActivity[];
    const actorIds = [...new Set(records.map((item) => item.actor_user_id).filter((id): id is string => Boolean(id)))];
    const profiles = actorIds.length ? await db.from("profiles").select("user_id,full_name").in("user_id", actorIds) : { data: [] };
    setActivity(records);
    setNames(new Map((profiles.data ?? []).map((profile) => [profile.user_id, profile.full_name || "Coordinator"])));
    setLoading(false);
  }, [db, dealId]);

  // The asynchronous query writes state only after both reads settle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return <section className="space-y-3 rounded-xl border border-border bg-card p-3">
    <div><h3 className="text-sm font-semibold text-foreground">Activity</h3><p className="text-xs text-muted-foreground">Append-only coordinator and system history.</p></div>
    {loading ? <p className="text-xs text-muted-foreground">Loading activity…</p> : activity.length === 0 ? <p className="text-xs text-muted-foreground">No Phase 8 activity is recorded yet. New status, assignment, note, and notification actions will appear here.</p> : <ol className="space-y-3 border-l border-border pl-3">{activity.map((item) => <li key={item.id} className="relative"><span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-primary" /><p className="text-sm font-medium text-foreground">{ACTION_LABEL[item.action]}</p>{changeSummary(item) && <p className="text-xs text-muted-foreground">{changeSummary(item)}</p>}<p className="mt-1 text-xs text-muted-foreground">{actorName(item, names)} · {new Date(item.created_at).toLocaleString()}</p></li>)}</ol>}
  </section>;
}
