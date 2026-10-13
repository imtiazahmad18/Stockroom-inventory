import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

// GET /api/categories
router.get('/', async (req, res) => {
  const categories = await prisma.categories.findMany({
    where: { owner_id: req.user.id },
    orderBy: { name: 'asc' },
  });
  res.json(categories);
});

// POST /api/categories  { name }
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Category name is required.' });
  }
  try {
    const created = await prisma.categories.create({
      data: { name: name.trim(), owner_id: req.user.id },
    });
    res.status(201).json(created);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'That category already exists.' });
    }
    res.status(500).json({ error: 'Could not create category.' });
  }
});

// DELETE /api/categories/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const result = await prisma.categories.deleteMany({
    where: { id, owner_id: req.user.id },
  });
  if (result.count === 0) {
    return res.status(404).json({ error: 'Category not found.' });
  }
  res.status(204).send();
});

export default router;
