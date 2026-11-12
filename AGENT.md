# AGENT.md — Lixyte (Broken Design) Engineering Specification, Agent Runbook & Development Roadmap

> **MANDATORY RULE FOR ALL AI AGENTS (กฎบังคับสำหรับ AI Agent ทุกตัว — Antigravity, Gemini, Claude, Cursor, Copilot, Codex, Windsurf):**
> ก่อนเริ่มแก้ไขโค้ด สร้างไฟล์ หรือรันคำสั่งใดๆ ในโปรเจกต์นี้ **Agent ทุกตัวต้องอ่านและปฏิบัติตามข้อกำหนดในไฟล์ `AGENT.md` นี้ทุกครั้ง** เพื่อให้เข้าใจสถาปัตยกรรม กฎเหล็กด้านความปลอดภัย (Security Invariants) สถานะงานปัจจุบัน และเส้นทางการพัฒนา (Development Roadmap) ของโปรเจกต์ไปในทิศทางเดียวกัน

---

## 1. ภาพรวมระบบและเป้าหมาย (Product Vision & Overview)

**Lixyte (Broken Design)** คือแพลตฟอร์ม **"Google Fonts สำหรับโลก 3 มิติ"** — คลังจัดเก็บ ค้นหา ซื้อขายรายชิ้น และสตรีมไฟล์โมเดล 3 มิติมาตรฐาน `.glb` (Binary glTF 2.0) ข้ามโดเมนผ่าน CDN:
- **นักพัฒนาเว็บ (Web Developer / Buyer):** ค้นหาโมเดลใน Gallery, ปรับแต่งใน Playground, คัดลอกโค้ด `<vm-model>` หรือ `<iframe>` ไปแปะบนเว็บตัวเองเพื่อสตรีมจาก CDN ของเราโดยไม่ต้องโฮสต์ไฟล์เอง หรือกดดาวน์โหลดไฟล์ `.glb` ที่ฝังลายน้ำดิจิทัลและใบอนุญาตเฉพาะผู้ซื้อ
- **ครีเอเตอร์ (Creator / Seller):** เปิดโหมดคนขาย (`is_seller = true`) ในบัญชีเดิมเพื่ออัปโหลดไฟล์ `.glb` (ฟรีหรือตั้งราคาขาย), จับภาพหน้าปก (`poster.webp`) อัตโนมัติจาก `<model-viewer>.toBlob()` และดูยอดขายในแดชบอร์ดคนขาย
- **แอดมิน (Admin):** ดูแลระบบผ่านแดชบอร์ดแอดมิน (ซ่อน/คืนโมเดล, ระงับ/คืนบัญชีผู้ใช้, ดูรายการสั่งซื้อทั้งระบบ) โดยตั้งสิทธิ์ในฐานข้อมูลเท่านั้น สมัครเองไม่ได้ และห้ามซื้อ/ขายโมเดล

---

## 2. สถาปัตยกรรม Microservices (System Architecture)

| เซอร์วิส / โฟลเดอร์ | พอร์ต | เทคโนโลยีหลัก | หน้าที่รับผิดชอบ |
| :--- | :---: | :--- | :--- |
| **`frontend/`** | `3000` | Next.js 15 (App Router), React 19, Tailwind CSS 3, `@google/model-viewer` v4 | หน้า Gallery, หน้ารายละเอียด `/models/[id]`, หน้าอัปโหลด `/upload`, หน้า Iframe `/embed/[id]`, สคริปต์ `public/embed.js` (`<vm-model>`), หน้าจ่ายจำลอง `/pay/mock/[id]`, แดชบอร์ด `/me`, `/seller`, `/admin/*` |
| **`services/core-api/`** | `4000` | Express 5, TypeScript, PostgreSQL (`pg`), JWT, `bcrypt`, `zod` | ระบบสมาชิก (`/api/auth/*`), แคตตาล็อกและการค้นหา (`/api/models/*`), ระบบซื้อรายชิ้นและ `embed_key` (`/api/models/:id/checkout`, `/api/me/purchases`), ระบบคนขาย (`/api/seller/*`), ระบบแอดมิน (`/api/admin/*`) |
| **`services/cdn-service/`** | `4001` | Express 5, TypeScript, `multer`, `@gltf-transform/core`, `@supabase/supabase-js`, `express-rate-limit` | รับอัปโหลดไฟล์ `.glb`/`poster.webp` (`POST /api/models`), ตรวจ Magic Bytes (`glTF` v2), ฝังและตรวจสอบลายน้ำ 2 ชั้น (`glbWatermark.ts`), จัดเก็บแบบ Content-Addressable (`sha256`), และสตรีมไฟล์ผ่าน `/cdn/models/*` (HTTP Range `206`/`416`, ETag/`304`, CORS, Cache, Rate Limit) |
| **`supabase/`** | `5432` | Supabase PostgreSQL & Supabase Storage | ฐานข้อมูลหลัก (`users`, `models`, `purchases`, `likes`, `comments`) และ Cloud Object Storage (`models` bucket) |

