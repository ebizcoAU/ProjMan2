// /panel — PM's Builder panel (xprojman-44 Module A + B, portaldesignspec §3.4 module 6).
'use client';

import { PanelView } from '@/components/portal/PanelView';

export default function PmPanelPage() {
  return (
    <PanelView
      filter="builder"
      sendAs="builder"
      title="Panel — Builders"
      emptyMessage="No Builder contacts yet — Introduction happens on the App (QR scan or code)."
    />
  );
}
