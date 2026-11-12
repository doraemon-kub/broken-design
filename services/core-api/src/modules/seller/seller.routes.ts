// [ภีม] แดชบอร์ดคนขาย — โมเดลของฉัน, ยอดขาย, เปิดโหมดคนขาย
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { db } from '../../config/db';
import { AppError } from '../../middlewares/error.middleware';

export const sellerRouter = Router();

// ─── Middleware: ตรวจว่าเป็นคนขายแล้ว ──────────────────────────────────────
function requireSeller(
  req: import('express').Request,
  _res: import('express').Response,
  next: import('express').NextFunction,
) {
  const userId = req.user!.id;
  // ตรวจ is_seller จาก DB เพื่อความปลอดภัย (ไม่เชื่อ JWT อย่างเดียว)
  db.query(`SELECT is_seller FROM users WHERE id = $1`, [userId])
    .then((result) => {
      if (result.rowCount === 0 || !result.rows[0].is_seller) {
        throw new AppError(403, 'NOT_SELLER', 'You must enable seller mode first');
      }
      next();
    })
    .catch(next);
}

// ─── 1. POST /api/seller/enable ─────────────────────────────────────────────
// เปิดโหมดคนขาย (is_seller = true)
sellerRouter.post('/enable', requireAuth, async (req, res) => {
  const userId = req.user!.id;

  const result = await db.query(
    `UPDATE users SET is_seller = TRUE WHERE id = $1 AND is_seller = FALSE RETURNING id`,
    [userId],
  );

  if (result.rowCount === 0) {
    // อาจเป็นคนขายอยู่แล้ว
    const check = await db.query(`SELECT is_seller FROM users WHERE id = $1`, [userId]);
    if (check.rowCount! > 0 && check.rows[0].is_seller) {
      res.json({ message: 'Seller mode is already enabled' });
      return;
    }
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  res.json({ message: 'Seller mode enabled successfully' });
});

// ─── 2. GET /api/seller/models ──────────────────────────────────────────────
// โมเดลของฉัน (คนขาย)
sellerRouter.get('/models', requireAuth, requireSeller, async (req, res) => {
  const userId = req.user!.id;

  const result = await db.query(
    `SELECT id, title, price_cents, currency, view_count, download_count,
            hidden_at, deleted_at, created_at
     FROM models
     WHERE owner_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  res.json({
    models: result.rows.map((r) => ({
      id: r.id,
      title: r.title,
      priceCents: r.price_cents,
      currency: r.currency,
      viewCount: r.view_count,
      downloadCount: r.download_count,
      isHidden: r.hidden_at !== null,
      isDeleted: r.deleted_at !== null,
      createdAt: r.created_at,
    })),
  });
});

// ─── 3. GET /api/seller/sales ───────────────────────────────────────────────
// ยอดขายของคนขาย — สรุปรายได้ทั้งหมดและรายการขายแต่ละรายการ
sellerRouter.get('/sales', requireAuth, requireSeller, async (req, res) => {
  const userId = req.user!.id;

  // รายการขายทั้งหมด (เฉพาะ paid)
  const salesResult = await db.query(
    `SELECT p.id AS purchase_id, p.model_id, p.created_at AS sold_at,
            m.title, m.price_cents, m.currency,
            u.display_name AS buyer_name
     FROM purchases p
     JOIN models m ON m.id = p.model_id
     JOIN users u ON u.id = p.user_id
     WHERE m.owner_id = $1 AND p.status = 'paid'
     ORDER BY p.created_at DESC`,
    [userId],
  );

  // สรุปรายได้รวม
  const summaryResult = await db.query(
    `SELECT COALESCE(SUM(m.price_cents), 0) AS total_revenue,
            COUNT(*)::int AS total_sales
     FROM purchases p
     JOIN models m ON m.id = p.model_id
     WHERE m.owner_id = $1 AND p.status = 'paid'`,
    [userId],
  );

  const summary = summaryResult.rows[0];

  res.json({
    totalRevenue: Number(summary.total_revenue),
    totalSales: summary.total_sales,
    sales: salesResult.rows.map((r) => ({
      purchaseId: r.purchase_id,
      modelId: r.model_id,
      title: r.title,
      priceCents: r.price_cents,
      currency: r.currency,
      buyerName: r.buyer_name,
      soldAt: r.sold_at,
    })),
  });
});

// ─── 4. GET /api/seller/status ──────────────────────────────────────────────
// ตรวจสถานะคนขาย (ไม่ต้อง requireSeller — ใครก็เรียกได้)
sellerRouter.get('/status', requireAuth, async (req, res) => {
  const userId = req.user!.id;

  const result = await db.query(
    `SELECT is_seller FROM users WHERE id = $1`,
    [userId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  res.json({ isSeller: result.rows[0].is_seller });
});
