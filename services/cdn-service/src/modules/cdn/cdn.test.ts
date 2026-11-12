// Tests for the CDN module: access rules, embed_key, Range, caching, downloads.
import { TEST_STORAGE_DIR } from "./cdn.test-env";
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { AddressInfo } from "net";
import express from "express";
import jwt from "jsonwebtoken";
import { db } from "../../config/db";
import { errorHandler } from "../../middlewares/error.middleware";
import { cdnRouter } from "./cdn.routes";
import { parseRangeSpec, resolveRange } from "./range";
import { contentDisposition } from "./cdn.service";
import { Document, NodeIO } from "@gltf-transform/core";
import {
  embedLicenseAndWatermark,
  verifyGlbWatermark,
} from "../../utils/glbWatermark";

// ─── Fixtures ───────────────────────────────────────────────────────────────
function store(content: Buffer, ext: "glb" | "webp"): string {
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  fs.writeFileSync(path.join(TEST_STORAGE_DIR, `${hash}.${ext}`), content);
  return hash;
}

const FULL = Buffer.from("glTF-FULL-0123456789abcdefghijklmnopqrstuvwxyz"); // 46 bytes
const PREVIEW = Buffer.from("glTF-PREVIEW-small");
const POSTER = Buffer.from("RIFF....WEBPposter");
const FULL_HASH = store(FULL, "glb");
const PREVIEW_HASH = store(PREVIEW, "glb");
const POSTER_HASH = store(POSTER, "webp");

const OWNER = "11111111-1111-4111-8111-111111111111";
const BUYER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const FREE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAID_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MISSING_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const KEY = "a".repeat(48);

type Row = Record<string, any>;
let models: Record<string, Row>;
let purchases: Row[];
let users: Record<string, Row>;
let downloadIncrements: string[];

function resetDb() {
  const base = {
    owner_id: OWNER,
    file_hash: FULL_HASH,
    poster_hash: POSTER_HASH,
    hidden_at: null,
    deleted_at: null,
    owner_suspended_at: null,
  };
  models = {
    [FREE_ID]: {
      ...base,
      id: FREE_ID,
      title: "Free Robot",
      preview_hash: null,
      price_cents: 0,
    },
    [PAID_ID]: {
      ...base,
      id: PAID_ID,
      title: "รองเท้า Sneaker",
      preview_hash: PREVIEW_HASH,
      price_cents: 500,
    },
  };
  purchases = [
    { user_id: BUYER, model_id: PAID_ID, status: "paid", embed_key: KEY },
  ];
  users = {
    [OWNER]: { suspended_at: null },
    [BUYER]: { suspended_at: null },
    [STRANGER]: { suspended_at: null },
  };
  downloadIncrements = [];
}

