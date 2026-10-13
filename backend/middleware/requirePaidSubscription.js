import prisma from '../lib/prisma.js';
import { isBillingDevBypassEnabled } from '../billingProvider.js';

const ACCESS_STATUSES = new Set(['active', 'past_due', 'cancelled', 'canceled']);

export async function requirePaidSubscription(req, res, next) {
  if (isBillingDevBypassEnabled()) return next();
  try {
    const subscription = await prisma.billing_subscriptions.findFirst({
      where: { user_id: req.user.id },
      orderBy: { created_at: 'desc' },
    });
    const periodEnd = subscription?.current_period_end
      ? Date.parse(subscription.current_period_end)
      : NaN;
    if (subscription && ACCESS_STATUSES.has(subscription.status) && periodEnd > Date.now()) {
      return next();
    }
    return res.status(402).json({
      error: 'An active subscription is required to use the inventory software.',
      code: 'SUBSCRIPTION_REQUIRED',
    });
  } catch (error) {
    console.error('Subscription access check failed:', error);
    return res.status(500).json({ error: 'Could not verify subscription access.' });
  }
}

export default requirePaidSubscription;
