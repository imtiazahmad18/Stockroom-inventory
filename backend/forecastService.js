// forecastService.js
// Statistical (non-ML) forecasting shared by the /api/sales/forecast route,
// the chat agent's get_forecast tool, and the background agent's stockout
// scan — one implementation, three callers.

import prisma from './lib/prisma.js';

const REORDER_COVERAGE_DAYS = 14; // a reorder should cover ~2 weeks of sell-through
const CRITICAL_DAYS = 3;
const WARNING_DAYS = 7;
const MIN_DAYS_FOR_SEASONALITY = 21; // need ~3 weeks before trusting a per-weekday average

export async function computeForecast(ownerId) {
  const [{ today }] = await prisma.$queryRaw`SELECT date('now', 'localtime') AS today`;
  const recentSalesDays = await prisma.$queryRaw`
    SELECT date(created_at) AS day, SUM(quantity * sale_price) AS revenue
    FROM sales
    WHERE owner_id = ${ownerId}
      AND date(created_at) >= date('now', 'localtime', '-29 days')
      AND date(created_at) <= date('now', 'localtime')
    GROUP BY day
    ORDER BY day ASC
  `;

  let revenueForecast = null;
  if (recentSalesDays.length >= 2) {
    const todayDate = new Date(`${today}T00:00:00Z`);
    const earliestSaleDate = new Date(`${recentSalesDays[0].day}T00:00:00Z`);
    const earliestWindowDate = new Date(todayDate);
    earliestWindowDate.setUTCDate(earliestWindowDate.getUTCDate() - 29);
    const firstDate = earliestSaleDate > earliestWindowDate ? earliestSaleDate : earliestWindowDate;
    const revenueByDay = new Map(recentSalesDays.map((row) => [row.day, Number(row.revenue)]));
    const daily = [];
    for (const date = new Date(firstDate); date <= todayDate; date.setUTCDate(date.getUTCDate() + 1)) {
      const day = date.toISOString().slice(0, 10);
      daily.push({ day, revenue: revenueByDay.get(day) || 0 });
    }

    const n = daily.length;
    const xs = daily.map((_, i) => i);
    const ys = daily.map((d) => d.revenue);
    const xMean = xs.reduce((a, b) => a + b, 0) / n;
    const yMean = ys.reduce((a, b) => a + b, 0) / n;

    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - xMean) * (ys[i] - yMean);
      den += (xs[i] - xMean) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = yMean - slope * xMean;

    // Weekday seasonality: scale the trend line by how each weekday's
    // average revenue compares to the overall average.
    const weekdayTotals = Array(7).fill(0);
    const weekdayCounts = Array(7).fill(0);
    daily.forEach((d) => {
      const wd = new Date(`${d.day}T00:00:00Z`).getUTCDay();
      weekdayTotals[wd] += Number(d.revenue);
      weekdayCounts[wd] += 1;
    });
    const seasonalityApplied = daily.length >= MIN_DAYS_FOR_SEASONALITY && weekdayCounts.every((c) => c >= 2);
    const weekdayFactor = weekdayTotals.map((total, wd) => {
      if (!seasonalityApplied || yMean === 0) return 1;
      return (total / weekdayCounts[wd]) / yMean;
    });

    const next30Days = [];
    for (let i = 0; i < 30; i++) {
      const x = n + i;
      const futureDate = new Date(todayDate);
      futureDate.setUTCDate(futureDate.getUTCDate() + i + 1);
      const base = Math.max(0, intercept + slope * x);
      const predicted = Math.max(0, base * weekdayFactor[futureDate.getUTCDay()]);
      next30Days.push({
        day: i + 1,
        date: futureDate.toISOString().slice(0, 10),
        predictedRevenue: Math.round(predicted * 100) / 100,
      });
    }
    const next7Days = next30Days.slice(0, 7);

    revenueForecast = {
      trend: slope > 0.5 ? 'up' : slope < -0.5 ? 'down' : 'flat',
      dailyAverage: Math.round(yMean * 100) / 100,
      seasonalityApplied,
      next7Days,
      next7DaysTotal: Math.round(next7Days.reduce((s, d) => s + d.predictedRevenue, 0) * 100) / 100,
      next30DaysTotal: Math.round(next30Days.reduce((s, d) => s + d.predictedRevenue, 0) * 100) / 100,
      basedOnDays: n,
      salesDaysInWindow: recentSalesDays.length,
    };
  }

  const productStats = await prisma.$queryRaw`
    SELECT
      p.id, p.name, p.sku, p.current_stock, p.reorder_level,
      COALESCE(SUM(CASE
        WHEN date(s.created_at) >= date('now', 'localtime', '-29 days')
         AND date(s.created_at) <= date('now', 'localtime')
        THEN s.quantity ELSE 0 END), 0) AS recent_units,
      COUNT(CASE WHEN date(s.created_at) >= date('now', 'localtime', '-29 days')
        AND date(s.created_at) <= date('now', 'localtime') THEN 1 END) AS transactions_30d
    FROM products p
    LEFT JOIN sales s ON s.product_id = p.id AND s.owner_id = ${ownerId}
    WHERE p.owner_id = ${ownerId}
    GROUP BY p.id
  `;

  const productForecast = productStats.map((p) => {
    const recentUnits = Number(p.recent_units);
    if (!recentUnits) {
      const reorderNeeded = Math.max(0, p.reorder_level - p.current_stock);
      return {
        id: p.id, name: p.name, sku: p.sku, currentStock: p.current_stock,
        dailyVelocity: 0, projectedDemand30Days: 0, daysRemaining: null,
        riskLevel: p.current_stock === 0 ? 'critical' : reorderNeeded > 0 ? 'warning' : 'unknown',
        suggestedReorderQty: reorderNeeded,
        note: 'No sales in the last 30 days; reorder quantity is based only on the configured reorder level.',
      };
    }

    // This query covers a fixed 30-calendar-day window. Dividing by the
    // number of days since the first sale made sparse products look like
    // they sold every day; use the full observed window instead.
    const velocity = recentUnits / 30;
    const daysRemaining = velocity > 0 ? Math.floor(p.current_stock / velocity) : null;

    let riskLevel = 'ok';
    if (p.current_stock <= 0) riskLevel = 'critical';
    else if (p.current_stock <= p.reorder_level) riskLevel = 'warning';
    else if (daysRemaining !== null) {
      if (daysRemaining <= CRITICAL_DAYS) riskLevel = 'critical';
      else if (daysRemaining <= WARNING_DAYS) riskLevel = 'warning';
    }

    const targetStock = Math.ceil(velocity * REORDER_COVERAGE_DAYS);
    const suggestedReorderQty = riskLevel === 'ok'
      ? 0
      : Math.max(0, Math.max(targetStock, p.reorder_level) - p.current_stock);

    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      currentStock: p.current_stock,
      dailyVelocity: Math.round(velocity * 100) / 100,
      projectedDemand30Days: Math.ceil(velocity * 30),
      transactions30Days: Number(p.transactions_30d || 0),
      daysRemaining,
      riskLevel,
      suggestedReorderQty,
    };
  });

  return { revenueForecast, productForecast };
}