(db as any).query = async (sql: string, params: any[] = []) => {
  if (sql.includes("FROM models m")) {
    const m = models[params[0]];
    return { rows: m ? [{ ...m }] : [], rowCount: m ? 1 : 0 };
  }
  if (sql.includes("FROM purchases WHERE embed_key")) {
    const rows = purchases.filter(
      (p) => p.embed_key === params[0] && p.status === "paid",
    );
    return { rows, rowCount: rows.length };
  }
  if (sql.includes("FROM users u")) {
    const u = users[params[0]];
    if (!u) return { rows: [], rowCount: 0 };
    const match = purchases.find(
      (p) =>
        p.user_id === params[0] &&
        p.model_id === params[1] &&
        p.status === "paid",
    );
    return {
      rows: [
        {
          ...u,
          purchased: Boolean(match),
          purchase_id: match?.id ?? null,
          license_type: match?.license_type ?? null,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes("UPDATE purchases SET watermark_hash")) {
    const p = purchases.find((item) => item.id === params[1]);
    if (p) p.watermark_hash = params[0];
    return { rows: [], rowCount: p ? 1 : 0 };
  }
  if (sql.includes("UPDATE models SET download_count")) {
    downloadIncrements.push(params[0]);
    return { rows: [], rowCount: 1 };
  }
  throw new Error(`Unexpected SQL in test: ${sql}`);
};

const app = express();
app.use("/cdn", cdnRouter);
app.use(errorHandler);
const server = app.listen(0);
const base = `http://localhost:${(server.address() as AddressInfo).port}/cdn`;
after(() => {
  server.close();
  fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
});
beforeEach(resetDb);

const token = (id: string, role = "user") =>
  jwt.sign({ id, email: `${id}@x.com`, role }, "cdn-test-secret");
const get = (p: string, headers: Record<string, string> = {}) =>
  fetch(base + p, { headers });
const errCode = async (res: Response) =>
  ((await res.json()) as any).error?.code;
const waitTick = () => new Promise((r) => setTimeout(r, 50));

// ─── Range parsing ──────────────────────────────────────────────────────────
test("parseRangeSpec / resolveRange", () => {
  assert.deepEqual(parseRangeSpec("bytes=0-9"), {
    kind: "bounded",
    start: 0,
    end: 9,
  });
  assert.deepEqual(parseRangeSpec("bytes=5-"), { kind: "open", start: 5 });
  assert.deepEqual(parseRangeSpec("bytes=-3"), { kind: "suffix", length: 3 });
  assert.equal(parseRangeSpec(undefined), null);
  assert.equal(parseRangeSpec("items=0-1"), null);
  assert.equal(parseRangeSpec("bytes=0-1,4-5"), null);
  assert.equal(parseRangeSpec("bytes=9-2"), null);
  assert.equal(parseRangeSpec("bytes=-"), null);

  assert.deepEqual(resolveRange({ kind: "bounded", start: 0, end: 999 }, 10), {
    start: 0,
    end: 9,
  });
  assert.deepEqual(resolveRange({ kind: "suffix", length: 50 }, 10), {
    start: 0,
    end: 9,
  });
  assert.equal(resolveRange({ kind: "open", start: 10 }, 10), null);
  assert.equal(resolveRange({ kind: "suffix", length: 0 }, 10), null);
});

test("contentDisposition keeps Thai titles via filename*", () => {
  const v = contentDisposition('รองเท้า "x"');
  assert.match(
    v,
    /^attachment; filename="[\x20-\x7e]+\.glb"; filename\*=UTF-8''/,
  );
  assert.ok(v.includes(encodeURIComponent("รองเท้า")));
});

// ─── Free models ────────────────────────────────────────────────────────────
test("free model: hash URL streams with immutable cache, CORS-friendly headers", async () => {
  const res = await get(`/models/${FREE_ID}/${FULL_HASH}.glb`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "model/gltf-binary");
  assert.equal(
    res.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(res.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.equal(res.headers.get("etag"), `"${FULL_HASH}"`);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), FULL);
});

test("free model: preview.glb and file.glb serve the full file without a key", async () => {
  for (const p of ["preview.glb", "file.glb"]) {
    const res = await get(`/models/${FREE_ID}/${p}`);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get("cache-control")!, /^public, max-age=\d+$/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), FULL);
  }
});

test("If-None-Match → 304", async () => {
  const res = await get(`/models/${FREE_ID}/${FULL_HASH}.glb`, {
    "If-None-Match": `"${FULL_HASH}"`,
  });
  assert.equal(res.status, 304);
});

// ─── Range ──────────────────────────────────────────────────────────────────
test("Range: bounded, open, suffix → 206 with correct bytes", async () => {
  const cases: [string, number, number][] = [
    ["bytes=0-3", 0, 3],
    ["bytes=40-", 40, FULL.length - 1],
    ["bytes=-6", FULL.length - 6, FULL.length - 1],
    ["bytes=10-9999", 10, FULL.length - 1],
  ];
  for (const [range, start, end] of cases) {
    const res = await get(`/models/${FREE_ID}/${FULL_HASH}.glb`, {
      Range: range,
    });
    assert.equal(res.status, 206, range);
    assert.equal(
      res.headers.get("content-range"),
      `bytes ${start}-${end}/${FULL.length}`,
      range,
    );
    assert.equal(
      res.headers.get("content-length"),
      String(end - start + 1),
      range,
    );
    assert.deepEqual(
      Buffer.from(await res.arrayBuffer()),
      FULL.subarray(start, end + 1),
      range,
    );
  }
});

test("Range: unsatisfiable → 416 with bytes */size, not cached", async () => {
  const res = await get(`/models/${FREE_ID}/${FULL_HASH}.glb`, {
    Range: `bytes=${FULL.length}-`,
  });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get("content-range"), `bytes */${FULL.length}`);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(await errCode(res), "RANGE_NOT_SATISFIABLE");
});