---

## 3. กฎเหล็กทางธุรกิจและความปลอดภัย (Core Invariants & Access Rules)

Agent ทุกตัว **ห้ามละเมิด** กฎต่อไปนี้ในทุกกรณี:

### 3.1 ตารางสิทธิ์การเข้าถึงโมเดล (Access Control Matrix)

| สถานะโมเดล / ประเภท | แสดงใน Gallery | สตรีมผ่าน `/preview.glb` หรือ `/:hash.glb` | สตรีมไฟล์เต็มผ่าน `/file.glb?key=` | ดาวน์โหลดผ่าน `/download` |
| :--- | :--- | :--- | :--- | :--- |
| **โมเดลฟรี (`price_cents = 0`)** | แสดงทุกคน | ทุกคน (ส่งไฟล์เต็ม) | ทุกคน (ไม่ต้องใช้ `key`) | ทุกคน (ไม่ต้องล็อกอิน) |
| **โมเดลเสียเงิน (`price_cents > 0`)** | แสดงทุกคน | ทุกคน (ส่งเฉพาะไฟล์ `preview_hash` เท่านั้น **ห้ามส่ง `file_hash` เด็ดขาด**) | เฉพาะผู้มี `embed_key` ที่สถานะ `paid` และตรงกับ `model_id` | ต้องล็อกอิน (`Bearer JWT`) + ซื้อแล้ว (`status = 'paid'`) หรือเป็นเจ้าของโมเดล |
| **โมเดลถูกลบ (`deleted_at IS NOT NULL`)** | ไม่แสดง (`404`) | ปิดกั้น (`404 MODEL_NOT_FOUND`) | **ผู้ซื้อเดิมยังสตรีมได้** (Soft Delete) | **ผู้ซื้อเดิม/เจ้าของยังดาวน์โหลดได้** |
| **โมเดลถูกซ่อน (`hidden_at IS NOT NULL`)** | ไม่แสดง | **ปิดกั้นทันที (`403 MODEL_UNAVAILABLE`)** | **ปิดกั้นทันที (`403`) แม้ซื้อแล้ว** | **ปิดกั้นทันที (`403`) แม้ซื้อแล้ว** |
| **เจ้าของถูกระงับ (`owner.suspended_at IS NOT NULL`)** | ไม่แสดง | **ปิดกั้นทันที (`403 MODEL_UNAVAILABLE`)** | **ปิดกั้นทันที (`403`) แม้ซื้อแล้ว** | **ปิดกั้นทันที (`403`) แม้ซื้อแล้ว** |

