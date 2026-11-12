# Lixyte — 3D Asset Repository & WebGL CDN Platform

**Lixyte** (เดิมชื่อ **Broken Design**) คือแพลตฟอร์ม **"Google Fonts สำหรับโลก 3 มิติ"** ศูนย์กลางในการจัดเก็บ ค้นหา ซื้อขาย และสตรีมไฟล์โมเดล 3 มิติมาตรฐาน `.glb` (Binary glTF 2.0) สำหรับนักพัฒนาเว็บและครีเอเตอร์ รองรับการฝังโมเดลลงบนเว็บไซต์ภายนอก (Embed) ผ่าน `<iframe>` และ Web Component `<vm-model>` แบบข้ามโดเมน (Cross-Origin CDN) โดยไม่ต้องดาวน์โหลดหรือโฮสต์ไฟล์เอง

> 📌 **สำหรับ AI Coding Agent และนักพัฒนา:** โปรเจกต์นี้มีไฟล์สเปกกลางที่ **[AGENT.md](./AGENT.md)** (พร้อมกฎบังคับโหลดอัตโนมัติใน `.agents/rules/mandatory-agent-spec.md` และ `GEMINI.md`) เพื่อให้ Agent อ่านทำความเข้าใจสถาปัตยกรรม ขอบเขตงาน และกฎความปลอดภัยก่อนเริ่มทำงานทุกครั้ง

---

## 1. สถาปัตยกรรมระบบแบบ Microservices (System Architecture)

โปรเจกต์ **Lixyte** แยกส่วน Backend ออกเป็น **2 Microservices** ตามลักษณะการใช้ทรัพยากร เพื่อป้องกันไม่ให้การอัปโหลดและสตรีมไฟล์ 3 มิติขนาดใหญ่กระทบต่อความเร็วของระบบ API หลัก:

| เซอร์วิส / โฟลเดอร์         | พอร์ต  | เทคโนโลยีหลัก                                              | หน้าที่รับผิดชอบ                                                                                                                                                           |
| :-------------------------- | :----: | :--------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`frontend/`**             | `3000` | Next.js (App Router), Tailwind CSS, `@google/model-viewer` | หน้าเว็บ Gallery, หน้ารายละเอียด `/models/[id]` + 3D Preview, หน้า `/upload`, หน้า `/embed/[id]` สำหรับ Iframe, สคริปต์ `public/embed.js` (`<vm-model>`), แดชบอร์ดคนขาย และแดชบอร์ดแอดมิน |
| **`services/core-api/`**    | `4000` | Express 5, TypeScript, JWT, bcrypt, Zod                    | จัดการระบบสมาชิก (`auth`), ข้อมูลแคตตาล็อกและการค้นหา (`models`), ระบบซื้อขายแบบจำลองและสร้างคีย์ (`payments`), ส่วนคนขาย (`seller`) และส่วนแอดมิน (`admin`)               |
| **`services/cdn-service/`** | `4001` | Express 5, TypeScript, Multer, Node Streams, Supabase JS   | รับอัปโหลดไฟล์ `.glb` (สูงสุด 50 MB), ตรวจ Magic Bytes (`glTF` v2), เก็บไฟล์ด้วย `sha256` (`LocalDiskStorage` / `SupabaseStorage`) และสตรีมไฟล์ผ่าน `/cdn/*` (รองรับ CORS, Cache, ETag, HTTP Range) |
| **`supabase/`**             | `5432` | Supabase PostgreSQL & Supabase Storage                     | ฐานข้อมูลกลางสำหรับเก็บตาราง `users`, `models` (`tags text[]`), `purchases`, `likes`, และ `comments` พร้อม Object Storage สำหรับเก็บไฟล์ `.glb` และ `poster.webp`          |

---

## 2. บทบาทผู้ใช้และสิทธิ์การเข้าถึง (Roles & Access Control)

ลูกค้าและคนขายเป็น **บัญชีเดียวกัน** ส่วนแอดมินมีไว้ดูแลเว็บเท่านั้น

