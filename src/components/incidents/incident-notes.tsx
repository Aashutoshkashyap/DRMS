"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { IncidentNote } from "@/types";
import { toast } from "sonner";

export function IncidentNotes({ dealId }: { dealId: string }) {
  const db = createClient();
  const { accountId, user } = useAuth();
  const [notes, setNotes] = useState<IncidentNote[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db
      .from("incident_notes")
      .select("id,account_id,deal_id,user_id,note_text,created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });
    if (error) toast.error("Could not load case notes.");
    else setNotes((data ?? []) as IncidentNote[]);
    setLoading(false);
  }, [db, dealId]);

  // The asynchronous loader updates local state only after the Supabase read settles.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function addNote() {
    const noteText = text.trim();
    if (!noteText || !accountId || !user) return;
    setSaving(true);
    const { error } = await db.from("incident_notes").insert({
      account_id: accountId,
      deal_id: dealId,
      user_id: user.id,
      note_text: noteText,
    });
    setSaving(false);
    if (error) {
      toast.error("Could not save case note.");
      return;
    }
    setText("");
    await load();
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Case notes</h3>
        <p className="text-xs text-muted-foreground">Coordinator-only operational context for this incident.</p>
      </div>
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Add a verified observation, handover, or coordinator decision"
        className="min-h-20 border-border bg-muted text-foreground"
      />
      <Button type="button" size="sm" onClick={addNote} disabled={saving || !text.trim()}>
        {saving ? "Saving…" : "Add case note"}
      </Button>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No case notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-lg bg-muted/60 p-2 text-sm text-foreground">
              <p>{note.note_text}</p>
              <p className="mt-1 text-xs text-muted-foreground">Coordinator · {new Date(note.created_at).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
