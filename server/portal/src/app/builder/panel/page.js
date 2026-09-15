// /builder/panel — Builder's own Tradie/Foreperson panel (xprojman-44 Module A + B,
// portaldesignspec §3.4 module 6, §4.3 "Panel management (his own)"). Sending a Job
// Award here produces an accepted subcontractor engagement's project_members row
// today; the pass-through-consent register bridge (xprojman-44 Module C) is a
// separate, not-yet-built server piece — this screen doesn't depend on it.
'use client';

import { PanelView } from '@/components/portal/PanelView';

export default function BuilderPanelPage() {
  return (
    <PanelView
      filter="tradieForeperson"
      sendAs="subcontractor"
      title="Panel — your crew"
      emptyMessage="No Tradie/Foreperson contacts yet — Introduction happens on the App (QR scan or code)."
    />
  );
}
