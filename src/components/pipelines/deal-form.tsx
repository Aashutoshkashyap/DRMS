"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type {
  Contact,
  Conversation,
  Deal,
  IncidentCategory,
  IncidentPriority,
  PipelineStage,
  Profile,
} from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { requestIncidentStatusNotification } from "@/lib/incidents/request-notification-client";
import { useTranslations } from "next-intl";
import { IncidentNotes } from "@/components/incidents/incident-notes";
import { ResourceRecommendations } from "@/components/incidents/resource-recommendations";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations("Pipelines.form");
  const supabase = createClient();
  const { accountId } = useAuth();

  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<IncidentCategory>("information");
  const [location, setLocation] = useState("");
  const [landmark, setLandmark] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [peopleAffected, setPeopleAffected] = useState("1");
  const [priority, setPriority] = useState<IncidentPriority>("medium");
  const [assignedTeam, setAssignedTeam] = useState("");
  const [assignedResource, setAssignedResource] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Array<{ id: string; name: string; availability: string }>>([]);
  const [vehicles, setVehicles] = useState<Array<{ id: string; identifier: string; vehicle_type: string; availability: string }>>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (deal) {
      setTitle(deal.title);
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? "");
      setDescription(deal.description ?? deal.notes ?? "");
      setCategory(deal.category ?? "information");
      setLocation(deal.location ?? "");
      setLandmark(deal.landmark ?? "");
      setLatitude(deal.latitude?.toString() ?? "");
      setLongitude(deal.longitude?.toString() ?? "");
      setPeopleAffected(String(deal.people_affected ?? 1));
      setPriority(deal.priority ?? "medium");
      setAssignedTeam(deal.assigned_team ?? "");
      setAssignedResource(deal.assigned_resource ?? "");
    } else {
      setTitle("");
      setContactId("");
      setStageId(defaultStageId || stages[0]?.id || "");
      setAssignedTo("");
      setDescription("");
      setCategory("information"); setLocation(""); setLandmark(""); setLatitude(""); setLongitude("");
      setPeopleAffected("1"); setPriority("medium"); setAssignedTeam(""); setAssignedResource("");
    }
  }, [open, deal, defaultStageId, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p, teamResult, vehicleResult] = await Promise.all([
        supabase.from("contacts").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("response_teams").select("id,name,availability").order("name"),
        supabase.from("vehicles").select("id,identifier,vehicle_type,availability").order("identifier"),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
      setTeams((teamResult.data ?? []) as Array<{ id: string; name: string; availability: string }>);
      setVehicles((vehicleResult.data ?? []) as Array<{ id: string; identifier: string; vehicle_type: string; availability: string }>);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  // Fetch linked conversation for the selected contact (newest open one).
  // Clearing on no-selection is sync with prop state; the populated
  // case runs setLinkedConversation inside the async fetch callback.
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId || !location.trim() || Number(peopleAffected) < 1) {
      toast.error(t("toastRequired"));
      return;
    }
    setSaving(true);

    const payload = {
      title: title.trim(),
      value: 0,
      currency: "NPR",
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      notes: description.trim() || null,
      conversation_id: linkedConversation?.id ?? null,
      category,
      requester_name: title.trim(),
      location: location.trim(),
      landmark: landmark.trim() || null,
      latitude: latitude ? Number(latitude) : null,
      longitude: longitude ? Number(longitude) : null,
      people_affected: Math.floor(Number(peopleAffected)),
      priority,
      description: description.trim() || null,
      assigned_team: assignedTeam.trim() || null,
      assigned_resource: assignedResource.trim() || null,
    };

    if (deal) {
      const { error } = await supabase
        .from("deals")
        .update(payload)
        .eq("id", deal.id);
      if (error) {
        toast.error(t("toastFailedSave"));
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error(t("toastNotSignedIn"));
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error(t("toastNotLinked"));
        setSaving(false);
        return;
      }
      const { error } = await supabase
        .from("deals")
        .insert({ ...payload, user_id: user.id, account_id: accountId, status: "open" });
      if (error) {
        toast.error(t("toastFailedCreate"));
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    if (deal && stageId !== deal.stage_id && !(await requestIncidentStatusNotification(deal.id))) {
      toast.error("Status changed, but the WhatsApp update could not be delivered. The failure was recorded for coordinator retry.");
    }
    toast.success(deal ? t("toastUpdated") : t("toastCreated"));
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? "Edit incident" : "New incident"}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Requester name</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Requester name or incident title"
                className="border-border bg-muted text-foreground"
              />
            </div>

            {deal?.request_id && <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm"><span className="text-muted-foreground">Request ID </span><span className="font-semibold text-primary">{deal.request_id}</span></div>}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label className="text-muted-foreground">Service</Label><select value={category} onChange={(e) => setCategory(e.target.value as IncidentCategory)} className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground"><option value="rescue">Rescue</option><option value="food_water">Food / Water</option><option value="medicine">Medicine</option><option value="shelter">Shelter</option><option value="missing_person">Missing person</option><option value="information">Information</option></select></div>
              <div className="grid gap-2"><Label className="text-muted-foreground">Priority</Label><select value={priority} onChange={(e) => setPriority(e.target.value as IncidentPriority)} className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground"><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
            </div>
            <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label className="text-muted-foreground">Location</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Municipality, ward" className="border-border bg-muted text-foreground" /></div><div className="grid gap-2"><Label className="text-muted-foreground">Landmark</Label><Input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Nearby landmark" className="border-border bg-muted text-foreground" /></div></div>
            <div className="grid grid-cols-3 gap-3"><div className="grid gap-2"><Label className="text-muted-foreground">Latitude</Label><Input type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} className="border-border bg-muted text-foreground" /></div><div className="grid gap-2"><Label className="text-muted-foreground">Longitude</Label><Input type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} className="border-border bg-muted text-foreground" /></div><div className="grid gap-2"><Label className="text-muted-foreground">People affected</Label><Input type="number" min="1" value={peopleAffected} onChange={(e) => setPeopleAffected(e.target.value)} className="border-border bg-muted text-foreground" /></div></div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("contact")}</Label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">{t("selectContact")}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>

              {linkedConversation && (
                <Link
                  href="/inbox"
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
                >
                  <MessageSquare className="h-3 w-3" />
                  Open communication history
                </Link>
              )}
            </div>
            <ResourceRecommendations
              latitude={latitude ? Number(latitude) : null}
              longitude={longitude ? Number(longitude) : null}
              onChooseTeam={setAssignedTeam}
              onChooseVehicle={setAssignedResource}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label className="text-muted-foreground">Assigned team</Label><select value={assignedTeam} onChange={(e) => setAssignedTeam(e.target.value)} className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground"><option value="">No team assigned</option>{teams.filter((team) => team.availability === "available" || team.availability === "limited" || team.name === assignedTeam).map((team) => <option key={team.id} value={team.name}>{team.name} ({team.availability})</option>)}</select></div>
              <div className="grid gap-2"><Label className="text-muted-foreground">Assigned vehicle / resource</Label><select value={assignedResource} onChange={(e) => setAssignedResource(e.target.value)} className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground"><option value="">No vehicle assigned</option>{vehicles.filter((vehicle) => vehicle.availability === "available" || vehicle.availability === "limited" || vehicle.identifier === assignedResource).map((vehicle) => <option key={vehicle.id} value={vehicle.identifier}>{vehicle.vehicle_type} — {vehicle.identifier} ({vehicle.availability})</option>)}</select></div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Response status</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Coordinator</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">Unassigned</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Incident description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What was reported or verified?"
                className="min-h-[100px] border-border bg-muted text-foreground"
              />
            </div>

            {deal && <IncidentNotes dealId={deal.id} />}

            {deal && <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">Move the request on the board to change its status. Verification, assignment, and dispatch remain human coordinator decisions.</div>}
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !title.trim() || !contactId || !stageId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : deal ? "Save incident" : "Create incident"}
              </Button>
            </div>

            {deal &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">{t("deletePrompt")}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? t("deleting") : t("confirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete incident
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
