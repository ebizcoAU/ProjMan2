// /builder/job-awards — Job Award response (portaldesignspec §4.3): "Introduction
// with PM may have happened long before; the Portal shows the formal invitation
// (S9.6) landing here for Builder to review and accept/decline (S9.7)." Same
// component as the legacy `/job-awards` URL — see components/portal/JobAwardInbox.js.
'use client';

import JobAwardInbox from '@/components/portal/JobAwardInbox';

export default function BuilderJobAwardsPage() {
  return <JobAwardInbox />;
}
