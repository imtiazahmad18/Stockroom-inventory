import express from 'express';
import cors from 'cors';
import productsRouter from './routes/products.js';
import categoriesRouter from './routes/categories.js';
import salesRouter from './routes/sales.js';
import notificationsRouter from './routes/notifications.js';
import 'dotenv/config';
import chatRouter from './routes/chat.js';
import analyticsRouter from './routes/analytics.js';
import authRouter from './routes/auth.js';
import { requireAuth } from './middleware/auth.js';
import { requirePaidSubscription } from './middleware/requirePaidSubscription.js';
import billingRouter, { handleSafepayWebhook } from './routes/billing.js';
import { startBackgroundAgent } from './backgroundAgent.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
// Safepay signs the raw request body. Keep this before express.json().
app.post('/api/billing/safepay-webhook', express.raw({ type: 'application/json' }), handleSafepayWebhook);
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRouter);
app.use('/api/billing', requireAuth, billingRouter);

app.use('/api/products', requireAuth, requirePaidSubscription, productsRouter);
app.use('/api/categories', requireAuth, requirePaidSubscription, categoriesRouter);
app.use('/api/sales', requireAuth, requirePaidSubscription, salesRouter);
app.use('/api/notifications', requireAuth, requirePaidSubscription, notificationsRouter);
app.use('/api/chat', requireAuth, requirePaidSubscription, chatRouter);
app.use('/api/analytics', requireAuth, requirePaidSubscription, analyticsRouter);

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(PORT, () => {
  console.log(`Inventory API running on http://localhost:${PORT}`);
  startBackgroundAgent();
});
