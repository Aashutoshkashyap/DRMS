"use client";

import { useEffect, useState } from "react";
import { FileImage, Volume2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Evidence = { id: string; message_id: string; media_type: string | null; created_at: string };

/** Incident-scoped evidence links. Files remain private; the authenticated
 * route issues the short-lived URL only after account authorization. */
export function IncidentEvidence({ dealId }: { dealId: string }) {
  const [items, setItems] = useState<Evidence[]>([]);
  useEffect(() => {
    void createClient().from("incident_evidence").select("id,message_id,media_type,created_at")
      .eq("deal_id", dealId).order("created_at", { ascending: false })
      .then(({ data }) => setItems((data ?? []) as Evidence[]));
  }, [dealId]);
  if (!items.length) return null;
  return <section className="rounded-xl border border-border bg-card p-3">
    <h3 className="text-sm font-semibold text-foreground">Citizen evidence</h3>
    <p className="mt-1 text-xs text-muted-foreground">Private files are available only to coordinators in this account.</p>
    <ul className="mt-2 space-y-2">{items.map((item) => <li key={item.id}>
      <a className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-2 text-sm text-primary hover:bg-muted/70" href={`/api/evidence/${item.message_id}`} target="_blank" rel="noreferrer">
        {item.media_type?.startsWith("audio/") ? <Volume2 className="h-4 w-4" /> : <FileImage className="h-4 w-4" />}
        Open {item.media_type?.startsWith("audio/") ? "voice evidence" : "evidence"}
      </a>
    </li>)}</ul>
  </section>;
}
