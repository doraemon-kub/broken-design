import crypto from "crypto";
import { NodeIO, Logger } from "@gltf-transform/core";
import { env } from "../config/env";
import { db } from "../config/db";
import { supabase } from "../config/supabase";
import { validateGlbHeader } from "./glbValidator";
import { AppError } from "../middlewares/error.middleware";

export interface WatermarkPayload {
  modelId: string;
  ownerId: string;
  license: string;
  purchaseId?: string;
}

export interface WatermarkMetadata {
  platform: "Lixyte";
  modelId: string;
  ownerId: string;
  license: string;
  purchaseId: string;
  signature: string;
  issuedAt: string;
}

export interface VerifyWatermarkResult {
  isValidMetadata: boolean;
  isValidVertexWatermark: boolean;
  extractedMetadata: WatermarkMetadata | Record<string, any> | null;
  vertexBitMatchRatio: number;
}

const VERTEX_WATERMARK_BITS = 64;
const VERTEX_MATCH_THRESHOLD = 0.85;

function createSilentIO(): NodeIO {
  const io = new NodeIO();
  io.setLogger(new Logger(Logger.Verbosity.SILENT));
  return io;
}

/**
 * สร้าง 64-bit prefix (16 hex chars) ที่ผูกกับ modelId และ WATERMARK_SECRET
 * เพื่อให้สามารถตรวจสอบ Vertex Steganography ได้แม้ว่า asset.extras จะถูกลบออกจากการ Export ใหม่
 */
