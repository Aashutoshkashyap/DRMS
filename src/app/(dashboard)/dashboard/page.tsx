"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, ClipboardList, MapPin, MessageSquare, Radio, Send, UserRoundCheck } from "lucide-react";
import { groupIncidentsByLocation, type IncidentAttentionItem, type LocationGrouping, type OperationsIncident, type loadOperationsOverview } from "@/lib/operations/overview";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { AvailableAdministrators } from "@/components/dashboard/available-administrators";

type Overview = Awaited<ReturnType<typeof loadOperationsOverview>>;
type HealthAlert = { component: "webhook" | "storage" | "outbound"; severity: "degraded" | "incident"; message: string; event_count: number; last_seen_at: string };
type WorkspaceAccess = { kind: "no_shared_workspace" | "operational_workspace"; accountName: string };

function healthLabel(component: HealthAlert["component"]) {
  return component === "outbound" ? "WhatsApp communication" : component === "webhook" ? "Inbound WhatsApp processing" : "Evidence storage";
}

function healthLink(component: HealthAlert["component"]) {
  return component === "outbound" ? "/follow-up?filter=communication_failed" : component === "webhook" ? "/inbox" : "/pipelines";
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").toUpperCase();
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [overviewError, setOverviewError] = useState(false);
  const [workspaceAccess, setWorkspaceAccess] = useState<WorkspaceAccess | null>(null);
  const [locationGrouping, setLocationGrouping] = useState<LocationGrouping>("exact");
  const [health, setHealth] = useState<{ status: "operational" | "degraded" | "incident"; alerts: HealthAlert[] } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setOverviewError(false);
    try {
      const [overviewResponse, workspaceResponse] = await Promise.all([
        fetch("/api/follow-up/overview", { method: "POST" }),
        fetch("/api/account/workspace-access", { cache: "no-store" }),
      ]);
      if (!overviewResponse.ok) throw new Error("Could not load operations overview");
      setOverview(await overviewResponse.json() as Overview);
      setWorkspaceAccess(workspaceResponse.ok ? await workspaceResponse.json() as WorkspaceAccess : null);
    }
    catch (error) { console.error("[operations overview]", error); setOverviewError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void fetch("/api/operations/health").then((response) => response.ok ? response.json() : null).then(setHealth).catch(() => setHealth(null)); }, []);
  const locationSummary = useMemo(() => groupIncidentsByLocation(overview?.active ?? [], locationGrouping), [locationGrouping, overview?.active]);

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold text-foreground">Operations Overview</h1><p className="mt-1 text-sm text-muted-foreground">Coordinator view of stored incidents, communications, resource data, and items needing attention.</p></div><div className="flex gap-2"><Link href="/pipelines" className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">View incidents</Link><Link href="/resources" className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground">Resources & locations</Link></div></div>
    {overviewError && <section className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm"><strong>DRMS data unavailable.</strong><p className="mt-1">Your changes are not confirmed. Restore the connection, then retry the specific action.</p><button type="button" onClick={() => void load()} className="mt-2 text-sm font-medium text-primary underline">Retry dashboard</button></section>}
    {workspaceAccess?.kind === "no_shared_workspace" && <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"><strong>No shared workspace access yet.</strong><p className="mt-1">This is a new private workspace, so no shared operational incidents are available here. Open the organization invitation link provided by a workspace administrator, then sign in again to join the shared coordination board.</p></section>}
    {health && <section className={`rounded-xl border p-3 text-sm ${health.status === "operational" ? "border-emerald-500/40 bg-emerald-500/10" : health.status === "incident" ? "border-red-500/40 bg-red-500/10" : "border-amber-500/40 bg-amber-500/10"}`}><strong>{health.status === "operational" ? "System status · Operational" : "System status / attention"}</strong>{health.status === "operational" ? <p className="mt-1 text-muted-foreground">The dashboard database check succeeded and no unresolved inbound WhatsApp, evidence-storage, or outbound WhatsApp failures are recorded for this workspace.</p> : health.alerts.slice(0, 2).map((alert) => <div key={`${alert.component}-${alert.message}`} className="mt-2"><p><span className="font-medium">{healthLabel(alert.component)} degraded</span>{alert.event_count > 1 ? ` · ${alert.event_count} affected operations` : ""}</p><p className="text-xs text-muted-foreground">Last failure: {new Date(alert.last_seen_at).toLocaleString()} · {alert.message}</p><Link href={healthLink(alert.component)} className="text-xs font-medium text-primary underline">View affected requests</Link></div>)}</section>}
    {workspaceAccess?.kind !== "no_shared_workspace" && <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{loading || !overview ? Array.from({ length: 12 }).map((_, index) => <SkeletonCard key={index} />) : <>
      <DashboardMetric href="/pipelines"><MetricCard title="Active incidents" value={String(overview.counts.active)} icon={ClipboardList} /></DashboardMetric>
      <DashboardMetric href="/pipelines?priority=critical"><MetricCard title="Critical incidents" value={String(overview.counts.critical)} icon={AlertTriangle} /></DashboardMetric>
      <DashboardMetric href="/pipelines?status=received"><MetricCard title="New requests" value={String(overview.counts.received)} icon={CircleAlert} /></DashboardMetric>
      <DashboardMetric href="/pipelines?status=verified"><MetricCard title="Verified" value={String(overview.counts.verified)} icon={UserRoundCheck} /></DashboardMetric>
      <DashboardMetric href="/pipelines?status=assigned"><MetricCard title="Assigned" value={String(overview.counts.assigned)} icon={ClipboardList} /></DashboardMetric>
      <DashboardMetric href="/follow-up?filter=unassigned"><MetricCard title="Unassigned" value={String(overview.counts.unassigned)} icon={UserRoundCheck} /></DashboardMetric>
      <DashboardMetric href="/follow-up?filter=communication_failed"><MetricCard title="Communication failed" value={String(overview.counts.communicationFollowUp)} icon={MessageSquare} /></DashboardMetric>
      <DashboardMetric href="/pipelines?status=dispatched"><MetricCard title="Dispatched" value={String(overview.counts.dispatched)} icon={Send} /></DashboardMetric>
      <DashboardMetric href="/pipelines?status=in_progress"><MetricCard title="In progress" value={String(overview.counts.inProgress)} icon={Radio} /></DashboardMetric>
      <DashboardMetric href="/pipelines?status=resolved"><MetricCard title="Resolved" value={String(overview.counts.resolved)} icon={CheckCircle2} /></DashboardMetric>
      <Link href="/follow-up"><MetricCard title="Follow-up required" value={String(overview.counts.followUp)} icon={AlertTriangle} subtitle={`${overview.counts.criticalFollowUp} critical · ${overview.counts.unassigned} unassigned · ${overview.counts.communicationFollowUp} communication`} /></Link>
      <DashboardMetric href="/inbox"><MetricCard title="Citizen communications" value={String(overview.recentMessages.length)} icon={MessageSquare} subtitle="Most recent stored messages" /></DashboardMetric>
    </>}</section>}
    {workspaceAccess?.kind !== "no_shared_workspace" && <><div className="grid gap-5 xl:grid-cols-5"><section className="rounded-xl border border-border bg-card xl:col-span-3"><header className="flex items-center justify-between border-b border-border px-4 py-3"><div><h2 className="font-semibold text-foreground">What needs me right now?</h2><p className="text-xs text-muted-foreground">Human review is required; nothing here triggers a dispatch.</p></div><Link href="/follow-up" className="text-sm text-primary">View follow-up</Link></header>{loading ? <p className="p-4 text-sm text-muted-foreground">Loading operational items…</p> : <AttentionList items={overview?.attentionItems ?? []} />}</section><section className="rounded-xl border border-border bg-card xl:col-span-2"><header className="flex items-center justify-between border-b border-border px-4 py-3"><div><h2 className="font-semibold text-foreground">Location summary</h2><p className="text-xs text-muted-foreground">Active incidents by stored location fields.</p></div><select value={locationGrouping} onChange={(event) => setLocationGrouping(event.target.value as LocationGrouping)} className="h-8 rounded border border-border bg-muted px-2 text-xs text-foreground"><option value="exact">Exact location</option><option value="municipality">Municipality</option><option value="district">District</option></select></header><ul className="divide-y divide-border">{locationSummary.map(([location, count]) => <li key={location} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="flex items-center gap-2 text-foreground"><MapPin className="h-4 w-4 text-muted-foreground" />{location}</span><span className="font-medium tabular-nums">{count}</span></li>)}{!loading && locationSummary.length === 0 && <li className="px-4 py-6 text-sm text-muted-foreground">No active incident location is recorded yet.</li>}</ul></section></div>
    <div className="grid gap-5 xl:grid-cols-3"><section className="rounded-xl border border-border bg-card"><header className="border-b border-border px-4 py-3"><h2 className="font-semibold text-foreground">Recent citizen communications</h2><p className="text-xs text-muted-foreground">Messages already stored in the shared CRM inbox.</p></header><MessageList messages={overview?.recentMessages ?? []} /></section><section className="rounded-xl border border-border bg-card"><header className="border-b border-border px-4 py-3"><h2 className="font-semibold text-foreground">Response status</h2><p className="text-xs text-muted-foreground">Current workflow from the existing pipeline engine.</p></header><StatusList incidents={overview?.incidents ?? []} /></section><AvailableAdministrators /></div></>}
  </div>;
}

function DashboardMetric({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{children}</Link>;
}

function AttentionList({ items }: { items: IncidentAttentionItem[] }) {
  return <div className="divide-y divide-border">{items.slice(0, 6).map((item) => <Link key={item.incident.id} href={`/pipelines?incident=${item.incident.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/60"><span><span className="font-medium text-foreground">{item.incident.request_id}</span><span className="ml-2 text-muted-foreground">{[item.incident.location, item.incident.municipality, item.incident.district].filter(Boolean).join(" · ") || "Location not recorded"}</span><span className="mt-1 block text-xs text-muted-foreground">{item.reasons.map((reason) => reason.replaceAll("_", " ")).join(" · ")}</span></span><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{item.incident.priority}</span></Link>)}{items.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">No current incident requires coordinator attention.</p>}</div>;
}

function MessageList({ messages }: { messages: Array<{ id: string; content_text: string | null; sender_type: string; created_at: string }> }) {
  return <ul className="divide-y divide-border">{messages.map((message) => <li key={message.id} className="px-4 py-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium text-foreground">{message.sender_type === "customer" ? "Citizen" : "Coordinator / system"}</span><span className="text-xs text-muted-foreground">{new Date(message.created_at).toLocaleString()}</span></div><p className="mt-1 line-clamp-2 text-muted-foreground">{message.content_text || "Media or structured message"}</p></li>)}{messages.length === 0 && <li className="px-4 py-6 text-sm text-muted-foreground">No stored communications yet.</li>}</ul>;
}

function StatusList({ incidents }: { incidents: OperationsIncident[] }) {
  const counts = incidents.reduce((map, incident) => { map.set(incident.incident_status, (map.get(incident.incident_status) ?? 0) + 1); return map; }, new Map<string, number>());
  return <ul className="divide-y divide-border">{["received", "verified", "assigned", "dispatched", "in_progress", "resolved"].map((status) => <li key={status} className="flex items-center justify-between px-4 py-3 text-sm"><span className="text-foreground">{statusLabel(status)}</span><span className="font-medium tabular-nums">{counts.get(status) ?? 0}</span></li>)}</ul>;
}
