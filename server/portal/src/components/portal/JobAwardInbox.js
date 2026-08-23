// JobAwardInbox.js — the Builder's Job Award inbox (portaldesignspec §4.3, server
// xprojman-12). Identity-level, NOT project-scoped: an invitee can't reach the
// project until they accept, so this reads GET /job-awards/pending (status='sent',
// across the caller's org) and drives accept/decline through the project-scoped
// respond endpoint.
//
// Extracted out of the page component so it can render both under the Builder
// console (`/builder/job-awards`, where it belongs per the route-group table)
// and the legacy `/job-awards` URL (kept as a thin redirect target so nothing
// bookmarked or linked from the dashboard's "pending invitation" pill breaks).
//
// v1 coherence note (xprojman-17 Q2): Introduction + Job Award are same-org only, so this
// inbox only populates for a Builder provisioned INSIDE the PM's org. A self-registered
// Builder (own org, Fork A) can't be cross-org awarded until PM2-02 — their inbox reads empty.
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { jobAwardsApi }  from '@/lib/api';

const MODE_LABEL = {
  employee: 'Employee', independent_fixed: 'Fixed price', independent_cost_plus: 'Cost + margin',
};
const when = (d) => d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export default function JobAwardInbox() {
  const { data, loading, error, refetch } = usePortalData(() => jobAwardsApi.pending(), []);
  const [busy, setBusy]         = useState(null);   // `${jaId}:${accept}`
  const [actionError, setError] = useState(null);

  const pending = data?.data?.pending || [];

  const respond = async (award, accept) => {
    setBusy(`${award.id}:${accept}`); setError(null);
    try { await jobAwardsApi.respond(award.project_id, award.id, accept); await refetch(); }
    catch (err) { setError(err?.response?.data?.message || err.message); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ padding: 20, maxWidth: 860 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        Job invitations
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>
        Pending Job Awards inviting you onto a project. Accepting enrols you; declining dismisses it.
      </div>

      {actionError && <div style={{ marginBottom: 12 }}><PortalError message={actionError} /></div>}

      {loading ? <PortalEmpty message="Loading…" />
      : error ? <PortalError message={error} />
      : pending.length === 0 ? (
        <PortalCard title="Inbox">
          <PortalEmpty message="No pending invitations. When a PM awards you onto a project, it appears here." />
        </PortalCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pending.map((a) => (
            <PortalCard key={a.id}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                    {a.project_name || 'A project'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>
                    <strong style={{ color: 'var(--dim)' }}>{a.from_name || 'A manager'}</strong> invited you as{' '}
                    <strong style={{ color: 'var(--brand)' }}>{a.role_offered}</strong>
                    {a.builder_engagement_type ? ` · ${MODE_LABEL[a.builder_engagement_type] || a.builder_engagement_type}` : ''}
                    {a.sent_at ? ` · ${when(a.sent_at)}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" disabled={!!busy}
                    onClick={() => respond(a, true)}
                    style={{ padding: '8px 18px' }}>
                    {busy === `${a.id}:true` ? 'Accepting…' : 'Accept'}
                  </button>
                  <button className="btn" disabled={!!busy}
                    onClick={() => respond(a, false)}
                    style={{ padding: '8px 18px' }}>
                    {busy === `${a.id}:false` ? 'Declining…' : 'Decline'}
                  </button>
                </div>
              </div>
            </PortalCard>
          ))}
        </div>
      )}
    </div>
  );
}
