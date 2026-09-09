// Shared project-status badge map (xprojman-35). Single source so the enum only
// needs updating in one place — the badge map fell out of sync with the real enum
// once already (builder/programme/page.js still had 'archived' after the server
// renamed that slot to 'inactive').
export const PROJECT_STATUS_BADGE = {
  draft: 'badge-muted',
  active: 'badge-active',
  on_hold: 'badge-pending',
  completed: 'badge-muted',
  inactive: 'badge-muted',
  cancelled: 'badge-revoked',
};

export const PROJECT_STATUS_LABEL = {
  draft: 'Draft',
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
  inactive: 'Inactive',
  cancelled: 'Cancelled',
};