### 3.2 กฎความปลอดภัยสำคัญ (Security Rules)
1. **ตรวจสิทธิ์ที่ Backend เสมอ:** ห้ามตรวจบทบาท (`is_seller`, `role === 'admin'`, `suspended_at`) แค่ฝั่ง Frontend หรือเชื่อเฉพาะ payload ใน JWT สำหรับการกระทำสำคัญ ต้องเช็กสถานะล่าสุดจากฐานข้อมูลเสมอ
2. **Constant-Time `embed_key` Verification:** การเปรียบเทียบ `embed_key` ต้องใช้ `verifyEmbedKeyConstantTime` (`crypto.timingSafeEqual`) และเมื่อผู้ซื้อกด Regenerate Key (`POST /api/purchases/:id/regenerate-key`) คีย์เก่าต้องใช้งานไม่ได้ทันที
3. **GLB Magic Bytes & Content-Addressable Storage:**
   - ตรวจ 12 ไบต์แรกของไฟล์ `.glb` เสมอ (`magic === 0x46546C67` (`"glTF"`), `version === 2`, และ `totalLength === file.size`)
   - จำกัดขนาดไฟล์: Main `.glb` ≤ `50 MB`, Preview `.glb` ≤ `5 MB`, Poster `.webp/.png/.jpg` ≤ `1 MB`
   - โมเดลเสียเงิน (`price_cents > 0`) **บังคับ** ต้องแนบไฟล์ `preview` เสมอ
   - ตั้งชื่อไฟล์ใน Storage ด้วยค่า `sha256` (`<hash>.glb`, `<hash>.webp`) ห้ามนำชื่อไฟล์จากผู้ใช้มาเป็น path
4. **Multi-Layer GLB Watermarking (`glbWatermark.ts`):**
   - ทุกไฟล์ `.glb` ที่อัปโหลดผ่าน `POST /api/models` ต้องผ่าน `embedLicenseAndWatermark` เพื่อฝังลายน้ำต้นฉบับ (`purchaseId: 'original'`) ก่อนบันทึกลง Storage
   - เมื่อผู้ซื้อที่ชำระเงินแล้ว (`status = 'paid'`) ดาวน์โหลดไฟล์ผ่าน `GET /cdn/models/:id/download` ระบบต้องฝัง `purchaseId` และ `license_type` ของผู้ซื้อลงในไฟล์ `.glb` (ทั้งใน `asset.extras` และพิกัด `POSITION` 64 จุดแรก) พร้อมบันทึก `watermark_hash` ลงตาราง `purchases`
5. **Mock Payment Guard:** ระบบจ่ายเงินจำลองทำงานเฉพาะเมื่อ `PAYMENT_PROVIDER=mock` เท่านั้น ห้ามเปิดใน Production
6. **Standard Error Format:** ทุก API และ CDN ต้องตอบ Error ในรูปแบบเดียวกันเสมอ และ Error ของ CDN ต้องตั้ง `Cache-Control: no-store`:
   ```json
   {
     "error": {
       "code": "ERROR_CODE",
       "message": "Human-readable description"
     }
   }
   ```

---

## 4. สเปกของแต่ละเซอร์วิสและ API Contract

### 4.1 CDN Service (`services/cdn-service/` — พอร์ต `4001`)
- **`POST /api/models`** (`requireAuth`, `requireSeller`, `multipart/form-data`):
  - Fields: `file` (required `.glb`), `preview` (required ถ้า `price_cents > 0`), `poster` (optional image), `title`, `description`, `tags`, `license` (`CC0` | `CC-BY` | `CC-BY-NC` | `COMMERCIAL`), `price_cents`, `currency`
  - ตรวจไฟล์ด้วย `validateGlbFile` → ฝังลายน้ำต้นฉบับด้วย `embedLicenseAndWatermark` (`purchaseId: 'original'`) → คำนวณ `sha256` → บันทึกลง Storage (`LocalDiskStorage` / `SupabaseStorage`) และฐานข้อมูล
- **`GET /cdn/models/:id/:hash.glb`**:
  - สตรีมไฟล์ตาม Content Hash (อนุญาตเฉพาะไฟล์ของโมเดลฟรี หรือ `preview_hash` ของโมเดลเสียเงิน หากขอ `file_hash` ของโมเดลเสียเงินจะตอบ `401 KEY_REQUIRED`)
  - Headers: `Cache-Control: public, max-age=31536000, immutable`, `Accept-Ranges: bytes`, `ETag: "<hash>"`, `Cross-Origin-Resource-Policy: cross-origin`
