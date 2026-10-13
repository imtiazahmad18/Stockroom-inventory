// agent.js — the Stockroom agent loop.
//
// This is what makes the chatbot an *agent* rather than a Q&A prompt: on
// each turn the model either asks to call one of the tools in
// chatTools.js (read data, adjust stock, record a sale, create a reorder
// suggestion...) or gives a final answer. We execute the tool, feed the
// result back, and loop until it's done or MAX_STEPS is hit.
//
// The underlying DeepAIChat client (ai.mjs) has no native function-calling
// API — it's plain chat completion — so the protocol is enforced entirely
// through the system prompt: the model must always reply with one strict
// JSON object, either {"type":"tool_call",...} or a final answer.

import { DeepAIChat } from './ai.mjs';
import {
  toolDefinitions,
  runTool,
  getProductCategories,
  getOutOfStockProducts,
  getCurrentMonthSales,
  getNextMonthReorderNeeds,
  getStockroomAssistantContext,
  getProductForecastMentionedInMessage,
  getProductInfoMentionedInMessage,
  getProductSalesMentionedInMessage,
  getSalesDrivenRestockRecommendations,
  getTopSellingProducts,
} from './chatTools.js';

const MAX_STEPS = 6;

function money(value) {
  const amount = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(value);
  return `Rs ${amount}`;
}

function isForecastIntent(text) {
  // The DeepAI client sometimes receives common spelling mistakes from chat;
  // recognize "futrure" as well as "future" instead of falling through to it.
  return /\b(?:predict|forecast|fut\w{0,5}|project|estimate|expected|outlook)\b/i.test(String(text || ''));
}

