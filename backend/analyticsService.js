// analyticsService.js
// Ground-truth business analytics computed straight from SQL — top sellers,
// slow movers, margins, category performance, trend and anomaly detection.
// These numbers are the "authoritative data" handed to the LLM in
// routes/analytics.js so its narrative suggestions are grounded in real
// stats rather than invented ones, and ruleBasedSuggestions() below is a
// pure-code fallback so the insights page still works if the AI call fails.

import prisma from './lib/prisma.js';

const SLOW_MOVER_DAYS = 21;
const TOP_N = 5;

export async function computeInsights(ownerId) {
  const products = await prisma.$queryRaw`
    SELECT p.id, p.name, p.sku, p.current_stock, p.sale_price, p.cost_price, c.name AS category
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.owner_id = ${ownerId}
  `;
  const productById = new Map(products.map((p) => [p.id, p]));

  const salesByProduct = await prisma.$queryRaw`
    SELECT product_id,
           SUM(quantity) AS units,
           SUM(quantity * sale_price) AS revenue,
           SUM(quantity * (sale_price - cost_price_at_sale)) AS profit,
           MAX(date(created_at)) AS last_sale_day
    FROM sales
    WHERE owner_id = ${ownerId}
    GROUP BY product_id
  `;

  const topSellers = [...salesByProduct]
    .sort((a, b) => Number(b.revenue) - Number(a.revenue))
    .slice(0, TOP_N)
    .map((s) => {
      const p = productById.get(s.product_id);
      return {
        id: s.product_id, name: p?.name || 'Unknown', sku: p?.sku,
        unitsSold: Number(s.units), revenue: Number(s.revenue), profit: Number(s.profit),
      };
    });

  const salesMap = new Map(salesByProduct.map((s) => [s.product_id, s]));
  const today = new Date();
  const slowMovers = products
    .filter((p) => p.current_stock > 0)
    .map((p) => {
      const s = salesMap.get(p.id);
      const daysSinceLastSale = s?.last_sale_day
        ? Math.round((today - new Date(s.last_sale_day)) / 86400000)
        : null;
      return { id: p.id, name: p.name, sku: p.sku, currentStock: p.current_stock, daysSinceLastSale };
    })
    .filter((p) => p.daysSinceLastSale === null || p.daysSinceLastSale >= SLOW_MOVER_DAYS)
    .sort((a, b) => (b.daysSinceLastSale ?? 9999) - (a.daysSinceLastSale ?? 9999))
    .slice(0, 10);

  const marginable = products.filter((p) => p.sale_price > 0);
  const withMargin = marginable.map((p) => ({
    id: p.id, name: p.name, sku: p.sku,
    marginPct: Math.round(((p.sale_price - p.cost_price) / p.sale_price) * 1000) / 10,
  }));
  const marginLeaders = [...withMargin].sort((a, b) => b.marginPct - a.marginPct).slice(0, 5);
  const marginLaggards = [...withMargin].sort((a, b) => a.marginPct - b.marginPct).slice(0, 5);

  const categoryTotals = {};
  for (const s of salesByProduct) {
    const cat = productById.get(s.product_id)?.category || 'Uncategorized';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(s.revenue);
  }
  const categoryPerformance = Object.entries(categoryTotals)
    .map(([category, revenue]) => ({ category, revenue: Math.round(revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue);

  const [{ today: todayKey }] = await prisma.$queryRaw`SELECT date('now', 'localtime') AS today`;
  const dailyRaw = await prisma.$queryRaw`
    SELECT date(created_at) AS day, SUM(quantity * sale_price) AS revenue
    FROM sales
    WHERE owner_id = ${ownerId}
      AND date(created_at) >= date('now', 'localtime', '-89 days')
      AND date(created_at) <= date('now', 'localtime')
    GROUP BY day ORDER BY day ASC
  `;
  const revenueByDay = new Map(dailyRaw.map((d) => [d.day, Number(d.revenue)]));
  const dailyRevenue = [];
  const dayCursor = new Date(`${todayKey}T00:00:00Z`);
  for (let offset = 89; offset >= 0; offset--) {
    const day = new Date(dayCursor);
    day.setUTCDate(day.getUTCDate() - offset);
    const key = day.toISOString().slice(0, 10);
    dailyRevenue.push({ day: key, revenue: revenueByDay.get(key) || 0 });
  }

  const [trend] = await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(CASE WHEN date(created_at) >= date('now', 'localtime', '-6 days')
        AND date(created_at) <= date('now', 'localtime') THEN quantity * sale_price ELSE 0 END), 0) AS last7,
      COALESCE(SUM(CASE WHEN date(created_at) >= date('now', 'localtime', '-13 days')
        AND date(created_at) < date('now', 'localtime', '-6 days') THEN quantity * sale_price ELSE 0 END), 0) AS prior7
    FROM sales WHERE owner_id = ${ownerId}
  `;
  const last7 = Number(trend?.last7 ?? 0);
  const prior7 = Number(trend?.prior7 ?? 0);
  const revenueTrendPct = prior7 > 0 ? Math.round(((last7 - prior7) / prior7) * 1000) / 10 : null;

  // A day counts as an anomaly when it's more than 75% away from the
  // trailing 7-day average that preceded it. Needs 8+ days of history so
  // there's a real baseline to compare against.
  const anomalies = [];
  for (let i = 7; i < dailyRevenue.length; i++) {
    const trailing = dailyRevenue.slice(i - 7, i);
    const avg = trailing.reduce((s, d) => s + d.revenue, 0) / 7;
    const point = dailyRevenue[i];
    if (avg > 0 && Math.abs(point.revenue - avg) / avg > 0.75) {
      const direction = point.revenue > avg ? 'spike' : 'drop';
      anomalies.push({
        day: point.day,
        revenue: Math.round(point.revenue * 100) / 100,
        baseline: Math.round(avg * 100) / 100,
        direction,
        message: `Revenue on ${point.day} was $${Math.round(point.revenue)} — a ${direction} vs the recent daily average of $${Math.round(avg)}.`,
      });
    }
  }

  return {
    topSellers,
    slowMovers,
    marginLeaders,
    marginLaggards,
    categoryPerformance,
    revenueTrendPct,
    last7DaysRevenue: Math.round(last7 * 100) / 100,
    prior7DaysRevenue: Math.round(prior7 * 100) / 100,
    anomalies: anomalies.slice(-5),
  };
}

export function ruleBasedSuggestions(insights) {
  const out = [];

  if (insights.topSellers[0]) {
    const p = insights.topSellers[0];
    out.push(`${p.name} is your top seller ($${p.revenue} revenue) — keep it well stocked.`);
  }

  if (insights.slowMovers.length) {
    const p = insights.slowMovers[0];
    const since = p.daysSinceLastSale === null ? 'has never sold' : `hasn't sold in ${p.daysSinceLastSale} days`;
    out.push(`${p.name} ${since} with ${p.currentStock} units on hand — consider a discount or bundling it.`);
  }

  if (insights.revenueTrendPct !== null) {
    const dir = insights.revenueTrendPct >= 0 ? 'up' : 'down';
    out.push(`Revenue is ${dir} ${Math.abs(insights.revenueTrendPct)}% over the last 7 days vs the previous 7.`);
  }

  if (insights.marginLaggards[0] && insights.marginLaggards[0].marginPct < 15) {
    const p = insights.marginLaggards[0];
    out.push(`${p.name} has a thin margin (${p.marginPct}%) — consider a price review.`);
  }

  for (const a of insights.anomalies.slice(-2)) {
    out.push(a.message);
  }

  if (!out.length) {
    out.push('Not enough sales history yet for tailored suggestions — record a few days of sales first.');
  }

  return out;
}
