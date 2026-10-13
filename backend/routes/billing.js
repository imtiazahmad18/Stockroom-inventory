import { Router } from 'express';
import prisma from '../lib/prisma.js';
import {
  createCheckoutReference,
  createSubscriptionCheckout,
  SUBSCRIPTION_PRICE_USD,
  SUBSCRIPTION_AMOUNT_CENTS,
  verifySafepaySignature,
  isBillingDevBypassEnabled,
} from '../billingProvider.js';

const router = Router();
const ACCESS_STATUSES = new Set(['active', 'past_due', 'cancelled', 'canceled']);

router.get('/status', async (req, res) => {
  if (isBillingDevBypassEnabled()) {
    return res.json({ active: true, status: 'development_bypass', currentPeriodEnd: null, priceUsd: SUBSCRIPTION_PRICE_USD });
  }
  try {
    const subscription = await prisma.billing_subscriptions.findFirst({
      where: { user_id: req.user.id },
      orderBy: { created_at: 'desc' },
    });
    const periodEnd = subscription?.current_period_end
      ? Date.parse(subscription.current_period_end)
      : NaN;
    const active = Boolean(subscription && ACCESS_STATUSES.has(subscription.status) && periodEnd > Date.now());
    return res.json({
      active,
      status: subscription?.status ?? 'inactive',
      currentPeriodEnd: subscription?.current_period_end ?? null,
      priceUsd: SUBSCRIPTION_PRICE_USD,
    });
  } catch (error) {
    console.error('Billing status lookup failed:', error);
    return res.status(500).json({ error: 'Could not load subscription status.' });
  }
});

router.post('/checkout', async (req, res) => {
  const reference = createCheckoutReference();
  let subscription;
  try {
    subscription = await prisma.billing_subscriptions.create({
      data: { user_id: req.user.id, checkout_reference: reference, status: 'pending' },
    });
    const checkoutUrl = await createSubscriptionCheckout(reference);
    return res.json({ checkoutUrl });
  } catch (error) {
    if (subscription) {
      await prisma.billing_subscriptions.update({
        where: { id: subscription.id },
        data: { status: 'checkout_failed' },
      }).catch(() => {});
    }
    if (error.code === 'BILLING_NOT_CONFIGURED') {
      return res.status(503).json({
        error: 'Online payments are not configured yet. The Safepay merchant keys and subscription plan must be added by the project owner.',
        code: error.code,
      });
    }
    console.error('Could not create Safepay checkout:', error);
    return res.status(502).json({ error: 'Could not start checkout with Safepay. Please try again.' });
  }
});

function eventPayload(event) {
  const data = event?.data?.data ?? event?.data ?? {};
  const reference = data.reference ?? data.ref ?? event?.reference ?? null;
  const subscriptionId = data.subscription_id ?? data.subscriptionId ?? data.id ?? null;
  return { data, reference, subscriptionId };
}

function periodEndIso(data) {
  const value = data.current_period_end_date?.seconds
    ?? data.current_period_end?.seconds
    ?? data.current_period_end_date
    ?? data.current_period_end;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const milliseconds = Number(value) * 1000;
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
  }
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function handleSafepayWebhook(req, res) {
  const signature = req.get('x-sfpy-signature') || req.get('x-safepay-signature') || req.get('x-webhook-signature');
  if (!verifySafepaySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid webhook payload.' });
  }
  if (process.env.SAFEPAY_API_KEY && event?.merchant_api_key !== process.env.SAFEPAY_API_KEY) {
    return res.status(401).json({ error: 'Webhook is for a different Safepay merchant account.' });
  }
  const eventId = event?.token ?? event?.id ?? event?.event_id;
  const eventType = event?.type ?? event?.event_type;
  if (typeof eventId !== 'string' || typeof eventType !== 'string') {
    return res.status(400).json({ error: 'Webhook event ID or type is missing.' });
  }

  const { data, reference, subscriptionId } = eventPayload(event);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.billing_webhook_events.create({ data: { event_id: eventId, event_type: eventType } });
      if (!reference) return;
      const record = await tx.billing_subscriptions.findUnique({ where: { checkout_reference: String(reference) } });
      if (!record) return;

      if (eventType === 'subscription.payment.succeeded') {
        const periodEnd = periodEndIso(data);
        const amount = Number(data.amount ?? data.plan?.amount);
        const currency = String(data.currency ?? data.plan?.currency ?? '').toUpperCase();
        const planId = data.plan_id ?? data.plan?.id;
        if (!periodEnd || !Number.isFinite(amount) || amount !== SUBSCRIPTION_AMOUNT_CENTS
          || currency !== 'USD'
          || !planId || !process.env.SAFEPAY_PLAN_ID || String(planId) !== process.env.SAFEPAY_PLAN_ID) {
          throw new Error('Safepay payment details did not match the configured USD 10 monthly plan.');
        }
        await tx.billing_subscriptions.update({
          where: { id: record.id },
          data: {
            status: 'active',
            current_period_end: periodEnd,
            ...(subscriptionId ? { provider_subscription_id: String(subscriptionId) } : {}),
            updated_at: new Date().toISOString(),
          },
        });
      } else if (eventType === 'subscription.payment.failed') {
        await tx.billing_subscriptions.update({
          where: { id: record.id },
          data: { status: 'past_due', updated_at: new Date().toISOString() },
        });
      } else if (['subscription.cancelled', 'subscription.canceled', 'subscription.ended'].includes(eventType)) {
        await tx.billing_subscriptions.update({
          where: { id: record.id },
          data: { status: 'cancelled', updated_at: new Date().toISOString() },
        });
      } else if (eventType === 'subscription.created' && record.status !== 'active') {
        await tx.billing_subscriptions.update({
          where: { id: record.id },
          data: {
            status: 'pending',
            ...(subscriptionId ? { provider_subscription_id: String(subscriptionId) } : {}),
            updated_at: new Date().toISOString(),
          },
        });
      }
    });
    return res.json({ received: true });
  } catch (error) {
    if (error.code === 'P2002') return res.json({ received: true, duplicate: true });
    console.error('Safepay webhook processing failed:', error);
    return res.status(500).json({ error: 'Webhook could not be processed.' });
  }
}

export default router;
