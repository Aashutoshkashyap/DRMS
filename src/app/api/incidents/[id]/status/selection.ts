export type StatusTransition = { stageId: string; remark: string | null };

/** Validates a coordinator's explicit workflow-stage selection. */
export function parseStatusTransition(value: unknown): StatusTransition | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.stageId !== "string" || !body.stageId.trim()) return null;
  if (body.remark != null && typeof body.remark !== "string") return null;
  const remark = typeof body.remark === "string" ? body.remark.trim() : "";
  if (remark.length > 1000) return null;
  return { stageId: body.stageId.trim(), remark: remark || null };
}