- **`GET /cdn/models/:id/preview.glb`**:
  - สตรีมไฟล์ตัวอย่างสาธารณะ (โมเดลฟรีส่ง `file_hash`, โมเดลเสียเงินส่ง `preview_hash`)
  - Headers: `Cache-Control: public, max-age=300` (5 นาที เพื่อให้การซ่อนโมเดลหรือระงับบัญชีมีผลเร็ว)
- **`GET /cdn/models/:id/file.glb?key=YOUR_EMBED_KEY`**:
  - สตรีมไฟล์เต็มของโมเดล (โมเดลเสียเงินต้องส่ง `key` ที่ถูกต้องและสถานะ `paid`)
  - Headers: `Cache-Control: private, no-store`
  - มี Rate Limit ป้องกันการสุ่มคีย์ผิดซ้ำๆ (`keyFailureLimiter`)
- **`GET /cdn/models/:id/download`**:
  - ดาวน์โหลดไฟล์จริง (`Content-Disposition: attachment; filename="..."; filename*=UTF-8''...`)
  - โมเดลเสียเงินต้องส่ง `Authorization: Bearer <token>` ของผู้ซื้อ (`status = 'paid'`) หรือเจ้าของโมเดล
  - สำหรับผู้ซื้อที่ชำระเงินแล้ว จะฝัง `purchaseId` + `license_type` ลงในไฟล์ `.glb` และอัปเดต `purchases.watermark_hash` ก่อนส่งไฟล์กลับ
  - เพิ่มค่า `download_count + 1` เมื่อสตรีมเริ่มต้นจากไบต์ที่ 0 (ไม่นับซ้ำเมื่อ Resume Range chunk)
- **`GET /cdn/models/:id/poster.webp`**:
  - สตรีมภาพปก (`image/webp`, `Cache-Control: public, max-age=300`)
- **`POST /cdn/verify-watermark` (รวมถึง `/verify-watermark` และ `/api/verify-watermark`)**:
  - รับไฟล์ `.glb` (`multipart/form-data` หรือ `model/gltf-binary`) พร้อม `expectedModelId` (optional)
  - ตรวจสอบทั้ง Layer 1 (`asset.extras` HMAC signature) และ Layer 2 (Vertex Steganography 64 จุดแรก) แล้วคืนค่า `{ isValidMetadata, isValidVertexWatermark, extractedMetadata, vertexBitMatchRatio }`
- **HTTP Range & ETag:** ทุก `/cdn/*` route รองรับ `HEAD`, `If-None-Match` (`304`), `If-Range`, และ `Range: bytes=start-end` / `start-` / `-suffix` (`206 Partial Content` หรือ `416 Range Not Satisfiable`)
- **Supabase Dual-Mode Support:**
  - `db.ts`, `cdn.service.ts`, และ `upload.routes.ts` รองรับทั้งการคิวรีผ่าน PostgreSQL Pool (`DATABASE_URL`) และสลับไปใช้ `@supabase/supabase-js` (`SUPABASE_URL` + `SUPABASE_KEY`) อัตโนมัติหาก Pool เชื่อมต่อไม่ได้
  - `openStream()` รองรับการดึงไฟล์ทั้งจาก `LocalDiskStorage` และ `SupabaseStorage` พร้อม Fallback อัตโนมัติ

### 4.2 Core API (`services/core-api/` — พอร์ต `4000`)
- **Auth (`/api/auth`):**
  - `POST /api/auth/register` — สมัครสมาชิก (`bcrypt` + ออก JWT)
  - `POST /api/auth/login` — ล็อกอิน (บล็อกผู้ใช้ที่ `suspended_at IS NOT NULL` ด้วย `403 ACCOUNT_SUSPENDED`)
- **Models (`/api/models`):**
  - `GET /api/models?q=&tag=&license=&price=free|paid&page=` — ค้นหา กรอง แบ่งหน้า (กรอง `hidden_at IS NULL AND deleted_at IS NULL AND u.suspended_at IS NULL`)
  - `GET /api/models/:id` — รายละเอียดโมเดล (ไม่ส่ง `fileUrl` ของโมเดลเสียเงิน)
  - `DELETE /api/models/:id` — Soft Delete (`deleted_at = NOW()`, เฉพาะเจ้าของหรือแอดมิน)
