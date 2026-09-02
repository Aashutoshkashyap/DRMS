"use client";

import type { Deal, PipelineStage } from "@/types";
import { AlertTriangle, MapPin, Paperclip, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;
  const assignmentLabel = deal.assigned_team || deal.assigned_resource || assigneeLabel;
  const requiresAssignment = deal.incident_status === "verified" && !deal.assigned_to && !deal.assigned_team && !deal.assigned_resource && !deal.assigned_team_id && !deal.assigned_vehicle_id && !deal.assigned_location_id && !deal.assigned_inventory_id;
  const evidence = deal.evidence ?? [];
  const primaryEvidence = evidence[0] ?? null;

  function openDetails() {
    if (!isOverlay) onEdit(deal);
  }

  return (
    <div
      role="button"
      tabIndex={isOverlay ? -1 : 0}
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        openDetails();
      }}
      onKeyDown={(event) => {
        if (isOverlay || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        openDetails();
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {deal.request_id || deal.title}
        </h4>
        <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${deal.priority === 'critical' ? 'bg-red-500/15 text-red-400' : deal.priority === 'high' ? 'bg-amber-500/15 text-amber-500' : 'bg-muted text-muted-foreground'}`}>{deal.priority.toUpperCase()}</span>
      </div>

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
      </div>

      <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        {deal.location && <span className="flex items-center gap-1 truncate"><MapPin className="h-3 w-3 shrink-0" />{deal.location}</span>}
      </div>

      {primaryEvidence && !isOverlay && (
        <a
          href={`/api/evidence/${primaryEvidence.message_id}`}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        >
          {primaryEvidence.media_type?.startsWith("audio/") ? <Volume2 className="h-3 w-3" /> : <Paperclip className="h-3 w-3" />}
          Open {primaryEvidence.media_type?.startsWith("audio/") ? "voice memo" : "photo"}{evidence.length > 1 ? ` (${evidence.length})` : ""}
        </a>
      )}

      {assignmentLabel && <p className="mt-2 truncate text-[11px] text-primary">Assigned: {assignmentLabel}</p>}
      {requiresAssignment && <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3 w-3" />Follow-up required: assign response</p>}
    </div>
  );
}
