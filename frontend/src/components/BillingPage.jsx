import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

export default function BillingPage() {
  const { user, logout, billing, refreshBilling } = useAuth();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const query = new URLSearchParams(window.location.search);
  const returnedFromCheckout = query.get('billing') === 'success';
  const checkoutCancelled = query.get('billing') === 'cancelled';

  async function beginCheckout() {
    setError('');
    setBusy(true);
    try {
      const { checkoutUrl } = await api.startBillingCheckout();
      window.location.assign(checkoutUrl);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function checkPayment() {
    setChecking(true);
    setError('');
    try {
      await refreshBilling();
      window.history.replaceState({}, '', window.location.pathname);
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-card billing-card">
        <div className="brand">Stockroom</div>
        <p className="billing-eyebrow">SUBSCRIPTION</p>
        <h1>Unlock your shop workspace</h1>
        <p className="billing-description">
          Your account is ready, {user?.email}. Subscribe to use products, sales, stock tracking, and reports.
        </p>
        <div className="billing-price"><strong>$10</strong><span>USD per month</span></div>
        <ul className="billing-features">
          <li>Inventory and stock management</li>
          <li>Sales tracking and business reports</li>
          <li>Recurring monthly billing through Safepay</li>
        </ul>
        {billing?.currentPeriodEnd && billing.status !== 'inactive' && (
          <p className="billing-description">Subscription status: {billing.status}. Access is checked securely with Safepay.</p>
        )}
        {returnedFromCheckout && <p className="auth-success">We’re confirming your payment. Access opens after Safepay notifies the server.</p>}
        {checkoutCancelled && <p className="auth-error">Checkout was cancelled. You can try again when you’re ready.</p>}
        {error && <p className="auth-error">{error}</p>}
        <button type="button" onClick={beginCheckout} disabled={busy}>
          {busy ? 'Opening secure checkout…' : 'Subscribe for $10/month'}
        </button>
        {returnedFromCheckout && (
          <button className="billing-secondary" type="button" onClick={checkPayment} disabled={checking}>
            {checking ? 'Checking…' : 'I’ve paid — check access'}
          </button>
        )}
        <button className="billing-link" type="button" onClick={logout}>Sign out</button>
      </section>
    </div>
  );
}