- **Payments (`/api`):**
  - `POST /api/models/:id/checkout` — สร้างรายการสั่งซื้อรายชิ้น (`status = 'pending'`), ล็อก `amount_cents`, `currency`, `license_type` จากตาราง `models`, และสุ่ม `embed_key` 48 ตัวอักษร hex (`crypto.randomBytes(24)`)
  - `POST /api/purchases/:id/confirm-mock` (และ `/api/models/:id/pay-mock`) — ยืนยันจ่ายเงินจำลอง (`status = 'paid'`, `paid_at = NOW()`) เมื่อ `PAYMENT_PROVIDER=mock`
  - `GET /api/me/purchases` — ดึงรายการโมเดลที่ซื้อแล้วพร้อม `embed_key`, `amount_cents`, `currency`, `license_type`, `watermark_hash`, `paid_at`
  - `POST /api/purchases/:id/regenerate-key` — สร้าง `embed_key` ใหม่แทนที่รหัสเดิมทันที
- **Seller (`/api/seller`):**
  - `POST /api/seller/enable` — เปิดโหมดคนขาย (`is_seller = true`)
  - `GET /api/seller/status` — ตรวจสถานะคนขาย
  - `GET /api/seller/models` — รายการโมเดลของคนขาย
  - `GET /api/seller/sales` — สรุปรายได้และประวัติการขาย

### 4.3 Frontend & Embed Contract (`frontend/` — พอร์ต `3000`)
- **Web Component (`public/embed.js`):**
  ```html
  <script type="module" src="http://localhost:3000/embed.js"></script>
  <vm-model model-id="UUID" cdn-base="http://localhost:4001" key="OPTIONAL_KEY" auto-rotate camera-controls></vm-model>
  ```
  - รองรับ attributes: `model-id`, `key`, `cdn-base`, `auto-rotate`, `camera-controls`, `background`, `exposure`, `shadow-intensity`, `poster`, `loading` (ค่าเริ่มต้น `lazy`)
  - **Graceful Fallback:** หาก `key` ผิดหรือถูก Regenerate จะสลับไปโหลด `/preview.glb` อัตโนมัติและแสดงป้าย `"ต้องซื้อเพื่อใช้งาน · แสดงไฟล์ตัวอย่าง (Preview)"` โดยไม่ crash
- **Iframe Embed (`/embed/[id]?key=...`):**
  - ตั้งค่า `Content-Security-Policy: frame-ancestors *;` ใน `next.config.ts` (ส่วนหน้าอื่นตั้ง `frame-ancestors 'self';`)
  - ใช้คอมโพเนนต์ `EmbedIframeViewer.tsx` สตรีมจาก CDN พร้อมระบบสลับไป `preview.glb` เมื่อ `key` ไม่ถูกต้อง
- **Model Detail (`/models/[id]`):**
  - ใช้ `ModelPreview.tsx` สตรีมตัวอย่าง 3D จาก CDN พร้อมช่องทดสอบ `embed_key`
  - ใช้ `ModelActions.tsx` ดาวน์โหลดไฟล์ผ่าน `fetch('/cdn/models/:id/download')` พร้อมแนบ `Authorization: Bearer <token>` แล้วแปลงเป็น `Blob` (เพราะ `<a href>` ธรรมดาส่ง Header ไม่ได้)
  - ใช้ `EmbedSnippets.tsx` สร้างโค้ด `<vm-model>` และ `<iframe>`

---

## 5. โครงสร้างฐานข้อมูล (`supabase/schema.sql`)

