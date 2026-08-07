// /login — "Log in with ProjMan" (spec §4). There is no VeriTrade password, for
// anyone. The browser mints a session QR, the person scans it with the ProjMan App
// and approves/denies, and this page polls until that resolves, then redeems a
// normal session token pair — exactly the App-mediated model the whole product's
// auth rests on.
//
// The App's own "Scan to sign in" screen doesn't exist yet (a separate team's
// build). NEXT_PUBLIC_VERITRADE_DEV_LOGIN=true shows a dev-only panel that plays
// the App's part over plain HTTP, so this flow is testable end to end today —
// never enabled in production (see .env.example).
'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import VtHeader from '@/components/VtHeader';
import api, { setSession } from '@/lib/api';

const DEV_LOGIN = process.env.NEXT_PUBLIC_VERITRADE_DEV_LOGIN === 'true';
const POLL_MS = 2000;

function LoginFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';

  const [session, setSessionState] = useState(null); // { session_id, code, expires_at }
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [status, setStatus] = useState('starting'); // starting|pending|approved|denied|expired|error
  const pollRef = useRef(null);

  const [devEmail, setDevEmail] = useState('');
  const [devPassword, setDevPassword] = useState('');
  const [devToken, setDevToken] = useState(null);
  const [devBusy, setDevBusy] = useState(false);
  const [devError, setDevError] = useState(null);

  const start = async () => {
    setStatus('starting');
    try {
      const { data } = await api.login.initiate();
      const s = data.data;
      setSessionState(s);
      // The App's own scan target — the exact deep-link scheme is the App team's
      // to define; this is a reasonable placeholder shape carrying what an
      // approval needs (session id + code), not a finalised contract.
      const deepLink = `projman://veritrade-login?session_id=${s.session_id}&code=${encodeURIComponent(s.code)}`;
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
        const { data } = await api.login.status(session.session_id, session.code);
        const s = data.data;
        if (s.status === 'approved' && s.access_token) {
          clearInterval(pollRef.current);
          setSession({ accessToken: s.access_token, refreshToken: s.refresh_token });
          const me = await api.me.me().catch(() => null);
          if (me?.data?.data?.user) setSession({ accessToken: s.access_token, user: me.data.data.user });
          setStatus('approved');
          router.replace(next);
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

  const devSignIn = async (e) => {
    e.preventDefault();
    setDevBusy(true); setDevError(null);
    try {
      const { data } = await api.devAuth.login(devEmail, devPassword);
      setDevToken(data.data.accessToken);
    } catch (err) {
      setDevError(err.response?.data?.message || 'Sign-in failed');
    } finally {
      setDevBusy(false);
    }
  };

  const devApprove = async () => {
    if (!session || !devToken) return;
    setDevBusy(true); setDevError(null);
    try {
      const { status: httpStatus, data } = await api.login.devApprove(session.session_id, session.code, devToken);
      if (httpStatus >= 400) setDevError(data.message || 'Approve failed');
    } catch {
      setDevError('Approve failed');
    } finally {
      setDevBusy(false);
    }
  };

  return (
    <div>
      <VtHeader />
      <div style={{ maxWidth: 420, margin: '48px auto', padding: '0 20px' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--fh)', fontWeight: 700, fontSize: 22, marginBottom: 6 }}>Log in with ProjMan</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 20 }}>
            Open the ProjMan App → Profile → &ldquo;Scan to sign in&rdquo;, then approve this request.
          </p>

          {status === 'starting' && <div style={{ padding: 40, color: 'var(--muted)' }}>Generating your sign-in code…</div>}

          {status === 'pending' && qrDataUrl && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="Scan with the ProjMan App to sign in" width={240} height={240}
                style={{ margin: '0 auto', border: '1px solid var(--b1)', borderRadius: 8 }} />
              <div style={{ marginTop: 14, fontSize: 13, color: 'var(--muted)' }}>Waiting for approval…</div>
            </>
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

        {DEV_LOGIN && status === 'pending' && (
          <div className="card" style={{ marginTop: 16, borderStyle: 'dashed' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--yellow)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
              Dev only — stands in for the App
            </div>
            {!devToken ? (
              <form onSubmit={devSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input className="input" placeholder="ProjMan email" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} />
                <input className="input" placeholder="Password" type="password" value={devPassword} onChange={(e) => setDevPassword(e.target.value)} />
                <button className="btn btn-ghost" type="submit" disabled={devBusy}>Sign in as this App user</button>
              </form>
            ) : (
              <button className="btn btn-primary" onClick={devApprove} disabled={devBusy} style={{ width: '100%', justifyContent: 'center' }}>
                Approve this login
              </button>
            )}
            {devError && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--red)' }}>{devError}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: 'var(--muted)' }}>Loading…</div>}>
      <LoginFlow />
    </Suspense>
  );
}
