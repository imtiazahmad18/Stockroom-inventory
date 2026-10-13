import prisma from './lib/prisma.js';
import { Prisma } from '@prisma/client';
import { applyStockChange } from './stockService.js';
import { computeForecast } from './forecastService.js';
import { computeInsights } from './analyticsService.js';

// Safety bound for a single adjust_stock tool call. Not a business rule —
// just a sanity cap so one bad/hallucinated model turn can't wipe out or
// invent a wildly wrong stock count in one shot. Split a legitimately large
// restock into a couple of calls if you ever need more than this.
const MAX_STOCK_DELTA = 100000;

export const toolDefinitions = [
  {
    name: 'get_product_categories',
    description: 'Lists this shop owner’s product categories and how many products each contains.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_products',
    description: 'Search current products by words, SKU, category, plural forms, and small typos. Use when a product name is misspelled/partial or when a requested product is not found; return the best matches as suggestions.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'get_sales_by_period',
    description: 'Reads current sales between ISO dates (from inclusive, to inclusive), optionally for one product. Use for revenue, units, and profit today, this week, or a requested date range.',
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, product: { type: 'string' } }, required: [] },
  },
  {
    name: 'get_slow_moving_products',
    description: 'Finds in-stock products with zero or very few sales in the requested number of recent days. Use for products that have not sold, slow movers, and stagnant stock.',
    parameters: { type: 'object', properties: { days: { type: 'number' } }, required: [] },
  },
  {
    name: 'get_stock_history',
    description: 'Reads recent stock change log entries for a named product. Use for restock, sale, correction, and stock-change history questions.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
  },
  {
    name: 'get_category_summary',
    description: 'Returns product count, units in stock, and stock value grouped by category. Use for category inventory value or category stock questions.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_recent_notifications',
    description: 'Lists recent notifications for this owner. Use for alerts, unread notices, and recent inventory events.',
    parameters: { type: 'object', properties: { unreadOnly: { type: 'boolean' }, limit: { type: 'number' } }, required: [] },
  },
  {
    name: 'get_inventory_overview',
    description: 'Returns current product count, stock units/value, low-stock count, and sales revenue/profit totals. Use for overall inventory or business summaries.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_out_of_stock_products',
    description: 'Lists products with exactly zero stock, including their category.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_next_month_reorder_needs',
    description: 'Estimates next month’s reorder quantities from units sold during the last 30 days, current stock, and each product’s reorder level. Explain that this is a simple estimate, not a guarantee.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_low_stock_products',
    description: 'Returns all products whose current stock is at or below their reorder level. Use this when the user asks what is low on stock, what needs reordering, or similar.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_product_info',
    description: 'Looks up a single product by name or SKU (partial match) and returns its price, current stock, reorder level, and category.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Product name or SKU to search for, e.g. "t-shirt" or "TS-001".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_products',
    description: 'Lists products (name, sku, stock, price, category), most useful when the user asks to browse or see everything rather than search for one item.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows to return, default 50, capped at 100.' },
        category: { type: 'string', description: 'Optional category name to filter the list.' },
      },
      required: [],
    },
  },
  {
    name: 'get_sales_summary',
    description: 'Returns sale count, units sold, revenue, cost, and profit for a selected date range.',
    parameters: {
      type: 'object',
      properties: { period: { type: 'string', enum: ['all_time', 'today', 'this_month', 'last_month', 'last_7_days', 'last_30_days', 'this_year'], description: 'Requested date range; use all_time if the question does not specify one.' } },
      required: ['period'],
    },
  },
  {
    name: 'get_top_selling_products',
    description: 'Ranks products by units sold and revenue for a chosen sales period and optional category. Use for top-selling, best-selling, or most popular product questions.',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['all_time', 'today', 'this_month', 'last_month', 'last_7_days', 'last_30_days', 'this_year'] },
        days: { type: 'number', description: 'Optional rolling day window, e.g. 7 for this week.' },
        limit: { type: 'number', description: 'Number of products to return, up to 20.' },
        category: { type: 'string', description: 'Optional category name to filter by.' },
      },
      required: [],
    },
  },
  {
    name: 'get_product_sales',
    description: 'Returns how many units of a specific product have been sold and the revenue it generated. Use this for "how is X selling" questions.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Product name or SKU to search for.' },
        period: { type: 'string', enum: ['all_time', 'this_month', 'last_month', 'last_30_days'], description: 'Sales period; defaults to the last 30 days.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_forecast',
    description: 'Returns 7-day and 30-day revenue forecasts plus per-product sell-through velocity from the last 30 days, estimated days until stockout, risk level, and a suggested reorder quantity. Use for sales predictions, stockout timing, and future stock planning. Explain that forecasts are estimates.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_product_forecast',
    description: 'Forecasts one named product using its current-month pace, last 30 days, and previous month sales. Returns month-end and next-30-day unit estimates, current stock, and estimated stockout timing. Use this whenever the user asks to predict or forecast a named product.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Product name or SKU.' } },
      required: ['query'],
    },
  },
  {
    name: 'get_sales_driven_restock_recommendations',
    description: 'Ranks products by units sold over the last 30 days and stock cover; use when the user asks which product to increase, restock, or prioritize according to sales. This is advice only and does not change stock.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_business_insights',
    description: 'Returns analytics: top sellers, slow-moving products, margin leaders/laggards, category revenue breakdown, week-over-week revenue trend, and revenue anomalies. Use for "how is the business doing", "what should I focus on" type questions.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'adjust_stock',
    description: "Changes a product's stock count (restock, correction, or loss/write-off). Positive change = add stock, negative = remove stock. Only use this when the user explicitly asks to restock, add, remove, or correct stock — never to record a sale (use record_sale for that).",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Product name or SKU.' },
        change: { type: 'number', description: 'Non-zero integer. Positive to add stock, negative to remove.' },
        reason: { type: 'string', description: 'Short reason, e.g. "restock", "correction", "damaged goods". Defaults to "ai_agent".' },
      },
      required: ['query', 'change'],
    },
  },
  {
    name: 'record_sale',
    description: 'Records a sale of a product and decrements its stock accordingly. Use this when the user explicitly asks you to log/record a sale.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Product name or SKU.' },
        quantity: { type: 'number', description: 'Positive integer quantity sold.' },
        salePrice: { type: 'number', description: "Optional override of the unit sale price; defaults to the product's current sale price." },
      },
      required: ['query', 'quantity'],
    },
  },
  {
    name: 'create_reorder_suggestion',
    description: 'Creates a reorder notification for a product so it shows up in the notification bell. Use this to flag a restock recommendation without actually changing stock.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Product name or SKU.' },
        message: { type: 'string', description: 'Short, specific suggestion message to show the user.' },
      },
      required: ['query', 'message'],
    },
  },
];

