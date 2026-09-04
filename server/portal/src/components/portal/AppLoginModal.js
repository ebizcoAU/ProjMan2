// "Sign in with the ProjMan App" (xprojman-31) — generalizes VeriTrade's own
// "Scan to sign in" (xprojman-25) to a second product. The browser mints a session
// QR here, the person scans it with the ProjMan App and approves/denies, this modal
// polls until that resolves, then hands the token pair back to /login's own
// `enter()` — same setSession()+role-redirect path the password/Google flows
// already use. Additive: this sits alongside the existing form, never replaces it
// (xprojman-31 §3/§4 item 3 — Portal Agent's call to keep both).
'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { appLoginApi } from '@/lib/api';

const POLL_MS = 2000;

export default function AppLoginModal({ onClose, onApproved }) {
  const [session, setSession] = useState(null); // { session_id, code, expires_at }
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [status, setStatus] = useState('starting'); // starting|pending|approved|denied|expired|error
  const pollRef = useRef(null);

  const start = async () => {
    setStatus('starting');
    try {
      const { data } = await appLoginApi.initiate();
      const s = data.data;
      setSession(s);
      const deepLink = `projman://app-login?session_id=${s.session_id}&code=${encodeURIComponent(s.code)}&product=portal`;
      setQrDataUrl(await QRCode.toDataURL(deepLink, { width: 240, margin: 1 }));
      setStatus('pending');
    } catch {
      setStatus('error');
    }
  };

  useEffect(() => { start(); return () => clearInterval(pollRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status !== 'pending' || !session) return;
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await appLoginApi.status(session.session_id, session.code);
        const s = data.data;
        if (s.status === 'approved' && s.access_token) {
          clearInterval(pollRef.current);
          setStatus('approved');
          onApproved({ accessToken: s.access_token, refreshToken: s.refresh_token });
        } else if (s.status === 'denied' || s.status === 'expired') {
          clearInterval(pollRef.current);
          setStatus(s.status);
        }
      } catch {
        // A transient poll failure isn't fatal — keep polling until expiry.
      }
    }, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [status, session]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(22,32,46,.55)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 100,
    }}>
      <div style={{
        width: 380, maxWidth: '100%', background: 'var(--s1)', borderRadius: 16,
        border: '1px solid var(--b1)', boxShadow: '0 24px 70px rgba(0,0,0,.35)', padding: '28px 30px',
        textAlign: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={{ fontFamily: 'var(--fh)', fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            Sign in with the App
          </h2>
          <button type="button" onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--muted)', cursor: 'pointer', lineHeight: 1 }}>
            &times;
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>
          Open the ProjMan App &rarr; Profile &rarr; &ldquo;Scan to sign in&rdquo;, then approve this request.
        </p>

        {status === 'starting' && <div style={{ padding: 40, color: 'var(--muted)' }}>Generating your sign-in code&hellip;</div>}

        {status === 'pending' && qrDataUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="Scan with the ProjMan App to sign in" width={240} height={240}
              style={{ margin: '0 auto', border: '1px solid var(--b1)', borderRadius: 8 }} />
            <div style={{ marginTop: 14, fontSize: 13, color: 'var(--muted)' }}>Waiting for approval&hellip;</div>
          </>
        )}

        {status === 'approved' && (
          <div style={{ padding: '20px 0', color: 'var(--muted)' }}>Signed in &mdash; redirecting&hellip;</div>
        )}
        {status === 'denied' && (
          <div style={{ padding: '20px 0' }}>
            <p style={{ color: 'var(--red)', marginBottom: 12 }}>This sign-in request was denied.</p>
            <button className="btn btn-primary" onClick={start}>Try again</button>
          </div>
        )}
        {status === 'expired' && (
          <div style={{ padding: '20px 0' }}>
            <p style={{ color: 'var(--muted)', marginBottom: 12 }}>This code expired.</p>
            <button className="btn btn-primary" onClick={start}>Get a new code</button>
          </div>
        )}
        {status === 'error' && (
          <div style={{ padding: '20px 0' }}>
            <p style={{ color: 'var(--red)', marginBottom: 12 }}>Couldn&rsquo;t start a sign-in request.</p>
            <button className="btn btn-primary" onClick={start}>Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}
