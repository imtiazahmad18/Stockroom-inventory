import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { applyStockChange, fireLowStockEvent } from '../stockService.js';

const router = Router();

function withCategoryName(product) {
  if (!product) return product;
  const { categories, ...rest } = product;
  return { ...rest, category_name: categories?.name ?? null };
}

// GET /api/products  — supports ?search= and ?lowStock=true
router.get('/', async (req, res) => {
  const { search, lowStock } = req.query;
  const where = { owner_id: req.user.id };
  if (search) {
    where.OR = [{ name: { contains: search } }, { sku: { contains: search } }];
  }
  if (lowStock === 'true') {
    where.current_stock = { lte: prisma.products.fields.reorder_level };
  }

  const products = await prisma.products.findMany({
    where,
    include: { categories: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(products.map(withCategoryName));
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  const product = await prisma.products.findFirst({
    where: { id: Number(req.params.id), owner_id: req.user.id },
    include: { categories: { select: { name: true } } },
  });
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  res.json(withCategoryName(product));
});

// POST /api/products
router.post('/', async (req, res) => {
  const { sku, name, category_id, cost_price, sale_price, current_stock, reorder_level } = req.body;

  if (typeof sku !== 'string' || !sku.trim() || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'SKU and name are required.' });
  }

  // A product must not be linked to another user's category. The category
  // name is included in product responses, so accepting a foreign key here
  // would leak another tenant's data.
  const categoryId = category_id == null || category_id === '' ? null : Number(category_id);
  if (categoryId !== null) {
    if (!Number.isInteger(categoryId) || !(await prisma.categories.findFirst({
      where: { id: categoryId, owner_id: req.user.id },
      select: { id: true },
    }))) {
      return res.status(400).json({ error: 'Category not found.' });
    }
  }

  try {
    const created = await prisma.products.create({
      data: {
        sku: sku.trim(),
        name: name.trim(),
        category_id: categoryId,
        cost_price: cost_price || 0,
        sale_price: sale_price || 0,
        current_stock: current_stock || 0,
        reorder_level: reorder_level ?? 5,
        owner_id: req.user.id,
      },
      include: { categories: { select: { name: true } } },
    });

    if (created.current_stock <= created.reorder_level) {
      await fireLowStockEvent(prisma, created, created.current_stock);
    }

    res.status(201).json(withCategoryName(created));
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A product with that SKU already exists.' });
    }
    res.status(500).json({ error: 'Could not create product.' });
  }
});

// PUT /api/products/:id
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.products.findFirst({ where: { id, owner_id: req.user.id } });
  if (!existing) return res.status(404).json({ error: 'Product not found.' });

  const { sku, name, category_id, cost_price, sale_price, reorder_level } = req.body;

  if ((sku !== undefined && (typeof sku !== 'string' || !sku.trim()))
    || (name !== undefined && (typeof name !== 'string' || !name.trim()))) {
    return res.status(400).json({ error: 'SKU and name must be non-empty strings.' });
  }

  // `null` deliberately clears a category; undefined leaves it unchanged.
  const categoryId = category_id === undefined
    ? existing.category_id
    : (category_id === null || category_id === '' ? null : Number(category_id));
  const categoryIsOwned = categoryId === null || (Number.isInteger(categoryId)
    && await prisma.categories.findFirst({
      where: { id: categoryId, owner_id: req.user.id },
      select: { id: true },
    }));
  if (!categoryIsOwned) {
    return res.status(400).json({ error: 'Category not found.' });
  }

  const updated = await prisma.products.update({
    where: { id },
    data: {
      sku: sku === undefined ? existing.sku : sku.trim(),
      name: name === undefined ? existing.name : name.trim(),
      category_id: categoryId,
      cost_price: cost_price ?? existing.cost_price,
      sale_price: sale_price ?? existing.sale_price,
      reorder_level: reorder_level ?? existing.reorder_level,
      updated_at: new Date().toISOString(),
    },
    include: { categories: { select: { name: true } } },
  });

  res.json(withCategoryName(updated));
});

// DELETE /api/products/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const result = await prisma.products.deleteMany({ where: { id, owner_id: req.user.id } });
  if (result.count === 0) return res.status(404).json({ error: 'Product not found.' });
  res.status(204).send();
});

// POST /api/products/:id/stock  { change, reason }
// change: positive integer = restock, negative = sale/loss/correction.
router.post('/:id/stock', async (req, res) => {
  const id = Number(req.params.id);
  const { change, reason } = req.body;
  const delta = Number(change);
  if (!Number.isInteger(delta) || delta === 0) {
    return res.status(400).json({ error: 'change must be a non-zero integer.' });
  }

  const owned = await prisma.products.findFirst({ where: { id, owner_id: req.user.id } });
  if (!owned) return res.status(404).json({ error: 'Product not found.' });

  try {
    await prisma.$transaction(async (tx) => {
      await applyStockChange(tx, id, delta, reason || 'correction');
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Could not adjust stock.' });
  }

  const updated = await prisma.products.findUnique({
    where: { id },
    include: { categories: { select: { name: true } } },
  });
  res.json(withCategoryName(updated));
});

export default router;