export async function getInventorySnapshot(ownerId) {
  const products = await prisma.products.findMany({
    where: { owner_id: ownerId },
    include: { categories: true },
    orderBy: { name: 'asc' },
  });
  const mapped = products.map((p) => ({
    name: p.name,
    sku: p.sku,
    sale_price: p.sale_price,
    cost_price: p.cost_price,
    current_stock: p.current_stock,
    reorder_level: p.reorder_level,
    category: p.categories ? p.categories.name : null,
  }));
  const lowStock = mapped.filter((product) => product.current_stock <= product.reorder_level);
  const agg = await prisma.sales.aggregate({
    where: { owner_id: ownerId },
    _count: { _all: true },
    _sum: { quantity: true },
  });
  const totals = await prisma.$queryRaw`
    SELECT COALESCE(SUM(quantity * sale_price), 0) AS revenue,
           COALESCE(SUM(quantity * cost_price_at_sale), 0) AS cost
    FROM sales WHERE owner_id = ${ownerId}
  `;
  const revenue = Number(totals[0]?.revenue ?? 0);
  const cost = Number(totals[0]?.cost ?? 0);

  return {
    products: mapped,
    lowStock,
    salesSummary: {
      saleCount: agg._count._all,
      revenue,
      cost,
      profit: revenue - cost,
    },
  };
}

