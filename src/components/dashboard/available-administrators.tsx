"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PRESENCE_DOT_CLASS, PresenceDot } from "@/components/presence/presence-dot";
import { usePresence } from "@/hooks/use-presence";
import type { AccountMember } from "@/types";

const ADMIN_ROLES = new Set(["owner", "admin"]);

/** Signed-in account members can see which administrators are reachable
 * without exposing the directory to citizens or unauthenticated visitors. */
export function AvailableAdministrators() {
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [loading, setLoading] = useState(true);
  const { getPresence } = usePresence();

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/account/members", { cache: "no-store" })
      .then(async (response) => response.ok ? (await response.json()) as { members?: AccountMember[] } : { members: [] })
      .then((data) => {
        if (!cancelled) setMembers((data.members ?? []).filter((member) => ADMIN_ROLES.has(member.role)));
      })
      .catch(() => { if (!cancelled) setMembers([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return <section className="rounded-xl border border-border bg-card">
    <header className="border-b border-border px-4 py-3">
      <h2 className="flex items-center gap-2 font-semibold text-foreground"><ShieldCheck className="h-4 w-4" />Available administrators</h2>
      <p className="mt-1 text-xs text-muted-foreground">Account-scoped directory and current availability for operational coordination.</p>
    </header>
    <ul className="divide-y divide-border">
      {loading && <li className="px-4 py-5 text-sm text-muted-foreground">Loading administrator directory…</li>}
      {!loading && members.map((member) => {
        const presence = getPresence(member.user_id);
        return <li key={member.user_id} className="flex items-center gap-3 px-4 py-3">
          <Avatar className="size-9 shrink-0">
            {member.avatar_url && <AvatarImage src={member.avatar_url} alt={member.full_name || "Administrator"} />}
            <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">{(member.full_name || member.email || "A").charAt(0).toUpperCase()}</AvatarFallback>
            <AvatarBadge className={PRESENCE_DOT_CLASS[presence]} />
          </Avatar>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{member.full_name || "Unnamed administrator"}</p><p className="truncate text-xs text-muted-foreground">{member.email || "No email on profile"}</p></div>
          <div className="flex shrink-0 flex-col items-end gap-1"><Badge variant="outline" className="text-[10px] uppercase">{member.role}</Badge><span className="flex items-center gap-1 text-xs text-muted-foreground"><PresenceDot status={presence} />{presence}</span></div>
        </li>;
      })}
      {!loading && members.length === 0 && <li className="px-4 py-5 text-sm text-muted-foreground">No owner or administrator is listed for this account.</li>}
    </ul>
  </section>;
}
