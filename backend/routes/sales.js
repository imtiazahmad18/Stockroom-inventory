import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { applyStockChange } from '../stockService.js';
import { computeForecast } from '../forecastService.js';

const router = Router();

function withProductName(sale) {
  const { products, ...rest } = sale;
  return { ...rest, product_name: products?.name ?? null, sku: products?.sku ?? null };
}

// GET /api/sales — recent sales history, most recent first
router.get('/', async (req, res) => {
  const sales = await prisma.sales.findMany({
    where: { owner_id: req.user.id },
    include: { products: { select: { name: true, sku: true } } },
    orderBy: { created_at: 'desc' },
    take: 200,
  });
  res.json(sales.map(withProductName));
});

// GET /api/sales/summary — revenue/cost/profit totals, for the dashboard
// and (eventually) the chatbot's "how's business doing" answers.
router.get('/summary', async (req, res) => {
  const [row] = await prisma.$queryRaw`
    SELECT
      COUNT(*) AS sale_count,
      COALESCE(SUM(quantity * sale_price), 0) AS revenue,
      COALESCE(SUM(quantity * cost_price_at_sale), 0) AS cost
    FROM sales
    WHERE owner_id = ${req.user.id}
  `;

  const revenue = Number(row.revenue);
  const cost = Number(row.cost);
  res.json({
    saleCount: Number(row.sale_count),
    revenue,
    cost,
    profit: revenue - cost,
  });
});

// POST /api/sales  { product_id, quantity, sale_price? }
// Records the sale AND decrements stock in one atomic transaction.
router.post('/', async (req, res) => {
  const { product_id, quantity, sale_price } = req.body;
  const qty = Number(quantity);

  if (!product_id || !Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: 'product_id and a positive integer quantity are required.' });
  }

  const product = await prisma.products.findFirst({
    where: { id: Number(product_id), owner_id: req.user.id },
  });
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  if (product.current_stock < qty) {
    return res.status(400).json({ error: `Only ${product.current_stock} in stock.` });
  }

  const priceUsed = sale_price != null ? Number(sale_price) : product.sale_price;

  try {
    const saleId = await prisma.$transaction(async (tx) => {
      const sale = await tx.sales.create({
        data: {
          product_id: product.id,
          quantity: qty,
          sale_price: priceUsed,
          cost_price_at_sale: product.cost_price,
          created_at: new Date().toISOString(),
          owner_id: req.user.id,
        },
      });
      await applyStockChange(tx, product.id, -qty, 'sale');
      return sale.id;
    });

    const sale = await prisma.sales.findUnique({
      where: { id: saleId },
      include: { products: { select: { name: true, sku: true } } },
    });
    res.status(201).json(withProductName(sale));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Could not record sale.' });
  }
});

// GET /api/sales/forecast
router.get('/forecast', async (req, res) => {
  res.json(await computeForecast(req.user.id));
});

export default router;