- **`users`**: `id (UUID)`, `email (UNIQUE)`, `password_hash`, `display_name`, `role ('user'|'creator'|'admin')`, `is_seller (BOOLEAN)`, `suspended_at (TIMESTAMPTZ)`, `created_at`
- **`models`**: `id (UUID)`, `owner_id (FK users)`, `title`, `description`, `tags (TEXT[] GIN)`, `license ('CC0'|'CC-BY'|'CC-BY-NC'|'COMMERCIAL')`, `file_hash (CHAR(64))`, `file_size (BIGINT)`, `preview_hash (CHAR(64))`, `poster_hash (CHAR(64))`, `price_cents (INT)`, `currency (CHAR(3))`, `view_count`, `download_count`, `hidden_at`, `deleted_at`, `created_at`
- **`purchases`**: `id (UUID)`, `user_id (FK users)`, `model_id (FK models)`, `status ('pending'|'paid')`, `amount_cents (INT)`, `currency (VARCHAR(10))`, `license_type (VARCHAR(50))`, `watermark_hash (VARCHAR(128))`, `paid_at (TIMESTAMPTZ)`, `provider_session_id`, `embed_key (VARCHAR(64) UNIQUE)`, `created_at`, `UNIQUE(user_id, model_id)`
- **`likes`** & **`comments`**: ตารางสำหรับระบบถูกใจและคอมเมนต์
- **Multi-Layer GLB Watermarking (`services/cdn-service/src/utils/glbWatermark.ts`):**
  - **Layer 1 (Metadata Signature):** ฝัง `{ platform: 'Broken Design', modelId, ownerId, license, purchaseId, signature, issuedAt }` (HMAC-SHA256 ด้วย `WATERMARK_SECRET`) ลงใน `asset.extras` และ `asset.copyright`
  - **Layer 2 (Vertex Steganography):** ฝังบิต 64 บิตแรกของ `signature` ลงในทศนิยมหลักที่ 4 ของพิกัดแกน X (`Math.round(x * 10000)`) ของจุดยอด 64 จุดแรกใน `POSITION` accessor ของ Mesh แรก
  - **`POST /cdn/verify-watermark` (หรือ `/verify-watermark`):** รับไฟล์ `.glb` เพื่อตรวจสอบทั้ง `isValidMetadata` และ `isValidVertexWatermark` (`vertexBitMatchRatio`) แม้ `asset.extras` ถูกลบออกจากการ Export ใหม่

**บัญชี Seed เริ่มต้น:**
- Admin: `admin@brokendesign.com` / `Admin@BrokenDesign2026!`
- Creator: `creator@brokendesign.com` / `Creator@BrokenDesign2026!` (หรือ `Admin@BrokenDesign2026!` ใน `schema.sql`)
- โมเดลตัวอย่างบน Supabase (`ioqslrzmwsjogxsojwne`): ID `7524b129-938b-41c9-b66c-977a809e1c89` (`Lixyte Crystal Cube`)

---

## 6. เส้นทางการพัฒนาของโปรเจกต์ (Development Roadmap & Agent Action Plan)

ส่วนนี้กำหนดแผนที่นำทาง (Roadmap) สำหรับ AI Agent ทุกตัว เพื่อให้สามารถรับงานต่อและพัฒนาฟีเจอร์ถัดไปได้อย่างเป็นระบบโดยไม่ชนกัน:

### Phase 1: โครงสร้างพื้นฐาน, ระบบ CDN, ลายน้ำ 3 มิติ และการซื้อรายชิ้น (Completed ✅)
1. **Database Schema & Core Middlewares (แฮม):**
   - `supabase/schema.sql` (รองรับ Single-Item Purchase: `amount_cents`, `currency`, `license_type`, `watermark_hash`, `paid_at`)
   - `auth.middleware.ts` (`requireAuth`, `requireSeller`, `requireAdmin`) และ `error.middleware.ts` (`AppError`)
2. **Upload, Dual Storage & GLB Validation (แฮม & นนท์):**
   - `LocalDiskStorage` และ `SupabaseStorage` (`models` bucket) พร้อมระบบ Fallback อัตโนมัติ
   - `glbValidator.ts` ตรวจ Magic Bytes (`glTF` v2) และคำนวณ `sha256`
   - หน้า `/upload` พร้อมระบบสร้างภาพปก `poster.webp` อัตโนมัติจาก `<model-viewer>.toBlob()`
