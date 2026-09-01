"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Filter, History, MessageSquare, UsersRound } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Activity = { id: string; deal_id: string; actor_user_id: string | null; actor_team_id: string | null; action: string; previous_value: string | null; next_value: string | null; metadata: Record<string, unknown>; created_at: string };
type Incident = { id: string; request_id: string | null; title: string; incident_status: string };
type Profile = { user_id: string; full_name: string | null; email: string | null; account_role: string | null };
type Team = { id: string; name: string };

const ACTION_LABEL: Record<string, string> = { incident_created: "Incident created", status_changed: "Status changed", assignment_confirmed: "Assignment confirmed", notification_queued: "Citizen notification queued", notification_sent: "Citizen notification sent", notification_failed: "Citizen notification failed", notification_retry_requested: "Citizen notification retry requested", case_note_added: "Internal note added", follow_up_created: "Follow-up created", follow_up_reviewed: "Follow-up reviewed", follow_up_cleared: "Follow-up cleared", coordinator_remark: "Coordinator remark", coordinator_assigned: "Coordinator assigned", incident_details_updated: "Incident details updated" };
const COMMUNICATION_ACTIONS = new Set(["notification_queued", "notification_sent", "notification_failed", "notification_retry_requested"]);

function label(value: string | null) { return value ? value.replaceAll("_", " ").toUpperCase() : null; }

export default function ActivityPage() {
  const db = createClient();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [person, setPerson] = useState("all");
  const [team, setTeam] = useState("all");
  const [action, setAction] = useState("all");
  const [incident, setIncident] = useState("all");
  const [status, setStatus] = useState("all");
  const [date, setDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [activityResult, incidentResult, profileResult, teamResult] = await Promise.all([
      db.from("incident_activity").select("id,deal_id,actor_user_id,actor_team_id,action,previous_value,next_value,metadata,created_at").order("created_at", { ascending: false }).limit(500),
      db.from("deals").select("id,request_id,title,incident_status").order("created_at", { ascending: false }).limit(500),
      db.from("profiles").select("user_id,full_name,email,account_role"),
      db.from("response_teams").select("id,name").order("name"),
    ]);
    setActivities((activityResult.data ?? []) as Activity[]);
    setIncidents((incidentResult.data ?? []) as Incident[]);
    setProfiles((profileResult.data ?? []) as Profile[]);
    setTeams((teamResult.data ?? []) as Team[]);
    setLoading(false);
  }, [db]);
  // The asynchronous loader updates state only after account-scoped reads settle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const incidentById = useMemo(() => new Map(incidents.map((item) => [item.id, item])), [incidents]);
  const profileById = useMemo(() => new Map(profiles.map((item) => [item.user_id, item])), [profiles]);
  const teamById = useMemo(() => new Map(teams.map((item) => [item.id, item])), [teams]);
  const filtered = useMemo(() => activities.filter((item) => {
    const itemIncident = incidentById.get(item.deal_id);
    const actionTeam = item.actor_team_id ?? (typeof item.metadata.team_id === "string" ? item.metadata.team_id : null);
    return (person === "all" || item.actor_user_id === person) && (team === "all" || actionTeam === team) && (action === "all" || item.action === action) && (incident === "all" || item.deal_id === incident) && (status === "all" || item.next_value === status || itemIncident?.incident_status === status) && (!date || item.created_at.slice(0, 10) === date);
  }), [action, activities, date, incident, incidentById, person, status, team]);

  return <div className="space-y-5"><header><h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><History className="size-6" />Activity & accountability</h1><p className="mt-1 text-sm text-muted-foreground">Append-only workspace activity. Every stored operational event remains linked to its incident, time, actor and, when known, that actor’s response team.</p></header><section className="grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 xl:grid-cols-3"><Filter className="mt-2 size-4 text-muted-foreground" /><Select value={person} onChange={setPerson}><option value="all">All people</option>{profiles.map((item) => <option key={item.user_id} value={item.user_id}>{item.full_name || item.email || "Unnamed member"}</option>)}</Select><Select value={team} onChange={setTeam}><option value="all">All teams</option>{teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Select value={action} onChange={setAction}><option value="all">All actions</option>{[...new Set(activities.map((item) => item.action))].map((item) => <option key={item} value={item}>{ACTION_LABEL[item] || item}</option>)}</Select><Select value={incident} onChange={setIncident}><option value="all">All incidents</option>{incidents.map((item) => <option key={item.id} value={item.id}>{item.request_id || item.title}</option>)}</Select><div className="grid grid-cols-2 gap-2"><Select value={status} onChange={setStatus}><option value="all">All statuses</option>{["received", "verified", "assigned", "dispatched", "in_progress", "resolved"].map((item) => <option key={item} value={item}>{label(item)}</option>)}</Select><input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Activity date" className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground" /></div></section><section className="overflow-hidden rounded-xl border border-border bg-card"><div className="border-b border-border px-4 py-3 text-sm text-muted-foreground">{loading ? "Loading activity…" : `${filtered.length} activity record${filtered.length === 1 ? "" : "s"} · newest first`}</div>{!loading && <ul className="divide-y divide-border">{filtered.map((item) => { const itemIncident = incidentById.get(item.deal_id); const actor = item.actor_user_id ? profileById.get(item.actor_user_id) : null; const actorTeamId = item.actor_team_id ?? (typeof item.metadata.team_id === "string" ? item.metadata.team_id : null); const actorTeam = actorTeamId ? teamById.get(actorTeamId) : null; const remark = typeof item.metadata.remark === "string" ? item.metadata.remark : null; const change = item.previous_value && item.next_value ? `${label(item.previous_value)} → ${label(item.next_value)}` : label(item.next_value); return <li key={item.id} className="space-y-2 px-4 py-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium text-foreground">{ACTION_LABEL[item.action] || item.action}</p><p className="mt-0.5 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</p></div><Link href={`/pipelines?incident=${item.deal_id}`} className="rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{itemIncident?.request_id || "Open incident"}</Link></div>{change && <p className="text-sm text-foreground">{change}</p>}{remark && <p className="rounded bg-muted/60 px-3 py-2 text-sm text-foreground">{remark}</p>}<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span><strong className="text-foreground">Actor:</strong> {actor ? `${actor.full_name || "Unnamed member"}${actor.email ? ` · ${actor.email}` : ""} · ${actor.account_role || "member"}` : "System"}</span><span className="inline-flex items-center gap-1"><UsersRound className="size-3" /><strong className="text-foreground">Team:</strong> {actorTeam?.name || (typeof item.metadata.team === "string" ? item.metadata.team : "Unassigned / individual coordinator")}</span>{COMMUNICATION_ACTIONS.has(item.action) && <span className="inline-flex items-center gap-1"><MessageSquare className="size-3" />Citizen communication event</span>}</div></li>; })}{filtered.length === 0 && <li className="px-4 py-8 text-sm text-muted-foreground">No recorded activity matches these filters.</li>}</ul>}</section></div>;
}

function Select({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: ReactNode }) { return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground">{children}</select>; }