async function answerFromDatabase(message, ownerId) {
  const text = String(message || '').trim();
  if (/^(?:hi|hello|hey|good morning|good afternoon|good evening)[!.\s]*$/i.test(text)) {
    return { type: 'text', message: 'Hi! I can help with your stock, product sales, reorders, and forecasts. What would you like to check?', items: [], actions: [] };
  }

  if (/^(?:thanks?|thank you|thx|cheers)(?:\b|[!.\s])/i.test(text)) {
    return { type: 'text', message: "You're welcome! Ask me anytime about your stock or sales.", items: [], actions: [] };
  }

  if (/\b(?:what|which|show|list|any|are there).{0,45}\b(?:out of stock|stockout|stocked out)\b|\bwhat is out of stock\b/i.test(text)) {
    const products = await runTool('get_out_of_stock_products', {}, ownerId);
    const messageText = products.length
      ? `Out of stock (${products.length}): ${products.map((p) => `${p.name}${p.category ? ` — ${p.category}` : ''}`).join(', ')}.`
      : 'There are no out-of-stock products right now.';
    return {
      type: 'out_of_stock', message: messageText,
      items: products.map((p) => ({ name: p.name, stock: 0, category: p.category })), actions: [],
    };
  }

  if (/\b(?:product )?categories\b/i.test(text) && /\b(?:what|which|list|show|have|are)\b/i.test(text)) {
    const categories = await runTool('get_product_categories', {}, ownerId);
    const messageText = categories.length
      ? `Product categories: ${categories.map((c) => `${c.name} (${c.productCount})`).join(', ')}.`
      : 'You don’t have any product categories yet.';
    return { type: 'text', message: messageText, items: [], actions: [] };
  }

  const asksForProductList = /\b(?:what|which|show|list|name|tell me)\b.{0,35}\b(?:my\s+)?(?:products?|items?)\b/i.test(text) ||
    /\b(?:my|all)\s+(?:products?|items?)\b/i.test(text);
  if (asksForProductList && !/\b(?:sales?|sold|selling|forecast|predict)\b/i.test(text)) {
    const products = await runTool('list_products', {}, ownerId);
    if (!products.length) {
      return { type: 'text', message: 'You don’t have any products in your inventory yet.', items: [], actions: [] };
    }
    const names = products.map((product) => `${product.name} (${product.current_stock} in stock)`).join('; ');
    return {
      type: 'text',
      message: `You have ${products.length} product${products.length === 1 ? '' : 's'}: ${names}.`,
      items: products.map((product) => ({ name: product.name, stock: product.current_stock, salePrice: product.sale_price, category: product.category })),
      actions: [],
    };
  }

  if (/\bhow many\b/i.test(text) && /\b(?:products?|items?)\b/i.test(text)) {
    const products = await runTool('list_products', { limit: 100 }, ownerId);
    return { type: 'text', message: `You have ${products.length} product${products.length === 1 ? '' : 's'} in your inventory.`, items: products.map((p) => ({ name: p.name, stock: p.current_stock, category: p.category })), actions: [] };
  }

  if (/\b(?:stock value|inventory value)\b/i.test(text) && /\bcategory|each|by\b/i.test(text)) {
    const rows = await runTool('get_category_summary', {}, ownerId);
    return { type: 'text', message: rows.length ? `Stock value by category: ${rows.map((row) => `${row.category}: ${money(row.stockValue)} (${row.stockUnits} units)`).join('; ')}.` : 'There is no inventory to value yet.', items: [], actions: [] };
  }

  if (/\b(?:low(?:\s+on)? stock|running low|below reorder|need(?:s)? restock|what'?s low)\b/i.test(text)) {
    const rows = await runTool('get_low_stock_products', {}, ownerId);
    return { type: 'low_stock', message: rows.length ? `Low-stock products: ${rows.map((row) => `${row.name} (${row.current_stock} in stock, reorder at ${row.reorder_level})`).join('; ')}.` : 'No products are currently at or below their reorder levels.', items: rows.map((row) => ({ name: row.name, stock: row.current_stock, reorderLevel: row.reorder_level, status: row.current_stock === 0 ? 'out_of_stock' : 'low' })), actions: [] };
  }

  if (/\b(?:haven['’]?t|have not|not) sold\b|\bslow[ -]?moving\b|\b(?:no|zero) sales\b/i.test(text)) {
    const days = Number(text.match(/\b(\d+)\s+days?\b/i)?.[1]) || 30;
    const rows = await runTool('get_slow_moving_products', { days }, ownerId);
    return { type: 'text', message: rows.length ? `Products with little or no sales in the last ${days} days: ${rows.map((row) => `${row.name} (${row.unitsSold} sold, ${row.stock} in stock${row.lastSale ? `; last sale ${row.lastSale}` : '; no recorded sale'})`).join('; ')}.` : `No slow-moving products were found in the last ${days} days.`, items: rows.map((row) => ({ name: row.name, stock: row.stock, category: row.category })), actions: [] };
  }

  if (/\b(?:stock history|stock changes|restock history|history of)\b/i.test(text)) {
    const result = await runTool('get_stock_history', { query: text, limit: 20 }, ownerId);
    if (result.error) return { type: 'text', message: `${result.error} Try including the product name.`, items: [], actions: [] };
    return { type: 'text', message: result.entries.length ? `Recent stock history for ${result.product}: ${result.entries.map((entry) => `${entry.createdAt}: ${entry.change > 0 ? '+' : ''}${entry.change} (${entry.reason})`).join('; ')}.` : `No stock history is recorded for ${result.product}.`, items: [], actions: [] };
  }

  if (/\b(?:revenue|sales|profit)\b/i.test(text) && /\b(?:today|this week|last 7 days)\b/i.test(text) && !isForecastIntent(text)) {
    const now = new Date();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(now);
    const to = today;
    const from = /\b(?:this week|last 7 days)\b/i.test(text)
      ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date(now.getTime() - 6 * 86400000)) : today;
    const summary = await runTool('get_sales_by_period', { from, to }, ownerId);
    const label = from === to ? 'today' : 'the last 7 days';
    return { type: 'text', message: `${label[0].toUpperCase()}${label.slice(1)}: ${summary.units} units across ${summary.saleCount} sales, ${money(summary.revenue)} revenue, and ${money(summary.profit)} profit.`, items: [], actions: [] };
  }

  const asksProductFact = (/\b(?:stock|inventory|quantity|available|price|cost|category|sku|reorder level)\b/i.test(text) &&
    /\b(?:what|which|how|show|tell|is|does|give|check|current)\b/i.test(text)) ||
    /\bhow many\b/i.test(text);
  if (asksProductFact) {
    const product = await runTool('get_product_info', { query: text }, ownerId);
    if (product?.error) {
      const suggestions = await runTool('search_products', { query: text, limit: 3 }, ownerId);
      if (/\bhow many\b/i.test(text) && suggestions.length > 1) {
        return { type: 'text', message: `I found several matching products: ${suggestions.map((p) => `${p.name} (${p.current_stock} in stock)`).join('; ')}.`, items: suggestions.map((p) => ({ name: p.name, stock: p.current_stock, category: p.category })), actions: [] };
      }
      const suggestionText = suggestions.length ? ` Did you mean ${suggestions.map((p) => p.name).join(', ')}?` : '';
      return { type: 'text', message: `I couldn’t find a matching product.${suggestionText}`, items: suggestions.map((p) => ({ name: p.name, stock: p.current_stock, category: p.category })), actions: [] };
    }
    if (product) {
      const facts = [];
      if (/\b(?:stock|inventory|quantity|available)\b/i.test(text) || /\bhow many\b/i.test(text)) {
        facts.push(`${product.current_stock} units in stock`);
        facts.push(`reorder level ${product.reorder_level}`);
      }
      if (/\b(?:price|cost)\b/i.test(text)) facts.push(`sale price ${money(product.sale_price)}`);
      if (/\bcost\b/i.test(text)) facts.push(`cost ${money(product.cost_price)}`);
      if (/\bcategory\b/i.test(text)) facts.push(`category ${product.category || 'uncategorized'}`);
      if (/\bsku\b/i.test(text)) facts.push(`SKU ${product.sku}`);
      return {
        type: 'text',
        message: `${product.name}: ${facts.join('; ')}.`,
        items: [{ name: product.name, stock: product.current_stock, salePrice: product.sale_price, category: product.category }],
        actions: [],
      };
    }
  }

  const asksAggregateSales = /\b(?:sales?|revenue|profit)\b/i.test(text) &&
    (/\b(?:today|this week|last 7 days|this month|month to date|last month|last 30 days|all time|ever)\b/i.test(text) || /\bmy sales\b/i.test(text));
  if (asksAggregateSales && !/\b(?:according to|based on)\s+(?:my\s+)?sales\b|\bwhich\s+(?:product|item)s?\b.*\b(?:increase|restock|order|stock up|prioritize)\b/i.test(text)) {
    const matches = await runTool('search_products', { query: text, limit: 1 }, ownerId);
    const likelyProduct = Array.isArray(matches) && matches[0]?.score >= 4;
    if (!likelyProduct) {
      const period = /\btoday\b/i.test(text) ? 'today'
        : /\bthis week\b|\blast 7 days\b/i.test(text) ? 'last_7_days'
          : /\bthis month\b|\bmonth to date\b/i.test(text) ? 'this_month'
            : /\blast month\b/i.test(text) ? 'last_month'
              : /\blast 30 days\b/i.test(text) ? 'last_30_days' : 'all_time';
      const summary = await runTool('get_sales_summary', { period }, ownerId);
      const label = period === 'all_time' ? 'all time' : period.replaceAll('_', ' ');
      return { type: 'text', message: summary.saleCount ? `${label[0].toUpperCase()}${label.slice(1)}: ${summary.saleCount} sales covering ${summary.unitsSold} units, ${money(summary.revenue)} revenue, and ${money(summary.profit)} profit.` : `No sales have been recorded ${label}.`, items: [], actions: [] };
    }
  }

  const asksProductSales = /\b(?:selling|sales|sold|sell|performance)\b/i.test(text) &&
    !/\b(?:top|best|highest)[-\s]+(?:selling|seller|sold|performing)|\b(?:most popular|best sellers?)\b|\b(?:according to|based on)\s+(?:my\s+)?sales\b.*\b(?:increase|restock|order|stock up|prioritize)\b|\bwhy\b.*\bsales?\b|\b(?:sales?\s+)?(?:trend|declin|dropped?|fell|anomal|insight)/i.test(text);
  if (asksProductSales) {
    const period = /\bthis month\b|\bmonth to date\b/i.test(text) ? 'this_month'
      : /\blast month\b/i.test(text) ? 'last_month'
        : /\ball time\b|\bever\b/i.test(text) ? 'all_time' : 'last_30_days';
    const sales = await runTool('get_product_sales', { query: text, period }, ownerId);
    if (sales?.error) {
      const suggestions = await runTool('search_products', { query: text, limit: 3 }, ownerId);
      const suggestionText = suggestions.length ? ` Did you mean ${suggestions.map((p) => p.name).join(', ')}?` : '';
      return { type: 'text', message: `I couldn’t find a matching product to check sales for.${suggestionText}`, items: [], actions: [] };
    }
    if (!sales) {
      return { type: 'text', message: 'I couldn’t match a product name in that question. Please include the product name or SKU and I’ll look up its sales.', items: [], actions: [] };
    }
    if (sales) {
      const periodLabel = period === 'all_time' ? 'all time' : period.replaceAll('_', ' ');
      const resultMessage = sales.unitsSold === 0
        ? `${sales.name} has no sales recorded ${periodLabel}. It currently has ${sales.stock} units in stock.`
        : `${sales.name} sold ${sales.unitsSold} units ${periodLabel}, generating ${money(sales.revenue)} revenue and ${money(sales.profit)} gross profit. Current stock is ${sales.stock}${sales.estimatedDaysOfStock == null ? '' : `, about ${sales.estimatedDaysOfStock} days at this sales rate`}.`;
      return {
        type: 'text', message: resultMessage,
        items: [{ name: sales.name, stock: sales.stock, category: sales.category }],
        actions: [],
      };
    }
  }

  const asksSalesDrivenIncrease = /(?:according to|based on)\s+(?:my\s+)?sales/i.test(text) &&
    /\b(?:which|what|recommend|should|increase|restock|order|stock up)\b/i.test(text);
  const asksWhichProductToIncrease = /\b(?:which|what)\s+(?:product|item)s?\b.*\b(?:increase|restock|order|stock up|prioritize)\b/i.test(text);
  if (asksSalesDrivenIncrease || asksWhichProductToIncrease) {
    const recommendations = await runTool('get_sales_driven_restock_recommendations', {}, ownerId);
    if (!recommendations.length) {
      return { type: 'text', message: 'There are no sales in the last 30 days to rank products by demand. Record sales for a few weeks and I can identify which products are gaining traction.', items: [], actions: [] };
    }
    const top = recommendations[0];
    const messageText = `${top.name} is the first product I’d consider increasing: it sold ${top.unitsSold30Days} units in the last 30 days and has ${top.stock} in stock${top.estimatedDaysOfStock == null ? '' : `, about ${top.estimatedDaysOfStock} days of stock at that rate`}. To cover another 30 days of similar demand and reach its reorder buffer, the estimate is to order ${top.suggestedOrderQty} units. This is a sales-based suggestion, not an inventory change.`;
    return {
      type: 'text', message: messageText,
      items: recommendations.map((product) => ({ name: product.name, stock: product.stock, reorderQty: product.suggestedOrderQty, category: product.category })),
      actions: [],
    };
  }

  if (/\b(?:top\s+\d*\s*(?:selling|sellers?)|(?:best|highest)[-\s]+(?:selling|seller|sold|performing)|\b(?:most popular|best sellers?)\b)/i.test(text)) {
    const period = /\bthis week\b/i.test(text) ? 'last_7_days'
      : /\bthis month\b|\bmonth to date\b/i.test(text) ? 'this_month'
      : /\blast month\b/i.test(text) ? 'last_month'
        : /\blast 7 days\b/i.test(text) ? 'last_7_days'
          : /\blast 30 days\b|\brecent(?:ly)?\b/i.test(text) ? 'last_30_days' : 'all_time';
    const categoryMatch = text.match(/\b(?:in|from)\s+(?:the\s+)?["'“]?(.+?)["'”]?\s+category\b/i);
    const category = categoryMatch?.[1]?.trim() || '';
    const topLimit = Number(text.match(/\btop\s+(\d+)\b/i)?.[1]) || 5;
    const products = await runTool('get_top_selling_products', { period, category, limit: topLimit }, ownerId);
    if (!products.length) {
      const scope = [category && `in ${category}`, period !== 'all_time' && `during ${period.replaceAll('_', ' ')}`].filter(Boolean).join(' ');
      return { type: 'text', message: `No product sales were recorded${scope ? ` ${scope}` : ''}.`, items: [], actions: [] };
    }
    const periodLabel = period === 'all_time' ? 'all time' : period.replaceAll('_', ' ');
    const categoryLabel = category ? ` in ${category}` : '';
    const top = products[0];
    const others = products.slice(1).map((product) => `${product.name} (${product.unitsSold} units)`).join(', ');
    return {
      type: 'text',
      message: `Top-selling${categoryLabel} ${periodLabel}, ranked by units sold: ${top.name} leads with ${top.unitsSold} units and ${money(top.revenue)} revenue${others ? `; next are ${others}` : ''}.`,
      items: products.map((product) => ({ name: product.name, stock: product.stock, salePrice: product.salePrice, category: product.category })),
      actions: [],
    };
  }

  const asksNextMonth = /\b(?:next month|coming month|upcoming month)\b/i.test(text) &&
    /\b(?:need|buy|order|stock|reorder|prepare)\b/i.test(text);
  if (asksNextMonth || /\bwhat do i need next month\b/i.test(text)) {
    const forecast = await runTool('get_next_month_reorder_needs', {}, ownerId);
    if (!forecast.products.length) {
      const noSales = !forecast.hasRecentSales;
      return {
        type: 'low_stock',
        message: noSales
          ? 'I can’t estimate next month’s demand because there were no sales in the last 30 days, and no products are currently below their reorder levels.'
          : 'Based on sales from the last 30 days and current stock, no reorders are suggested for next month.',
        items: [], actions: [],
      };
    }
    const list = forecast.products.map((p) => `${p.name}: order ${p.reorderQty} (current stock ${p.stock}; estimated 30-day demand ${p.projectedDemand})`).join('; ');
    return {
      type: 'low_stock',
      message: `Based on sales from the last 30 days${forecast.hasRecentSales ? '' : ' and current reorder levels'}, plan these reorders for next month: ${list}.`,
      items: forecast.products.map((p) => ({ name: p.name, stock: p.stock, reorderQty: p.reorderQty, category: p.category })),
      actions: [],
    };
  }

  if (/\b(?:this month|month to date|so far this month)\b/i.test(text) &&
      /\b(?:sales?|revenue|profit|sold)\b/i.test(text) &&
      !isForecastIntent(text)) {
    const summary = await runTool('get_sales_summary', { period: 'this_month' }, ownerId);
    if (!summary.saleCount) {
      return { type: 'text', message: 'No sales have been recorded this month yet.', items: [], actions: [] };
    }
    return {
      type: 'text',
      message: `This month: ${summary.saleCount} sales covering ${summary.unitsSold} units, ${money(summary.revenue)} revenue, and ${money(summary.profit)} profit.`,
      items: [], actions: [],
    };
  }

  if (isForecastIntent(text)) {
    const result = await runTool('get_product_forecast', { query: text }, ownerId);
    if (result?.error) return { type: 'text', message: result.error, items: [], actions: [] };
    if (result) {
        const monthProjection = result.projectedMonthEndUnits == null
          ? 'There are no sales recorded yet this month, so I can’t calculate a reliable month-end pace.'
          : result.isColdStartEstimate
            ? `There are ${result.unitsThisMonth} recorded sales of this product so far this month. A rough month-end proxy is ${result.projectedMonthEndUnits} units (${money(result.projectedMonthEndRevenue)} revenue), inferred from other products rather than this product’s own sales.`
            : `At the current month-to-date pace, estimated month-end sales are ${result.projectedMonthEndUnits} units and ${money(result.projectedMonthEndRevenue)} revenue (currently ${result.unitsThisMonth} units and ${money(result.revenueThisMonth)} this month).`;
        const next30 = result.projectedNext30DaysUnits == null
          ? 'There is not enough recent sales history to estimate the next 30 days.'
          : `Estimated next-30-day demand is ${result.projectedNext30DaysUnits} units (${money(result.projectedNext30DaysRevenue)} revenue), based on ${result.forecastBaseline}.`;
        const stockout = result.estimatedStockoutDays == null
          ? 'A stockout date cannot be estimated without recent sales.'
          : result.isColdStartEstimate && result.confidence.startsWith('low')
            ? `If this product sold at the shop-wide comparison rate, its ${result.currentStock} units would last about ${result.estimatedStockoutDays} days; there is no category history to confirm that rate.`
            : `At that recent rate, the current ${result.currentStock} units may last about ${result.estimatedStockoutDays} days.`;
        const confidence = result.confidence === 'higher' ? 'higher'
          : result.confidence === 'moderate' ? 'moderate'
            : result.confidence === 'limited' ? 'limited'
              : result.confidence.startsWith('low') ? result.confidence : 'insufficient';
        const comparison = result.previousMonthUnits > 0
          ? ` Last month’s actual sales were ${result.previousMonthUnits} units.` : '';
        const reorderAdvice = result.suggestedReorderQty == null
          ? 'I can’t responsibly size a reorder yet because this category has no sales history; consider a small test restock and review its sales.'
          : `Suggested reorder: ${result.suggestedReorderQty} units.`;
        const messageText = `${result.name} forecast (confidence: ${confidence}). ${monthProjection} ${next30}${comparison} ${stockout} ${reorderAdvice} This is an estimate from recorded sales, not a guarantee.`;
        return {
          type: 'text', message: messageText,
          items: [{ name: result.name, stock: result.currentStock, ...(result.suggestedReorderQty == null ? {} : { reorderQty: result.suggestedReorderQty }), category: result.category }],
          actions: [],
        };
    }
    const businessForecast = await runTool('get_forecast', {}, ownerId);
    const revenueForecast = businessForecast?.revenueForecast;
    if (!revenueForecast) {
      return { type: 'text', message: 'There is not enough sales history yet to make a shop-wide revenue forecast. Record more sales and ask again.', items: [], actions: [] };
    }
    const risks = (businessForecast.productForecast || [])
      .filter((product) => product.riskLevel === 'critical' || product.riskLevel === 'warning')
      .slice(0, 3);
    const riskText = risks.length
      ? ` Stock attention: ${risks.map((product) => `${product.name} (${product.currentStock} in stock, ${product.riskLevel} risk)`).join('; ')}.`
      : '';
    return {
      type: 'text',
      message: `Shop-wide revenue forecast: ${money(revenueForecast.next7DaysTotal)} over 7 days and ${money(revenueForecast.next30DaysTotal)} over 30 days, based on ${revenueForecast.basedOnDays} calendar days. The trend is ${revenueForecast.trend}. This is an estimate, not a guarantee.${riskText}`,
      items: risks.map((product) => ({ name: product.name, stock: product.currentStock })),
      actions: [],
    };
  }

  return null;
}

// Tool calls worth surfacing to the UI as "the agent did something" —
// read-only lookups are just the agent thinking, not an action taken.
const WRITE_TOOLS = new Set(['adjust_stock', 'record_sale', 'create_reorder_suggestion']);

const ALLOWED_TYPES = new Set([
  'text', 'stock', 'low_stock', 'out_of_stock', 'price', 'not_found', 'action_result',
]);

// The underlying free model frequently skips the tool_call protocol
// entirely and just fabricates plausible-looking data for common questions
// (see looksLikeFabricatedToolResult below) instead of asking us for the
// real numbers. For these well-known, zero-argument, read-only questions we
// fetch the real data ourselves up front and hand it to the model already
// grounded — its job becomes "summarize this JSON" instead of "decide
// whether to call a tool", which it does far more reliably. Checked in
// order; first match wins. Product-specific lookups (price/stock of X,
// per-product sales) still rely on the model's own tool_call, since routing
// those needs the free-text product name resolved via chatTools' fuzzy
// matching, not a keyword regex.
const GROUNDING_RULES = [
  [/\b(low(?:er)? stock|running low|about to run out|need(?:s)? restock|what'?s low)\b/i, 'get_low_stock_products'],
  [/\b(why|trend|dropped?|fell|declin|anomal|insight|suggestion|recommend|how is (?:the |my )?business|top sellers?|slow[\s-]?mov)\b/i, 'get_business_insights'],
  [/\b(forecast|predict|when will .* run out|days? (?:left|remaining)|stockout|reorder quantity)\b/i, 'get_forecast'],
  [/\b(sales (?:summary|report|total)|how (?:much|many) (?:did we sell|sold)|total revenue|total profit)\b/i, 'get_sales_summary'],
  [/(?:^|[^a-z])(?:list|show|see|display)(?:[^a-z].*)?(?:products?|items?|inventory|stockroom|catalog(?:ue)?)/i, 'list_products'],
];

function detectGroundingTool(message) {
  const text = String(message || '');
  for (const [pattern, tool] of GROUNDING_RULES) {
    if (pattern.test(text)) return tool;
  }
  return null;
}

// The model's narrative message is usually fine, but it's unreliable at
// faithfully transcribing structured rows into the "items" array (it tends
// to summarize in prose and leave items empty). When we already grounded
// the turn with real data, build the item list ourselves from that same
// data instead of trusting the model to have copied it correctly.
function itemsFromGroundingResult(tool, result) {
  if (tool === 'list_products' && Array.isArray(result)) {
    return result.map((p) => ({
      name: p.name,
      sku: p.sku,
      stock: p.current_stock,
      salePrice: p.sale_price,
      category: p.category,
    }));
  }
  if (tool === 'get_low_stock_products' && Array.isArray(result)) {
    return result.map((p) => ({
      name: p.name,
      stock: p.current_stock,
      reorderLevel: p.reorder_level,
      status: p.current_stock <= 0 ? 'out_of_stock' : 'low',
    }));
  }
  if (tool === 'get_forecast' && result && Array.isArray(result.productForecast)) {
    return result.productForecast
      .filter((p) => p.riskLevel === 'critical' || p.riskLevel === 'warning')
      .map((p) => ({ name: p.name, stock: p.currentStock }));
  }
  return [];
}

// Short prompt-only hints, deliberately terser than chatTools.js's full
// descriptions (those stay detailed for our own documentation) — the
// system prompt needs to be as small as possible, see note below.
const PROMPT_TOOL_HINTS = {
  get_low_stock_products: 'products at/below reorder level',
  get_product_info: 'price/stock for one product by name',
  list_products: 'list products',
  get_sales_summary: 'total sales/revenue/profit',
  get_product_sales: 'units sold + revenue for one product',
  get_forecast: '7-day revenue forecast + per-product stockout risk',
  get_product_forecast: 'product-specific monthly and next-30-day sales projection',
  get_sales_driven_restock_recommendations: 'products to prioritize based on recent sales and stock cover',
  get_top_selling_products: 'rank by units sold for the requested period and category',
  get_business_insights: 'top sellers, slow movers, trends, anomalies',
  adjust_stock: 'restock/remove/correct stock (not for sales)',
  record_sale: 'log a sale, decrements stock',
  create_reorder_suggestion: 'flag a reorder notification',
};

// Kept deliberately short: the long, detailed version of this prompt made
// the model far more likely to ignore the JSON-only instruction, fabricate
// data, or claim an action happened without calling the tool (see agent.js
// history for the diagnosis). It follows a terse, minimal prompt much more
// reliably — so trim before adding new rules here, don't extend.
function buildSystemPrompt() {
  const toolsDoc = toolDefinitions
    .map((t) => `- ${t.name}(${Object.keys(t.parameters.properties).join(', ')}): ${PROMPT_TOOL_HINTS[t.name] || t.description}`)
    .join('\n');

  const now = new Date();
  const localDateTime = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', dateStyle: 'full', timeStyle: 'long',
  }).format(now);

  return `You are Stockroom, an assistant for the signed-in shop owner. Never identify yourself as another AI model.
Current date and time: ${localDateTime} (Asia/Karachi).

Always call a live database tool for every factual question about products, stock, sales, revenue, profit, alerts, or forecasts. Never answer a number from model memory, old chat turns, or the context snapshot. Use the most specific tool. If no product matches, call search_products and say plainly when no match exists, including close matches as suggestions. Answer in short business language and show money as Rs with a number (for example, Rs 1,200.00). Keep forecasts clearly labeled estimates, not guarantees. Never invent or copy unrelated values.

Tools:
${toolsDoc}

To call a tool, reply with ONLY: {"type":"tool_call","tool":"name","arguments":{...}}
You'll get a TOOL RESULT next. Then call another tool or give the final answer.
Never invent data or a TOOL RESULT yourself. Only call adjust_stock/record_sale/create_reorder_suggestion when explicitly asked to do that action.

Final answer, ONLY this JSON: {"type":"text","message":"short answer","items":[]}
items (optional): [{"name":"Bread","stock":4,"reorderLevel":5,"salePrice":120}]
Currency: use Rs, formatted like "Rs 1,200.00".
JSON only, no markdown, no extra text. Max ${MAX_STEPS} tool rounds.`;
}

function formatHistory(history) {
  if (!Array.isArray(history) || !history.length) return '';
  return history
    .filter((entry) => entry && ['user', 'assistant'].includes(entry.role))
    .map((entry) => {
      const content = typeof entry?.text === 'string'
        ? entry.text
        : typeof entry?.content === 'string' ? entry.content : '';
      if (!content.trim()) return null;
      if (entry.role === 'assistant' && (looksLikeFabricatedToolResult(content) || /"type"\s*:\s*"tool_call"|"tool_calls"\s*:/i.test(content))) return null;
      return `${entry.role === 'assistant' ? 'Assistant' : 'User'}: ${content.trim()}`;
    })
    .filter(Boolean)
    .slice(-20)
    .join('\n');
}

function extractJsonObject(text) {
  let cleaned = String(text || '').trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch { /* fall through */ }

  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(cleaned.slice(first, last + 1));
    } catch { /* fall through */ }
  }
  return null;
}

function sanitizePlainText(text) {
  if (!text) return '';
  let out = String(text).trim();

  out = out.replace(
    /^(?:I'm|I am)\s+(?:DeepSeek(?:\s+V[\d.]+)?|GPT(?:-\d+(?:\.\d+)?)?|Claude|Gemini)[^\n]*\n?/i, ''
  );
  out = out.replace(/^As an AI\s+(?:assistant|language model)[^\n]*\n?/i, '');
  out = out.replace(/^I'?m not (?:a|an)\s+(?:stock|inventory)\s+assistant[^\n]*\n?/i, '');
  out = out.replace(/<inventory>[\s\S]*?<\/inventory>/gi, '');

  out = out
    .replace(/\$\s*(\d[\d,]*(?:\.\d+)?)/g, 'Rs $1')
    .replace(/\b(?:USD|PKR)\s*\$?\s*(\d[\d,]*(?:\.\d+)?)/gi, 'Rs $1')
    .replace(/\b(\d[\d,]*(?:\.\d+)?)\s*rupees?\b/gi, (_, amount) => `Rs ${amount}`);

  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item === 'object' && typeof item.name === 'string')
    .map((item) => {
      const clean = { name: item.name.trim() };
      if (typeof item.stock === 'number' && Number.isFinite(item.stock)) clean.stock = item.stock;
      if (typeof item.reorderLevel === 'number' && Number.isFinite(item.reorderLevel)) clean.reorderLevel = item.reorderLevel;
      if (typeof item.salePrice === 'number' && Number.isFinite(item.salePrice)) clean.salePrice = item.salePrice;
      if (typeof item.costPrice === 'number' && Number.isFinite(item.costPrice)) clean.costPrice = item.costPrice;
      if (typeof item.status === 'string' && ['healthy', 'low', 'out_of_stock'].includes(item.status)) clean.status = item.status;
      if (typeof item.category === 'string') clean.category = item.category;
      return clean;
    });
}

// Catches the model narrating a tool call and inventing its own output
// instead of actually emitting {"type":"tool_call",...} — e.g. "I checked
// the inventory... {\"result\": [...fabricated rows...]}" or "I used the
// following tool: get_low_stock_products(...)". This data is never real.
const TOOL_NAME_PATTERN = new RegExp(
  `\\b(?:${toolDefinitions.map((t) => t.name).join('|')})\\s*\\(`
);
function looksLikeFabricatedToolResult(raw) {
  const text = String(raw || '');
  if (TOOL_NAME_PATTERN.test(text)) return true;
  if (/"result"\s*:/i.test(text) && /[a-z]/i.test(text.replace(/"result"\s*:/i, ''))) return true;
  return /\bI (?:checked|used|called|looked up|queried)\b/i.test(text);
}

// Catches the model claiming a write action happened ("Restocking 5
// apples", "Recorded the sale") in its final answer without ever emitting
// the adjust_stock/record_sale/create_reorder_suggestion tool_call — which
// would tell the user something changed when nothing actually did.
function claimsUnexecutedAction(message) {
  return /\b(restock(ing|ed)?|reorder(ed|ing)?|adjust(ing|ed)?\s+stock|record(ing|ed)?\s+(the\s+)?sale|logg(ing|ed)\s+(a\s+)?sale|creat(ing|ed)\s+(a\s+)?reorder)\b/i
    .test(String(message || ''));
}

const MESSAGE_KEYS = new Set(['message', 'text', 'content', 'answer', 'reply']);

// The model invents a different JSON envelope almost every call — flat
// {message}, {text}, {content}, or nested one like
// {type:"text",tool:"default",arguments:{text:"..."}}. Rather than special
// case each shape, walk the object (breadth-first, shallow) for the first
// string under a known message-ish key name at any depth. Deliberately does
// NOT fall back to "any string value" — that grabbed unrelated fields (a
// product name, a category) and presented them as if they were the answer,
// which is worse than admitting we couldn't parse a reply.
function deepFindMessage(obj, maxDepth = 3) {
  const queue = [{ node: obj, depth: 0 }];
  while (queue.length) {
    const { node, depth } = queue.shift();
    if (!node || typeof node !== 'object' || depth > maxDepth) continue;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && value.trim() && MESSAGE_KEYS.has(key)) return value;
      if (value && typeof value === 'object') queue.push({ node: value, depth: depth + 1 });
    }
  }
  return null;
}

function normalizeFinalAnswer(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { type: 'text', message: 'Sorry, I could not generate an answer.', items: [] };
  }
  const type = ALLOWED_TYPES.has(parsed.type) ? parsed.type : 'text';
  const raw = deepFindMessage(parsed);
  const message = raw ? sanitizePlainText(raw) : 'Sorry, I could not generate an answer.';
  return { type, message, items: sanitizeItems(parsed.items) };
}

