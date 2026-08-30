/** Invoke the authenticated coordinator endpoint after a CRM status change.
 * A failed delivery does not roll back the coordinator's database action. */
export async function requestIncidentStatusNotification(dealId: string): Promise<boolean> {
  const response = await fetch(`/api/incidents/${dealId}/status-notification`, { method: "POST" });
  return response.ok;
}
