// /projects/:id/payment-schedule — this project's client billing (xprojman-43 §6/§13): the
// milestone payment schedule (set at Job Award, sums to 100%, deposit capped by the site's
// state, readiness gates) and the progress claims raised against it. money.read; edits money.write.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, authApi } from '@/lib/api';
import { clientClaimsApi, seedMockProjects } from '@/lib/clientClaims';
import { ProjectTabs } from '../_ProjectTabs';
import {
  ClaimsMockBanner, ClaimTotals, ClaimTable, PaymentScheduleCard,
} from '@/components/portal/ClientClaimViews';

export default function PaymentSchedulePage() {
  const { id } = useParams();
  const project = usePortalData(() => projectsApi.detail(id), [id]);
  const perms = usePortalData(() => authApi.permissions());
  const list = perms.data?.data?.permissions || [];
  const proj = project.data?.data?.project;
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!proj) return;
    seedMockProjects([proj]);
    setErr(null);
    try {
      const res = await clientClaimsApi.list({ project_id: id });
      setData(res?.data?.data || null);
    } catch (e) { setErr(e?.response?.data?.message || e.message); }
  }, [id, proj]);
  useEffect(() => { load(); }, [load]);

  if (project.loading && !project.data) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (project.error) return <div style={{ padding: 20 }}><PortalError message={project.error} /></div>;
  if (!proj) return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;
  const canRead = list.includes('money.read');

  return (
    <div style={{ padding: 20, maxWidth: 1200 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{proj.code}</span>{'  '}{proj.name}
      </div>
      <ProjectTabs id={id} seesMoney={canRead} />
      {!canRead ? <PortalError message="Progress claims need the money.read permission." /> : (
        <>
          <ClaimsMockBanner />
          <ClaimTotals totals={data?.totals} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
            <PortalCard title="Progress claims to the client">
              {err ? <PortalError message={err} /> : !data ? <PortalEmpty message="Loading…" />
                : <ClaimTable rows={data.client_claims || []} />}
            </PortalCard>
            <PortalCard title="Payment schedule">
              <PaymentScheduleCard projectId={id} canWrite={list.includes('money.write')} onSaved={load} />
            </PortalCard>
          </div>
        </>
      )}
    </div>
  );
}
