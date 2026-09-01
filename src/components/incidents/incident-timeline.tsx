"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { IncidentActivity } from "@/types";

const ACTION_LABEL: Record<IncidentActivity["action"], string> = {
  incident_created: "Incident created",
  status_changed: "Response status changed",
  assignment_confirmed: "Assignment confirmed",
  notification_queued: "Citizen notification queued",
  notification_sent: "Citizen notification accepted by WhatsApp transport",
  notification_failed: "Citizen notification failed",
  notification_retry_requested: "Citizen notification retry requested",
  case_note_added: "Case note added",
  follow_up_created: "Follow-up required",
  follow_up_reviewed: "Follow-up reviewed",
  follow_up_cleared: "Follow-up cleared",
  coordinator_remark: "Coordinator remark",
  coordinator_assigned: "Coordinator ownership changed",
  incident_details_updated: "Incident details updated",
};

type Actor = { name: string; email: string | null; role: string | null };

function actorName(activity: IncidentActivity, actors: Map<string, Actor>) {
  if (!activity.actor_user_id) return "System";
  const actor = actors.get(activity.actor_user_id);
  if (!actor) return "Coordinator";
  const identity = actor.email ? `${actor.name} · ${actor.email}` : actor.name;
  return actor.role ? `${identity} · ${actor.role}` : identity;
}

function category(activity: IncidentActivity) {
  if (["notification_queued", "notification_sent", "notification_failed", "notification_retry_requested"].includes(activity.action)) return "Communication";
  if (activity.actor_user_id) return "Coordinator";
  return "System";
}

function changeSummary(activity: IncidentActivity) {
  if (activity.previous_value && activity.next_value) return `${activity.previous_value.replaceAll("_", " ").toUpperCase()} → ${activity.next_value.replaceAll("_", " ").toUpperCase()}`;
  if (activity.next_value) return activity.next_value.replaceAll("_", " ").toUpperCase();
  const reasons = activity.metadata.reason_codes;
  if (Array.isArray(reasons) && reasons.every((reason): reason is string => typeof reason === "string")) return reasons.map((reason) => reason.replaceAll("_", " ")).join(" · ");
  const fields = ["team", "vehicle", "location", "inventory"]
    .map((field) => activity.metadata[field])
    .filter((value): value is string => typeof value === "string");
  if (fields.length) return fields.join(" · ");
  const changedFields = activity.metadata.changed_fields;
  if (Array.isArray(changedFields) && changedFields.every((field): field is string => typeof field === "string")) return `Updated: ${changedFields.join(", ").replaceAll("_", " ")}`;
  return null;
}

export function IncidentTimeline({ dealId }: { dealId: string }) {
  const db = createClient();
  const [activity, setActivity] = useState<IncidentActivity[]>([]);
  const [actors, setActors] = useState(new Map<string, Actor>());
  const [teams, setTeams] = useState(new Map<string, string>());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db
      .from("incident_activity")
      .select("id,account_id,deal_id,actor_user_id,actor_team_id,action,previous_value,next_value,metadata,created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });
    if (error) { setLoading(false); return; }
    const records = (data ?? []) as IncidentActivity[];
    const actorIds = [...new Set(records.map((item) => item.actor_user_id).filter((id): id is string => Boolean(id)))];
    const teamIds = [...new Set(records.map((item) => item.actor_team_id).filter((id): id is string => Boolean(id)))];
    const [profiles, teamRows] = await Promise.all([
      actorIds.length ? db.from("profiles").select("user_id,full_name,email,account_role").in("user_id", actorIds) : Promise.resolve({ data: [] }),
      teamIds.length ? db.from("response_teams").select("id,name").in("id", teamIds) : Promise.resolve({ data: [] }),
    ]);
    setActivity(records);
    setActors(new Map((profiles.data ?? []).map((profile) => [profile.user_id, { name: profile.full_name || "Coordinator", email: profile.email || null, role: profile.account_role || null }])));
    setTeams(new Map((teamRows.data ?? []).map((team) => [team.id, team.name])));
    setLoading(false);
  }, [db, dealId]);

  // The asynchronous query writes state only after both reads settle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return <section className="space-y-3 rounded-xl border border-border bg-card p-3">
    <div><h3 className="text-sm font-semibold text-foreground">Activity & accountability</h3><p className="text-xs text-muted-foreground">Append-only coordinator and system history. The workspace Activity Log provides cross-incident filtering.</p></div>
    {loading ? <p className="text-xs text-muted-foreground">Loading activity…</p> : activity.length === 0 ? <p className="text-xs text-muted-foreground">No incident activity is recorded yet. New status, assignment, note, and communication actions will appear here.</p> : <ol className="space-y-3 border-l border-border pl-3">{activity.map((item) => <li key={item.id} className="relative"><span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-primary" /><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-foreground">{ACTION_LABEL[item.action]}</p><span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{category(item)}</span></div>{changeSummary(item) && <p className="text-xs text-muted-foreground">{changeSummary(item)}</p>}{typeof item.metadata.remark === "string" && <p className="mt-1 rounded bg-muted/70 px-2 py-1 text-xs text-foreground">Remark: {item.metadata.remark}</p>}<p className="mt-1 text-xs text-muted-foreground">{actorName(item, actors)} · {teams.get(item.actor_team_id ?? "") || (typeof item.metadata.team === "string" ? item.metadata.team : "Unassigned / individual coordinator")} · {new Date(item.created_at).toLocaleString()}</p></li>)}</ol>}
  </section>;
}