| บทบาท               | วิธีได้สิทธิ์                          | เห็นและทำอะไรได้                                                                                                |
| :------------------ | :------------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| **ลูกค้า**          | สมัครสมาชิก                            | ดู Gallery, ซื้อโมเดล, ดาวน์โหลด, ขอโค้ดฝัง, หน้า `/me` (โมเดลที่ซื้อ + `embed_key`)                            |
| **คนขาย** (Creator) | กดเปิด "โหมดคนขาย" ในบัญชีเดิม         | ทุกอย่างของลูกค้า + แดชบอร์ดคนขาย (`/seller`: โมเดลของฉัน ยอดขาย) + อัปโหลด/ลบโมเดลของตัวเอง                    |
| **แอดมิน**          | ตั้งในฐานข้อมูลเท่านั้น สมัครเองไม่ได้ | แดชบอร์ดแอดมิน (`/admin/*`): ภาพรวม, ซ่อน/คืนโมเดล, ระงับ/คืนบัญชี, ดูรายการซื้อขายทั้งระบบ ซื้อและขายเองไม่ได้ |

### ตารางสิทธิ์การสตรีมและดาวน์โหลดผ่าน CDN (CDN Access Matrix)

| ประเภท / สถานะโมเดล | สตรีมผ่าน `/preview.glb` หรือ `/:hash.glb` | สตรีมไฟล์เต็มผ่าน `/file.glb?key=` | ดาวน์โหลดไฟล์จริงผ่าน `/download` |
| :--- | :--- | :--- | :--- |
| **โมเดลฟรี (`price_cents = 0`)** | ทุกคน (ส่งไฟล์เต็ม) | ทุกคน (ไม่ต้องใช้ `key`) | ทุกคน (ไม่ต้องล็อกอิน) |
| **โมเดลเสียเงิน (`price_cents > 0`)** | ทุกคน (ส่งเฉพาะไฟล์ `preview` เท่านั้น บล็อก `file_hash` ด้วย `401`) | เฉพาะผู้มี `embed_key` ที่ชำระเงินแล้ว (`status = 'paid'`) และตรงกับโมเดล | ต้องล็อกอิน (`Bearer JWT`) + ซื้อแล้ว หรือเป็นเจ้าของโมเดล |
| **ถูกลบโดยเจ้าของ (`deleted_at`)** | ปิดกั้น (`404 MODEL_NOT_FOUND`) | **ผู้ซื้อเดิมยังสตรีมได้ปกติ** (Soft Delete) | **ผู้ซื้อเดิม/เจ้าของยังดาวน์โหลดได้** |
| **ถูกซ่อนโดยแอดมิน (`hidden_at`)** | **หยุดส่งทันที (`403 MODEL_UNAVAILABLE`)** | **หยุดส่งทันที (`403`) แม้ซื้อแล้ว** | **หยุดส่งทันที (`403`) แม้ซื้อแล้ว** |
| **เจ้าของถูกระงับ (`suspended_at`)** | **หยุดส่งทันที (`403 MODEL_UNAVAILABLE`)** | **หยุดส่งทันที (`403`) แม้ซื้อแล้ว** | **หยุดส่งทันที (`403`) แม้ซื้อแล้ว** |

---

## 3. เทคโนโลยีที่ใช้พัฒนา (Tech Stack)

- **Frontend & 3D WebGL (`frontend/`)**
  - **Framework & Styling**: Next.js 15 (App Router), React 19, TypeScript 5, Tailwind CSS 3, Lucide React
  - **3D Rendering & Embed**: `@google/model-viewer` v4, Three.js, Web Components (`<vm-model>`), มาตรฐานไฟล์ Binary glTF 2.0 (`.glb`)
