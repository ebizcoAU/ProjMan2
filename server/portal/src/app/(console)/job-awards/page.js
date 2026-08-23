// /job-awards — kept as the legacy URL so nothing bookmarked, or the console
// dashboard's "pending invitation" link (`(console)/dashboard/page.js`),
// breaks. The real content now lives in the Builder console at
// `/builder/job-awards` (portaldesignspec §2/§4.3 — Job Award response is
// Builder-only; a PM sends awards, never receives them). Same component both
// places — see components/portal/JobAwardInbox.js.
'use client';

import JobAwardInbox from '@/components/portal/JobAwardInbox';

export default function JobAwardInboxPage() {
  return <JobAwardInbox />;
}
