// /login — office console sign-in. Email + password against POST /auth/login.
// A rewrite, not a port: the Nexus portal login was CCCD + PIN + QR; ProjMan2 is
// email/password (OAuth buttons come with the app team's provider IDs later).
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, setSession } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState(null);
  const [busy, setBusy]         = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await authApi.login(email, password);
      const d = data.data || data;
      setSession({
        accessToken: d.accessToken,
        refreshToken: d.refreshToken,
        user: d.user,
      });
      router.replace('/devices');
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Sign-in failed');
      setBusy(false);
    }
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
        {/* Brand */}
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
              Office Console
            </div>
          </div>
        </div>

        <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--dim)', marginBottom: 6 }}>
          Email
        </label>
        <input
          className="input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ marginBottom: 14 }}
        />

        <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--dim)', marginBottom: 6 }}>
          Password
        </label>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ marginBottom: 18 }}
        />

        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 8, marginBottom: 14,
            background: 'var(--rdim)', border: '1px solid rgba(185,28,28,.45)',
            color: 'var(--red)', fontSize: 14,
          }}>
            {error}
          </div>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy}
          style={{ width: '100%', justifyContent: 'center', padding: '11px 16px' }}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>

        <div style={{ marginTop: 16, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
          New here? <a href="/signup" style={{ color: 'var(--brand)' }}>Create an account</a>
        </div>
      </form>
    </div>
  );
}
