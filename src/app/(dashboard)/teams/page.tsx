"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, ShieldCheck, UserPlus, UsersRound, X } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type WorkspaceMember = { user_id: string; full_name: string | null; email: string | null; account_role: string | null };
type Team = { id: string; name: string; availability: string; location_id: string | null; created_at: string };
type Membership = { team_id: string; user_id: string; is_primary: boolean; created_at: string };

/** Shared workspace team directory. It manages only the relationship between
 * existing account members and existing response teams—identity, invitations,
 * resource records and RLS remain in their established modules. */
export default function TeamsPage() {
  const { canManageMembers } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/teams", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { teams?: Team[]; members?: WorkspaceMember[]; memberships?: Membership[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Could not load teams");
      setTeams(data?.teams ?? []);
      setMembers(data?.members ?? []);
      setMemberships(data?.memberships ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load response teams");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const membershipsByTeam = useMemo(() => {
    const map = new Map<string, Membership[]>();
    for (const membership of memberships) map.set(membership.team_id, [...(map.get(membership.team_id) ?? []), membership]);
    return map;
  }, [memberships]);
  const memberById = useMemo(() => new Map(members.map((member) => [member.user_id, member])), [members]);

  async function createTeam() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy("create");
    try {
      const response = await fetch("/api/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed }) });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Could not create response team");
      setName("");
      toast.success("Response team created");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create response team");
    } finally {
      setBusy(null);
    }
  }

  async function addMember(teamId: string, userId: string) {
    if (!userId) return;
    setBusy(`add-${teamId}`);
    try {
      const response = await fetch(`/api/teams/${teamId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Could not add workspace member");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add workspace member");
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(teamId: string, userId: string) {
    setBusy(`remove-${teamId}-${userId}`);
    try {
      const response = await fetch(`/api/teams/${teamId}/members/${userId}`, { method: "DELETE" });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Could not remove workspace member");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove workspace member");
    } finally {
      setBusy(null);
    }
  }

  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold text-foreground">Response teams</h1><p className="mt-1 text-sm text-muted-foreground">Authorized workspace members collaborate on the same incident board. Team membership adds operational context to future actions; it never grants access outside this workspace.</p></div><Link href="/settings?tab=members" className="text-sm font-medium text-primary underline">Invite or manage workspace members</Link></header>
    {canManageMembers && <section className="rounded-xl border border-border bg-card p-4"><h2 className="font-semibold text-foreground">Create response team</h2><div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="e.g. Kathmandu Response Team" /><Button type="button" onClick={() => void createTeam()} disabled={!name.trim() || busy === "create"}><Plus className="size-4" />{busy === "create" ? "Creating…" : "Create team"}</Button></div></section>}
    {!canManageMembers && <p className="rounded-xl border border-border bg-muted/50 p-3 text-sm text-muted-foreground">You can view the shared team directory. An administrator manages team membership.</p>}
    {loading ? <p className="text-sm text-muted-foreground">Loading response teams…</p> : teams.length === 0 ? <section className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">No response teams have been recorded. An administrator can create the first team above.</section> : <div className="grid gap-4 lg:grid-cols-2">{teams.map((team) => {
      const teamMemberships = membershipsByTeam.get(team.id) ?? [];
      const available = members.filter((member) => !teamMemberships.some((membership) => membership.user_id === member.user_id));
      return <section key={team.id} className="rounded-xl border border-border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold text-foreground"><UsersRound className="size-4" />{team.name}</h2><p className="mt-1 text-xs text-muted-foreground">Availability: {team.availability.replaceAll("_", " ")}</p></div><span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{teamMemberships.length} member{teamMemberships.length === 1 ? "" : "s"}</span></div><ul className="mt-4 space-y-2">{teamMemberships.map((membership) => { const member = memberById.get(membership.user_id); return <li key={membership.user_id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2"><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{member?.full_name || member?.email || "Workspace member"}{membership.is_primary && <span className="ml-2 text-xs text-primary">Primary team</span>}</p><p className="truncate text-xs text-muted-foreground">{member?.email || "No email on profile"} · {member?.account_role || "member"}</p></div>{canManageMembers && <button type="button" onClick={() => void removeMember(team.id, membership.user_id)} disabled={busy === `remove-${team.id}-${membership.user_id}`} className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-red-600" aria-label="Remove from team"><X className="size-4" /></button>}</li>; })}{teamMemberships.length === 0 && <li className="rounded-lg bg-muted/50 px-3 py-3 text-sm text-muted-foreground">No workspace members assigned yet.</li>}</ul>{canManageMembers && <label className="mt-4 grid gap-1 text-xs font-medium text-muted-foreground"><span className="flex items-center gap-1"><UserPlus className="size-3.5" />Add existing workspace member</span><select defaultValue="" disabled={busy === `add-${team.id}` || available.length === 0} onChange={(event) => { const selected = event.target.value; event.currentTarget.value = ""; if (selected) void addMember(team.id, selected); }} className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"><option value="">{available.length ? "Select a member" : "All workspace members are assigned"}</option>{available.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email} · {member.account_role || "member"}</option>)}</select></label>}</section>;
    })}</div>}
    <p className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />All listed users remain authenticated independently. Being added to a team records coordination context only; account membership and RLS continue to control access to shared incidents and citizen communications.</p>
  </div>;
}
