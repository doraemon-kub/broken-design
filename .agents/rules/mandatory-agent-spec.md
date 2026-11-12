# Mandatory Pre-Work Rule: Read `AGENT.md`

Before writing code, modifying files, or executing commands in this workspace, every AI agent **MUST** read and strictly follow the engineering specification and development roadmap in [AGENT.md](../../AGENT.md).

## Key Directives for All Agents
1. **Follow the Development Roadmap in `AGENT.md` Section 6:**
   - **Phase 1 (Completed):** Database Schema & Middlewares, Upload + Dual Storage (`LocalDiskStorage` & `SupabaseStorage`), CDN Streaming (`206`/`416`, ETag/`304`, Rate Limit, Constant-Time `embed_key`), Multi-Layer GLB Watermarking (`glbWatermark.ts` + `POST /cdn/verify-watermark`), Auth API, Single-Item Purchase & Seller API, Frontend Viewer & Cross-Origin Embed.
   - **Phase 2 (Current Priority):**
     1. Integrate Models Catalog & Search API (`services/core-api/src/modules/models/models.routes.ts`).
     2. Implement Admin Backend Module (`services/core-api/src/modules/admin/`).
     3. Connect Frontend Auth (`/login`), Mock Checkout (`/pay/mock/[id]`), Buyer (`/me`), Seller (`/seller`), and Admin (`/admin/*`) Dashboards.
   - **Phase 3 (Future Roadmap):** Watermark Inspector UI, Stripe Webhook Integration, and Automated 3D Compression.
2. **Never Violate Core Security Invariants (`AGENT.md` Section 3):**
   - Always check `is_seller`, `role`, and `suspended_at` against the database on the backend.
   - Never expose `file_hash` of a paid model without a valid paid `embed_key` verified via `crypto.timingSafeEqual`.
   - Maintain the standard error format `{ error: { code, message } }` via `AppError`.
3. **Always Run Verification Commands (`AGENT.md` Section 7.2):**
   - Use `npx.cmd` and `npm.cmd` on Windows PowerShell to run `tsc --noEmit` and `npm test` in `services/cdn-service`, `services/core-api`, and `frontend`.
