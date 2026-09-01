"use client";

import { useEffect, useState } from "react";
import { FileImage, TriangleAlert, Volume2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Evidence = { id: string; message_id: string; media_type: string | null; created_at: string };
type FailedEvidence = { id: string; content_type: string; media_storage_error: string | null };

/** Incident-scoped evidence links. Files remain private; the authenticated
 * route issues the short-lived URL only after account authorization. */
export function IncidentEvidence({ dealId }: { dealId: string }) {
  const [items, setItems] = useState<Evidence[]>([]);
  const [unavailable, setUnavailable] = useState<FailedEvidence[]>([]);
  useEffect(() => {
    const db = createClient();
    void Promise.all([
      db.from("incident_evidence").select("id,message_id,media_type,created_at")
        .eq("deal_id", dealId).order("created_at", { ascending: false }),
      db.from("incident_message_links").select("message:messages(id,content_type,media_storage_status,media_storage_error)")
        .eq("deal_id", dealId),
    ]).then(([evidenceResult, linksResult]) => {
      setItems((evidenceResult.data ?? []) as Evidence[]);
      const linked = (linksResult.data ?? []) as unknown as Array<{ message: FailedEvidence & { media_storage_status: string | null } | null }>;
      setUnavailable(linked.map((item) => item.message).filter((message): message is FailedEvidence & { media_storage_status: string | null } => message?.media_storage_status === "failed"));
    });
  }, [dealId]);
  if (!items.length && !unavailable.length) return null;
  return <section className="rounded-xl border border-border bg-card p-3">
    <h3 className="text-sm font-semibold text-foreground">Citizen evidence</h3>
    <p className="mt-1 text-xs text-muted-foreground">Private files are available only to coordinators in this account.</p>
    <ul className="mt-2 space-y-2">{items.map((item) => <li key={item.id}>
      <a className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-2 text-sm text-primary hover:bg-muted/70" href={`/api/evidence/${item.message_id}`} target="_blank" rel="noreferrer">
        {item.media_type?.startsWith("audio/") ? <Volume2 className="h-4 w-4" /> : <FileImage className="h-4 w-4" />}
        Open {item.media_type?.startsWith("audio/") ? "voice evidence" : "evidence"}
      </a>
    </li>)}</ul>
    {unavailable.map((message) => <div key={message.id} className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-foreground"><div className="flex items-center gap-1.5 font-medium"><TriangleAlert className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />Evidence unavailable</div><p className="mt-1">The request is still saved. {message.media_storage_error ?? "The attachment could not be stored."} Ask the citizen to resend it or add evidence manually.</p></div>)}
  </section>;
}
