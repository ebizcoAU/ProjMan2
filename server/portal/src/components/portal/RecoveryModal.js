// Forgot-password modal (xprojman-26). Matches docs/assets/RecoveryScreen.png's
// shape: bold heading + Close, thin divider, secondary heading, one-time-password
// boxes split 3-3, a masked-email caption, and a "Resend in Ns" countdown pill.
// Three steps against POST /auth/recovery/{request,verify,reset} — same contract
// the app uses, just a web-shaped UI on top.
'use client';

import { useState, useRef, useEffect, Fragment } from 'react';
import { recoveryApi } from '@/lib/api';

const CODE_LEN = 6;
const RESEND_SECONDS = 30;

function maskEmail(e) {
  const [user, domain] = String(e || '').split('@');
  if (!domain) return e || '';
  return `${user[0]}${'*'.repeat(Math.max(user.length - 1, 3))}@${domain}`;
}

export default function RecoveryModal({ initialEmail = '', onClose, onResetComplete }) {
  const [step, setStep]         = useState('email'); // email | otp | reset | done
  const [email, setEmail]       = useState(initialEmail);
  const [digits, setDigits]     = useState(Array(CODE_LEN).fill(''));
  const [recoveryToken, setRecoveryToken] = useState(null);
  const [newPassword, setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError]       = useState(null);
  const [busy, setBusy]         = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const boxRefs = useRef([]);

  useEffect(() => {
    if (step !== 'otp' || resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [step, resendIn]);

  const requestCode = async (e) => {
    e?.preventDefault();
    setBusy(true); setError(null);
    try {
      await recoveryApi.request(email);
      setDigits(Array(CODE_LEN).fill(''));
      setResendIn(RESEND_SECONDS);
      setStep('otp');
      setTimeout(() => boxRefs.current[0]?.focus(), 50);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Could not send the code');
    } finally {
      setBusy(false);
    }
  };

  const setDigit = (i, val) => {
    const v = val.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (v && i < CODE_LEN - 1) boxRefs.current[i + 1]?.focus();
    if (next.every((d) => d) && next.join('').length === CODE_LEN) verifyCode(next.join(''));
  };

  const onKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) boxRefs.current[i - 1]?.focus();
  };

  const onPaste = (e) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LEN);
    if (!text) return;
    e.preventDefault();
    const next = Array(CODE_LEN).fill('');
    text.split('').forEach((d, i) => { next[i] = d; });
    setDigits(next);
    boxRefs.current[Math.min(text.length, CODE_LEN - 1)]?.focus();
    if (text.length === CODE_LEN) verifyCode(text);
  };

  const verifyCode = async (code) => {
    setBusy(true); setError(null);
    try {
      const { data } = await recoveryApi.verify(email, code);
      setRecoveryToken((data.data || data).recoveryToken);
      setStep('reset');
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'That code is not valid or has expired');
      setDigits(Array(CODE_LEN).fill(''));
      boxRefs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (resendIn > 0) return;
    setBusy(true); setError(null);
    try {
      await recoveryApi.request(email);
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Could not resend the code');
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 10) return setError('Password must be at least 10 characters');
    if (newPassword !== confirmPassword) return setError('Passwords do not match');
    setBusy(true);
    try {
      await recoveryApi.reset(recoveryToken, newPassword);
      setStep('done');
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Could not reset your password');
    } finally {
      setBusy(false);
    }
  };

  const heading    = step === 'reset' || step === 'done' ? 'New password' : 'Sign in';
  const subheading = step === 'email' ? 'Reset your password'
    : step === 'otp' ? 'Welcome back'
    : step === 'reset' ? 'Choose a new password'
    : 'All set';

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(22,32,46,.55)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 100,
    }}>
      <div style={{
        width: 420, maxWidth: '100%', background: 'var(--s1)', borderRadius: 16,
        border: '1px solid var(--b1)', boxShadow: '0 24px 70px rgba(0,0,0,.35)', padding: '28px 30px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            {heading}
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost btn" style={{ padding: '6px 10px', gap: 6 }}>
            &times; Close
          </button>
        </div>

        <div style={{ height: 1, background: 'var(--b1)', margin: '16px 0' }} />

        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--dim)', marginBottom: 16 }}>{subheading}</div>

        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 8, marginBottom: 14,
            background: 'var(--rdim)', border: '1px solid rgba(185,28,28,.45)', color: 'var(--red)', fontSize: 14,
          }}>{error}</div>
        )}

        {step === 'email' && (
          <form onSubmit={requestCode}>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 14 }}>
              Enter your account email and we&apos;ll send a 6-digit code.
            </p>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--dim)', marginBottom: 6 }}>Email</label>
            <input className="input" type="email" autoFocus value={email}
              onChange={(e) => setEmail(e.target.value)} required style={{ marginBottom: 18 }} />
            <button className="btn btn-primary" type="submit" disabled={busy}
              style={{ width: '100%', justifyContent: 'center', padding: '11px 16px' }}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {step === 'otp' && (
          <div>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 18 }}>
              Enter the 6-digit code we sent to your email ({maskEmail(email)}).
            </p>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
              One-Time Password
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }} onPaste={onPaste}>
              {digits.map((d, i) => (
                <Fragment key={i}>
                  <input
                    ref={(el) => (boxRefs.current[i] = el)}
                    className="input"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    disabled={busy}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => onKeyDown(i, e)}
                    style={{ width: 44, height: 52, textAlign: 'center', fontSize: 20, fontWeight: 800, fontFamily: 'var(--fm)', padding: 0 }}
                  />
                  {i === 2 && <span style={{ color: 'var(--muted)', fontWeight: 700 }}>&mdash;</span>}
                </Fragment>
              ))}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>Code sent to your email.</div>

            <button type="button" onClick={resend} disabled={resendIn > 0 || busy} className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'center', padding: '10px 16px', marginBottom: 14 }}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>

            <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
              Wrong email?{' '}
              <button type="button" onClick={() => setStep('email')} className="btn" style={{ background: 'none', padding: 0, color: 'var(--brand)', fontWeight: 700 }}>
                Go back
              </button>
            </div>
          </div>
        )}

        {step === 'reset' && (
          <form onSubmit={submitReset}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--dim)', marginBottom: 6 }}>New password</label>
            <input className="input" type="password" autoFocus autoComplete="new-password" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} required style={{ marginBottom: 14 }} />
            <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--dim)', marginBottom: 6 }}>Confirm password</label>
            <input className="input" type="password" autoComplete="new-password" value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)} required style={{ marginBottom: 18 }} />
            <button className="btn btn-primary" type="submit" disabled={busy}
              style={{ width: '100%', justifyContent: 'center', padding: '11px 16px' }}>
              {busy ? 'Resetting…' : 'Reset password'}
            </button>
          </form>
        )}

        {step === 'done' && (
          <div>
            <p style={{ fontSize: 14, color: 'var(--dim)', marginBottom: 20 }}>
              Your password has been reset. Sign in with your new password.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => onResetComplete?.(email)}
              style={{ width: '100%', justifyContent: 'center', padding: '11px 16px' }}>
              Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
