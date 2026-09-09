// /builder/programme — project picker for the Builder's own Programme/Line-of-
// Balance editor (portaldesignspec §4.3, group-01.md §5, due 2026-09-04).
// `projectsApi.list()` is already scoped server-side to the Builder's own
// `assigned` engagements (project_members, lib/scope.js `projectScope`) — no
// client-side filtering needed, whatever comes back is his.
'use client';

import Link from 'next/link';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi }   from '@/lib/api';
import { PROJECT_STATUS_BADGE as STATUS_BADGE } from '@/components/portal/projectStatus';

export default function BuilderProgrammePage() {
  const { data, loading, error } = usePortalData(() => projectsApi.list());
  const projects = data?.data?.projects ?? [];

  return (
    <div style={{ padding: 20, maxWidth: 1000 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        Programme
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>
        Your own Line-of-Balance schedule, Stages 9–18. Pick a job to open its programme —
        this is your authored plan; the PM's view of it is a read, full stop.
      </div>

      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}

      <PortalCard title="Your jobs">
        {loading ? (
          <PortalEmpty message="Loading…" />
        ) : projects.length === 0 ? (
          <PortalEmpty message="No engaged jobs yet. Once a Job Award is accepted, it appears here." />
        ) : (
          <PortalTable
            headers={['Code', 'Name', 'Site', 'Status']}
            rows={projects.map((p) => [
              <Link key="c" href={`/builder/programme/${p.id}`}
                style={{ fontFamily: 'var(--fm)', color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>
                {p.code}
              </Link>,
              <Link key="n" href={`/builder/programme/${p.id}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>
                {p.name}
              </Link>,
              p.site_address || '—',
              <span key="s" className={`badge ${STATUS_BADGE[p.status] || 'badge-muted'}`}>{p.status}</span>,
            ])}
          />
        )}
      </PortalCard>
    </div>
  );
}
