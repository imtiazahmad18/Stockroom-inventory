// backgroundAgent.js — the autonomous monitoring agent.
//
// Runs on a timer, independent of any user opening the chat or a page. It
// only ever creates notifications/suggestions — it never adjusts stock or
// records sales on its own. Autonomously writing to stock counts or sales
// history with no human in the loop would let a bad model run silently
// corrupt the books; suggesting is safe and reversible, executing isn't.
// (The chat agent, driven by an explicit user request, is where real writes
// happen — see agent.js / chatTools.js.)

import prisma from './lib/prisma.js';
import { computeForecast } from './forecastService.js';
import { computeInsights } from './analyticsService.js';

const SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const DEDUPE_WINDOW_HOURS = 24; // don't re-flag the same thing more than once a day

// created_at is stored as a SQLite datetime string ("YYYY-MM-DD HH:MM:SS"),
// so the cutoff must be a string too — passing a JS Date makes Prisma reject
// it with "Expected String or StringFieldRefInput, provided DateTime".
function sqliteDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function hasRecentProductNotification(ownerId, productId, type) {
  const since = sqliteDateTime(new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000));
  const row = await prisma.notifications.findFirst({
    where: { owner_id: ownerId, product_id: productId, type, created_at: { gte: since } },
    orderBy: { created_at: 'desc' },
  });
  return !!row;
}

async function hasRecentMessage(ownerId, message) {
  const since = sqliteDateTime(new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000));
  const row = await prisma.notifications.findFirst({
    where: { owner_id: ownerId, message, created_at: { gte: since } },
  });
  return !!row;
}

async function insertNotification(ownerId, productId, type, message) {
  await prisma.notifications.create({
    data: { owner_id: ownerId, product_id: productId, type, message },
  });
}

async function scanStockoutRisk(ownerId) {
  const { productForecast } = await computeForecast(ownerId);
  for (const p of productForecast) {
    if (p.riskLevel === 'critical' && p.suggestedReorderQty > 0) {
      if (await hasRecentProductNotification(ownerId, p.id, 'reorder_suggestion')) continue;
      await insertNotification(
        ownerId,
        p.id,
        'reorder_suggestion',
        `${p.name} is at critical stockout risk (${p.daysRemaining} day(s) left at current pace). Suggested reorder: ${p.suggestedReorderQty} units.`
      );
    }
  }
}

async function scanSlowMovers(ownerId) {
  const { slowMovers } = await computeInsights(ownerId);
  for (const p of slowMovers) {
    if (await hasRecentProductNotification(ownerId, p.id, 'slow_mover')) continue;
    const since = p.daysSinceLastSale === null ? 'has never sold' : `hasn't sold in ${p.daysSinceLastSale} day(s)`;
    await insertNotification(
      ownerId,
      p.id,
      'slow_mover',
      `${p.name} ${since} and still has ${p.currentStock} unit(s) in stock — consider a promotion or discount.`
    );
  }
}

async function scanDemandAnomalies(ownerId) {
  const { anomalies } = await computeInsights(ownerId);
  for (const a of anomalies) {
    if (await hasRecentMessage(ownerId, a.message)) continue;
    await insertNotification(ownerId, null, 'demand_spike', a.message);
  }
}

async function scan() {
  try {
    const users = await prisma.users.findMany({ select: { id: true } });
    for (const user of users) {
      await scanStockoutRisk(user.id);
      await scanSlowMovers(user.id);
      await scanDemandAnomalies(user.id);
    }
  } catch (err) {
    console.error('Background agent scan failed:', err.message);
  }
}

export function startBackgroundAgent() {
  // First pass shortly after boot, then on a fixed interval.
  setTimeout(scan, 5000);
  setInterval(scan, SCAN_INTERVAL_MS);
}
