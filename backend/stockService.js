import prisma from './lib/prisma.js';

// Pure logic, no transaction wrapper — callers are expected to run this
// inside their own prisma.$transaction so it can be combined with other
// writes (e.g. inserting a sale row) atomically.
//
// This is also where the low-stock EVENT TRIGGER lives: whenever a stock
// change causes current_stock to cross from above the reorder level to at
// or below it, a row is written to `notifications`. It only fires on the
// crossing, not on every subsequent sale while stock stays low — otherwise
// a slow-selling low-stock item would spam one notification per sale.
export async function applyStockChange(client, productId, delta, reason) {
  const product = await client.products.findUnique({ where: { id: productId } });
  if (!product) {
    const err = new Error('Product not found.');
    err.status = 404;
    throw err;
  }

  const newStock = product.current_stock + delta;
  if (newStock < 0) {
    const err = new Error('Stock cannot go below zero.');
    err.status = 400;
    throw err;
  }

  await client.products.update({
    where: { id: productId },
    data: { current_stock: newStock, updated_at: new Date().toISOString() },
  });
  await client.stock_logs.create({
    data: { product_id: productId, change: delta, reason, created_at: new Date().toISOString() },
  });

  const wasAboveReorder = product.current_stock > product.reorder_level;
  const isNowAtOrBelow = newStock <= product.reorder_level;
  if (wasAboveReorder && isNowAtOrBelow) {
    await fireLowStockEvent(client, product, newStock);
  }

  return newStock;
}

export async function fireLowStockEvent(client, product, currentStock) {
  await client.notifications.create({
    data: {
      product_id: product.id,
      owner_id: product.owner_id,
      type: 'low_stock',
      message: `${product.name} is low on stock (${currentStock} left, reorder level ${product.reorder_level}).`,
      created_at: new Date().toISOString(),
    },
  });
}
