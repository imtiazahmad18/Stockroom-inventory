import { useState } from 'react';
import { useAuth } from '../AuthContext.jsx';

export default function Login({ onSwitch, onForgot }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="brand">
          <span className="brand-mark"><i className="ti ti-building-warehouse" aria-hidden="true" /></span>
          Stockroom
        </div>
        <h1>Sign in</h1>
        {error && <p className="auth-error">{error}</p>}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        <p className="auth-switch"><button type="button" onClick={onForgot}>Forgot password?</button></p>
        <p className="auth-switch">
          No account? <button type="button" onClick={onSwitch}>Create one</button>
        </p>
      </form>
    </div>
  );
}
