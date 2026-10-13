import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const [c, pr, s, n, sl] = await Promise.all([
  p.categories.count(),
  p.products.count(),
  p.sales.count(),
  p.notifications.count(),
  p.stock_logs.count(),
]);
console.log('categories', c, 'products', pr, 'sales', s, 'notifications', n, 'stock_logs', sl);
await p.$disconnect();
