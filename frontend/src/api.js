const BASE = '/api';
const TOKEN_KEY = 'stockroom-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (res.status === 401 && token) {
    setToken(null);
    window.dispatchEvent(new Event('auth:unauthorized'));
  }
  if (res.status === 402 && token) {
    window.dispatchEvent(new Event('billing:required'));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  register: (email, password) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  requestPasswordReset: (email) =>
    request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyPasswordResetCode: (email, code) =>
    request('/auth/verify-reset-code', { method: 'POST', body: JSON.stringify({ email, code }) }),
  resetPassword: (resetToken, newPassword) =>
    request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ resetToken, newPassword }) }),
  getBillingStatus: () => request('/billing/status'),
  startBillingCheckout: () => request('/billing/checkout', { method: 'POST', body: JSON.stringify({}) }),

  listProducts: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/products${qs ? `?${qs}` : ''}`);
  },
  createProduct: (data) => request('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id, data) => request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  adjustStock: (id, change, reason) =>
    request(`/products/${id}/stock`, { method: 'POST', body: JSON.stringify({ change, reason }) }),

  listCategories: () => request('/categories'),
  createCategory: (name) => request('/categories', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteCategory: (id) => request(`/categories/${id}`, { method: 'DELETE' }),

  listSales: () => request('/sales'),
  salesSummary: () => request('/sales/summary'),
  recordSale: (data) => request('/sales', { method: 'POST', body: JSON.stringify(data) }),

  listNotifications: (unreadOnly = false) => request(`/notifications${unreadOnly ? '?unread=true' : ''}`),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request('/notifications/read-all', { method: 'POST' }),
  sendChatMessage: (message, history = []) => request('/chat', {
    method: 'POST',
    body: JSON.stringify({ message, history }),
    signal: AbortSignal.timeout(30000),
  }),
  getForecast: () => request('/sales/forecast'),
  getInsights: () => request('/analytics/insights'),
};