- **Backend — Core API (`services/core-api/`)**
  - **Runtime & Framework**: Node.js 22+, Express 5, TypeScript 5 (`tsx`)
  - **Auth, Validation & Security**: JSON Web Token (`jsonwebtoken`), `bcrypt`, `zod`, `express-rate-limit`, `cors`
  - **Payments**: เวอร์ชันแรกใช้ **Mock Checkout (จ่ายเงินจำลอง)** ผ่านตัวแปร `PAYMENT_PROVIDER=mock` ส่วน Stripe SDK (`stripe`) ติดตั้งไว้สำหรับเฟสถัดไป
- **Backend — Asset CDN & Storage (`services/cdn-service/`)**
  - **Upload & File Streaming**: `multer`, Node.js Streams (`fs` / `stream.pipeline`), HTTP Range Requests (`206 Partial Content` / `416 Range Not Satisfiable`), ETag (`304 Not Modified`), Cross-Origin Resource Sharing (`CORS *` & `Cross-Origin-Resource-Policy: cross-origin`)
  - **Storage & Asset Integrity**: Content-Addressable Storage (`sha256` ผ่าน `StorageAdapter` — รองรับทั้ง `LocalDiskStorage` และ `SupabaseStorage` พร้อมระบบ Fallback อัตโนมัติ), GLB Magic Bytes Validator, Constant-Time Key Check (`crypto.timingSafeEqual`)
- **Database & Cloud Storage (`supabase/`)**
  - **Database & Driver**: Supabase (PostgreSQL), `pg` (`node-postgres`) และ `@supabase/supabase-js` (Dual-Mode Fallback), `pgcrypto` (`UUID`), GIN Index สำหรับค้นหา `tags` (`TEXT[]`)
  - **Object Storage**: Supabase Storage (เก็บไฟล์ `.glb` และ `poster.webp` แบบถาวรเมื่อ Deploy บน Cloud Free Tier)

---

## 4. โครงสร้างโฟลเดอร์โปรเจกต์ (Project Structure)

