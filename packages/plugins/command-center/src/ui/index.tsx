/**
 * UI bundle entry. The manifest's page slot references `CommandCenterPage` by
 * exportName; the host mounts it at /command-center.
 */
import React from "react";
import { CeoChat } from "./CeoChat";

/**
 * Page slot entry. The host passes a context (companyId) to plugin pages; read it
 * defensively from whichever shape arrives so the chat can scope its API calls.
 * Loosely typed on purpose to avoid pulling the SDK's strict transitive source
 * into this package's typecheck.
 */
export function CommandCenterPage(props: { companyId?: string | null; context?: { companyId?: string | null } }) {
  const companyId = props?.companyId ?? props?.context?.companyId ?? null;
  return <CeoChat companyId={companyId} />;
}

export default CommandCenterPage;
