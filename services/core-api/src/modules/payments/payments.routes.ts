// [ภีม] ระบบซื้อจำลองและจัดการ embed_key
import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../../middlewares/auth.middleware';
import { db } from '../../config/db';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/error.middleware';

export const paymentsRouter = Router();

// ─── Helper ────────────────────────────────────────────────────────────────────

export function generateEmbedKey(): string {
  return crypto.randomBytes(24).toString('hex');
}

// ─── Middleware: ตรวจว่า mock payment เปิดได้เฉพาะเมื่อ PAYMENT_PROVIDER=mock ─
function requireMockProvider(
  _req: import('express').Request,
  _res: import('express').Response,
  next: import('express').NextFunction,
) {
  if (env.paymentProvider !== 'mock') {
    throw new AppError(403, 'MOCK_DISABLED', 'Mock payment is disabled in this environment');
  }
  next();
}

// ─── 1. POST /api/models/:id/checkout ───────────────────────────────────────
// สร้างคำสั่งซื้อ (pending) ราคาดึงจากฐานข้อมูลจริง — กันซื้อซ้ำ
paymentsRouter.post('/models/:id/checkout', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const modelId = req.params.id;

  // ดึงราคาจากฐานข้อมูลจริง
  const modelRow = await db.query(
    `SELECT id, title, price_cents, currency, deleted_at, hidden_at, owner_id
     FROM models WHERE id = $1`,
    [modelId],
  );
  if (modelRow.rowCount === 0) {
    throw new AppError(404, 'MODEL_NOT_FOUND', 'Model not found');
  }
  const model = modelRow.rows[0];

  if (model.deleted_at || model.hidden_at) {
    throw new AppError(400, 'MODEL_UNAVAILABLE', 'This model is no longer available');
  }

  // ห้ามซื้อโมเดลของตัวเอง
  if (model.owner_id === userId) {
    throw new AppError(400, 'OWN_MODEL', 'You cannot purchase your own model');
  }

  // โมเดลฟรี → ซื้อได้เลยไม่ต้องจ่าย
  if (model.price_cents === 0) {
    throw new AppError(400, 'FREE_MODEL', 'This model is free — no checkout needed');
  }

  // ตรวจว่าซื้อแล้วหรือยัง (UNIQUE constraint: user_id + model_id)
  const existing = await db.query(
    `SELECT id, status FROM purchases WHERE user_id = $1 AND model_id = $2`,
    [userId, modelId],
  );
  if (existing.rowCount! > 0) {
    const purchase = existing.rows[0];
    if (purchase.status === 'paid') {
      throw new AppError(409, 'ALREADY_PURCHASED', 'You have already purchased this model');
    }
    // ถ้ายัง pending อยู่ → ส่ง checkout url เดิมกลับไป
    if (env.paymentProvider === 'mock') {
      res.json({
        purchaseId: purchase.id,
        checkoutUrl: `/pay/mock/${purchase.id}`,
        provider: 'mock',
      });
      return;
    }
  }

  // สร้างคำสั่งซื้อใหม่ status=pending
  const embedKey = generateEmbedKey();
  const result = await db.query(
    `INSERT INTO purchases (user_id, model_id, status, embed_key)
     VALUES ($1, $2, 'pending', $3)
     RETURNING id`,
    [userId, modelId, embedKey],
  );
  const purchaseId = result.rows[0].id;

  if (env.paymentProvider === 'mock') {
    res.json({
      purchaseId,
      checkoutUrl: `/pay/mock/${purchaseId}`,
      provider: 'mock',
    });
    return;
  }

  // TODO: Stripe checkout session — เฟสถัดไป
  res.json({
    purchaseId,
    checkoutUrl: null,
    provider: 'stripe',
    message: 'Stripe integration is not available yet',
  });
});

