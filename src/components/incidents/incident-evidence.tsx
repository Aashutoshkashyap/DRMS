"use client";

import { useEffect, useState } from "react";
import { FileImage, ImageOff, Loader2, TriangleAlert, Volume2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useMediaBlobUrl } from "@/hooks/use-media-blob-url";

type Evidence = { id: string; message_id: string; media_type: string | null; created_at: string };
type FailedEvidence = { id: string; content_type: string; media_storage_error: string | null };

function EvidencePreview({ item }: { item: Evidence }) {
  const evidenceUrl = `/api/evidence/${item.message_id}`;
  const { src, status } = useMediaBlobUrl(evidenceUrl);
  const isAudio = item.media_type?.startsWith("audio/");

  if (status === "loading") return <div className="flex h-24 items-center justify-center rounded-md bg-muted"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (status === "error" || !src) return <div className="flex h-24 items-center justify-center gap-2 rounded-md bg-muted text-xs text-muted-foreground"><ImageOff className="h-4 w-4" />Evidence unavailable</div>;

  return <div className="space-y-2">
    {isAudio ? <audio src={src} controls className="w-full" /> : (
      <a href={evidenceUrl} target="_blank" rel="noreferrer" className="block w-fit">
        {/* Evidence is private and served through the authenticated route. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Citizen evidence" className="max-h-64 max-w-full rounded-md object-contain" />
      </a>
    )}
    <a className="inline-flex items-center gap-2 text-sm text-primary hover:underline" href={evidenceUrl} target="_blank" rel="noreferrer">
      {isAudio ? <Volume2 className="h-4 w-4" /> : <FileImage className="h-4 w-4" />}
      Open full {isAudio ? "voice memo" : "photo"}
    </a>
  </div>;
}

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
    <ul className="mt-2 space-y-3">{items.map((item) => <li key={item.id} className="rounded-md bg-muted p-2.5"><EvidencePreview item={item} /></li>)}</ul>
    {unavailable.map((message) => <div key={message.id} className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-foreground"><div className="flex items-center gap-1.5 font-medium"><TriangleAlert className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />Evidence unavailable</div><p className="mt-1">The request is still saved. {message.media_storage_error ?? "The attachment could not be stored."} Ask the citizen to resend it or add evidence manually.</p></div>)}
  </section>;
}
