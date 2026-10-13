import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const SUBSCRIPTION_PRICE_USD = 10;
// Safepay reports payment amounts in the currency's minor unit (cents for USD).
export const SUBSCRIPTION_AMOUNT_CENTS = SUBSCRIPTION_PRICE_USD * 100;

export function isBillingDevBypassEnabled() {
  return process.env.NODE_ENV === 'development' && process.env.BILLING_DEV_BYPASS === 'true';
}

function configuration() {
  const environment = process.env.SAFEPAY_ENV || 'sandbox';
  const host = process.env.SAFEPAY_HOST || (environment === 'production'
    ? 'https://api.getsafepay.com'
    : 'https://sandbox.api.getsafepay.com');
  const checkoutHost = process.env.SAFEPAY_CHECKOUT_HOST || (environment === 'production'
    ? 'https://getsafepay.com'
    : 'https://sandbox.api.getsafepay.com');
  const appUrl = process.env.APP_URL;
  if (!process.env.SAFEPAY_SECRET_KEY || !process.env.SAFEPAY_PLAN_ID || !appUrl) {
    const error = new Error('Safepay is not configured.');
    error.code = 'BILLING_NOT_CONFIGURED';
    throw error;
  }
  if (environment === 'production' && !appUrl.startsWith('https://')) {
    const error = new Error('APP_URL must use HTTPS in production.');
    error.code = 'BILLING_NOT_CONFIGURED';
    throw error;
  }
  return { environment, host, checkoutHost, appUrl: appUrl.replace(/\/$/, '') };
}

export async function createSubscriptionCheckout(reference) {
  const { environment, host, checkoutHost, appUrl } = configuration();
  const response = await fetch(`${host}/client/passport/v1/token`, {
    method: 'POST',
    headers: { 'X-SFPY-MERCHANT-SECRET': process.env.SAFEPAY_SECRET_KEY },
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  const authToken = payload.data?.data ?? payload.data;
  if (!response.ok || typeof authToken !== 'string') {
    throw new Error(`Safepay authentication failed (${response.status}).`);
  }

  const params = new URLSearchParams({
    plan_id: process.env.SAFEPAY_PLAN_ID,
    auth_token: authToken,
    env: environment,
    redirect_url: `${appUrl}/?billing=success`,
    cancel_url: `${appUrl}/?billing=cancelled`,
    reference,
  });
  return `${checkoutHost}/checkout/auth/login?${params.toString()}`;
}

export function createCheckoutReference() {
  return `stockroom_${randomUUID()}`;
}

export function verifySafepaySignature(rawBody, receivedSignature) {
  const secret = process.env.SAFEPAY_WEBHOOK_SECRET;
  if (!secret || !Buffer.isBuffer(rawBody) || typeof receivedSignature !== 'string') return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let provided = receivedSignature.trim().replace(/^sha256=/i, '');
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;
  const providedBytes = Buffer.from(provided, 'hex');
  return providedBytes.length === expected.length && timingSafeEqual(expected, providedBytes);
}