test("HEAD returns headers only", async () => {
  const res = await fetch(`${base}/models/${FREE_ID}/${FULL_HASH}.glb`, {
    method: "HEAD",
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), String(FULL.length));
});

// ─── Paid models & embed_key ────────────────────────────────────────────────
test("paid model: preview is public, full file via hash URL is refused", async () => {
  const preview = await get(`/models/${PAID_ID}/preview.glb`);
  assert.equal(preview.status, 200);
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), PREVIEW);

  const byPreviewHash = await get(`/models/${PAID_ID}/${PREVIEW_HASH}.glb`);
  assert.equal(byPreviewHash.status, 200);
  await byPreviewHash.arrayBuffer();

  const leak = await get(`/models/${PAID_ID}/${FULL_HASH}.glb`);
  assert.equal(leak.status, 401);
  assert.equal(await errCode(leak), "KEY_REQUIRED");
  assert.equal(leak.headers.get("cache-control"), "no-store");
});

test("paid model: file.glb needs a valid embed_key", async () => {
  const noKey = await get(`/models/${PAID_ID}/file.glb`);
  assert.equal(noKey.status, 401);
  assert.equal(await errCode(noKey), "KEY_REQUIRED");

  const badKey = await get(`/models/${PAID_ID}/file.glb?key=${"b".repeat(48)}`);
  assert.equal(badKey.status, 403);
  assert.equal(await errCode(badKey), "INVALID_KEY");

  const malformed = await get(
    `/models/${PAID_ID}/file.glb?key=${encodeURIComponent("' OR 1=1 --")}`,
  );
  assert.equal(malformed.status, 403);
  await malformed.arrayBuffer();

  const ok = await get(`/models/${PAID_ID}/file.glb?key=${KEY}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), FULL);
});

test("paid model: a key bought for another model is rejected", async () => {
  purchases[0].model_id = FREE_ID;
  const res = await get(`/models/${PAID_ID}/file.glb?key=${KEY}`);
  assert.equal(res.status, 403);
  await res.arrayBuffer();
});

test("paid model: regenerated key → old key stops working immediately", async () => {
  purchases[0].embed_key = "c".repeat(48);
  const old = await get(`/models/${PAID_ID}/file.glb?key=${KEY}`);
  assert.equal(old.status, 403);
  await old.arrayBuffer();
  const fresh = await get(`/models/${PAID_ID}/file.glb?key=${"c".repeat(48)}`);
  assert.equal(fresh.status, 200);
  await fresh.arrayBuffer();
});

test("paid model: pending purchase key is rejected", async () => {
  purchases[0].status = "pending";
  const res = await get(`/models/${PAID_ID}/file.glb?key=${KEY}`);
  assert.equal(res.status, 403);
  await res.arrayBuffer();
});

// ─── Hidden / suspended / deleted ───────────────────────────────────────────
test("hidden model or suspended owner → 403 everywhere, buyers included", async () => {
  for (const flag of ["hidden_at", "owner_suspended_at"]) {
    resetDb();
    models[PAID_ID][flag] = new Date();
    models[FREE_ID][flag] = new Date();
    const paths = [
      `/models/${PAID_ID}/file.glb?key=${KEY}`,
      `/models/${PAID_ID}/preview.glb`,
      `/models/${PAID_ID}/poster.webp`,
      `/models/${FREE_ID}/${FULL_HASH}.glb`,
    ];
    for (const p of paths) {
      const res = await get(p);
      assert.equal(res.status, 403, `${flag} ${p}`);
      assert.equal(await errCode(res), "MODEL_UNAVAILABLE");
    }
    const dl = await get(`/models/${PAID_ID}/download`, {
      Authorization: `Bearer ${token(BUYER)}`,
    });
    assert.equal(dl.status, 403, `${flag} download`);
    await dl.arrayBuffer();
  }
});

test("soft-deleted model: public URLs 404, buyers keep streaming", async () => {
  models[PAID_ID].deleted_at = new Date();
  const pub = await get(`/models/${PAID_ID}/preview.glb`);
  assert.equal(pub.status, 404);
  await pub.arrayBuffer();
  const buyer = await get(`/models/${PAID_ID}/file.glb?key=${KEY}`);
  assert.equal(buyer.status, 200);
  await buyer.arrayBuffer();
});

test("unknown / malformed ids and hashes → 404", async () => {
  for (const p of [
    `/models/${MISSING_ID}/preview.glb`,
    "/models/not-a-uuid/preview.glb",
    `/models/${FREE_ID}/${"0".repeat(64)}.glb`,
    `/models/${FREE_ID}/xyz.glb`,
  ]) {
    const res = await get(p);
    assert.equal(res.status, 404, p);
    await res.arrayBuffer();
  }
});

// ─── Poster ─────────────────────────────────────────────────────────────────
test("poster.webp streams the poster; missing poster → 404", async () => {
  const res = await get(`/models/${FREE_ID}/poster.webp`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/webp");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), POSTER);

  models[FREE_ID].poster_hash = null;
  const none = await get(`/models/${FREE_ID}/poster.webp`);
  assert.equal(none.status, 404);
  assert.equal(await errCode(none), "POSTER_NOT_FOUND");
});

// ─── Download ───────────────────────────────────────────────────────────────
test("download free model: anyone, attachment, counts once", async () => {
  const res = await get(`/models/${FREE_ID}/download`);
  assert.equal(res.status, 200);
  assert.match(
    res.headers.get("content-disposition")!,
    /^attachment; filename="Free_Robot\.glb"/,
  );
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), FULL);
  await waitTick();
  assert.deepEqual(downloadIncrements, [FREE_ID]);
});

test("download paid model: login + purchase (or owner) required", async () => {
  const anon = await get(`/models/${PAID_ID}/download`);
  assert.equal(anon.status, 401);
  assert.equal(await errCode(anon), "LOGIN_REQUIRED");

  const badToken = await get(`/models/${PAID_ID}/download`, {
    Authorization: "Bearer nope",
  });
  assert.equal(badToken.status, 401);
  await badToken.arrayBuffer();

  const stranger = await get(`/models/${PAID_ID}/download`, {
    Authorization: `Bearer ${token(STRANGER)}`,
  });
  assert.equal(stranger.status, 403);
  assert.equal(await errCode(stranger), "PURCHASE_REQUIRED");

  for (const who of [BUYER, OWNER]) {
    const res = await get(`/models/${PAID_ID}/download`, {
      Authorization: `Bearer ${token(who)}`,
    });
    assert.equal(res.status, 200, who);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), FULL);
  }
  await waitTick();
  assert.equal(downloadIncrements.length, 2);
});

test("download: suspended downloader is blocked", async () => {
  users[BUYER].suspended_at = new Date();
  const res = await get(`/models/${PAID_ID}/download`, {
    Authorization: `Bearer ${token(BUYER)}`,
  });
  assert.equal(res.status, 403);
  assert.equal(await errCode(res), "ACCOUNT_SUSPENDED");
});

test("download: resumed Range chunks do not increment the counter", async () => {
  const res = await get(`/models/${FREE_ID}/download`, { Range: "bytes=10-" });
  assert.equal(res.status, 206);
  await res.arrayBuffer();
  await waitTick();
  assert.deepEqual(downloadIncrements, []);
});

// ─── Multi-Layer GLB Watermarking (Layer 1 Metadata + Layer 2 Vertex Steganography) ──
async function createSampleGlbBuffer(vertexCount = 72): Promise<Buffer> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3] = Math.fround((i - 36) * 0.1234);
    positions[i * 3 + 1] = Math.fround(Math.sin(i) * 0.5);
    positions[i * 3 + 2] = Math.fround(Math.cos(i) * 0.5);
  }
  const positionAccessor = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(positions)
    .setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute("POSITION", positionAccessor);
  const mesh = doc.createMesh("SampleMesh").addPrimitive(prim);
  const node = doc.createNode("SampleNode").setMesh(mesh);
  doc.createScene("SampleScene").addChild(node);

  const io = new NodeIO();
  const u8 = await io.writeBinary(doc);
  return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
}

test("watermark: embedLicenseAndWatermark + verifyGlbWatermark (including stripped asset.extras)", async () => {
  const rawGlb = await createSampleGlbBuffer(72);
  const { buffer: watermarked, signature } = await embedLicenseAndWatermark(
    rawGlb,
    {
      modelId: PAID_ID,
      ownerId: OWNER,
      license: "COMMERCIAL",
      purchaseId: "original",
    },
  );

  assert.equal(signature.length, 64);

  const verified = await verifyGlbWatermark(watermarked, PAID_ID);
  assert.equal(verified.isValidMetadata, true);
  assert.equal(verified.isValidVertexWatermark, true);
  assert.equal(verified.vertexBitMatchRatio, 1);
  assert.equal((verified.extractedMetadata as any)?.platform, "Lixyte");
  assert.equal((verified.extractedMetadata as any)?.modelId, PAID_ID);
  assert.equal((verified.extractedMetadata as any)?.purchaseId, "original");

  // Simulate Blender / 3D editor re-export that strips asset.extras and root.extras
  const io = new NodeIO();
  const doc = await io.readBinary(new Uint8Array(watermarked));
  delete doc.getRoot().getAsset().extras;
  delete doc.getRoot().getAsset().copyright;
  doc.getRoot().setExtras({});
  const strippedU8 = await io.writeBinary(doc);
  const strippedBuffer = Buffer.from(
    strippedU8.buffer,
    strippedU8.byteOffset,
    strippedU8.byteLength,
  );

  const afterStrip = await verifyGlbWatermark(strippedBuffer, PAID_ID);
  assert.equal(afterStrip.isValidMetadata, false);
  assert.equal(afterStrip.isValidVertexWatermark, true);
  assert.equal(afterStrip.vertexBitMatchRatio, 1);
});

test("download paid real GLB: embeds buyer purchaseId + license_type, updates watermark_hash, and verifies via POST /cdn/verify-watermark", async () => {
  const rawGlb = await createSampleGlbBuffer(72);
  const realGlbHash = store(rawGlb, "glb");
  models[PAID_ID].file_hash = realGlbHash;
  models[PAID_ID].license = "COMMERCIAL";

  const purchaseId = "99999999-9999-4999-8999-999999999999";
  purchases[0].id = purchaseId;
  purchases[0].license_type = "CC-BY";

  const dlRes = await get(`/models/${PAID_ID}/download`, {
    Authorization: `Bearer ${token(BUYER)}`,
  });
  assert.equal(dlRes.status, 200);
  const downloadedBuffer = Buffer.from(await dlRes.arrayBuffer());

  // Verify watermark_hash was saved to the purchases record
  assert.ok(
    purchases[0].watermark_hash,
    "watermark_hash should be saved in purchases",
  );
  assert.equal(purchases[0].watermark_hash.length, 64);

  // Verify via POST /cdn/verify-watermark
  const verifyRes = await fetch(
    `${base}/verify-watermark?expectedModelId=${PAID_ID}`,
    {
      method: "POST",
      headers: { "Content-Type": "model/gltf-binary" },
      body: downloadedBuffer,
    },
  );
  assert.equal(verifyRes.status, 200);
  const body = (await verifyRes.json()) as any;
  assert.equal(body.isValidMetadata, true);
  assert.equal(body.isValidVertexWatermark, true);
  assert.equal(body.vertexBitMatchRatio, 1);
  assert.equal(body.extractedMetadata.purchaseId, purchaseId);
  assert.equal(body.extractedMetadata.license, "CC-BY");
  assert.equal(body.extractedMetadata.signature, purchases[0].watermark_hash);
});
