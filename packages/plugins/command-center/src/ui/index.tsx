/**
 * UI bundle entry. The manifest's page slot references `CommandCenterPage` by
 * exportName; the host mounts it at /command-center.
 */
import React from "react";
import { CeoChat } from "./CeoChat";

export function CommandCenterPage() {
  return <CeoChat />;
}

export default CommandCenterPage;
