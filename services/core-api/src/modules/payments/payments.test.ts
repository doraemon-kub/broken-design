// [ภีม] Test suite สำหรับ Payments module (ระบบซื้อจำลองและจัดการ embed_key)
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app } from '../../app';
import { db } from '../../config/db';
import { env } from '../../config/env';
import { generateEmbedKey } from './payments.routes';

const JWT_SECRET = env.jwtSecret;

function makeToken(user: { id?: string; email?: string; role?: 'user' | 'creator' } = {}) {
  const payload = {
    id: user.id || 'u-1',
    email: user.email || 'buyer@example.com',
    role: user.role || 'user',
  };
  return jwt.sign(payload, JWT_SECRET);
}

test('generateEmbedKey generates a 48-character hex string and unique keys', () => {
  const k1 = generateEmbedKey();
  const k2 = generateEmbedKey();
  assert.equal(typeof k1, 'string');
  assert.equal(k1.length, 48); // 24 bytes = 48 hex chars
  assert.notEqual(k1, k2);
});

test('POST /api/models/:id/checkout - rejects unauthenticated requests', async () => {
  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/models/m-1/checkout`, {
      method: 'POST',
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('POST /api/models/:id/checkout - returns 404 when model not found', async () => {
  const originalQuery = db.query.bind(db);
  (db as any).query = async (sql: string) => {
    if (sql.includes('FROM models WHERE id = $1')) {
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/models/m-999/checkout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error?.code, 'MODEL_NOT_FOUND');
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

test('POST /api/models/:id/checkout - rejects purchasing own model', async () => {
  const originalQuery = db.query.bind(db);
  (db as any).query = async (sql: string) => {
    if (sql.includes('FROM models WHERE id = $1')) {
      return {
        rowCount: 1,
        rows: [{ id: 'm-1', title: 'My Model', price_cents: 1500, currency: 'USD', owner_id: 'u-1' }],
      };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/models/m-1/checkout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${makeToken({ id: 'u-1', email: 'owner@example.com', role: 'creator' })}` },
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error?.code, 'OWN_MODEL');
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

test('POST /api/models/:id/checkout - rejects purchasing free model', async () => {
  const originalQuery = db.query.bind(db);
  (db as any).query = async (sql: string) => {
    if (sql.includes('FROM models WHERE id = $1')) {
      return {
        rowCount: 1,
        rows: [{ id: 'm-free', title: 'Free Model', price_cents: 0, currency: 'USD', owner_id: 'other-user' }],
      };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/models/m-free/checkout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error?.code, 'FREE_MODEL');
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

test('POST /api/models/:id/checkout - creates pending purchase with price from database', async () => {
  const originalQuery = db.query.bind(db);
  let insertedData: any = null;

  (db as any).query = async (sql: string, params: any[]) => {
    if (sql.includes('FROM models WHERE id = $1')) {
      return {
        rowCount: 1,
        rows: [{ id: 'm-paid', title: 'Paid Model', price_cents: 2900, currency: 'USD', owner_id: 'creator-9' }],
      };
    }
    if (sql.includes('FROM purchases WHERE user_id = $1 AND model_id = $2')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('INSERT INTO purchases')) {
      insertedData = { userId: params[0], modelId: params[1], embedKey: params[2] };
      return { rowCount: 1, rows: [{ id: 'purchase-123' }] };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/models/m-paid/checkout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${makeToken({ id: 'buyer-1', email: 'b@example.com', role: 'user' })}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.purchaseId, 'purchase-123');
    assert.equal(body.checkoutUrl, '/pay/mock/purchase-123');
    assert.equal(body.provider, 'mock');
    assert.equal(insertedData.userId, 'buyer-1');
    assert.equal(insertedData.modelId, 'm-paid');
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

test('POST /api/models/:id/checkout - prevents duplicate purchase if already paid', async () => {
  const originalQuery = db.query.bind(db);
  (db as any).query = async (sql: string) => {
    if (sql.includes('FROM models WHERE id = $1')) {
      return {
        rowCount: 1,
        rows: [{ id: 'm-paid', title: 'Paid Model', price_cents: 2900, currency: 'USD', owner_id: 'creator-9' }],
      };
    }
    if (sql.includes('FROM purchases WHERE user_id = $1 AND model_id = $2')) {
      return { rowCount: 1, rows: [{ id: 'p-already-paid', status: 'paid' }] };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/models/m-paid/checkout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error?.code, 'ALREADY_PURCHASED');
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

test('POST /api/purchases/:id/confirm-mock - confirms payment and changes status to paid', async () => {
  const originalQuery = db.query.bind(db);
  (db as any).query = async (sql: string, params: any[]) => {
    if (sql.includes('UPDATE purchases') && sql.includes("status = 'paid'")) {
      return {
        rowCount: 1,
        rows: [{ id: params[0], model_id: 'm-1', embed_key: 'mock-embed-key-123' }],
      };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/purchases/purchase-123/confirm-mock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.purchaseId, 'purchase-123');
    assert.equal(body.embedKey, 'mock-embed-key-123');
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

test('POST /api/purchases/:id/confirm-mock - prevents duplicate confirmation (cannot get new key)', async () => {
  const originalQuery = db.query.bind(db);
  (db as any).query = async (sql: string) => {
    if (sql.includes('UPDATE purchases')) {
      // 0 rows updated because status wasn't pending
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('SELECT status FROM purchases WHERE id = $1 AND user_id = $2')) {
      return { rowCount: 1, rows: [{ status: 'paid' }] };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/purchases/purchase-123/confirm-mock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error?.code, 'ALREADY_PAID');
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

test('POST /api/purchases/:id/confirm-mock - rejects when PAYMENT_PROVIDER is not mock', async () => {
  const originalProvider = env.paymentProvider;
  (env as any).paymentProvider = 'stripe';

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/purchases/purchase-123/confirm-mock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error?.code, 'MOCK_DISABLED');
  } finally {
    server.close();
    (env as any).paymentProvider = originalProvider;
  }
});

test('GET /api/me/purchases - lists only paid purchases with embed_key', async () => {
  const originalQuery = db.query.bind(db);
  (db as any).query = async (sql: string) => {
    if (sql.includes('FROM purchases p') && sql.includes("p.status = 'paid'")) {
      return {
        rowCount: 1,
        rows: [
          {
            id: 'p-1',
            model_id: 'm-1',
            embed_key: 'embed-key-1',
            created_at: '2026-11-11T00:00:00.000Z',
            title: 'Sample Model',
            price_cents: 1000,
            currency: 'USD',
          },
        ],
      };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/me/purchases`, {
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.purchases.length, 1);
    assert.equal(body.purchases[0].embedKey, 'embed-key-1');
    assert.equal(body.purchases[0].title, 'Sample Model');
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

test('POST /api/purchases/:id/regenerate-key - generates a new key and invalidates the old key', async () => {
  const originalQuery = db.query.bind(db);
  let updatedKey: string | null = null;

  (db as any).query = async (sql: string, params: any[]) => {
    if (sql.includes('UPDATE purchases') && sql.includes('SET embed_key = $1')) {
      updatedKey = params[0];
      return {
        rowCount: 1,
        rows: [{ id: params[1], model_id: 'm-1' }],
      };
    }
    return { rowCount: 0, rows: [] };
  };

  const server = app.listen(0);
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://localhost:${port}/api/purchases/purchase-123/regenerate-key`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.embedKey, 'string');
    assert.equal(body.embedKey.length, 48);
    assert.equal(body.embedKey, updatedKey);
  } finally {
    server.close();
    db.query = originalQuery;
  }
});