// ─── 2. POST /api/purchases/:id/confirm-mock ────────────────────────────────
// กดจ่ายจำลอง → เปลี่ยน status เป็น paid, embed_key พร้อมใช้ทันที
// เปิดได้เฉพาะเมื่อ PAYMENT_PROVIDER=mock
paymentsRouter.post('/purchases/:id/confirm-mock', requireAuth, requireMockProvider, async (req, res) => {
  const userId = req.user!.id;
  const purchaseId = req.params.id;

  const result = await db.query(
    `UPDATE purchases
     SET status = 'paid'
     WHERE id = $1 AND user_id = $2 AND status = 'pending'
     RETURNING id, model_id, embed_key`,
    [purchaseId, userId],
  );

  if (result.rowCount === 0) {
    // อาจจ่ายไปแล้ว หรือไม่ใช่ของตัวเอง
    const check = await db.query(
      `SELECT status FROM purchases WHERE id = $1 AND user_id = $2`,
      [purchaseId, userId],
    );
    if (check.rowCount! > 0 && check.rows[0].status === 'paid') {
      throw new AppError(409, 'ALREADY_PAID', 'This purchase has already been paid');
    }
    throw new AppError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');
  }

  const purchase = result.rows[0];
  res.json({
    message: 'Payment confirmed (mock)',
    purchaseId: purchase.id,
    modelId: purchase.model_id,
    embedKey: purchase.embed_key,
  });
});

// ─── 3. POST /api/webhooks/stripe ────────────────────────────────────────────
// Stripe webhook — เฟสถัดไป
paymentsRouter.post('/webhooks/stripe', async (_req, res) => {
  res.json({ received: true });
});

// ─── 4. GET /api/me/purchases ────────────────────────────────────────────────
// รายการที่ซื้อแล้ว (เฉพาะ status=paid) พร้อม embed_key
paymentsRouter.get('/me/purchases', requireAuth, async (req, res) => {
  const userId = req.user!.id;

  const result = await db.query(
    `SELECT p.id, p.model_id, p.embed_key, p.created_at,
            m.title, m.price_cents, m.currency
     FROM purchases p
     JOIN models m ON m.id = p.model_id
     WHERE p.user_id = $1 AND p.status = 'paid'
     ORDER BY p.created_at DESC`,
    [userId],
  );

  res.json({
    purchases: result.rows.map((r) => ({
      id: r.id,
      modelId: r.model_id,
      title: r.title,
      priceCents: r.price_cents,
      currency: r.currency,
      embedKey: r.embed_key,
      purchasedAt: r.created_at,
    })),
  });
});

// ─── 5. POST /api/purchases/:id/regenerate-key ──────────────────────────────
// ขอ embed_key ใหม่ → รหัสเก่าใช้ไม่ได้ทันที
paymentsRouter.post('/purchases/:id/regenerate-key', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const purchaseId = req.params.id;
  const newKey = generateEmbedKey();

  const result = await db.query(
    `UPDATE purchases
     SET embed_key = $1
     WHERE id = $2 AND user_id = $3 AND status = 'paid'
     RETURNING id, model_id`,
    [newKey, purchaseId, userId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found or not yet paid');
  }

  res.json({
    purchaseId: result.rows[0].id,
    modelId: result.rows[0].model_id,
    embedKey: newKey,
  });
});

// ─── 6. GET /api/purchases/:id ──────────────────────────────────────────────
// ดึงข้อมูลคำสั่งซื้อ (สำหรับหน้าจ่ายเงินจำลอง)
paymentsRouter.get('/purchases/:id', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const purchaseId = req.params.id;

  const result = await db.query(
    `SELECT p.id, p.model_id, p.status, p.created_at,
            m.title, m.price_cents, m.currency
     FROM purchases p
     JOIN models m ON m.id = p.model_id
     WHERE p.id = $1 AND p.user_id = $2`,
    [purchaseId, userId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');
  }

  const r = result.rows[0];
  res.json({
    id: r.id,
    modelId: r.model_id,
    title: r.title,
    priceCents: r.price_cents,
    currency: r.currency,
    status: r.status,
    createdAt: r.created_at,
  });
});
