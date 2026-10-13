import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [billing, setBilling] = useState(null);
  const [billingLoading, setBillingLoading] = useState(Boolean(getToken()));

  async function refreshBilling() {
    const status = await api.getBillingStatus();
    setBilling(status);
    return status;
  }

  // On mount, if a token exists, try to use it. We have no /me endpoint,
  // so restore the cached user object saved at login/register time.
  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      if (!getToken()) {
        setLoading(false);
        setBillingLoading(false);
        return;
      }
      try {
        const cached = localStorage.getItem('stockroom-user');
        if (cached) {
          setUser(JSON.parse(cached));
          const status = await api.getBillingStatus();
          if (!cancelled) setBilling(status);
        } else {
          setToken(null);
        }
      } catch {
        setToken(null);
        localStorage.removeItem('stockroom-user');
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setBillingLoading(false);
        }
      }
    }
    restoreSession();
    return () => { cancelled = true; };
  }, []);

  // Logout when any request returns 401.
  useEffect(() => {
    function onUnauthorized() {
      localStorage.removeItem('stockroom-user');
      localStorage.removeItem('stockroom-chat');
      setUser(null);
      setBilling(null);
      setBillingLoading(false);
    }
    window.addEventListener('auth:unauthorized', onUnauthorized);
    function onBillingRequired() {
      setBillingLoading(true);
      api.getBillingStatus()
        .then(setBilling)
        .catch(() => setBilling(null))
        .finally(() => setBillingLoading(false));
    }
    window.addEventListener('billing:required', onBillingRequired);
    return () => {
      window.removeEventListener('auth:unauthorized', onUnauthorized);
      window.removeEventListener('billing:required', onBillingRequired);
    };
  }, []);

  async function login(email, password) {
    const { token, user: u } = await api.login(email, password);
    setToken(token);
    localStorage.setItem('stockroom-user', JSON.stringify(u));
    setUser(u);
    setBillingLoading(true);
    try { setBilling(await api.getBillingStatus()); }
    catch { setBilling(null); }
    finally { setBillingLoading(false); }
    return u;
  }

  async function signup(email, password) {
    const { token, user: u } = await api.register(email, password);
    setToken(token);
    localStorage.setItem('stockroom-user', JSON.stringify(u));
    setUser(u);
    setBillingLoading(true);
    try { setBilling(await api.getBillingStatus()); }
    catch { setBilling(null); }
    finally { setBillingLoading(false); }
    return u;
  }

  function logout() {
    setToken(null);
    localStorage.removeItem('stockroom-user');
    localStorage.removeItem('stockroom-chat');
    setUser(null);
    setBilling(null);
    setBillingLoading(false);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, billing, billingLoading, refreshBilling }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
