import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { authRouter } from './modules/auth/auth.routes';
import { modelsRouter } from './modules/models/models.routes';
import { paymentsRouter } from './modules/payments/payments.routes';
import { interactionsRouter } from './modules/interactions/interactions.routes';
import { sellerRouter } from './modules/seller/seller.routes';
import { errorHandler } from './middlewares/error.middleware';

export const app = express();

app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'broken-design-core-api', status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/models', modelsRouter);
app.use('/api', paymentsRouter);
app.use('/api/seller', sellerRouter);
app.use('/api', interactionsRouter);

app.use(errorHandler);

const isTest = process.env.NODE_ENV === 'test' || process.argv.some((arg) => arg.includes('test'));

if (!isTest) {
  app.listen(env.port, () => {
    console.log(`[Broken Design Core-API] running on http://localhost:${env.port}`);
  });
}
