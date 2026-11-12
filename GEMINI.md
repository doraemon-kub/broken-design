# Mandatory Workspace Rule — Lixyte (Broken Design)

Every AI agent working in this repository **MUST** read and follow [AGENT.md](./AGENT.md) before performing any task.

- **Architecture, Security Invariants, and Development Roadmap:** See [AGENT.md](./AGENT.md)
- **Project Overview & Contributor Guide:** See [README.md](./README.md)

---

## Quick Summary of Mandatory Agent Rules (from `AGENT.md`)

1. **Always Read `AGENT.md` First:** Before modifying code, creating files, or running commands, check the system architecture, access control matrix, and current development roadmap in [AGENT.md](./AGENT.md).
2. **Enforce Backend Access Control & Security Invariants:**
   - Never rely solely on frontend role checks or stale JWT claims; always verify `is_seller`, `role === 'admin'`, and `suspended_at` against the database.
   - Paid models (`price_cents > 0`) must **never** expose `file_hash` publicly; only `preview_hash` may be streamed without a valid paid `embed_key` (verified via `verifyEmbedKeyConstantTime` / `crypto.timingSafeEqual`).
   - Models with `hidden_at IS NOT NULL` or `owner.suspended_at IS NOT NULL` must be blocked immediately (`403 MODEL_UNAVAILABLE`) across all routes, including for previous buyers.
   - Soft-deleted models (`deleted_at IS NOT NULL`) are hidden from public catalog/preview (`404`), but existing paid buyers retain streaming and download access.
3. **Preserve Multi-Layer GLB Watermarking (`services/cdn-service/src/utils/glbWatermark.ts`):**
   - Uploaded `.glb` files are validated (`glbValidator.ts`) and watermarked with `purchaseId: 'original'` (Layer 1 `asset.extras` HMAC-SHA256 signature + Layer 2 64-vertex X-coordinate steganography).
   - Paid buyer downloads (`GET /cdn/models/:id/download`) dynamically embed the buyer's `purchaseId` and `license_type` and record `watermark_hash` in the `purchases` table.
4. **Run Verification Before Completing Any Task:**
   - `services/cdn-service`: `npx.cmd tsc --noEmit -p .` and `npm.cmd test`
   - `services/core-api`: `npx.cmd tsc --noEmit -p .` and `npm.cmd test`
   - `frontend`: `npx.cmd tsc --noEmit -p .`
