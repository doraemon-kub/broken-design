// [ภีม] Test suite สำหรับ Seller module (แดชบอร์ดคนขาย, ยอดขาย, เปิดโหมดคนขาย)
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app } from '../../app';
import { db } from '../../config/db';
import { env } from '../../config/env';

const JWT_SECRET = env.jwtSecret;

function makeToken(user: { id?: string; email?: string; role?: 'user' | 'creator' } = {}) {
  const payload = {
    id: user.id || 'seller-1',
    email: user.email || 'seller@example.com',
    role: user.role || 'user',
  };
  return jwt.sign(payload, JWT_SECRET);
}

test('POST /api/seller/enable - enables seller mode for user', async () => {
  const originalQuery = db.query.bind(db);
  let updated = false;

  (db as any).query = async (sql: string, params: any[]) => {
    if (sql.includes('UPDATE users SET is_seller = TRUE')) {
      updated = true;
      return { rowCount: 1, rows: [{ id: params[0] }] };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/seller/enable`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${makeToken({ id: 'u-user', email: 'u@example.com', role: 'user' })}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message, 'Seller mode enabled successfully');
    assert.equal(updated, true);
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

test('GET /api/seller/status - checks seller status', async () => {
  const originalQuery = db.query.bind(db);
  (db as any).query = async (sql: string) => {
    if (sql.includes('SELECT is_seller FROM users WHERE id = $1')) {
      return { rowCount: 1, rows: [{ is_seller: true }] };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/seller/status`, {
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.isSeller, true);
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

test('GET /api/seller/models - blocks non-seller users with 403', async () => {
  const originalQuery = db.query.bind(db);
  (db as any).query = async (sql: string) => {
    if (sql.includes('SELECT is_seller FROM users WHERE id = $1')) {
      return { rowCount: 1, rows: [{ is_seller: false }] };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/seller/models`, {
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error?.code, 'NOT_SELLER');
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

test('GET /api/seller/models - returns creator models for seller', async () => {
  const originalQuery = db.query.bind(db);
  (db as any).query = async (sql: string) => {
    if (sql.includes('SELECT is_seller FROM users WHERE id = $1')) {
      return { rowCount: 1, rows: [{ is_seller: true }] };
    }
    if (sql.includes('FROM models') && sql.includes('WHERE owner_id = $1')) {
      return {
        rowCount: 2,
        rows: [
          {
            id: 'm-1',
            title: 'Model 1',
            price_cents: 1000,
            currency: 'USD',
            view_count: 50,
            download_count: 10,
            hidden_at: null,
            deleted_at: null,
            created_at: '2026-11-11T00:00:00.000Z',
          },
        ],
      };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/seller/models`, {
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.models.length, 1);
    assert.equal(body.models[0].title, 'Model 1');
    assert.equal(body.models[0].priceCents, 1000);
    assert.equal(body.models[0].isHidden, false);
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

test('GET /api/seller/sales - returns revenue summary and sales list', async () => {
  const originalQuery = db.query.bind(db);
  (db as any).query = async (sql: string) => {
    if (sql.includes('SELECT is_seller FROM users WHERE id = $1')) {
      return { rowCount: 1, rows: [{ is_seller: true }] };
    }
    if (sql.includes('COALESCE(SUM(m.price_cents), 0) AS total_revenue')) {
      return {
        rowCount: 1,
        rows: [{ total_revenue: 5800, total_sales: 2 }],
      };
    }
    if (sql.includes('FROM purchases p') && sql.includes('JOIN users u')) {
      return {
        rowCount: 2,
        rows: [
          {
            purchase_id: 'p-1',
            model_id: 'm-1',
            sold_at: '2026-11-11T00:00:00.000Z',
            title: 'Cool Robot',
            price_cents: 2900,
            currency: 'USD',
            buyer_name: 'Alice',
          },
          {
            purchase_id: 'p-2',
            model_id: 'm-1',
            sold_at: '2026-11-11T01:00:00.000Z',
            title: 'Cool Robot',
            price_cents: 2900,
            currency: 'USD',
            buyer_name: 'Bob',
          },
        ],
      };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/seller/sales`, {
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.totalRevenue, 5800);
    assert.equal(body.totalSales, 2);
    assert.equal(body.sales.length, 2);
    assert.equal(body.sales[0].buyerName, 'Alice');
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

