"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Radio } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";

type Session = { id: string; label: string | null; openwa_session_id: string | null; phone_number_id: string | null; status: string; is_primary: boolean };

/** Small operational registry, intentionally separate from the legacy primary
 * config editor so an administrator can add session B/C without overwriting A. */
export function OpenWaSessions() {
  const { canEditSettings } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [label, setLabel] = useState("");
  const [primary, setPrimary] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/whatsapp/sessions", { cache: "no-store" });
    if (!response.ok) return;
    setSessions((await response.json() as { sessions: Session[] }).sessions);
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function add() {
    if (!sessionId.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/whatsapp/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sessionId.trim(), label, primary }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not add OpenWA session.");
      setSessionId(""); setLabel(""); setPrimary(false); await load(); toast.success("OpenWA session added.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not add OpenWA session."); }
    finally { setSaving(false); }
  }
  return <Card className="mt-6"><CardHeader><CardTitle className="flex items-center gap-2"><Radio className="size-4" />Additional OpenWA sessions</CardTitle><CardDescription>Sessions share this DRMS account, but each inbound conversation retains its source session for replies.</CardDescription></CardHeader><CardContent className="space-y-4">
    <ul className="space-y-2">{sessions.filter((session) => session.openwa_session_id).map((session) => <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{session.label || session.openwa_session_id}</span><span className="text-muted-foreground">{session.phone_number_id || "Phone unavailable"} · {session.status}{session.is_primary ? " · primary fallback" : ""}</span></li>)}{sessions.length === 0 && <li className="text-sm text-muted-foreground">No OpenWA session is configured.</li>}</ul>
    {canEditSettings && <div className="grid gap-3 rounded-md border border-dashed p-3 sm:grid-cols-[1fr_1fr_auto]"><div><Label htmlFor="openwa-session-id">Session ID</Label><Input id="openwa-session-id" value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="session-b" /></div><div><Label htmlFor="openwa-session-label">Label</Label><Input id="openwa-session-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="District hotline B" /></div><div className="flex items-end gap-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={primary} onChange={(event) => setPrimary(event.target.checked)} />Primary</label><Button onClick={add} disabled={saving || !sessionId.trim()}><Plus className="mr-1 size-4" />Add</Button></div></div>}
  </CardContent></Card>;
}
