// /builder/safety — the Builder's read-only Safety list per job (xprojman-48, SA
// ruling F7): the Builder holds safety.report, not safety.manage, so there's no
// detail, no incident data and no actions here. Reporting happens in the App.
'use client';

import { useEffect, useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi }   from '@/lib/api';
import { SafetyMockBanner, SafetyEventList } from '@/components/portal/SafetyViews';

export default function BuilderSafetyPage() {
  const projects = usePortalData(() => projectsApi.list());
  const list = projects.data?.data?.projects ?? [];
  const [projectId, setProjectId] = useState('');
  useEffect(() => { if (!projectId && list.length) setProjectId(list[0].id); }, [projectId, list]);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Safety</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
        What&apos;s been reported on your jobs. Report hazards and incidents from the App. The PM and Site Supervisor
        investigate and close them.
      </div>
      <SafetyMockBanner />
      {projects.error && <div style={{ marginBottom: 12 }}><PortalError message={projects.error} /></div>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <label style={{ fontSize: 13, color: 'var(--muted)' }} htmlFor="safety-project">Job</label>
        <select id="safety-project" className="input" style={{ minWidth: 260 }} value={projectId}
          onChange={(e) => setProjectId(e.target.value)} disabled={!list.length}>
          {!list.length && <option value="">{projects.loading ? 'Loading jobs…' : 'No engaged jobs yet'}</option>}
          {list.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ${p.name}` : p.name}</option>)}
        </select>
      </div>
      <PortalCard title="Hazards, near misses and incidents">
        {projectId ? <SafetyEventList projectId={projectId} /> : <PortalEmpty message="Pick a job." />}
      </PortalCard>
    </div>
  );
}