```text
broken-design/
├── .agents/
│   └── rules/
│       └── mandatory-agent-spec.md       # กฎบังคับให้ AI Agent อ่าน AGENT.md ก่อนทำงานทุกครั้ง
├── services/
│   ├── core-api/                         # [Microservice 1] Core Business Logic API (Port 4000)
│   │   ├── src/
│   │   │   ├── config/                   # ตั้งค่าการเชื่อมต่อ Supabase DB และ Environment Variables
│   │   │   ├── middlewares/              # JWT Auth, ตรวจบทบาท (requireSeller / requireAdmin), Error Handler  [แฮม]
│   │   │   ├── modules/
│   │   │   │   ├── auth/                 # สมัครสมาชิก, ล็อกอิน (bcrypt + JWT), บล็อกบัญชีที่ถูกระงับ  [ต้า]
│   │   │   │   ├── models/               # ดึงรายการ, ค้นหา, กรอง, แบ่งหน้า, รายละเอียด, Soft Delete  [เป้ก / แฮม]
│   │   │   │   ├── payments/             # Checkout จำลอง, สร้าง/Regenerate embed_key, รายการที่ซื้อ + Tests  [ภีม]
│   │   │   │   ├── seller/               # ยอดขาย, โมเดลของคนขาย, เปิดโหมดคนขาย + Tests  [ภีม]
│   │   │   │   ├── admin/                # ภาพรวม, ซ่อน/คืนโมเดล, ระงับ/คืนบัญชี, รายการซื้อขาย  [ต้า / เป้ก]
│   │   │   │   └── interactions/         # ถูกใจและความคิดเห็น (Likes/Comments)
│   │   │   ├── scripts/
│   │   │   │   └── seedAdmin.ts          # สคริปต์สร้างบัญชี Admin และ Creator เริ่มต้น  [แฮม]
│   │   │   └── app.ts                    # Entry point ของ Core API (/api/*)
│   │   ├── .env.example
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── cdn-service/                      # [Microservice 2] High-I/O Upload & 3D Streaming CDN (Port 4001)
│       ├── src/
│       │   ├── config/                   # ตั้งค่า DB (PostgreSQL + Supabase REST Fallback), Env, Supabase Client
│       │   ├── middlewares/              # JWT Auth (requireAuth / requireSeller / requireAdmin) & Error Handler  [แฮม]
│       │   ├── storage/                  # StorageAdapter, LocalDiskStorage & SupabaseStorage (sha256)  [แฮม]
│       │   ├── utils/                    # ตัวตรวจ Magic Bytes ของไฟล์ .glb (glTF v2)  [แฮม]
│       │   ├── modules/
│       │   │   ├── upload/               # รับไฟล์ .glb, preview, poster และบันทึกลง Storage + DB  [แฮม]
│       │   │   └── cdn/                  # สตรีมไฟล์ .glb/.webp, ตรวจ embed_key, Range, Cache, Rate Limit  [นนท์]
│       │   │       ├── cdn.routes.ts     #   Routes ทั้ง 5 เส้นทางของ /cdn/models/*
│       │   │       ├── cdn.service.ts    #   ตรวจสิทธิ์, ตรวจ embed_key, เชื่อม Supabase/Storage และส่งสตรีม
│       │   │       ├── range.ts          #   ตัวแปลง HTTP Range Header (RFC 9110 §14)
│       │   │       └── cdn.test.ts       #   ชุดทดสอบ CDN ครบทุกเงื่อนไข (21 test cases)
│       │   └── app.ts                    # Entry point ของ CDN Service (/api/models upload & /cdn/*)
│       ├── storage_data/                 # โฟลเดอร์เก็บไฟล์จริงตามค่า Hash (อยู่ใน .gitignore)
│       ├── tmp_uploads/                  # โฟลเดอร์พักไฟล์ขณะคำนวณ sha256 (อยู่ใน .gitignore)
│       ├── .env.example
│       ├── Dockerfile
│       └── package.json
│
├── frontend/                             # Next.js Frontend & WebGL Viewer (Port 3000)
│   ├── public/
│   │   └── embed.js                      # Web Component <vm-model> พร้อมระบบสลับไป preview เมื่อ key ผิด  [เจี๊ยบ / นนท์]
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx                  # หน้าแรก Landing & Popular Models
│   │   │   ├── gallery/page.tsx          # หน้า Gallery ค้นหาและกรองโมเดล
│   │   │   ├── login/page.tsx            # หน้าเข้าสู่ระบบและสมัครสมาชิก
│   │   │   ├── upload/page.tsx           # หน้าอัปโหลด .glb + สร้างภาพ Poster ด้วย .toBlob()  [แฮม]
│   │   │   ├── me/page.tsx               # รายการที่ซื้อ, embed_key, ปุ่ม Regenerate Key
│   │   │   ├── models/[id]/page.tsx      # หน้ารายละเอียด + 3D Preview + Embed Snippets + ปุ่มซื้อ/ดาวน์โหลด
│   │   │   ├── creators/[handle]/page.tsx# หน้าโปรไฟล์ครีเอเตอร์
│   │   │   └── embed/[id]/page.tsx       # หน้า Viewer สำหรับ Iframe (CSP frame-ancestors *)  [นนท์]
│   │   ├── components/
│   │   │   ├── gallery/                  # การ์ดโมเดลและตัวกรอง
│   │   │   ├── model/                    # ModelPreview (3D CDN), ModelActions (Download/Buy), EmbedSnippets
│   │   │   └── viewer/                   # 3D Canvas Viewer & EmbedIframeViewer
│   │   └── lib/
│   │       └── api.ts                    # เชื่อมต่อ Supabase REST, CORE_API_URL และ CDN_SERVICE_URL
│   ├── next.config.ts
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
│
├── supabase/
│   └── schema.sql                        # สคริปต์สร้างตาราง users, models, purchases, likes, comments + Seed
├── docker-compose.yml                    # รันทุก Microservices พร้อมกันด้วยคำสั่งเดียว
├── .gitignore
├── GEMINI.md                             # กฎระดับ Repository ที่บังคับโหลด AGENT.md อัตโนมัติ
├── AGENT.md                              # เอกสารสรุปสเปก ขอบเขต และกระบวนการทำงานสำหรับ AI Agent
└── README.md
```

