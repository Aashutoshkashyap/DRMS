"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, ClipboardList, MapPin, MessageSquare, Radio, Send, UserRoundCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadOperationsOverview, type OperationsIncident } from "@/lib/operations/overview";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";

type Overview = Awaited<ReturnType<typeof loadOperationsOverview>>;

function statusLabel(status: string) {
  return status.replaceAll("_", " ").toUpperCase();
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setOverview(await loadOperationsOverview(createClient())); }
    catch (error) { console.error("[operations overview]", error); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold text-foreground">Operations Overview</h1><p className="mt-1 text-sm text-muted-foreground">Coordinator view of stored incidents, communications, resource data, and items needing attention.</p></div><div className="flex gap-2"><Link href="/pipelines" className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">View incidents</Link><Link href="/resources" className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground">Resources & locations</Link></div></div>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{loading || !overview ? Array.from({ length: 8 }).map((_, index) => <SkeletonCard key={index} />) : <>
      <MetricCard title="Active incidents" value={String(overview.counts.active)} icon={ClipboardList} />
      <MetricCard title="Critical incidents" value={String(overview.counts.critical)} icon={AlertTriangle} />
      <MetricCard title="New requests" value={String(overview.counts.received)} icon={CircleAlert} />
      <MetricCard title="Unassigned" value={String(overview.counts.unassigned)} icon={UserRoundCheck} />
      <MetricCard title="Dispatched" value={String(overview.counts.dispatched)} icon={Send} />
      <MetricCard title="Resolved" value={String(overview.counts.resolved)} icon={CheckCircle2} />
      <MetricCard title="Follow-up required" value={String(overview.counts.followUp)} icon={AlertTriangle} subtitle={overview.followUpSettingsConfigured ? "Configured rules and operational exceptions" : "Unassigned cases and delivery failures"} />
      <MetricCard title="Citizen communications" value={String(overview.recentMessages.length)} icon={MessageSquare} subtitle="Most recent stored messages" />
    </>}</section>
    <div className="grid gap-5 xl:grid-cols-5"><section className="rounded-xl border border-border bg-card xl:col-span-3"><header className="flex items-center justify-between border-b border-border px-4 py-3"><div><h2 className="font-semibold text-foreground">Operational attention</h2><p className="text-xs text-muted-foreground">Human review is required; nothing here triggers a dispatch.</p></div><Link href="/follow-up" className="text-sm text-primary">View follow-up</Link></header>{loading ? <p className="p-4 text-sm text-muted-foreground">Loading operational items…</p> : <AttentionList incidents={overview?.active ?? []} failedCount={overview?.failedDeliveries.length ?? 0} />}</section><section className="rounded-xl border border-border bg-card xl:col-span-2"><header className="border-b border-border px-4 py-3"><h2 className="font-semibold text-foreground">Location summary</h2><p className="text-xs text-muted-foreground">Active incidents by recorded location.</p></header><ul className="divide-y divide-border">{(overview?.locationSummary ?? []).map(([location, count]) => <li key={location} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="flex items-center gap-2 text-foreground"><MapPin className="h-4 w-4 text-muted-foreground" />{location}</span><span className="font-medium tabular-nums">{count}</span></li>)}{!loading && overview?.locationSummary.length === 0 && <li className="px-4 py-6 text-sm text-muted-foreground">No active incident location is recorded yet.</li>}</ul></section></div>
    <div className="grid gap-5 xl:grid-cols-2"><section className="rounded-xl border border-border bg-card"><header className="border-b border-border px-4 py-3"><h2 className="font-semibold text-foreground">Recent citizen communications</h2><p className="text-xs text-muted-foreground">Messages already stored in the shared CRM inbox.</p></header><MessageList messages={overview?.recentMessages ?? []} /></section><section className="rounded-xl border border-border bg-card"><header className="border-b border-border px-4 py-3"><h2 className="font-semibold text-foreground">Response status</h2><p className="text-xs text-muted-foreground">Current workflow from the existing pipeline engine.</p></header><StatusList incidents={overview?.incidents ?? []} /></section></div>
  </div>;
}

function AttentionList({ incidents, failedCount }: { incidents: OperationsIncident[]; failedCount: number }) {
  const attention = incidents.filter((incident) => incident.priority === "critical" || (!incident.assigned_to && !incident.assigned_team && !incident.assigned_resource)).slice(0, 6);
  return <div className="divide-y divide-border">{failedCount > 0 && <div className="flex items-center gap-3 px-4 py-3 text-sm"><Radio className="h-4 w-4 text-amber-500" /><span className="text-foreground">{failedCount} failed citizen status delivery{failedCount === 1 ? "" : "ies"} requires coordinator review.</span></div>}{attention.map((incident) => <Link key={incident.id} href="/pipelines" className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/60"><span><span className="font-medium text-foreground">{incident.request_id}</span><span className="ml-2 text-muted-foreground">{incident.location || "Location not recorded"}</span></span><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{incident.priority}</span></Link>)}{attention.length === 0 && failedCount === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">No critical or unassigned active incident is currently recorded.</p>}</div>;
}

function MessageList({ messages }: { messages: Array<{ id: string; content_text: string | null; sender_type: string; created_at: string }> }) {
  return <ul className="divide-y divide-border">{messages.map((message) => <li key={message.id} className="px-4 py-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium text-foreground">{message.sender_type === "customer" ? "Citizen" : "Coordinator / system"}</span><span className="text-xs text-muted-foreground">{new Date(message.created_at).toLocaleString()}</span></div><p className="mt-1 line-clamp-2 text-muted-foreground">{message.content_text || "Media or structured message"}</p></li>)}{messages.length === 0 && <li className="px-4 py-6 text-sm text-muted-foreground">No stored communications yet.</li>}</ul>;
}

function StatusList({ incidents }: { incidents: OperationsIncident[] }) {
  const counts = incidents.reduce((map, incident) => { map.set(incident.incident_status, (map.get(incident.incident_status) ?? 0) + 1); return map; }, new Map<string, number>());
  return <ul className="divide-y divide-border">{["received", "verified", "assigned", "dispatched", "in_progress", "resolved"].map((status) => <li key={status} className="flex items-center justify-between px-4 py-3 text-sm"><span className="text-foreground">{statusLabel(status)}</span><span className="font-medium tabular-nums">{counts.get(status) ?? 0}</span></li>)}</ul>;
}
