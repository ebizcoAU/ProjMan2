// ClaimWarnings.js — non-blocking server warnings from the envelope (`warnings[]`), e.g.
// DEPOSIT_CAP_UNVERIFIED, SOP_TEMPLATE_UNVERIFIED, RCTI_AGREEMENT_NO_DOCUMENT: shown, never enforced.
export function Warnings({ list }) {
  if (!list?.length) return null;
  return list.map((w) => (
    <div key={w.code + w.message} style={{ fontSize: 12, color: 'var(--text)', background: 'var(--s2)', borderLeft: '3px solid var(--amber)',
      borderRadius: 4, padding: '6px 10px', margin: '8px 0' }}>{w.message}</div>
  ));
}
