// /projects/:id/safety — the project's Safety/OHS desk view (xprojman-48 §5 Portal).
// Events (investigate, respond, close, notifiable), the inductions register, and
// the safety document register with SWMS sign-on status. safety.manage (PM, Site
// Supervisor) gets all of it; anyone else with project access gets the events
// list only (no detail, no incident data), matching what the server returns.
'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, authApi } from '@/lib/api';
import { ProjectTabs } from '../_ProjectTabs';
import {
  SafetyMockBanner, SafetyEventList, SafetyEventDetail, InductionsRegister, SafetyRegister,
} from '@/components/portal/SafetyViews';

const SECTIONS = [
  { k: 'events', label: 'Events' },
  { k: 'inductions', label: 'Inductions' },
  { k: 'register', label: 'Register' },
];

export default function ProjectSafetyPage() {
  const { id } = useParams();
  const project = usePortalData(() => projectsApi.detail(id), [id]);
  const perms = usePortalData(() => authApi.permissions());
  const canManage = (perms.data?.data?.permissions || []).includes('safety.manage');
  const [section, setSection] = useState('events');
  const [selected, setSelected] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  if (project.loading && !project.data) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (project.error) return <div style={{ padding: 20 }}><PortalError message={project.error} /></div>;
  const proj = project.data?.data?.project;
  if (!proj) return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;
  const stages = project.data?.data?.stages || [];
  const seesMoney = stages.some((st) => 'estimated_amount' in st) || 'contract_value' in proj;

  return (
    <div style={{ padding: 20, maxWidth: 1200 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{proj.code}</span>{'  '}{proj.name}
      </div>
      <ProjectTabs id={id} seesMoney={seesMoney} />
      <SafetyMockBanner />

      {canManage && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {SECTIONS.map((s) => (
            <button key={s.k} className={`btn ${section === s.k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSection(s.k)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {section === 'events' && (
        <div style={{ display: 'grid', gridTemplateColumns: selected && canManage ? 'minmax(0,1fr) minmax(0,1fr)' : '1fr', gap: 16 }}>
          <PortalCard title="Hazards, near misses and incidents">
            <SafetyEventList projectId={id} reloadKey={reloadKey} selectedId={selected}
              onOpen={canManage ? (eid) => setSelected(eid === selected ? null : eid) : undefined} />
          </PortalCard>
          {selected && canManage && (
            <PortalCard title="Investigate">
              <SafetyEventDetail eventId={selected} onClose={() => setSelected(null)}
                onChanged={() => setReloadKey((k) => k + 1)} />
            </PortalCard>
          )}
        </div>
      )}
      {section === 'inductions' && canManage && (
        <PortalCard title="Site inductions"><InductionsRegister projectId={id} /></PortalCard>
      )}
      {section === 'register' && canManage && (
        <PortalCard title="Safety register"><SafetyRegister projectId={id} /></PortalCard>
      )}
    </div>
  );
}