---

## 5. รายละเอียด API Endpoints & การฝังโมเดล (API & Embed Reference)

### 5.1 CDN Service (`http://localhost:4001`)

| Method & Path | การยืนยันตัวตน | Cache-Control | รายละเอียดการทำงาน |
| :--- | :--- | :--- | :--- |
| `POST /api/models` | `Bearer JWT` (Seller) | `no-store` | อัปโหลดไฟล์ `file` (`.glb` ≤ 50 MB), `preview` (`.glb` ≤ 5 MB, บังคับถ้ามีราคา), `poster` (`.webp/.png/.jpg` ≤ 1 MB) |
| `GET /cdn/models/:id/:hash.glb` | Public | `public, max-age=31536000, immutable` | สตรีมไฟล์ตามค่า SHA-256 (เฉพาะไฟล์ของโมเดลฟรี หรือไฟล์ `preview` ของโมเดลเสียเงิน) รองรับ HTTP Range |
| `GET /cdn/models/:id/preview.glb` | Public | `public, max-age=300` | สตรีมไฟล์ตัวอย่างสำหรับแสดงผลสาธารณะ (โมเดลฟรีส่งไฟล์เต็ม โมเดลเสียเงินส่งไฟล์ preview) |
| `GET /cdn/models/:id/file.glb?key=` | `embed_key` (สำหรับโมเดลเสียเงิน) | `private, no-store` | ตรวจ `embed_key` ด้วย `crypto.timingSafeEqual` กับตาราง `purchases (status='paid')` ก่อนสตรีมไฟล์เต็ม |
| `GET /cdn/models/:id/download` | `Bearer JWT` (ถ้าเป็นโมเดลเสียเงิน) | `private, no-store` | ส่งไฟล์พร้อม `Content-Disposition: attachment` (รองรับชื่อไฟล์ภาษาไทย UTF-8) และเพิ่ม `download_count + 1` |
| `GET /cdn/models/:id/poster.webp` | Public | `public, max-age=300` | สตรีมภาพหน้าปกของโมเดล (`image/webp`) |

### 5.2 Core API (`http://localhost:4000`)

| หมวดหมู่ | Method & Path | รายละเอียดการทำงาน |
| :--- | :--- | :--- |
| **Auth** | `POST /api/auth/register` | สมัครสมาชิกใหม่ (เข้ารหัสรหัสผ่านด้วย `bcrypt` และคืนค่า JWT) |
| **Auth** | `POST /api/auth/login` | เข้าสู่ระบบ (ตรวจสอบรหัสผ่าน และบล็อกบัญชีที่มี `suspended_at` ด้วย `403`) |
| **Models** | `GET /api/models` | ดึงรายการโมเดล ค้นหา (`q`), กรองตาม `tag`, `license`, `price=free\|paid` และแบ่งหน้า (`page`) |
| **Models** | `GET /api/models/:id` | ดึงข้อมูลรายละเอียดโมเดล (ซ่อนลิงก์ไฟล์จริงหากเป็นโมเดลเสียเงิน) |
| **Models** | `DELETE /api/models/:id` | ลบโมเดลแบบ Soft Delete (`deleted_at = NOW()`) เฉพาะเจ้าของหรือแอดมิน |
| **Payments** | `POST /api/models/:id/checkout` | สร้างคำสั่งซื้อ (`pending`) และสุ่ม `embed_key` ความยาว 48 ตัวอักษร hex |
| **Payments** | `POST /api/models/:id/pay-mock` | ยืนยันการชำระเงินจำลอง (`status = 'paid'`) เฉพาะเมื่อ `PAYMENT_PROVIDER=mock` |
| **Payments** | `GET /api/me/purchases` | ดึงรายการโมเดลที่ซื้อสำเร็จพร้อม `embed_key` |
| **Payments** | `POST /api/purchases/:id/regenerate-key` | สุ่ม `embed_key` ใหม่และยกเลิกสิทธิ์ของคีย์เก่าทันที |
| **Seller** | `POST /api/seller/enable` | เปิดโหมดคนขาย (`is_seller = true`) ให้บัญชีปัจจุบัน |
| **Seller** | `GET /api/seller/models` & `/sales` | ดูรายการโมเดลของตัวเองและสรุปยอดขายทั้งหมด |