// Serializes calls against the shared (and fragile) DeepAI session so
// concurrent chats don't hammer it in parallel.
let _queue = Promise.resolve();
function enqueue(task) {
  const run = _queue.then(task, task);
  _queue = run.then(() => {}, () => {});
  return run;
}

export async function runAgent({ message, history = [], ownerId }) {
  try {
    const databaseAnswer = await answerFromDatabase(message, ownerId);
    if (databaseAnswer) return databaseAnswer;
  } catch (error) {
    console.error('Deterministic chat lookup failed:', error);
    return {
      type: 'text',
      message: 'I couldn’t read that information from your inventory just now. Please try again.',
      items: [],
      actions: [],
    };
  }

  const chat = new DeepAIChat({ systemPrompt: buildSystemPrompt(), maxHistory: 20 });
  const actions = [];
  let actionGuardUsed = false;

  try {
    const conversation = formatHistory(history);
    const groundingTool = detectGroundingTool(message);
    // The full owner-scoped snapshot grounds broad questions. Keep this
    // targeted fallback for cases where the model ignores a specific tool.
    let groundingResult = null;
    const overview = await runTool('get_inventory_overview', {}, ownerId);
    const stockroomContext = await getStockroomAssistantContext(ownerId);
    let turnInput = [
      `FRESH INVENTORY OVERVIEW (queried for this request):\n${JSON.stringify(overview)}`,
      `VERIFIED STOCKROOM DATA FOR THIS USER (use as facts; never expose internal IDs):\n${JSON.stringify(stockroomContext)}`,
      conversation ? `RECENT CONVERSATION:\n${conversation}\n` : '',
      `USER MESSAGE:\n${message.trim()}`,
      '\nRespond with the required JSON.',
    ].filter(Boolean).join('\n');

    for (let step = 0; step < MAX_STEPS; step++) {
      const raw = await enqueue(() => chat.sendMessage(turnInput));
      if (process.env.AGENT_DEBUG) console.log(`[AGENT DEBUG step ${step}] raw:`, JSON.stringify(raw));
      let parsed = extractJsonObject(raw);

      // DeepAI may ignore the JSON envelope and answer in plain language.
      // Accept ordinary prose directly. Only nudge it when it appears to
      // invent a tool execution, which must never be treated as real data.
      if (!parsed) {
        const fabricated = looksLikeFabricatedToolResult(raw);
        if (!fabricated) {
          return { type: 'text', message: sanitizePlainText(raw) || 'Sorry, I could not generate an answer.', items: [], actions };
        }
        const retryRaw = await enqueue(() => chat.sendMessage(
          'That claimed a tool was run, but it was not. Do not claim results or changes. Return a real tool_call JSON object or apologize briefly.'
        ));
        if (process.env.AGENT_DEBUG) console.log(`[AGENT DEBUG step ${step}] retry raw:`, JSON.stringify(retryRaw));
        const retryParsed = extractJsonObject(retryRaw);
        if (retryParsed) {
          parsed = retryParsed;
        } else {
          return { type: 'text', message: sanitizePlainText(raw) || 'Sorry, I could not generate an answer.', items: [], actions };
        }
      }

      // The model frequently emits a valid tool call but drops the
      // "type":"tool_call" field, e.g. {"tool":"get_low_stock_products",
      // "arguments":{}}. Treat any object whose "tool" names a known tool as a
      // tool call, regardless of (or missing) "type" — otherwise it falls
      // through to normalizeFinalAnswer and the user sees a generic failure.
      const looksLikeToolCall = parsed && typeof parsed.tool === 'string' &&
        (parsed.type === 'tool_call' || toolDefinitions.some((t) => t.name === parsed.tool));

      const parallelCalls = Array.isArray(parsed?.tool_calls) ? parsed.tool_calls
        .map((call) => call?.function ? { tool: call.function.name, arguments: call.function.arguments } : call)
        .filter((call) => call && typeof call.tool === 'string' && toolDefinitions.some((t) => t.name === call.tool)) : [];

        // Bug: the model sometimes returns parseable JSON that is neither a
        // tool call nor a valid final answer (e.g. {"products":[...]}). It used
        // to slip past the retry nudge (because parsing "succeeded") and reach
        // normalizeFinalAnswer, which found no message key and surfaced the
        // generic "Sorry, I could not generate an answer." Give one corrective
        // nudge when the parsed envelope has no recognizable shape.
        const hasFinalAnswerShape = parsed &&
          (parallelCalls.length > 0 || parsed.type === 'text' || parsed.type === 'final' ||
            Object.keys(parsed).some((k) => MESSAGE_KEYS.has(k)));
        if (parsed && !looksLikeToolCall && !hasFinalAnswerShape) {
          const retryRaw = await enqueue(() => chat.sendMessage(
            'That JSON has no "tool_call" or final-answer "message". Reply with ONLY the tool_call JSON {"type":"tool_call","tool":"name","arguments":{...}} or the final-answer JSON {"type":"text","message":"short answer","items":[]}.'
          ));
          if (process.env.AGENT_DEBUG) console.log(`[AGENT DEBUG step ${step}] shape retry raw:`, JSON.stringify(retryRaw));
          const retryParsed = extractJsonObject(retryRaw);
          if (retryParsed) parsed = retryParsed;
        }

      if (parallelCalls.length) {
        const results = [];
        for (const call of parallelCalls.slice(0, 6)) {
          const result = await runTool(call.tool, call.arguments || {}, ownerId);
          if (WRITE_TOOLS.has(call.tool)) actions.push({ tool: call.tool, arguments: call.arguments || {}, result });
          results.push({ tool: call.tool, result });
        }
        turnInput = `TOOL RESULTS for this request:\n${JSON.stringify(results)}\n\nContinue: call another tool if needed, or respond with the required final-answer JSON.`;
        continue;
      }

      if (looksLikeToolCall) {
        const def = toolDefinitions.find((t) => t.name === parsed.tool);
        let result;

        if (!def) {
          result = { error: `Unknown tool "${parsed.tool}". Available: ${toolDefinitions.map((t) => t.name).join(', ')}.` };
        } else {
          try {
            result = await runTool(parsed.tool, parsed.arguments || {}, ownerId);
          } catch (err) {
            result = { error: err.message || 'Tool failed.' };
          }
        }

        if (def && WRITE_TOOLS.has(parsed.tool)) {
          actions.push({ tool: parsed.tool, arguments: parsed.arguments || {}, result });
        }

        turnInput = `TOOL RESULT for ${parsed.tool}:\n${JSON.stringify(result)}\n\nContinue: call another tool if needed, or respond with the required final-answer JSON.`;
        continue;
      }

      const finalAnswer = normalizeFinalAnswer(parsed);

      // The model often answers a data question (e.g. "list my products")
      // without calling any tool, inventing Product A/B/C. If we detected a
      // grounding tool for this message and no tool was run, fetch the real
      // data now and rebuild the answer from it instead of trusting the model.
      if (
        groundingTool &&
        actions.length === 0 &&
        groundingResult === null &&
        finalAnswer.items.length === 0
      ) {
        try {
          groundingResult = await runTool(groundingTool, {}, ownerId);
        } catch {
          groundingResult = null;
        }
        if (groundingResult) {
          turnInput =
            `TOOL RESULT for ${groundingTool}:\\n${JSON.stringify(groundingResult)}\\n\\n` +
            'Now respond with the required final-answer JSON summarizing ONLY this real data. Do not invent products.';
          continue;
        }
      }

      if (actions.length === 0 && claimsUnexecutedAction(finalAnswer.message)) {
        if (!actionGuardUsed) {
          actionGuardUsed = true;
          turnInput =
            'You described an action but never called the tool — nothing happened. If the user asked for a real ' +
            'action, call it now as tool_call JSON. Otherwise, answer without claiming it happened.';
          continue;
        }
        // Already gave it one corrective chance and it still claimed an
        // unexecuted action — don't let a false "done" reach the user.
        return {
          type: 'text',
          message: "I wasn't able to complete that action reliably. Please try rephrasing it (e.g. \"restock 10 Apple\"), or make the change directly on the Stock page.",
          items: [],
          actions,
        };
      }

      if (groundingTool && actions.length === 0 && finalAnswer.items.length === 0 && groundingResult) {
        const enriched = sanitizeItems(itemsFromGroundingResult(groundingTool, groundingResult));
        if (enriched.length) finalAnswer.items = enriched;
      }

      return { ...finalAnswer, actions };
    }

    return {
      type: 'text',
      message: 'That needed more steps than I\'m allowed to take at once — try asking more specifically.',
      items: [],
      actions,
    };
  } catch (err) {
    // The AI provider itself failed (e.g. its session got CSRF-blocked and
    // a fresh retry still failed) — surface a calm chat message instead of
    // a raw error bubbling up to a 500.
    if (process.env.AGENT_DEBUG) console.error('[AGENT DEBUG] provider error:', err);
    return {
      type: 'text',
      message: 'The AI service is temporarily unavailable — please try again in a moment.',
      items: [],
      actions,
    };
  } finally {
    await chat.close().catch(() => {});
  }
}