// Deterministic answers for common questions should come directly from the
// account's database rows instead of asking a language model to reproduce them.
export async function getProductCategories(ownerId) {
  return prisma.categories.findMany({
    where: { owner_id: ownerId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  }).then((rows) => rows.map((row) => ({ name: row.name, productCount: row._count.products })));
}

export async function getOutOfStockProducts(ownerId) {
  const rows = await prisma.products.findMany({
    where: { owner_id: ownerId, current_stock: 0 },
    include: { categories: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((row) => ({ name: row.name, sku: row.sku, current_stock: 0, category: row.categories?.name ?? null }));
}

export async function getSalesSummaryByPeriod(ownerId, period = 'all_time') {
  let periodFilter = Prisma.empty;
  switch (period) {
    case 'today':
      periodFilter = Prisma.sql`AND date(created_at) = date('now', 'localtime')`;
      break;
    case 'this_month':
      periodFilter = Prisma.sql`AND date(created_at) >= date('now', 'localtime', 'start of month') AND date(created_at) < date('now', 'localtime', 'start of month', '+1 month')`;
      break;
    case 'last_month':
      periodFilter = Prisma.sql`AND date(created_at) >= date('now', 'localtime', 'start of month', '-1 month') AND date(created_at) < date('now', 'localtime', 'start of month')`;
      break;
    case 'last_7_days':
      periodFilter = Prisma.sql`AND date(created_at) >= date('now', 'localtime', '-6 days') AND date(created_at) < date('now', 'localtime', '+1 day')`;
      break;
    case 'last_30_days':
      periodFilter = Prisma.sql`AND date(created_at) >= date('now', 'localtime', '-29 days') AND date(created_at) < date('now', 'localtime', '+1 day')`;
      break;
    case 'this_year':
      periodFilter = Prisma.sql`AND date(created_at) >= date('now', 'localtime', 'start of year') AND date(created_at) < date('now', 'localtime', 'start of year', '+1 year')`;
      break;
    case 'all_time':
    default:
      break;
  }
  const [row] = await prisma.$queryRaw`
    SELECT COUNT(*) AS sale_count,
           COALESCE(SUM(quantity), 0) AS units_sold,
           COALESCE(SUM(quantity * sale_price), 0) AS revenue,
           COALESCE(SUM(quantity * cost_price_at_sale), 0) AS cost
    FROM sales
    WHERE owner_id = ${ownerId} ${periodFilter}
  `;
  const revenue = Number(row?.revenue ?? 0);
  const cost = Number(row?.cost ?? 0);
  return {
    period,
    saleCount: Number(row?.sale_count ?? 0),
    unitsSold: Number(row?.units_sold ?? 0),
    revenue,
    cost,
    profit: revenue - cost,
  };
}

export async function getCurrentMonthSales(ownerId) {
  return getSalesSummaryByPeriod(ownerId, 'this_month');
}

export async function getNextMonthReorderNeeds(ownerId) {
  const rows = await prisma.$queryRaw`
    SELECT p.name, p.sku, p.current_stock, p.reorder_level,
           c.name AS category,
           COALESCE(SUM(CASE
             WHEN date(s.created_at) >= date('now', 'localtime', '-30 days')
              AND date(s.created_at) < date('now', 'localtime')
             THEN s.quantity ELSE 0 END), 0) AS units_sold_30d
    FROM products p
    LEFT JOIN sales s ON s.product_id = p.id AND s.owner_id = ${ownerId}
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.owner_id = ${ownerId}
    GROUP BY p.id
    ORDER BY p.name ASC
  `;

  const products = rows.map((row) => {
    const soldRecently = Number(row.units_sold_30d ?? 0);
    const projectedDemand = Math.ceil(soldRecently);
    const reorderQty = Math.max(0, projectedDemand + Number(row.reorder_level) - Number(row.current_stock));
    return {
      name: row.name,
      sku: row.sku,
      stock: Number(row.current_stock),
      reorderLevel: Number(row.reorder_level),
      projectedDemand,
      reorderQty,
      category: row.category,
    };
  });

  return {
    basedOnDays: 30,
    hasRecentSales: rows.some((row) => Number(row.units_sold_30d ?? 0) > 0),
    products: products.filter((product) => product.reorderQty > 0),
  };
}

export async function getProductForecast(ownerId, query) {
  const resolved = await resolveSingleProduct(query, ownerId);
  if (resolved.error) return resolved;
  const product = resolved.product;
  const [periods] = await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(CASE
        WHEN date(created_at) >= date('now', 'localtime', '-29 days')
         AND date(created_at) <= date('now', 'localtime')
        THEN quantity ELSE 0 END), 0) AS units_30d,
      COALESCE(SUM(CASE
        WHEN date(created_at) >= date('now', 'localtime', 'start of month')
         AND date(created_at) <= date('now', 'localtime')
        THEN quantity ELSE 0 END), 0) AS units_mtd,
      COALESCE(SUM(CASE
        WHEN date(created_at) >= date('now', 'localtime', 'start of month')
         AND date(created_at) <= date('now', 'localtime')
        THEN quantity * sale_price ELSE 0 END), 0) AS revenue_mtd,
      COALESCE(SUM(CASE
        WHEN date(created_at) >= date('now', 'localtime', 'start of month', '-1 month')
         AND date(created_at) < date('now', 'localtime', 'start of month')
        THEN quantity ELSE 0 END), 0) AS units_previous_month,
      COUNT(CASE
        WHEN date(created_at) >= date('now', 'localtime', '-29 days')
         AND date(created_at) <= date('now', 'localtime') THEN 1 END) AS transactions_30d,
      CAST(strftime('%d', 'now', 'localtime') AS INTEGER) AS elapsed_month_days,
      CAST(strftime('%d', date('now', 'localtime', 'start of month', '+1 month', '-1 day')) AS INTEGER) AS days_in_month
    FROM sales
    WHERE owner_id = ${ownerId} AND product_id = ${product.id}
  `;
  const row = periods || {};
  const units30d = Number(row.units_30d || 0);
  const unitsMtd = Number(row.units_mtd || 0);
  const revenueMtd = Number(row.revenue_mtd || 0);
  const previousMonthUnits = Number(row.units_previous_month || 0);
  const monthDays = Number(row.days_in_month || 30);
  const elapsedDays = Number(row.elapsed_month_days || 1);
  let forecastUnits30d = units30d || previousMonthUnits;
  let forecastMtd = unitsMtd;
  let forecastBaseline = units30d > 0 ? 'the product’s last 30 days' : previousMonthUnits > 0 ? 'the product’s previous calendar month' : null;
  let coldStart = false;
  let hasCategoryBaseline = false;

  if (!forecastUnits30d) {
    const peers = await prisma.$queryRaw`
      SELECT p.id, p.category_id,
        COALESCE(SUM(CASE WHEN date(s.created_at) >= date('now', 'localtime', '-29 days')
          AND date(s.created_at) <= date('now', 'localtime') THEN s.quantity ELSE 0 END), 0) AS units_30d,
        COALESCE(SUM(CASE WHEN date(s.created_at) >= date('now', 'localtime', 'start of month')
          AND date(s.created_at) <= date('now', 'localtime') THEN s.quantity ELSE 0 END), 0) AS units_mtd
      FROM products p
      LEFT JOIN sales s ON s.product_id = p.id AND s.owner_id = ${ownerId}
      WHERE p.owner_id = ${ownerId} AND p.id != ${product.id}
      GROUP BY p.id
    `;
    const sellingPeers = peers.filter((peer) => Number(peer.units_30d) > 0);
    const sameCategory = sellingPeers.filter((peer) => peer.category_id === product.category_id);
    const baselinePeers = sameCategory.length ? sameCategory : sellingPeers;
    if (baselinePeers.length) {
      const median = (values) => {
        const sorted = values.map(Number).sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
      };
      forecastUnits30d = Math.round(median(baselinePeers.map((peer) => peer.units_30d)));
      const peerMonthPaces = baselinePeers.map((peer) => Number(peer.units_mtd) > 0
        ? Number(peer.units_mtd) / elapsedDays * monthDays
        : null).filter((value) => value != null);
      forecastMtd = peerMonthPaces.length ? Math.round(median(peerMonthPaces) * elapsedDays / monthDays) : 0;
      forecastBaseline = sameCategory.length
        ? 'median sales of products in the same category over the last 30 days'
        : 'median sales of other products in the shop over the last 30 days; this product has no category sales history';
      coldStart = true;
      hasCategoryBaseline = sameCategory.length > 0;
    }
  }

  const projectedMonthEndUnits = unitsMtd > 0
    ? Math.round(unitsMtd / elapsedDays * monthDays)
    : coldStart && forecastMtd > 0 ? Math.round(forecastMtd / elapsedDays * monthDays) : null;
  const projectedMonthEndRevenue = projectedMonthEndUnits == null ? null
    : unitsMtd > 0 ? Math.round(revenueMtd / elapsedDays * monthDays * 100) / 100
      : Math.round(projectedMonthEndUnits * product.sale_price * 100) / 100;
  const dailyVelocity = forecastUnits30d > 0 ? forecastUnits30d / 30 : 0;
  const projectedNext30DaysUnits = forecastUnits30d > 0 ? Math.round(forecastUnits30d) : null;
  const stockoutDays = dailyVelocity > 0 ? Math.floor(product.current_stock / dailyVelocity) : null;
  const confidence = Number(row.transactions_30d || 0) >= 10 ? 'higher'
    : Number(row.transactions_30d || 0) >= 3 ? 'moderate' : units30d > 0 ? 'limited' : 'insufficient';

  return {
    name: product.name,
    sku: product.sku,
    category: product.categories?.name ?? null,
    currentStock: product.current_stock,
    reorderLevel: product.reorder_level,
    unitsLast30Days: units30d,
    transactionsLast30Days: Number(row.transactions_30d || 0),
    unitsThisMonth: unitsMtd,
    previousMonthUnits,
    projectedMonthEndUnits,
    revenueThisMonth: revenueMtd,
    projectedMonthEndRevenue,
    projectedNext30DaysUnits,
    projectedNext30DaysRevenue: projectedNext30DaysUnits == null
      ? null : Math.round(projectedNext30DaysUnits * product.sale_price * 100) / 100,
    estimatedStockoutDays: stockoutDays,
    suggestedReorderQty: coldStart && !hasCategoryBaseline
      ? null
      : projectedNext30DaysUnits == null
        ? Math.max(0, product.reorder_level - product.current_stock)
        : Math.max(0, projectedNext30DaysUnits + product.reorder_level - product.current_stock),
    confidence: coldStart ? 'low (shop comparison)' : units30d > 0 ? confidence : previousMonthUnits > 0 ? 'limited' : 'insufficient',
    forecastBaseline,
    isColdStartEstimate: coldStart,
  };
}

function editDistanceAtMostOne(left, right) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else { i += 1; j += 1; }
  }
  if (i < left.length || j < right.length) edits += 1;
  return edits <= 1;
}

async function findProductMentionedInMessage(ownerId, message) {
  const results = await searchProducts(ownerId, message, 5);
  if (!results.length) return null;
  if (results.length > 1 && results[0].score === results[1].score) {
    return { error: `I found more than one product matching that name: ${results.slice(0, 5).map((p) => p.name).join(', ')}. Please specify one.` };
  }
  return results[0].product;
}

function wordsForSearch(value) {
  return String(value || '').toLocaleLowerCase().match(/[a-z0-9]+/g) || [];
}

function normalizedWord(value) {
  const word = String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

export async function searchProducts(ownerId, query, limit = 5) {
  const ignored = new Set(['a', 'an', 'and', 'are', 'available', 'by', 'check', 'current', 'do', 'does', 'for', 'from', 'have', 'how', 'i', 'in', 'is', 'it', 'me', 'many', 'my', 'of', 'on', 'product', 'products', 'quantity', 'sales', 'sell', 'selling', 'show', 'sold', 'stock', 'the', 'to', 'today', 'what', 'which', 'with']);
  const queryWords = wordsForSearch(query).map(normalizedWord).filter((word) => word.length > 1 && !ignored.has(word));
  if (!queryWords.length) return [];
  const products = await prisma.products.findMany({
    where: { owner_id: ownerId },
    include: { categories: true },
  });
  const matches = products.map((product) => {
    const fields = [product.name, product.sku, product.categories?.name].filter(Boolean);
    const fieldWords = fields.flatMap(wordsForSearch).map(normalizedWord);
    const compactFields = fields.map((value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, ''));
    let score = 0;
    let matched = 0;
    for (const queryWord of queryWords) {
      const exact = fieldWords.some((fieldWord) => fieldWord === queryWord);
      const close = !exact && fieldWords.some((fieldWord) => fieldWord.length >= 3 && queryWord.length >= 3 && editDistanceAtMostOne(fieldWord, queryWord));
      const compact = compactFields.some((field) => field.includes(queryWord));
      if (exact || close || compact) {
        matched += 1;
        score += exact ? 4 : close ? 2 : 1;
      }
    }
    if (queryWords.length > 1 && matched === queryWords.length) score += 3;
    return { product, score, matched };
  }).filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || b.matched - a.matched || a.product.name.localeCompare(b.product.name))
    .slice(0, Math.min(20, Math.max(1, Number(limit) || 5)));
  return matches;
}

export async function getProductForecastMentionedInMessage(ownerId, message) {
  const product = await findProductMentionedInMessage(ownerId, message);
  if (!product || product.error) return product;
  return getProductForecast(ownerId, product.name);
}

export async function getProductInfoMentionedInMessage(ownerId, message) {
  const product = await findProductMentionedInMessage(ownerId, message);
  if (!product || product.error) return product;
  return toProductRow(product);
}

export async function getProductSalesMentionedInMessage(ownerId, message, period = 'last_30_days') {
  const product = await findProductMentionedInMessage(ownerId, message);
  if (!product || product.error) return product;
  let periodFilter = Prisma.empty;
  switch (period) {
    case 'this_month':
      periodFilter = Prisma.sql`AND date(created_at) >= date('now', 'localtime', 'start of month') AND date(created_at) < date('now', 'localtime', 'start of month', '+1 month')`;
      break;
    case 'last_month':
      periodFilter = Prisma.sql`AND date(created_at) >= date('now', 'localtime', 'start of month', '-1 month') AND date(created_at) < date('now', 'localtime', 'start of month')`;
      break;
    case 'all_time':
      break;
    default:
      period = 'last_30_days';
      periodFilter = Prisma.sql`AND date(created_at) >= date('now', 'localtime', '-29 days') AND date(created_at) < date('now', 'localtime', '+1 day')`;
  }
  const [totals] = await prisma.$queryRaw`
    SELECT COUNT(*) AS sale_count,
           COALESCE(SUM(quantity), 0) AS units_sold,
           COALESCE(SUM(quantity * sale_price), 0) AS revenue,
           COALESCE(SUM(quantity * cost_price_at_sale), 0) AS cost
    FROM sales
    WHERE owner_id = ${ownerId} AND product_id = ${product.id} ${periodFilter}
  `;
  const revenue = Number(totals?.revenue || 0);
  const cost = Number(totals?.cost || 0);
  const observedDays = period === 'last_30_days' ? 30 : period === 'this_month' ? new Date().getDate() : null;
  return {
    name: product.name,
    category: product.categories?.name ?? null,
    stock: product.current_stock,
    period,
    saleCount: Number(totals?.sale_count || 0),
    unitsSold: Number(totals?.units_sold || 0),
    revenue,
    profit: revenue - cost,
    estimatedDaysOfStock: observedDays && Number(totals?.units_sold || 0) > 0
      ? Math.floor(product.current_stock / (Number(totals.units_sold) / observedDays))
      : null,
  };
}

export async function getSalesDrivenRestockRecommendations(ownerId) {
  const rows = await prisma.$queryRaw`
    SELECT p.name, p.sku, p.current_stock, p.reorder_level, p.sale_price,
           c.name AS category,
           COALESCE(SUM(CASE
             WHEN date(s.created_at) >= date('now', 'localtime', '-29 days')
              AND date(s.created_at) <= date('now', 'localtime')
             THEN s.quantity ELSE 0 END), 0) AS units_30d,
           COALESCE(SUM(CASE
             WHEN date(s.created_at) >= date('now', 'localtime', '-29 days')
              AND date(s.created_at) <= date('now', 'localtime')
             THEN s.quantity * s.sale_price ELSE 0 END), 0) AS revenue_30d
    FROM products p
    LEFT JOIN sales s ON s.product_id = p.id AND s.owner_id = ${ownerId}
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.owner_id = ${ownerId}
    GROUP BY p.id
    ORDER BY units_30d DESC, p.name ASC
  `;

  return rows
    .map((row) => {
      const units30d = Number(row.units_30d || 0);
      const dailyVelocity = units30d / 30;
      const coverageDays = dailyVelocity > 0 ? Math.floor(Number(row.current_stock) / dailyVelocity) : null;
      return {
        name: row.name,
        sku: row.sku,
        category: row.category,
        stock: Number(row.current_stock),
        reorderLevel: Number(row.reorder_level),
        unitsSold30Days: units30d,
        revenue30Days: Number(row.revenue_30d || 0),
        estimatedDaysOfStock: coverageDays,
        suggestedOrderQty: Math.max(0, Math.ceil(units30d + Number(row.reorder_level) - Number(row.current_stock))),
      };
    })
    .filter((product) => product.unitsSold30Days > 0)
    .slice(0, 5);
}

export async function getTopSellingProducts(ownerId, period = 'all_time', category = '', limit = 5, days = null) {
  let periodFilter = Prisma.empty;
  switch (period) {
    case 'today':
      periodFilter = Prisma.sql`AND date(s.created_at) = date('now', 'localtime')`;
      break;
    case 'this_month':
      periodFilter = Prisma.sql`AND date(s.created_at) >= date('now', 'localtime', 'start of month') AND date(s.created_at) < date('now', 'localtime', 'start of month', '+1 month')`;
      break;
    case 'last_month':
      periodFilter = Prisma.sql`AND date(s.created_at) >= date('now', 'localtime', 'start of month', '-1 month') AND date(s.created_at) < date('now', 'localtime', 'start of month')`;
      break;
    case 'last_7_days':
      periodFilter = Prisma.sql`AND date(s.created_at) >= date('now', 'localtime', '-6 days') AND date(s.created_at) < date('now', 'localtime', '+1 day')`;
      break;
    case 'last_30_days':
      periodFilter = Prisma.sql`AND date(s.created_at) >= date('now', 'localtime', '-29 days') AND date(s.created_at) < date('now', 'localtime', '+1 day')`;
      break;
    case 'this_year':
      periodFilter = Prisma.sql`AND date(s.created_at) >= date('now', 'localtime', 'start of year') AND date(s.created_at) < date('now', 'localtime', 'start of year', '+1 year')`;
      break;
    default:
      break;
  }
  if (Number.isInteger(Number(days)) && Number(days) > 0) {
    const windowDays = Math.min(3650, Number(days));
    periodFilter = Prisma.sql`AND date(s.created_at) >= date('now', 'localtime', ${`-${windowDays - 1} days`}) AND date(s.created_at) < date('now', 'localtime', '+1 day')`;
  }
  const categoryFilter = category ? Prisma.sql`AND c.name LIKE ${`%${category}%`}` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    SELECT p.name, p.sku, p.current_stock, p.sale_price, c.name AS category,
           SUM(s.quantity) AS units_sold,
           SUM(s.quantity * s.sale_price) AS revenue
    FROM sales s
    JOIN products p ON p.id = s.product_id AND p.owner_id = ${ownerId}
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE s.owner_id = ${ownerId} ${periodFilter} ${categoryFilter}
    GROUP BY p.id
    ORDER BY units_sold DESC, revenue DESC, p.name ASC
    LIMIT ${Math.min(20, Math.max(1, Number(limit) || 5))}
  `;
  return rows.map((row) => ({
    name: row.name,
    sku: row.sku,
    stock: Number(row.current_stock),
    salePrice: Number(row.sale_price),
    category: row.category,
    unitsSold: Number(row.units_sold),
    revenue: Number(row.revenue),
  }));
}

function validIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

async function salesByPeriod(ownerId, input) {
  const { from, to } = input;
  if ((from && !validIsoDate(from)) || (to && !validIsoDate(to))) return { error: 'from and to must be ISO dates in YYYY-MM-DD format.' };
  if (from && to && from > to) return { error: 'from must be on or before to.' };
  let productFilter = Prisma.empty;
  let productName = null;
  if (input.product) {
    const resolved = await resolveSingleProduct(input.product, ownerId);
    if (resolved.error) return resolved;
    productName = resolved.product.name;
    productFilter = Prisma.sql`AND s.product_id = ${resolved.product.id}`;
  }
  const dateFilter = Prisma.sql`${from ? Prisma.sql`AND date(s.created_at) >= date(${from})` : Prisma.empty} ${to ? Prisma.sql`AND date(s.created_at) <= date(${to})` : Prisma.empty}`;
  const [totals] = await prisma.$queryRaw`
    SELECT COUNT(*) AS sale_count, COALESCE(SUM(s.quantity), 0) AS units,
      COALESCE(SUM(s.quantity * s.sale_price), 0) AS revenue,
      COALESCE(SUM(s.quantity * s.cost_price_at_sale), 0) AS cost
    FROM sales s WHERE s.owner_id = ${ownerId} ${dateFilter} ${productFilter}
  `;
  const dailyRows = await prisma.$queryRaw`
    SELECT date(s.created_at) AS day, SUM(s.quantity) AS units,
      SUM(s.quantity * s.sale_price) AS revenue,
      SUM(s.quantity * (s.sale_price - s.cost_price_at_sale)) AS profit
    FROM sales s WHERE s.owner_id = ${ownerId} ${dateFilter} ${productFilter}
    GROUP BY date(s.created_at) ORDER BY day ASC LIMIT 90
  `;
  const revenue = Number(totals?.revenue || 0);
  const cost = Number(totals?.cost || 0);
  return {
    from: from || null, to: to || null, product: productName,
    saleCount: Number(totals?.sale_count || 0), units: Number(totals?.units || 0),
    revenue, profit: revenue - cost,
    byDay: dailyRows.map((row) => ({ day: row.day, units: Number(row.units), revenue: Number(row.revenue), profit: Number(row.profit) })),
  };
}

async function slowMovingProducts(ownerId, days = 30) {
  const windowDays = Math.min(3650, Math.max(1, Number(days) || 30));
  const rows = await prisma.$queryRaw`
    SELECT p.name, p.sku, p.current_stock, p.reorder_level, c.name AS category,
      COALESCE(SUM(CASE WHEN date(s.created_at) >= date('now', 'localtime', ${`-${windowDays - 1} days`})
        AND date(s.created_at) < date('now', 'localtime', '+1 day') THEN s.quantity ELSE 0 END), 0) AS units_sold,
      MAX(date(s.created_at)) AS last_sale
    FROM products p LEFT JOIN sales s ON s.product_id = p.id AND s.owner_id = ${ownerId}
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.owner_id = ${ownerId} AND p.current_stock > 0
    GROUP BY p.id HAVING units_sold <= 2 ORDER BY units_sold ASC, last_sale ASC LIMIT 50
  `;
  return rows.map((row) => ({ name: row.name, sku: row.sku, stock: Number(row.current_stock), reorderLevel: Number(row.reorder_level), category: row.category, unitsSold: Number(row.units_sold), lastSale: row.last_sale, days }));
}

async function stockHistory(ownerId, query, limit = 20) {
  const resolved = await resolveSingleProduct(query, ownerId);
  if (resolved.error) return resolved;
  const rows = await prisma.$queryRaw`
    SELECT change, reason, created_at FROM stock_logs
    WHERE product_id = ${resolved.product.id}
    ORDER BY created_at DESC LIMIT ${Math.min(100, Math.max(1, Number(limit) || 20))}
  `;
  return { product: resolved.product.name, entries: rows.map((row) => ({ change: Number(row.change), reason: row.reason, createdAt: row.created_at })) };
}

async function categorySummary(ownerId) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(c.name, 'Uncategorized') AS category, COUNT(p.id) AS products,
      COALESCE(SUM(p.current_stock), 0) AS stock_units,
      COALESCE(SUM(p.current_stock * p.sale_price), 0) AS stock_value
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.owner_id = ${ownerId} GROUP BY c.id ORDER BY category ASC
  `;
  return rows.map((row) => ({ category: row.category, productCount: Number(row.products), stockUnits: Number(row.stock_units), stockValue: Number(row.stock_value) }));
}

async function recentNotifications(ownerId, input = {}) {
  const rows = await prisma.notifications.findMany({
    where: { owner_id: ownerId, ...(input.unreadOnly ? { is_read: 0 } : {}) },
    include: { products: { select: { name: true } } },
    orderBy: { created_at: 'desc' }, take: Math.min(50, Math.max(1, Number(input.limit) || 10)),
  });
  return rows.map((row) => ({ type: row.type, message: row.message, product: row.products?.name ?? null, isRead: Boolean(row.is_read), createdAt: row.created_at }));
}

async function inventoryOverview(ownerId) {
  const [inventory] = await prisma.$queryRaw`
    SELECT COUNT(*) AS products, COALESCE(SUM(current_stock), 0) AS stock_units,
      COALESCE(SUM(current_stock * sale_price), 0) AS stock_value,
      COALESCE(SUM(CASE WHEN current_stock <= reorder_level THEN 1 ELSE 0 END), 0) AS low_stock
    FROM products WHERE owner_id = ${ownerId}
  `;
  const sales = await getSalesSummaryByPeriod(ownerId, 'all_time');
  return { productCount: Number(inventory.products), stockUnits: Number(inventory.stock_units), stockValue: Number(inventory.stock_value), lowStockCount: Number(inventory.low_stock), revenue: sales.revenue, profit: sales.profit, saleCount: sales.saleCount };
}

// A compact, owner-scoped snapshot gives the language model enough real
// context to answer varied shop questions while the tools remain available
// for exact, product-specific lookups and actions.
export async function getStockroomAssistantContext(ownerId) {
  const [products, categories, thisMonth, lastMonth, last7Days, last30Days, insights, forecast] = await Promise.all([
    prisma.products.findMany({
      where: { owner_id: ownerId },
      include: { categories: true },
      orderBy: { name: 'asc' },
      take: 100,
    }),
    getProductCategories(ownerId),
    getSalesSummaryByPeriod(ownerId, 'this_month'),
    getSalesSummaryByPeriod(ownerId, 'last_month'),
    getSalesSummaryByPeriod(ownerId, 'last_7_days'),
    getSalesSummaryByPeriod(ownerId, 'last_30_days'),
    computeInsights(ownerId),
    computeForecast(ownerId),
  ]);

  const [{ totalProducts }] = await prisma.$queryRaw`
    SELECT COUNT(*) AS totalProducts FROM products WHERE owner_id = ${ownerId}
  `;

  return {
    products: products.map((p) => ({
      name: p.name,
      sku: p.sku,
      category: p.categories?.name ?? null,
      stock: p.current_stock,
      reorderLevel: p.reorder_level,
      salePrice: p.sale_price,
      costPrice: p.cost_price,
      marginPercent: p.sale_price > 0
        ? Math.round(((p.sale_price - p.cost_price) / p.sale_price) * 1000) / 10
        : null,
    })),
    productCount: Number(totalProducts),
    productsTruncated: Number(totalProducts) > products.length,
    categories,
    sales: { thisMonth, lastMonth, last7Days, last30Days },
    insights,
    forecast,
  };
}

// Resolves a free-text query to exactly one product row, or an { error }
// describing why not (none found / ambiguous). Shared by every tool that
// writes data, so a write can never silently land on the wrong product.
async function resolveSingleProduct(query, ownerId) {
  if (!query || typeof query !== 'string') return { error: 'A product query is required.' };
  let matches = await prisma.products.findMany({
    where: {
      owner_id: ownerId,
      OR: [{ name: { contains: query } }, { sku: { contains: query } }],
    },
    include: { categories: true },
    take: 5,
  });

  // Match small formatting differences such as "iPhone 18" vs "Iphone18".
  if (matches.length === 0) {
    const normalizedQuery = query.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalizedQuery) {
      const allProducts = await prisma.products.findMany({
        where: { owner_id: ownerId },
        include: { categories: true },
      });
      matches = allProducts.filter((product) => {
        const name = product.name.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
        const sku = product.sku.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
        return name.includes(normalizedQuery) || sku.includes(normalizedQuery);
      }).slice(0, 5);
    }
  }

  if (matches.length === 0) {
    const fuzzy = await searchProducts(ownerId, query, 5);
    const confident = fuzzy.filter((match) => match.score >= 2);
    if (confident.length) {
      const bestScore = confident[0].score;
      matches = confident.filter((match) => match.score === bestScore).map((match) => match.product);
    }
  }
  if (matches.length === 0) return { error: `No product matches "${query}".` };
  if (matches.length > 1) {
    return {
      error: `Multiple products match "${query}": ${matches.map((m) => m.name).join(', ')}. Ask the user which one, or call again with a more specific query.`,
    };
  }
  return { product: matches[0] };
}

function toProductRow(p) {
  return {
    name: p.name,
    sku: p.sku,
    sale_price: p.sale_price,
    cost_price: p.cost_price,
    current_stock: p.current_stock,
    reorder_level: p.reorder_level,
    category: p.categories ? p.categories.name : null,
  };
}

async function executeTool(name, input = {}, ownerId) {
  switch (name) {
    case 'search_products':
      return (await searchProducts(ownerId, input.query, input.limit || 5)).map(({ product, score }) => ({ ...toProductRow(product), score }));

    case 'get_sales_by_period':
      return salesByPeriod(ownerId, input);

    case 'get_slow_moving_products':
      return slowMovingProducts(ownerId, input.days);

    case 'get_stock_history':
      return stockHistory(ownerId, input.query, input.limit);

    case 'get_category_summary':
      return categorySummary(ownerId);

    case 'get_recent_notifications':
      return recentNotifications(ownerId, input);

    case 'get_inventory_overview':
      return inventoryOverview(ownerId);

    case 'get_product_categories':
      return getProductCategories(ownerId);

    case 'get_out_of_stock_products':
      return getOutOfStockProducts(ownerId);

    case 'get_next_month_reorder_needs':
      return getNextMonthReorderNeeds(ownerId);

    case 'get_low_stock_products': {
      const rows = await prisma.$queryRaw`
        SELECT name, sku, current_stock, reorder_level
        FROM products
        WHERE owner_id = ${ownerId} AND current_stock <= reorder_level
        ORDER BY current_stock ASC
      `;
      return rows.map((r) => ({
        name: r.name,
        sku: r.sku,
        current_stock: Number(r.current_stock),
        reorder_level: Number(r.reorder_level),
      }));
    }

    case 'get_product_info': {
      const resolved = await resolveSingleProduct(input.query, ownerId);
      return resolved.error ? resolved : toProductRow(resolved.product);
    }

    case 'list_products': {
      const limit = Math.min(100, Math.max(1, Number(input.limit) || 50));
      const where = { owner_id: ownerId };
      if (input.category) where.categories = { is: { name: { contains: input.category } } };
      const rows = await prisma.products.findMany({
        where,
        include: { categories: true },
        orderBy: { name: 'asc' },
        take: limit,
      });
      return rows.map((p) => ({
        name: p.name,
        sku: p.sku,
        current_stock: p.current_stock,
        sale_price: p.sale_price,
        category: p.categories ? p.categories.name : null,
      }));
    }

    case 'get_sales_summary': {
      return getSalesSummaryByPeriod(ownerId, input.period || 'all_time');
    }

    case 'get_top_selling_products':
      return getTopSellingProducts(ownerId, input.period || 'all_time', input.category || '', input.limit, input.days);

    case 'get_product_sales': {
      return getProductSalesMentionedInMessage(ownerId, input.query, input.period || 'last_30_days');
    }

    case 'get_forecast':
      return computeForecast(ownerId);

    case 'get_product_forecast':
      return getProductForecastMentionedInMessage(ownerId, input.query);

    case 'get_sales_driven_restock_recommendations':
      return getSalesDrivenRestockRecommendations(ownerId);

    case 'get_business_insights':
      return computeInsights(ownerId);

    case 'adjust_stock': {
      const delta = Number(input.change);
      if (!Number.isInteger(delta) || delta === 0) {
        return { error: 'change must be a non-zero integer.' };
      }
      if (Math.abs(delta) > MAX_STOCK_DELTA) {
        return { error: `Change of ${delta} is larger than the ${MAX_STOCK_DELTA}-unit safety limit for a single action. Split it into smaller adjustments.` };
      }
      const resolved = await resolveSingleProduct(input.query, ownerId);
      if (resolved.error) return resolved;

      try {
        const newStock = await prisma.$transaction((tx) =>
          applyStockChange(tx, resolved.product.id, delta, input.reason || 'ai_agent')
        );
        return {
          product: resolved.product.name,
          sku: resolved.product.sku,
          previousStock: resolved.product.current_stock,
          change: delta,
          newStock,
        };
      } catch (err) {
        return { error: err.message || 'Could not adjust stock.' };
      }
    }

    case 'record_sale': {
      const qty = Number(input.quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        return { error: 'quantity must be a positive integer.' };
      }
      const resolved = await resolveSingleProduct(input.query, ownerId);
      if (resolved.error) return resolved;
      const product = resolved.product;

      if (product.current_stock < qty) {
        return { error: `Only ${product.current_stock} of ${product.name} in stock — cannot sell ${qty}.` };
      }
      const priceUsed = input.salePrice != null && Number.isFinite(Number(input.salePrice))
        ? Number(input.salePrice)
        : product.sale_price;

      try {
        const sale = await prisma.$transaction(async (tx) => {
          const created = await tx.sales.create({
            data: {
              product_id: product.id,
              owner_id: ownerId,
              quantity: qty,
              sale_price: priceUsed,
              cost_price_at_sale: product.cost_price,
              created_at: new Date().toISOString(),
            },
          });
          await applyStockChange(tx, product.id, -qty, 'sale');
          return created;
        });

        return {
          product: product.name,
          sku: product.sku,
          quantity: qty,
          salePrice: priceUsed,
          revenue: Math.round(priceUsed * qty * 100) / 100,
          saleId: sale.id,
        };
      } catch (err) {
        return { error: err.message || 'Could not record sale.' };
      }
    }

    case 'create_reorder_suggestion': {
      if (!input.message) return { error: 'message is required.' };
      const resolved = await resolveSingleProduct(input.query, ownerId);
      if (resolved.error) return resolved;

      await prisma.notifications.create({
        data: {
          product_id: resolved.product.id,
          owner_id: ownerId,
          type: 'reorder_suggestion',
          message: input.message,
        },
      });
      return { created: true, product: resolved.product.name };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export async function runTool(name, input = {}, ownerId) {
  let args = input;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); }
    catch { return { error: 'Tool arguments were not valid JSON.' }; }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { error: 'Tool arguments must be a JSON object.' };
  try {
    const result = await executeTool(name, args, ownerId);
    const rowCount = Array.isArray(result) ? result.length
      : Array.isArray(result?.entries) ? result.entries.length
        : Array.isArray(result?.byDay) ? result.byDay.length : result == null ? 0 : 1;
    console.info(`[chat-tool] ${name} args=${JSON.stringify(args)} rows=${rowCount}`);
    return result;
  } catch (error) {
    console.error(`[chat-tool] ${name} failed:`, error?.message || error);
    return { error: error?.message || 'Tool query failed.' };
  }
}
