"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, RotateCw, Settings2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { FOLLOW_UP_REASON_LABEL, type IncidentAttentionItem, type OperationsIncident, type loadOperationsOverview } from "@/lib/operations/overview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Overview = Awaited<ReturnType<typeof loadOperationsOverview>>;
type Settings = { received_after_hours: string; assigned_after_hours: string; dispatched_after_hours: string };
type Filter = "all" | "critical" | "high" | "unassigned" | "communication_failed" | "overdue" | "reviewed";

function locationLabel(incident: OperationsIncident) {
  return [incident.location, incident.municipality, incident.district].filter(Boolean).join(" · ") || "Location not recorded";
}

function filterLabel(filter: Filter) {
  return filter === "all" ? "All" : filter === "communication_failed" ? "Communication" : filter.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function FollowUpPage() {
  const db = createClient();
  const searchParams = useSearchParams();
  const { accountId, user } = useAuth();
  const canEditSettings = useCan("edit-settings");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [settings, setSettings] = useState<Settings>({ received_after_hours: "", assigned_after_hours: "", dispatched_after_hours: "" });
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(() => {
    const value = searchParams.get("filter");
    return value === "critical" || value === "high" || value === "unassigned" || value === "communication_failed" || value === "overdue" || value === "reviewed" ? value : "all";
  });
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [location, setLocation] = useState("");

  const load = useCallback(async () => {
    try {
      const [response, settingsResult] = await Promise.all([
        fetch("/api/follow-up/overview", { method: "POST" }),
        db.from("incident_follow_up_settings").select("received_after_hours,assigned_after_hours,dispatched_after_hours").maybeSingle(),
      ]);
      if (!response.ok) throw new Error("Could not load the operational attention queue.");
      setOverview(await response.json() as Overview);
      const data = settingsResult.data;
      setSettings({ received_after_hours: data?.received_after_hours?.toString() ?? "", assigned_after_hours: data?.assigned_after_hours?.toString() ?? "", dispatched_after_hours: data?.dispatched_after_hours?.toString() ?? "" });
    } catch (error) {
      console.error("[follow-up]", error);
      toast.error("Could not load the operational attention queue.");
    }
  }, [db]);

  // The queue updates after the authenticated API response is available.
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

  async function review(item: IncidentAttentionItem) {
    setActionId(item.incident.id);
    try {
      const response = await fetch(`/api/incidents/${item.incident.id}/follow-up/review`, { method: "POST" });
      if (!response.ok) throw new Error("Could not mark this follow-up reviewed.");
      toast.success("Follow-up reviewed. It remains active until the underlying condition is cleared.");
      await load();
    } catch {
      toast.error("Could not mark this follow-up reviewed.");
    } finally { setActionId(null); }
  }

  async function retry(item: IncidentAttentionItem) {
    setActionId(item.incident.id);
    try {
      const response = await fetch(`/api/incidents/${item.incident.id}/status-notification/retry`, { method: "POST" });
      if (!response.ok) throw new Error("Could not retry the citizen notification.");
      const result = await response.json() as { delivered: boolean };
      toast.success(result.delivered ? "Citizen notification accepted by WhatsApp transport; delivery is not yet confirmed." : "Notification retry was requested.");
      await load();
    } catch {
      toast.error("Could not retry the citizen notification. Use the communication history if the problem persists.");
    } finally { setActionId(null); }
  }

  const filterCounts = useMemo(() => {
    const items = overview?.attentionItems ?? [];
    return {
      all: items.length,
      critical: items.filter((item) => item.incident.priority === "critical").length,
      high: items.filter((item) => item.incident.priority === "high").length,
      unassigned: items.filter((item) => item.reasons.includes("unassigned")).length,
      communication_failed: items.filter((item) => item.reasons.includes("communication_failed")).length,
      overdue: items.filter((item) => item.reasons.includes("overdue")).length,
      reviewed: items.filter((item) => item.followUp?.status === "reviewed").length,
    } satisfies Record<Filter, number>;
  }, [overview]);

  const items = useMemo(() => (overview?.attentionItems ?? []).filter((item) => {
    if (filter === "critical" || filter === "high") { if (item.incident.priority !== filter) return false; }
    else if (filter === "reviewed") { if (item.followUp?.status !== "reviewed") return false; }
    else if (filter !== "all" && !item.reasons.includes(filter)) return false;
    if (category !== "all" && item.incident.category !== category) return false;
    if (status !== "all" && item.incident.incident_status !== status) return false;
    return !location.trim() || locationLabel(item.incident).toLowerCase().includes(location.trim().toLowerCase());
  }), [overview, filter, category, status, location]);

  const categories = [...new Set((overview?.attentionItems ?? []).map((item) => item.incident.category))].sort();
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold text-foreground">Follow-up Required</h1><p className="mt-1 text-sm text-muted-foreground">Operational attention derived from incident ownership, stored delivery outcomes, and only explicitly configured response rules. Nothing is dispatched or retried automatically.</p></div>
    <section className="rounded-xl border border-border bg-card p-4"><div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" /><h2 className="font-semibold">Age-based follow-up rules</h2></div><p className="mt-1 text-xs text-muted-foreground">Leave a rule blank to disable it. No default time threshold exists.</p><div className="mt-4 grid gap-3 md:grid-cols-3"><RuleInput label="RECEIVED older than (hours)" value={settings.received_after_hours} onChange={(value) => setSettings((current) => ({ ...current, received_after_hours: value }))} /><RuleInput label="ASSIGNED older than (hours)" value={settings.assigned_after_hours} onChange={(value) => setSettings((current) => ({ ...current, assigned_after_hours: value }))} /><RuleInput label="DISPATCHED older than (hours)" value={settings.dispatched_after_hours} onChange={(value) => setSettings((current) => ({ ...current, dispatched_after_hours: value }))} /></div>{canEditSettings && <Button className="mt-4" onClick={saveSettings} disabled={saving}>{saving ? "Saving…" : "Save follow-up rules"}</Button>}</section>
    <section className="space-y-3"><div className="flex flex-wrap gap-2">{(Object.keys(filterCounts) as Filter[]).map((key) => <Button key={key} size="sm" variant={filter === key ? "default" : "outline"} onClick={() => setFilter(key)}>{filterLabel(key)} {filterCounts[key]}</Button>)}</div><div className="grid gap-3 md:grid-cols-3"><Input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Filter location" /><select value={category} onChange={(event) => setCategory(event.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"><option value="all">All services</option>{categories.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"><option value="all">All response statuses</option>{["received", "verified", "assigned", "dispatched", "in_progress", "resolved"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div></section>
    <section className="space-y-3">{items.map((item) => <AttentionCard key={item.incident.id} item={item} busy={actionId === item.incident.id} onReview={review} onRetry={retry} />)}{overview && items.length === 0 && <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground"><CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-emerald-500" />No incidents match this attention filter.</div>}</section>
  </div>;
}

function AttentionCard({ item, busy, onReview, onRetry }: { item: IncidentAttentionItem; busy: boolean; onReview: (item: IncidentAttentionItem) => void; onRetry: (item: IncidentAttentionItem) => void }) {
  const { incident } = item;
  const retryable = item.reasons.includes("communication_failed");
  const reviewable = item.reasons.includes("overdue") && item.followUp?.status !== "reviewed";
  return <article className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-foreground">{incident.request_id}</span><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${incident.priority === "critical" ? "bg-red-500/10 text-red-700 dark:text-red-300" : incident.priority === "high" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>{incident.priority.toUpperCase()}</span>{item.followUp?.status === "reviewed" && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">REVIEWED</span>}</div><p className="mt-1 text-sm text-foreground">{incident.category.replaceAll("_", " ")} · {locationLabel(incident)}</p><p className="mt-1 text-xs text-muted-foreground">{incident.requester_name || incident.title}{incident.contact_phone ? ` · ${incident.contact_phone}` : ""} · {incident.people_affected ?? "—"} people affected · {incident.incident_status.replaceAll("_", " ").toUpperCase()}</p></div><AlertTriangle className="h-5 w-5 text-amber-500" /></div><div className="mt-3 space-y-1">{item.reasons.map((reason) => <p key={reason} className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{reason === "communication_failed" ? "Communication failure" : reason.replaceAll("_", " ")}: </span>{FOLLOW_UP_REASON_LABEL[reason]}</p>)}</div>{item.followUp?.reviewed_at && <p className="mt-2 text-xs text-muted-foreground">Reviewed {new Date(item.followUp.reviewed_at).toLocaleString()}; the underlying condition remains active.</p>}<div className="mt-4 flex flex-wrap gap-2"><Link href={`/pipelines?incident=${incident.id}`} className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-muted">{item.reasons.includes("unassigned") ? "Assign response" : "Open incident"}</Link>{retryable && <Button size="sm" onClick={() => onRetry(item)} disabled={busy}><RotateCw className="mr-1 h-3.5 w-3.5" />Retry notification</Button>}{reviewable && <Button size="sm" variant="outline" onClick={() => onReview(item)} disabled={busy}>Mark reviewed</Button>}</div></article>;
}

function RuleInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="grid gap-2 text-sm font-medium text-foreground">{label}<Input type="number" min="1" step="1" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Disabled" /></label>; }
