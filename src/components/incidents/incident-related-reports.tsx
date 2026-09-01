"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

type Relation = { id: string; source_deal_id: string; related_deal_id: string; relationship: "possible_related" | "related" | "separate"; match_signals: { distance_km?: number | null; shared_tokens?: string[] }; related?: { id: string; request_id: string; incident_status: string; location: string | null } | null };

export function IncidentRelatedReports({ dealId }: { dealId: string }) {
  const db = createClient(); const { user } = useAuth(); const [items, setItems] = useState<Relation[]>([]);
  const load = useCallback(async () => {
    const { data } = await db.from("incident_relationships").select("id,source_deal_id,related_deal_id,relationship,match_signals,related:deals!incident_relationships_related_deal_id_fkey(id,request_id,incident_status,location)").eq("source_deal_id", dealId).order("created_at", { ascending: false });
    setItems((data ?? []).map((row) => ({ ...row, related: Array.isArray(row.related) ? row.related[0] ?? null : row.related })) as unknown as Relation[]);
  }, [db, dealId]);
  // Query completion, not the effect body, performs the state update.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  async function decide(item: Relation, relationship: "related" | "separate") {
    const { error } = await db.from("incident_relationships").update({ relationship, decided_at: new Date().toISOString(), decided_by_user_id: user?.id ?? null }).eq("id", item.id);
    if (!error) await load();
  }
  if (!items.length) return null;
  return <section className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"><div><h3 className="text-sm font-semibold text-foreground">Related reports</h3><p className="text-xs text-muted-foreground">Possible matches are evidence for coordinator review only. They never merge reports or dispatch resources.</p></div>{items.map((item) => <div key={item.id} className="rounded-lg border border-border bg-card p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{item.related?.request_id || "Related request"}</span><span className="text-xs uppercase text-muted-foreground">{item.relationship.replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-muted-foreground">{item.related?.location || "Location missing"}{typeof item.match_signals.distance_km === "number" ? ` · ${item.match_signals.distance_km.toFixed(1)} km away` : ""}</p><div className="mt-2 flex gap-2"><Link className="text-xs text-primary" href={`/pipelines?incident=${item.related_deal_id}`}>View existing incident</Link>{item.relationship === "possible_related" && <><Button size="sm" variant="outline" onClick={() => decide(item, "related")}>Mark related</Button><Button size="sm" variant="ghost" onClick={() => decide(item, "separate")}>Keep separate</Button></>}</div></div>)}</section>;
}
