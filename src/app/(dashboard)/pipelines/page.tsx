"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineStage, Deal } from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Plus, ChevronDown, Settings } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { GatedButton } from "@/components/ui/gated-button";
import { useTranslations } from "next-intl";
import { DISASTER_PIPELINE_STAGES, ensureDisasterPipeline } from "@/lib/incidents/pipeline-service";
import { requestIncidentStatusNotification } from "@/lib/incidents/request-notification-client";

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// Spec-defined seed — name and color per the product spec.
export default function PipelinesPage() {
  const t = useTranslations("Pipelines.page");
  const searchParams = useSearchParams();
  const supabase = createClient();
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");
  const { accountId } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState(() => {
    const status = searchParams.get("status");
    return status && ["received", "verified", "assigned", "dispatched", "in_progress", "resolved"].includes(status) ? status : "all";
  });
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState(() => {
    const priority = searchParams.get("priority");
    return priority && ["critical", "high", "medium", "low"].includes(priority) ? priority : "all";
  });
  const [locationField, setLocationField] = useState<"location" | "municipality" | "district">("location");
  const [locationFilter, setLocationFilter] = useState("");
  const [archiveView, setArchiveView] = useState<"active" | "archived">("active");

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);
  const openedIncidentRef = useRef<string | null>(null);


  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      return data ?? [];
    },
    [supabase],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("deals")
        .select("*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });
      const requests = (data ?? []) as Deal[];
      if (!requests.length) return requests;

      // The board only needs a compact attachment pointer. File access still
      // goes through the authenticated evidence route on click.
      const { data: evidence, error } = await supabase
        .from("incident_evidence")
        .select("deal_id,message_id,media_type")
        .in("deal_id", requests.map((request) => request.id));
      if (error) {
        console.error("Failed to load incident evidence:", error.message);
        return requests;
      }
      const evidenceByDeal = new Map<string, Array<{ message_id: string; media_type: string | null }>>();
      for (const item of evidence ?? []) {
        const items = evidenceByDeal.get(item.deal_id) ?? [];
        items.push({ message_id: item.message_id, media_type: item.media_type });
        evidenceByDeal.set(item.deal_id, items);
      }
      return requests.map((request) => ({ ...request, evidence: evidenceByDeal.get(request.id) ?? [] }));
    },
    [supabase],
  );

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return null;
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) return null;

    try {
      const result = await ensureDisasterPipeline(supabase, accountId, user.id);
      const { data: pipeline } = await supabase.from("pipelines").select("*").eq("id", result.pipelineId).single();
      return (pipeline as Pipeline | null) ?? null;
    } catch (error) {
      console.error("Failed to seed pipeline:", error);
      return null;
    }
  }, [supabase, accountId]);

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      // Clearing the selected pipeline synchronizes the board with its absence.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([]);
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  // Follow-up links open the existing case sheet; they do not introduce a
  // second incident detail route or bypass the established workflow controls.
  useEffect(() => {
    const incidentId = searchParams.get("incident");
    const incident = incidentId ? deals.find((deal) => deal.id === incidentId) : null;
    if (!incident || openedIncidentRef.current === incidentId) return;
    const timer = window.setTimeout(() => {
      openedIncidentRef.current = incidentId;
      setEditingDeal(incident);
      setDefaultStageId(incident.stage_id);
      setDealFormOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [deals, searchParams]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      const incident = deals.find((deal) => deal.id === dealId);
      const stage = stages.find((item) => item.id === newStageId);
      if (!incident || !stage) {
        toast.error(t("toastFailedMoveDeal"));
        await refreshDeals();
        return;
      }
      if (!window.confirm(`Change ${incident.request_id || "this incident"} to ${stage.name}? This action will be recorded under your coordinator account.`)) {
        await refreshDeals();
        return;
      }
      const response = await fetch(`/api/incidents/${dealId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId: newStageId }),
      });
      if (!response.ok) {
        toast.error(t("toastFailedMoveDeal"));
      } else if (!(await requestIncidentStatusNotification(dealId))) {
        toast.error("Status changed, but the WhatsApp update could not be delivered. The failure was recorded for coordinator retry.");
      }
      await refreshDeals();
    },
    [deals, refreshDeals, stages, t],
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error(t("toastNotLinkedToAccount"));
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error(t("toastFailedCreatePipeline"));
      setCreating(false);
      return;
    }

    const stagesPayload = DISASTER_PIPELINE_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
      incident_status: s.incident_status,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    setNewPipelineName("");
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success(t("toastPipelineCreated"));
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);
  const filteredDeals = deals.filter((request) =>
    (archiveView === "active" ? request.incident_status !== "resolved" : request.incident_status === "resolved") &&
    (statusFilter === "all" || request.incident_status === statusFilter) &&
    (categoryFilter === "all" || request.category === categoryFilter) &&
    (priorityFilter === "all" || request.priority === priorityFilter) &&
    (!locationFilter.trim() || (request[locationField] ?? "").toLocaleLowerCase().includes(locationFilter.trim().toLocaleLowerCase())),
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Incidents & response workflow</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track relief cases through human verification, assignment, dispatch, and resolution.</p>
      </div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Response-workflow selector; underlying configurable pipeline data is preserved. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors data-[popup-open]:bg-muted"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? t("selectPipeline")}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-border bg-popover text-popover-foreground"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  {t("noPipelinesYet")}
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-primary"
                      : "text-popover-foreground"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-popover-foreground"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  Manage response workflow
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="manage response workflows"
            onClick={() => setNewPipelineOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Plus className="mr-1 h-4 w-4" />
            New workflow
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason="create incidents"
            disabled={!selectedPipelineId || stages.length === 0}
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            New incident
          </GatedButton>
        </div>
      </div>

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            {t("noPipelinesYet")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a response workflow to begin tracking incidents.
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="manage response workflows"
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Create response workflow
          </GatedButton>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card/60 p-3">
            <div className="inline-flex rounded-lg border border-border bg-muted p-0.5" aria-label="Incident archive view">
              <Button size="sm" variant={archiveView === "active" ? "default" : "ghost"} onClick={() => { setArchiveView("active"); if (statusFilter === "resolved") setStatusFilter("all"); }}>Active</Button>
              <Button size="sm" variant={archiveView === "archived" ? "default" : "ghost"} onClick={() => { setArchiveView("archived"); setStatusFilter("resolved"); }}>Archived / resolved</Button>
            </div>
            <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-lg border border-border bg-muted px-2 text-sm text-foreground"><option value="all">All statuses</option><option value="received">Received</option><option value="verified">Verified</option><option value="assigned">Assigned</option><option value="dispatched">Dispatched</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select>
            <select aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="h-9 rounded-lg border border-border bg-muted px-2 text-sm text-foreground"><option value="all">All categories</option><option value="rescue">Rescue</option><option value="food_water">Food / Water</option><option value="medicine">Medicine</option><option value="shelter">Shelter</option><option value="missing_person">Missing person</option><option value="information">Information</option></select>
            <select aria-label="Filter by priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="h-9 rounded-lg border border-border bg-muted px-2 text-sm text-foreground"><option value="all">All priorities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
            <select aria-label="Location field" value={locationField} onChange={(event) => setLocationField(event.target.value as "location" | "municipality" | "district")} className="h-9 rounded-lg border border-border bg-muted px-2 text-sm text-foreground"><option value="location">Exact location</option><option value="municipality">Municipality</option><option value="district">District</option></select>
            <Input aria-label="Filter by location" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} placeholder="Filter location" className="h-9 w-44 border-border bg-muted text-foreground" />
          </div>
          <PipelineBoard
            stages={stages}
            deals={filteredDeals}
            onDealMoved={handleDealMoved}
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
          />
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">New response workflow</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">Workflow name</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder="e.g. Disaster response workflow"
              className="mt-2 bg-muted border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              This keeps the configurable response status workflow used by incidents.
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? t("creating") : "Create workflow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />
    </div>
  );
}
