"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Settings2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { loadOperationsOverview, type OperationsIncident } from "@/lib/operations/overview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Overview = Awaited<ReturnType<typeof loadOperationsOverview>>;
type Settings = { received_after_hours: string; assigned_after_hours: string; dispatched_after_hours: string };

export default function FollowUpPage() {
  const db = createClient();
  const { accountId, user } = useAuth();
  const canEditSettings = useCan("edit-settings");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [settings, setSettings] = useState<Settings>({ received_after_hours: "", assigned_after_hours: "", dispatched_after_hours: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await loadOperationsOverview(db);
      setOverview(result);
      const { data } = await db.from("incident_follow_up_settings").select("received_after_hours,assigned_after_hours,dispatched_after_hours").maybeSingle();
      setSettings({ received_after_hours: data?.received_after_hours?.toString() ?? "", assigned_after_hours: data?.assigned_after_hours?.toString() ?? "", dispatched_after_hours: data?.dispatched_after_hours?.toString() ?? "" });
    } catch (error) { console.error("[follow-up]", error); }
  }, [db]);
  // The asynchronous loader updates local state only after its Supabase reads settle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function saveSettings() {
    if (!accountId || !user) return;
    const toNumber = (value: string) => value.trim() ? Number(value) : null;
    const values = Object.values(settings).map(toNumber);
    if (values.some((value) => value !== null && (!Number.isInteger(value) || value <= 0))) {
      toast.error("Use a positive whole number of hours, or leave a rule blank.");
      return;
    }
    setSaving(true);
    const { error } = await db.from("incident_follow_up_settings").upsert({
      account_id: accountId,
      received_after_hours: toNumber(settings.received_after_hours),
      assigned_after_hours: toNumber(settings.assigned_after_hours),
      dispatched_after_hours: toNumber(settings.dispatched_after_hours),
      updated_by_user_id: user.id,
    });
    setSaving(false);
    if (error) { toast.error("Could not save follow-up rules."); return; }
    toast.success("Follow-up rules saved. They only flag cases for human review.");
    await load();
  }

  const unassigned = overview?.active.filter((incident) => !incident.assigned_to && !incident.assigned_team && !incident.assigned_resource) ?? [];
  return <div className="space-y-6"><div><h1 className="text-2xl font-semibold text-foreground">Follow-up Required</h1><p className="mt-1 text-sm text-muted-foreground">Unassigned incidents, failed status deliveries, and only explicitly configured age-based rules. Nothing is sent or dispatched automatically.</p></div><section className="rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" /><h2 className="font-semibold">Age-based follow-up rules</h2></div><p className="mt-1 text-xs text-muted-foreground">Leave a rule blank to disable it. No default time threshold exists.</p><div className="mt-4 grid gap-3 md:grid-cols-3"><RuleInput label="RECEIVED older than (hours)" value={settings.received_after_hours} onChange={(value) => setSettings((current) => ({ ...current, received_after_hours: value }))} /><RuleInput label="ASSIGNED older than (hours)" value={settings.assigned_after_hours} onChange={(value) => setSettings((current) => ({ ...current, assigned_after_hours: value }))} /><RuleInput label="DISPATCHED older than (hours)" value={settings.dispatched_after_hours} onChange={(value) => setSettings((current) => ({ ...current, dispatched_after_hours: value }))} /></div>{canEditSettings && <Button className="mt-4" onClick={saveSettings} disabled={saving}>{saving ? "Saving…" : "Save follow-up rules"}</Button>}</section><div className="grid gap-5 xl:grid-cols-3"><FollowUpList title="Unassigned incidents" items={unassigned} empty="No active incident is completely unassigned." /><FollowUpList title="Configured age-based follow-up" items={overview?.ageFollowUps ?? []} empty="No incident meets an explicitly configured follow-up rule." /><section className="rounded-xl border border-border bg-card"><header className="border-b border-border px-4 py-3"><h2 className="font-semibold">Failed citizen status deliveries</h2></header><ul className="divide-y divide-border">{(overview?.failedDeliveries ?? []).map((delivery) => <li key={delivery.id} className="px-4 py-3 text-sm"><p className="font-medium">Status {String(delivery.incident_status).replaceAll("_", " ").toUpperCase()}</p><p className="mt-1 text-xs text-muted-foreground">{delivery.error_message || "Provider delivery failed"}</p></li>)}{overview && overview.failedDeliveries.length === 0 && <li className="px-4 py-6 text-sm text-muted-foreground">No failed status delivery is recorded.</li>}</ul></section></div></div>;
}

function RuleInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="grid gap-2 text-sm font-medium text-foreground">{label}<Input type="number" min="1" step="1" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Disabled" /></label>; }
function FollowUpList({ title, items, empty }: { title: string; items: OperationsIncident[]; empty: string }) { return <section className="rounded-xl border border-border bg-card"><header className="border-b border-border px-4 py-3"><h2 className="font-semibold">{title}</h2></header><ul className="divide-y divide-border">{items.map((incident) => <li key={incident.id}><Link href="/pipelines" className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-muted/60"><AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" /><span><span className="font-medium text-foreground">{incident.request_id}</span><span className="block text-xs text-muted-foreground">{incident.location || "Location not recorded"}</span></span></Link></li>)}{items.length === 0 && <li className="px-4 py-6 text-sm text-muted-foreground">{empty}</li>}</ul></section>; }