### 5.3 การฝังโมเดลข้ามโดเมน (Cross-Origin Embed Contract)

นักพัฒนาสามารถฝังโมเดล 3 มิติลงในเว็บไซต์ภายนอกได้ 2 รูปแบบ:

1. **Web Component (`<vm-model>`)**:
   ```html
   <script type="module" src="http://localhost:3000/embed.js"></script>
   <vm-model
     model-id="7524b129-938b-41c9-b66c-977a809e1c89"
     cdn-base="http://localhost:4001"
     key="YOUR_EMBED_KEY"
     auto-rotate
     camera-controls
   ></vm-model>
   ```
   *(สำหรับโมเดลฟรีไม่ต้องใส่ attribute `key` หากใส่ `key` ของโมเดลเสียเงินผิดหรือคีย์ถูก Regenerate ไปแล้ว ตัว Viewer จะสลับไปโหลดไฟล์ `preview.glb` พร้อมแสดงข้อความแจ้งเตือน `"ต้องซื้อเพื่อใช้งาน"` อัตโนมัติโดยไม่ทำให้หน้าเว็บพัง)*

2. **Iframe (`/embed/[id]`)**:
   ```html
   <iframe
     src="http://localhost:3000/embed/7524b129-938b-41c9-b66c-977a809e1c89?key=YOUR_EMBED_KEY"
     width="600"
     height="400"
     loading="lazy"
     allow="fullscreen"
     style="border:0"
   ></iframe>
   ```

---

## 6. การแบ่งงานภายในทีม 6 คน

| สมาชิก              | งานที่รับผิดชอบ                                                                                                                                                                                                                             | พื้นที่ในโปรเจกต์                                                                                     |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------- |
| **เจี๊ยบ** (คู่ภีม) | หน้าเว็บทั้งหมด: Web Component `<vm-model>` และหน้าฝัง Iframe, หน้าแรก Gallery, หน้ารายละเอียด + Embed Playground, หน้าอัปโหลด + สร้าง Poster, หน้าล็อกอิน/สมัคร, หน้า `/me`, **แดชบอร์ดแอดมินทั้ง 4 หน้า**                                 | `frontend/` (ยกเว้น `pay/mock/` และ `seller/`)                                                        |
| **ภีม** (คู่เจี๊ยบ) | ระบบซื้อจำลอง (checkout, ยืนยันจ่าย, สร้าง/Regenerate `embed_key`, รายการที่ซื้อ), หน้าจ่ายเงินจำลอง, แดชบอร์ดคนขาย (โมเดลของฉัน ยอดขาย ปุ่มเปิดโหมดคนขาย)                                                                                  | `core-api/src/modules/payments/`, `seller/`<br>`frontend/src/app/pay/`, `seller/`                     |
| **นนท์** (คู่เป้ก)  | ระบบ CDN: ส่งไฟล์โมเดล/ภาพปก, ตรวจ `embed_key`, ดาวน์โหลดเฉพาะผู้มีสิทธิ์, HTTP Range, Cache, Rate limit, หยุดส่งโมเดลที่ถูกซ่อนหรือเจ้าของถูกระงับ และเชื่อมต่อ CDN เข้ากับ Supabase & Frontend                                            | `cdn-service/src/modules/cdn/`<br>`frontend/src/app/embed/`, `components/model/`                      |
| **แฮม** (คู่ต้า)    | **ส่งภายในวันแรก:** ปรับ `schema.sql` (บทบาท, `is_seller`, `suspended_at`, `hidden_at`) และ middleware ตรวจผู้ใช้/บทบาท/รูปแบบ error จากนั้น: StorageAdapter, ตรวจไฟล์ GLB, รับอัปโหลด (เฉพาะคนขาย), ลบโมเดล (เจ้าของเท่านั้น, soft delete) | `supabase/`<br>`core-api/src/middlewares/`<br>`cdn-service/src/storage/`, `utils/`, `modules/upload/` |
| **ต้า** (คู่แฮม)    | สมัครสมาชิก/ล็อกอิน (bcrypt + JWT, บัญชีที่ถูกระงับล็อกอินไม่ได้), เปิดโหมดคนขาย, ฝั่ง Backend ของหน้าผู้ใช้ในแดชบอร์ดแอดมิน (ดึงรายชื่อ ระงับ/คืนบัญชี)                                                                                    | `core-api/src/modules/auth/`<br>`core-api/src/modules/admin/` (ส่วนผู้ใช้)                            |
| **เป้ก** (คู่นนท์)  | ดึงรายการ/ค้นหา/กรอง/แบ่งหน้า/รายละเอียดโมเดล (ไม่แสดงโมเดลที่ซ่อนหรือลบ และไม่ส่งลิงก์ไฟล์เต็มของโมเดลเสียเงิน)                                                                                                                            | `core-api/src/modules/models/`<br>`core-api/src/modules/admin/` (ส่วนโมเดลและรายการซื้อ)              |

