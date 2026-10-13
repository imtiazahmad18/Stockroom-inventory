import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

// GET /api/notifications?unread=true
router.get('/', async (req, res) => {
  const unreadOnly = req.query.unread === 'true';
  const notifications = await prisma.notifications.findMany({
    where: { owner_id: req.user.id, ...(unreadOnly ? { is_read: 0 } : {}) },
    include: { products: { select: { name: true } } },
    orderBy: { created_at: 'desc' },
    take: 50,
  });
  res.json(
    notifications.map(({ products, ...n }) => ({ ...n, product_name: products?.name ?? null }))
  );
});

// POST /api/notifications/:id/read
router.post('/:id/read', async (req, res) => {
  const id = Number(req.params.id);
  const result = await prisma.notifications.updateMany({
    where: { id, owner_id: req.user.id },
    data: { is_read: 1 },
  });
  if (result.count === 0) return res.status(404).json({ error: 'Notification not found.' });
  res.status(204).send();
});

// POST /api/notifications/read-all
router.post('/read-all', async (req, res) => {
  await prisma.notifications.updateMany({
    where: { owner_id: req.user.id, is_read: 0 },
    data: { is_read: 1 },
  });
  res.status(204).send();
});

export default router;
