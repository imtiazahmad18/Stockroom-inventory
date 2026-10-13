import { Router } from 'express';
import { runAgent } from '../agent.js';

const router = Router();

router.post('/', async (req, res) => {
  const { message, history = [] } = req.body;

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }

  let timeoutId;
  try {
    const result = await Promise.race([
      runAgent({ message, history, ownerId: req.user.id }),
      new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('Chat request timed out. Please try again.')), 29000); }),
    ]);
    const cleanHistory = Array.isArray(history)
      ? history.filter((entry) => entry && ['user', 'assistant'].includes(entry.role)
        && typeof (entry.content ?? entry.text) === 'string')
        .slice(-18)
        .map((entry) => ({ role: entry.role, content: entry.content ?? entry.text }))
      : [];
    cleanHistory.push({ role: 'user', content: message.trim() }, { role: 'assistant', content: result.message });
    return res.json({
      reply: result.message,
      history: cleanHistory.slice(-20),
      type: result.type,
      items: result.items,
      actions: result.actions,
    });
  } catch (err) {
    console.error('Chat Server Error:', err);
    const timedOut = /timed out/i.test(err?.message || '');
    return res.status(timedOut ? 504 : 500).json({ error: err?.message || 'Chat request failed.' });
  } finally {
    clearTimeout(timeoutId);
  }
});

export default router;
