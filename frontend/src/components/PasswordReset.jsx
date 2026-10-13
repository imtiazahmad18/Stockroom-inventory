import { useState } from 'react';
import { api } from '../api.js';

export default function PasswordReset({ onBack }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (step === 'email') {
        const result = await api.requestPasswordReset(email);
        setNotice(result.message);
        setStep('code');
      } else if (step === 'code') {
        const result = await api.verifyPasswordResetCode(email, code);
        setResetToken(result.resetToken);
        setStep('password');
      } else {
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }
        const result = await api.resetPassword(resetToken, password);
        setNotice(result.message);
        setStep('complete');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const heading = {
    email: 'Reset your password',
    code: 'Enter your code',
    password: 'Choose a new password',
    complete: 'Password updated',
  }[step];

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark"><i className="ti ti-building-warehouse" aria-hidden="true" /></span>
          Stockroom
        </div>
        <h1>{heading}</h1>
        {error && <p className="auth-error">{error}</p>}
        {notice && <p className="auth-success">{notice}</p>}

        {step === 'email' && <>
          <p>We’ll email you a code that is valid for 10 minutes.</p>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
          <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
        </>}

        {step === 'code' && <>
          <p>Enter the 6-digit code sent to {email}.</p>
          <label>One-time code<input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" required /></label>
          <button type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify code'}</button>
        </>}

        {step === 'password' && <>
          <label>New password<input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required /></label>
          <label>Confirm new password<input type="password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required /></label>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</button>
        </>}

        {step === 'complete' && <button type="button" onClick={onBack}>Back to sign in</button>}
        {step !== 'complete' && <p className="auth-switch"><button type="button" onClick={onBack}>Back to sign in</button></p>}
      </form>
    </div>
  );
}
