// /login — Portal sign-in. Email + password (POST /auth/login) OR Google (POST
// /auth/oauth/google). A user who signed up on the app with Google has NO password, so
// the Google button is how they reach the Portal — the server matches the same identity
// by provider sub or email (migration_v002).
//
// Google on web uses Google Identity Services (GIS) when a web client id is configured
// (NEXT_PUBLIC_GOOGLE_CLIENT_ID — must be one of the server's GOOGLE_CLIENT_IDS). In dev
// (no web client id, OAUTH_DEV_BYPASS=true) it falls back to the dev-bypass token, which
// the server resolves to the same user by email.
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, setSession } from '@/lib/api';
import RecoveryModal from '@/components/portal/RecoveryModal';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState(null);
  const [busy, setBusy]         = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  const enter = (d) => {
    setSession({ accessToken: d.accessToken, refreshToken: d.refreshToken, user: d.user });
    router.replace('/projects');
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { data } = await authApi.login(email, password);
      enter(data.data || data);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Sign-in failed');
      setBusy(false);
    }
  };

  const oauthLogin = async (provider, token) => {
    setBusy(true); setError(null);
    try {
      const { data } = await authApi.oauth(provider, token);
      enter(data.data || data);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Google sign-in failed');
      setBusy(false);
    }
  };

  // Real Google sign-in via GIS when a web client id is configured.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp) => oauthLogin('google', resp.credential),
      });
      const el = document.getElementById('g_btn');
      if (el) window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', width: 324 });
    };
    document.body.appendChild(script);
    return () => { script.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Dev fallback: no web client id → drive the server's OAUTH_DEV_BYPASS with the email.
  const devGoogle = () => {
    const e = email || window.prompt('Dev Google sign-in — enter the email you used on the app:');
    if (!e) return;
    oauthLogin('google', `dev:google:${e}:${e.split('@')[0]}`);
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundImage: 'linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.35)), url(/bgimage2.jpeg)',
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <form onSubmit={submit} style={{
        width: 380, maxWidth: '100%',
        background: 'var(--s1)', border: '2px solid var(--b1)', borderRadius: 16,
        padding: '32px 28px', boxShadow: '0 20px 60px rgba(0,0,0,.45)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <div style={{
            width: 70, height: 60, borderRadius: 10,
            background: 'var(--bdim)', border: '1px solid rgba(194,65,12,.28)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="ProjMan" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 20, color: 'var(--text)', lineHeight: 1.1 }}>
              ProjMan
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
              Portal
            </div>
          </div>
        </div>

        <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--dim)', marginBottom: 6 }}>Email</label>
        <input className="input" type="email" autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} required style={{ marginBottom: 14 }} />

        <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--dim)', marginBottom: 6 }}>Password</label>
        <input className="input" type="password" autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} required style={{ marginBottom: 8 }} />

        <div style={{ textAlign: 'right', marginBottom: 18 }}>
          <button type="button" onClick={() => setShowRecovery(true)}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: 'var(--brand)', fontWeight: 600, cursor: 'pointer' }}>
            Forgot password?
          </button>
        </div>

        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 8, marginBottom: 14,
            background: 'var(--rdim)', border: '1px solid rgba(185,28,28,.45)', color: 'var(--red)', fontSize: 14,
          }}>{error}</div>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy}
          style={{ width: '100%', justifyContent: 'center', padding: '11px 16px' }}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--b1)' }} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--b1)' }} />
        </div>

        {/* Google */}
        {GOOGLE_CLIENT_ID ? (
          <div id="g_btn" style={{ display: 'flex', justifyContent: 'center' }} />
        ) : (
          <button type="button" className="btn" onClick={devGoogle} disabled={busy}
            style={{ width: '100%', justifyContent: 'center', padding: '11px 16px', gap: 8 }}>
            <span style={{ fontWeight: 700, color: '#4285F4' }}>G</span> Sign in with Google
          </button>
        )}
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
          Signed up on the app with Google? Use the Google button — no password needed.
        </div>

        <div style={{ marginTop: 16, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
          New here? <a href="/signup" style={{ color: 'var(--brand)' }}>Create an account</a>
        </div>
      </form>

      {showRecovery && (
        <RecoveryModal
          initialEmail={email}
          onClose={() => setShowRecovery(false)}
          onResetComplete={(resetEmail) => {
            setShowRecovery(false);
            setEmail(resetEmail);
            setPassword('');
          }}
        />
      )}
    </div>
  );
}
