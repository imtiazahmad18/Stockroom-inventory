import prisma from './lib/prisma.js';
import { applyStockChange } from './stockService.js';
import { randomBytes } from 'node:crypto';
import { hashPassword } from './auth.js';

// One-time demo data so the Forecast page has something to show.
// Run with: node seed.js <ownerId>  (from inside backend/)
// Creates its own "Demo" category + products with a unique SKU suffix
// each time, so it never collides with your real data — safe to run
// more than once if you want more sample sales.

const ownerId = Number(process.argv[2]);
if (!Number.isInteger(ownerId) || ownerId <= 0) {
  console.error('Usage: node seed.js <ownerId>  (e.g. node seed.js 1)');
  process.exit(1);
}

const stamp = Date.now().toString().slice(-4);

async function ensureCategory(name) {
  const existing = await prisma.categories.findFirst({ where: { name, owner_id: ownerId } });
  if (existing) return existing.id;
  const created = await prisma.categories.create({ data: { name, owner_id: ownerId } });
  return created.id;
}

async function createProduct({ sku, name, categoryId, cost, price, stock, reorder }) {
  const created = await prisma.products.create({
    data: {
      sku,
      name,
      category_id: categoryId,
      owner_id: ownerId,
      cost_price: cost,
      sale_price: price,
      current_stock: stock,
      reorder_level: reorder,
    },
  });
  return created.id;
}

// Inserts a sale dated `daysAgo` days in the past, and moves stock through
// the normal applyStockChange() function so low-stock triggers still fire
// correctly if a demo product happens to cross its reorder level.
async function backdatedSale(productId, quantity, salePrice, costPrice, daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const iso = date.toISOString().slice(0, 19).replace('T', ' ');

  await prisma.$transaction(async (tx) => {
    await tx.sales.create({
      data: {
        product_id: productId,
        owner_id: ownerId,
        quantity,
        sale_price: salePrice,
        cost_price_at_sale: costPrice,
        created_at: iso,
      },
    });
    await applyStockChange(tx, productId, -quantity, 'sale');
  });
}

async function main() {
  console.log('Seeding demo data...');
  let owner = await prisma.users.findUnique({ where: { id: ownerId } });
  if (!owner) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`No user with id ${ownerId} exists. Create a user first; seed.js will not create demo accounts in production.`);
    }

    const email = `stockroom-demo-${ownerId}@example.com`;
    const password = randomBytes(12).toString('base64url');
    owner = await prisma.users.create({
      data: {
        id: ownerId,
        email,
        password_hash: await hashPassword(password),
        role: 'user',
      },
    });
    console.log('Created a local demo login because that owner ID did not exist:');
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
  }

  const catId = await ensureCategory('Demo');

  const tshirtId = await createProduct({
    sku: `DEMO-TS-${stamp}`, name: 'Demo Cotton T-shirt', categoryId: catId,
    cost: 5, price: 15, stock: 65, reorder: 8,
  });
  const mugId = await createProduct({
    sku: `DEMO-MG-${stamp}`, name: 'Demo Coffee Mug', categoryId: catId,
    cost: 3, price: 8, stock: 15, reorder: 5,
  });

  // T-shirt: rising sales trend over the last 10 days (oldest -> newest)
  const tshirtDailyQty = [2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
  for (let i = 0; i < tshirtDailyQty.length; i++) {
    await backdatedSale(tshirtId, tshirtDailyQty[i], 15, 5, tshirtDailyQty.length - i);
  }

  // Mug: slow, steady sales — will show a longer stock runway
  const mugDailyQty = [1, 0, 1, 1, 0, 1, 1, 0, 1, 1];
  for (let i = 0; i < mugDailyQty.length; i++) {
    if (mugDailyQty[i] > 0) await backdatedSale(mugId, mugDailyQty[i], 8, 3, mugDailyQty.length - i);
  }

  const demoProducts = await prisma.products.findMany({
    where: { category_id: catId },
    select: { id: true, sku: true, name: true, current_stock: true },
  });
  console.log('Done. Demo products:');
  console.log(demoProducts);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
