// /admin/login — System Admin sign-in. Separate entry page from the tenant Portal's
// /login, but the SAME identity/auth underneath (one JWT, one POST /auth/login) —
// this is a different front door, not a second auth system. After authenticating,
// confirms the account actually holds a `platform_admins` row before entering;
// a valid tenant login that isn't a platform admin gets a clear message here rather
// than a silent bounce, and keeps its session (still usable at the tenant /login).
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, adminApi, setSession } from '@/lib/api';

export default function AdminLoginPage() {
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
      setSession({ accessToken: d.accessToken, refreshToken: d.refreshToken, user: d.user });

      try {
        await adminApi.me();
      } catch {
        setError('This account does not have System Admin access. Use the office console at /login instead.');
        setBusy(false);
        return;
      }
      router.replace('/admin');
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Sign-in failed');
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <form onSubmit={submit} style={{
        width: 380, maxWidth: '100%',
        background: 'var(--s1)', border: '2px solid var(--b1)', borderRadius: 16,
        padding: '32px 28px', boxShadow: '0 20px 60px rgba(0,0,0,.25)',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <div style={{
            width: 60, height: 60, borderRadius: 10,
            background: 'var(--bluedim)', border: '1px solid rgba(29,78,216,.28)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="ProjMan" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 20, color: 'var(--text)', lineHeight: 1.1 }}>
              ProjMan
            </div>
            <div style={{ fontSize: 12, color: 'var(--blue)', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700 }}>
              System Admin
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
          Platform operations only. Tenant sign-in is at <a href="/login" style={{ color: 'var(--blue)' }}>/login</a>.
        </div>
      </form>
    </div>
  );
}