**ข้อควรระวัง**
- ระบบจ่ายเงินจำลองต้องเปิดได้เฉพาะเมื่อตั้ง `PAYMENT_PROVIDER=mock` และห้ามเปิดใน production
- การตรวจสิทธิ์คนขาย/แอดมินต้องทำที่ Backend เสมอ
- ถ้าเวลาไม่พอ ตัดตามลำดับ: หน้า `/me` → snippet หลายภาษาใน Playground → หน้าภาพรวมแอดมิน (เหลือตารางล้วน)

---

## 7. วิธีเริ่มต้นใช้งานและทดสอบโปรเจกต์ (Getting Started & Testing)

1. **ติดตั้ง Dependencies**:
   Clone โปรเจกต์จาก GitHub ลงเครื่อง (`git clone https://github.com/TuraHot/broken-design.git` แล้ว `cd broken-design`) และรัน `npm install` ในแต่ละโฟลเดอร์ (`services/core-api`, `services/cdn-service`, และ `frontend`)
2. **ตั้งค่าฐานข้อมูล Supabase**:
   นำโค้ดใน `supabase/schema.sql` ไปรันใน SQL Editor ของ Supabase (จะสร้างตารางทั้งหมดพร้อมบัญชีเริ่มต้นให้อัตโนมัติ)
3. **ตั้งค่าไฟล์ `.env`**:
   คัดลอกไฟล์ `.env.example` เป็น `.env` (และ `.env.local` ใน `frontend/`) แล้วใส่ค่า `DATABASE_URL`, `SUPABASE_URL`, และ `SUPABASE_KEY` ของโปรเจกต์ Supabase (ห้าม commit ไฟล์ `.env`)
4. **บัญชีทดสอบเริ่มต้น (Default Seed Accounts)**:
   - **Admin:** `admin@brokendesign.com` / รหัสผ่าน: `Admin@BrokenDesign2026!`
   - **Creator (คนขาย):** `creator@brokendesign.com` / รหัสผ่าน: `Creator@BrokenDesign2026!`
5. **รันระบบทั้งหมด**:
   - รันด้วย Docker Compose:
     ```bash
     docker compose up --build
     ```
   - หรือรันแยกแต่ละเซอร์วิสในโหมดพัฒนา (`npm run dev`) บนพอร์ต `3000` (`frontend`), `4000` (`core-api`) และ `4001` (`cdn-service`)
6. **รันชุดทดสอบ (Automated Tests & Type-Check)**:
   ```bash
   # ทดสอบระบบ CDN (21 test cases: Range, ETag, embed_key, Access Control, Download)
   cd services/cdn-service && npm test

   # ทดสอบระบบ Payments & Seller ใน Core API
   cd services/core-api && npm test
   ```