export function computeModelVertexPrefixHex(
  modelId: string,
  secret: string = env.watermarkSecret,
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`broken-design:vertex:${modelId.trim()}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * สร้าง HMAC-SHA256 Signature (64 hex chars = 256 bits) จาก payload ด้วย WATERMARK_SECRET
 * - 16 ตัวอักษรแรก (64 บิตแรก): ผูกกับ modelId สำหรับฝังและตรวจสอบในพิกัด Vertex 64 จุดแรก
 * - 48 ตัวอักษรหลัง (192 บิต): ผูกกับข้อมูลชุดเต็ม (modelId, ownerId, license, purchaseId)
 */
export function computeWatermarkSignature(
  payload: WatermarkPayload,
  secret: string = env.watermarkSecret,
): string {
  const purchaseId = (payload.purchaseId || "original").trim();
  const vertexPrefixHex = computeModelVertexPrefixHex(payload.modelId, secret);
  const canonicalPayload = JSON.stringify({
    platform: "Lixyte",
    modelId: payload.modelId.trim(),
    ownerId: payload.ownerId.trim(),
    license: payload.license.trim(),
    purchaseId,
  });

  const payloadMacHex = crypto
    .createHmac("sha256", secret)
    .update(canonicalPayload)
    .digest("hex")
    .slice(0, 48);

  return `${vertexPrefixHex}${payloadMacHex}`;
}

/**
 * แปลงค่า hex ของ signature (อย่างน้อย 16 ตัวอักษรแรก = 8 ไบต์) เป็นอาเรย์บิต 64 บิต (0 หรือ 1)
 */
function signatureHexTo64Bits(signatureHex: string): number[] {
  const cleanHex = signatureHex.trim().slice(0, 16).padEnd(16, "0");
  const buf = Buffer.from(cleanHex, "hex");
  const bits: number[] = [];
  for (let byteIdx = 0; byteIdx < 8; byteIdx++) {
    const byte = buf[byteIdx] ?? 0;
    for (let bitOffset = 7; bitOffset >= 0; bitOffset--) {
      bits.push((byte >> bitOffset) & 1);
    }
  }
  return bits;
}

/**
 * ปรับค่าพิกัดแกน X ให้ทศนิยมหลักที่ 4 (Math.round(x * 10000)) เป็นเลขคู่ (0) หรือคี่ (1)
 * โดยรองรับ Float32 round-trip ของ glTF POSITION accessor
 */
function encodeBitInCoordinateX(x: number, targetBit: number): number {
  const baseScaled = Math.round(x * 10000);
  const desiredBit = targetBit & 1;

  for (let step = 0; step <= 16; step++) {
    const offsets = step === 0 ? [0] : [step, -step];
    for (const delta of offsets) {
      const candidateScaled = baseScaled + delta;
      if ((Math.abs(candidateScaled) & 1) !== desiredBit) continue;
      const candidateFloat32 = Math.fround(candidateScaled / 10000);
      const roundTripScaled = Math.round(candidateFloat32 * 10000);
      if ((Math.abs(roundTripScaled) & 1) === desiredBit) {
        return candidateFloat32;
      }
    }
  }

  return Math.fround(baseScaled / 10000);
}

function extractBitFromCoordinateX(x: number): number {
  const scaled = Math.round(x * 10000);
  return Math.abs(scaled) & 1;
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a.trim(), "utf8");
  const bufB = Buffer.from(b.trim(), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * ฝัง License Metadata (Layer 1) และ Vertex Steganography (Layer 2) ลงในไฟล์ .glb
 */
export async function embedLicenseAndWatermark(
  glbBuffer: Buffer,
  payload: WatermarkPayload,
): Promise<{ buffer: Buffer; signature: string }> {
  if (
    !Buffer.isBuffer(glbBuffer) ||
    !validateGlbHeader(glbBuffer, glbBuffer.length)
  ) {
    throw new AppError(
      400,
      "INVALID_GLB",
      "Provided buffer is not a valid Binary glTF (GLB v2)",
    );
  }

  const purchaseId = (payload.purchaseId || "original").trim();
  const normalizedPayload: WatermarkPayload = {
    modelId: payload.modelId.trim(),
    ownerId: payload.ownerId.trim(),
    license: payload.license.trim(),
    purchaseId,
  };

  const signature = computeWatermarkSignature(normalizedPayload);
  const issuedAt = new Date().toISOString();

  const io = createSilentIO();
  const document = await io.readBinary(new Uint8Array(glbBuffer));
  const root = document.getRoot();

  // ─── Layer 1: Metadata Signature (asset.extras & asset.copyright) ──────────
  const watermarkMetadata: WatermarkMetadata = {
    platform: "Lixyte",
    modelId: normalizedPayload.modelId,
    ownerId: normalizedPayload.ownerId,
    license: normalizedPayload.license,
    purchaseId,
    signature,
    issuedAt,
  };

  const asset = root.getAsset();
  asset.copyright = `© Lixyte | Model ${normalizedPayload.modelId} | Owner ${normalizedPayload.ownerId} | License: ${normalizedPayload.license}`;
  const existingAssetExtras =
    asset.extras && typeof asset.extras === "object"
      ? (asset.extras as Record<string, unknown>)
      : {};
  asset.extras = {
    ...existingAssetExtras,
    ...watermarkMetadata,
  };

  // Also mirror into root extras for tools that inspect top-level glTF extras
  const existingRootExtras = root.getExtras();
  root.setExtras({
    ...existingRootExtras,
    ...watermarkMetadata,
  });

  // ─── Layer 2: Vertex Steganography (first mesh POSITION accessor, 64 pts) ──
  const meshes = root.listMeshes();
  if (meshes.length > 0) {
    const firstMesh = meshes[0];
    const primitives = firstMesh.listPrimitives();
    for (const primitive of primitives) {
      const positionAccessor = primitive.getAttribute("POSITION");
      if (positionAccessor && positionAccessor.getCount() > 0) {
        const bits = signatureHexTo64Bits(signature);
        const count = Math.min(
          VERTEX_WATERMARK_BITS,
          positionAccessor.getCount(),
        );
        const vertex: [number, number, number] = [0, 0, 0];

        for (let i = 0; i < count; i++) {
          positionAccessor.getElement(i, vertex);
          vertex[0] = encodeBitInCoordinateX(vertex[0], bits[i]);
          positionAccessor.setElement(i, vertex);
        }
        break;
      }
    }
  }

  const outputUint8 = await io.writeBinary(document);
  const outputBuffer = Buffer.from(
    outputUint8.buffer,
    outputUint8.byteOffset,
    outputUint8.byteLength,
  );

  return {
    buffer: outputBuffer,
    signature,
  };
}

/**
 * ค้นหา modelId จากฐานข้อมูลเมื่อไฟล์ถูกตัด asset.extras ออกและไม่ได้ระบุ expectedModelId
 */
async function findMatchingModelByVertexBits(extractedBits: number[]): Promise<{
  modelId: string;
  matchRatio: number;
} | null> {
  if (extractedBits.length === 0) return null;

  let modelIds: string[] = [];
  try {
    const res = await db.query(
      `SELECT id FROM models ORDER BY created_at DESC LIMIT 500`,
    );
    modelIds = res.rows.map((r: any) => String(r.id));
  } catch {
    if (supabase) {
      try {
        const { data } = await supabase.from("models").select("id").limit(500);
        if (data) modelIds = data.map((r: any) => String(r.id));
      } catch {
        // Ignore DB lookup errors during offline verification
      }
    }
  }

  let bestMatch: { modelId: string; matchRatio: number } | null = null;
  for (const candidateId of modelIds) {
    const expectedBits = signatureHexTo64Bits(
      computeModelVertexPrefixHex(candidateId),
    );
    let matched = 0;
    for (let i = 0; i < extractedBits.length; i++) {
      if (extractedBits[i] === expectedBits[i]) matched++;
    }
    const ratio = matched / extractedBits.length;
    if (
      ratio >= VERTEX_MATCH_THRESHOLD &&
      (!bestMatch || ratio > bestMatch.matchRatio)
    ) {
      bestMatch = { modelId: candidateId, matchRatio: ratio };
    }
  }

  return bestMatch;
}

/**
 * ตรวจสอบลายน้ำทั้งจาก Metadata (asset.extras) และพิกัดจุดยอด 3 มิติ (Vertex Steganography)
 */
export async function verifyGlbWatermark(
  glbBuffer: Buffer,
  expectedModelId?: string,
): Promise<VerifyWatermarkResult> {
  if (
    !Buffer.isBuffer(glbBuffer) ||
    !validateGlbHeader(glbBuffer, glbBuffer.length)
  ) {
    throw new AppError(
      400,
      "INVALID_GLB",
      "Provided file is not a valid Binary glTF (GLB v2)",
    );
  }

  const io = createSilentIO();
  const document = await io.readBinary(new Uint8Array(glbBuffer));
  const root = document.getRoot();

  // ─── 1. Extract & Verify Layer 1 (asset.extras) ────────────────────────────
  const asset = root.getAsset();
  const rawAssetExtras =
    asset.extras &&
    typeof asset.extras === "object" &&
    Object.keys(asset.extras).length > 0
      ? (asset.extras as Record<string, any>)
      : null;
  const rawRootExtras =
    root.getExtras() && Object.keys(root.getExtras()).length > 0
      ? (root.getExtras() as Record<string, any>)
      : null;

  const candidateExtras = rawAssetExtras?.signature
    ? rawAssetExtras
    : rawRootExtras?.signature
      ? rawRootExtras
      : rawAssetExtras || rawRootExtras;

  let isValidMetadata = false;
  let extractedMetadata: Record<string, any> | null = candidateExtras
    ? { ...candidateExtras }
    : null;

  if (
    candidateExtras &&
    typeof candidateExtras.modelId === "string" &&
    typeof candidateExtras.ownerId === "string" &&
    typeof candidateExtras.license === "string" &&
    typeof candidateExtras.signature === "string"
  ) {
    const expectedSig = computeWatermarkSignature({
      modelId: candidateExtras.modelId,
      ownerId: candidateExtras.ownerId,
      license: candidateExtras.license,
      purchaseId:
        typeof candidateExtras.purchaseId === "string"
          ? candidateExtras.purchaseId
          : "original",
    });

    const sigMatches = timingSafeHexEqual(
      candidateExtras.signature,
      expectedSig,
    );
    const modelMatches =
      !expectedModelId ||
      candidateExtras.modelId.trim() === expectedModelId.trim();
    isValidMetadata = sigMatches && modelMatches;
  }

  // ─── 2. Extract & Verify Layer 2 (Vertex Steganography) ────────────────────
  const extractedBits: number[] = [];
  const meshes = root.listMeshes();
  if (meshes.length > 0) {
    const primitives = meshes[0].listPrimitives();
    for (const primitive of primitives) {
      const positionAccessor = primitive.getAttribute("POSITION");
      if (positionAccessor && positionAccessor.getCount() > 0) {
        const count = Math.min(
          VERTEX_WATERMARK_BITS,
          positionAccessor.getCount(),
        );
        const vertex: [number, number, number] = [0, 0, 0];
        for (let i = 0; i < count; i++) {
          positionAccessor.getElement(i, vertex);
          extractedBits.push(extractBitFromCoordinateX(vertex[0]));
        }
        break;
      }
    }
  }

  let vertexBitMatchRatio = 0;
  let isValidVertexWatermark = false;

  if (extractedBits.length > 0) {
    // Determine reference 64-bit signature for vertex comparison:
    // Priority: expectedModelId -> valid metadata signature -> metadata modelId -> DB scan
    let referenceHex: string | null = null;

    if (expectedModelId && expectedModelId.trim() !== "") {
      referenceHex = computeModelVertexPrefixHex(expectedModelId.trim());
    } else if (
      isValidMetadata &&
      typeof candidateExtras?.signature === "string"
    ) {
      referenceHex = candidateExtras.signature;
    } else if (
      typeof candidateExtras?.modelId === "string" &&
      candidateExtras.modelId.trim() !== ""
    ) {
      referenceHex = computeModelVertexPrefixHex(
        candidateExtras.modelId.trim(),
      );
    }

    if (referenceHex) {
      const expectedBits = signatureHexTo64Bits(referenceHex);
      let matched = 0;
      for (let i = 0; i < extractedBits.length; i++) {
        if (extractedBits[i] === expectedBits[i]) {
          matched++;
        }
      }
      vertexBitMatchRatio = Number((matched / extractedBits.length).toFixed(4));
      isValidVertexWatermark = vertexBitMatchRatio >= VERTEX_MATCH_THRESHOLD;
    } else {
      const dbMatch = await findMatchingModelByVertexBits(extractedBits);
      if (dbMatch) {
        vertexBitMatchRatio = Number(dbMatch.matchRatio.toFixed(4));
        isValidVertexWatermark = true;
        extractedMetadata = {
          ...(extractedMetadata || {}),
          recoveredModelId: dbMatch.modelId,
        };
      }
    }
  }

  return {
    isValidMetadata,
    isValidVertexWatermark,
    extractedMetadata,
    vertexBitMatchRatio,
  };
}
