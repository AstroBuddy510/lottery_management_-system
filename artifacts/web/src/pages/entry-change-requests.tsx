import { ChangeRequestsPanel } from "@/components/change-requests-panel";

/**
 * Agents' own change requests. Administrators and directors review the same
 * requests from Settings → Change Requests; the route sends them there.
 */
export function EntryChangeRequests() {
  return (
    <div className="p-4 sm:p-6">
      <ChangeRequestsPanel variant="agent" />
    </div>
  );
}
