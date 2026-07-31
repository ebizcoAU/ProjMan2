// /signup — Self-Registration (portaldesignspec §2 route group, server xprojman-14 Fork A).
// A person self-registers, FOUNDING their own org, choosing their one fixed role. v1 allow-
// list is {projectManager, builder, developer}; this form surfaces Builder + Project Manager.
// A registrant is their org's owner (is_org_owner) — shown on success — which is what confers
// org-admin, decoupled from the fixed role (so a Builder runs their own org without a PM role).
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi, setSession } from '@/lib/api';

const ROLES = [
  { value: 'builder',        label: 'Builder — I run building work and engage my own crew' },
  { value: 'projectManager', label: 'Project Manager — I manage projects and engage builders' },
];

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--dim)', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ full_name: '', email: '', password: '', org_name: '', abn: '', role: 'builder' });
  const [error, setError] = useState(null);
  const [busy, setBusy]   = useState(false);
  const [done, setDone]   = useState(null);   // the registered user on success

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { data } = await authApi.register({
        organisation: { name: form.org_name, ...(form.abn ? { abn: form.abn } : {}) },
        user: { full_name: form.full_name, email: form.email, password: form.password, role: form.role },
      });
      const d = data.data || data;
      setSession({ accessToken: d.accessToken, refreshToken: d.refreshToken, user: d.user });
      setDone(d.user);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Registration failed');
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
      <div style={{
        width: 420, maxWidth: '100%', background: 'var(--s1)', border: '2px solid var(--b1)',
        borderRadius: 16, padding: '32px 28px', boxShadow: '0 20px 60px rgba(0,0,0,.45)',
      }}>
        <div style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 22, color: 'var(--text)', marginBottom: 4 }}>
          {done ? 'Welcome to ProjMan' : 'Create your account'}
        </div>

        {done ? (
          <>
            <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 18 }}>
              Your organisation is set up and you own it.
            </div>
            <div style={{ background: 'var(--s2)', border: '1px solid var(--b1)', borderRadius: 10, padding: 16, marginBottom: 18 }}>
              <Row label="Name" value={done.fullName} />
              <Row label="Role" value={<span style={{ color: 'var(--brand)', fontWeight: 700 }}>{done.role}</span>} />
              <Row label="Org owner" value={done.isOrgOwner
                ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>Yes — you administer this org</span>
                : <span style={{ color: 'var(--muted)' }}>No</span>} />
            </div>
            <button className="btn btn-primary" onClick={() => router.replace('/projects')}
              style={{ width: '100%', justifyContent: 'center', padding: '11px 16px' }}>
              Enter console
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>
              You’ll found your own organisation and hold one fixed role.
            </div>
            <Field label="Your full name">
              <input className="input" value={form.full_name} onChange={set('full_name')} required />
            </Field>
            <Field label="Email">
              <input className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
            </Field>
            <Field label="Password">
              <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required />
            </Field>
            <Field label="I am a…">
              <select className="input" value={form.role} onChange={set('role')}>
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Business name">
              <input className="input" value={form.org_name} onChange={set('org_name')} required
                placeholder={form.role === 'builder' ? 'Your building business' : 'Your company'} />
            </Field>
            <Field label="ABN (optional)">
              <input className="input" value={form.abn} onChange={set('abn')} placeholder="11 digits" />
            </Field>

            {error && (
              <div style={{ padding: '10px 12px', borderRadius: 8, marginBottom: 14,
                background: 'var(--rdim)', border: '1px solid rgba(185,28,28,.45)', color: 'var(--red)', fontSize: 14 }}>
                {error}
              </div>
            )}

            <button className="btn btn-primary" type="submit" disabled={busy}
              style={{ width: '100%', justifyContent: 'center', padding: '11px 16px' }}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
            <div style={{ marginTop: 16, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
              Already have an account? <Link href="/login" style={{ color: 'var(--brand)' }}>Sign in</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 14 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  );
}