3. **CDN Streaming, Access Control & Multi-Layer GLB Watermarking (นนท์):**
   - `cdn.routes.ts`, `cdn.service.ts`, `range.ts`, `glbWatermark.ts`, `cdn.test.ts` (ผ่าน **23/23 tests**)
   - รองรับ HTTP Range (`206`/`416`), ETag (`304`), Rate Limit, Constant-Time `embed_key` check
   - ฝังลายน้ำ 2 ชั้น (Metadata HMAC + 64-point Vertex Steganography) ทั้งตอนอัปโหลด (`purchaseId: 'original'`) และตอนผู้ซื้อดาวน์โหลด (`purchaseId` + `license_type` พร้อมบันทึก `watermark_hash`)
   - Endpoint `POST /cdn/verify-watermark` สำหรับพิสูจน์ความเป็นเจ้าของไฟล์ `.glb`
4. **Auth, Catalog Models, Payments & Seller Backend (ต้า, เป้ก & ภีม):**
   - `auth.routes.ts` (`register`, `login` พร้อมบล็อกบัญชีที่ถูกระงับ)
   - `models.routes.ts` (`GET /api/models` ค้นหา/กรอง/แบ่งหน้า, `GET /api/models/:id` ซ่อนลิงก์ไฟล์เต็มของโมเดลเสียเงิน, และ `DELETE /api/models/:id` Soft Delete)
   - `payments.routes.ts` + `payments.test.ts` และ `seller.routes.ts` + `seller.test.ts` (ผ่าน **17/17 tests**)
5. **Frontend Viewer, Gallery & Cross-Origin Embed (เจี๊ยบ & นนท์):**
   - หน้า `/`, `/gallery`, `/models/[id]`, `/creators/[handle]`, `/embed/[id]`, และ `public/embed.js` (`<vm-model>`) เชื่อมต่อกับ Supabase และ CDN Service เรียบร้อย

---

### Phase 2: ระบบแอดมิน และการเชื่อมหน้า Dashboard (Current Priority 🚧)

เมื่อผู้ใช้งานสั่งให้พัฒนาต่อในส่วนที่เหลือ Agent ต้องยึดแนวทางและลำดับความสำคัญดังนี้:

1. **งานที่ 1 — พัฒนา Admin Backend Module (`services/core-api/src/modules/admin/` — ต้า & เป้ก):**
   - **เป้าหมาย:** สร้าง `admin.routes.ts` และผูกเข้ากับ `app.use('/api/admin', adminRouter)` ใน `services/core-api/src/app.ts` โดยทุก Route ต้องผ่าน `requireAuth` และ `requireAdmin` (ตรวจ `role === 'admin'` และ `suspended_at IS NULL` จากฐานข้อมูลจริง)
   - **Endpoints ที่ต้องมี:**
     - `GET /api/admin/overview` — สรุปจำนวนผู้ใช้ทั้งหมด, จำนวนโมเดล, จำนวนรายการสั่งซื้อสำเร็จ และยอดขายรวม
     - `GET /api/admin/users` — ดึงรายชื่อผู้ใช้ทั้งหมดพร้อมสถานะ `role`, `is_seller`, `suspended_at`
     - `PATCH /api/admin/users/:id/suspend` — ระงับ (`suspended_at = NOW()`) หรือคืนสิทธิ์ (`suspended_at = NULL`) บัญชีผู้ใช้ (ห้ามแอดมินระงับตัวเอง)
     - `GET /api/admin/models` — ดึงรายการโมเดลทั้งหมดในระบบ (รวมโมเดลที่ถูกซ่อนหรือถูกลบ)
     - `PATCH /api/admin/models/:id/hide` — ซ่อน (`hidden_at = NOW()`) หรือแสดงผลคืน (`hidden_at = NULL`) โมเดล (เมื่อซ่อนแล้ว CDN จะบล็อกการสตรีมด้วย `403 MODEL_UNAVAILABLE` ทันที)
     - `GET /api/admin/purchases` — ดูรายการสั่งซื้อทั้งหมดในระบบพร้อมข้อมูลผู้ซื้อ โมเดล ราคา และ `watermark_hash`

2. **งานที่ 2 — เชื่อมต่อ Frontend Auth, Mock Checkout, Buyer/Seller/Admin Dashboards (`frontend/` — เจี๊ยบ & ภีม):**
   - **Auth (`/login`):** เชื่อมต่อฟอร์มเข้าสู่ระบบและสมัครสมาชิกเข้ากับ `POST /api/auth/login` และ `POST /api/auth/register` พร้อมเก็บ JWT Token
   - **Mock Checkout (`/pay/mock/[id]`):** หน้าจำลองการชำระเงินที่เรียก `POST /api/models/:id/checkout` และ `POST /api/purchases/:id/confirm-mock` เมื่อกดปุ่มยืนยันการชำระเงิน
   - **Buyer Dashboard (`/me`):** ดึงรายการโมเดลที่ซื้อแล้วจาก `GET /api/me/purchases` แสดง `embed_key`, ประเภท License, ปุ่มดาวน์โหลด `.glb` และปุ่มกด Regenerate Key (`POST /api/purchases/:id/regenerate-key`)
   - **Seller Dashboard (`/seller`):** เชื่อมต่อ `GET /api/seller/status`, ปุ่มเปิดโหมดคนขาย (`POST /api/seller/enable`), รายการโมเดลของฉัน (`GET /api/seller/models`), และตารางสรุปยอดขาย (`GET /api/seller/sales`)
   - **Admin Dashboard (`/admin/*`):** สร้างหน้าแดชบอร์ดแอดมินทั้ง 4 ส่วน (`/admin`, `/admin/models`, `/admin/users`, `/admin/purchases`) เชื่อมกับ `/api/admin/*`

---

### Phase 3: การต่อยอดหลังเวอร์ชันแรก (Post-v1 Future Roadmap 🚀)
1. **Watermark Inspector UI (`/verify` หรือในหน้า Admin/Creator):** หน้าเว็บสำหรับอัปโหลดไฟล์ `.glb` ต้องสงสัยเพื่อเรียก `POST /cdn/verify-watermark` และแสดงผลลัพธ์ `isValidMetadata`, `isValidVertexWatermark`, `vertexBitMatchRatio`, และ `purchaseId` ของผู้ซื้อที่นำไฟล์ไปเผยแพร่
2. **Real Stripe Checkout Integration:** เปิดใช้งาน Stripe Checkout Session และ `POST /api/webhooks/stripe` ที่ตรวจสอบ `stripe-signature` แบบ Idempotent เมื่อ `PAYMENT_PROVIDER=stripe`
3. **Automated 3D Optimization & Domain Lock:** บีบอัดโมเดลอัตโนมัติด้วย Draco / Meshopt ตอนอัปโหลด และเพิ่มตัวเลือกผูก `embed_key` กับรายชื่อโดเมนที่อนุญาต (Allowed Origins)

---

## 7. แนวทางปฏิบัติและคำสั่งตรวจสอบสำหรับ Agent (Agent Workflow & Verification)

### 7.1 ข้อควรระวังในการรันคำสั่งบน Windows PowerShell
- หากรันคำสั่งบน Windows PowerShell ที่ติดนโยบาย `ExecutionPolicy` ของสคริปต์ `.ps1` ให้เรียกใช้ **`npx.cmd`** และ **`npm.cmd`** แทน `npx` และ `npm`
- อ่านไฟล์ที่เกี่ยวข้องให้ครบถ้วนก่อนแก้ไขทุกครั้ง และรักษาสไตล์การเขียนโค้ด (TypeScript strictness, `AppError`, Dual-mode DB query + Supabase fallback) ให้สอดคล้องกับโค้ดเดิม

### 7.2 คำสั่งตรวจสอบบังคับก่อนจบงานทุกครั้ง (Mandatory Verification Checklist)

```bash
# 1. ตรวจ Type-check และรัน Unit Tests ของ CDN Service (ต้องผ่านครบ 23/23 tests)
cd services/cdn-service
npx.cmd tsc --noEmit -p .
npm.cmd test

# 2. ตรวจ Type-check และรัน Unit Tests ของ Core API (ต้องผ่านครบ 17/17 tests)
cd services/core-api
npx.cmd tsc --noEmit -p .
npm.cmd test

# 3. ตรวจ Type-check ของ Frontend
cd frontend
npx.cmd tsc --noEmit -p .
```
