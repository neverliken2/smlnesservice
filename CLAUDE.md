# smlnesservice — API Gateway สำหรับ SML ERP Web Apps

NestJS service ตัวกลางระหว่าง Web/Mobile clients ↔ PostgreSQL ของลูกค้า

> 📘 **คู่มืออ้างอิงระยะยาว** (architecture, security, DB lifecycle, timeouts, ops, checklist):
> [`docs/architecture.md`](docs/architecture.md) — ถาม agent เรื่องเหล่านี้ใช้ที่นี่ก่อน

## ข้อมูลพื้นฐาน

| | |
|---|---|
| **Path** | `C:\Users\never\Documents\work\smlnesservice\` |
| **GitHub** | https://github.com/neverliken2/smlnesservice |
| **Stack** | NestJS 11 + TypeScript strict + pg 8 + JWT + Passport + Zod + Swagger |
| **Port (dev)** | 3000 (configurable via PORT env) |
| **Deployment Model** | A — 1 service instance ต่อ 1 ลูกค้า (Docker คนละ server กับ PG) |

## ทำไมต้องมี service นี้

แทน pattern เดิมที่ Next.js (NextStep CN Coupon, etc.) ต่อ PG ตรงผ่าน `pg`:
- ❌ ลูกค้าหลายรายไม่ยอมเปิด port 5432 ออกสู่ภายนอก
- ❌ Business logic ซับซ้อน (transaction หลายตาราง) ผูกกับ Next.js → reuse ข้าม project ไม่ได้
- ❌ Mobile/desktop client ในอนาคตต้องเขียน logic ซ้ำ

`smlnesservice` แก้ทั้ง 3 ปัญหา — clients คุยผ่าน HTTPS (port 8003/443), service ถือ PG creds + logic

```
[NextStep CN Coupon Web] ──┐
[Future Web Project] ──────┼──HTTPS──>[smlnesservice]──TCP 5432──>[PostgreSQL]
[Future Mobile App] ───────┘          (NestJS, Docker)            smlerpmain<provider>
                                                                   <data_db>
```

## SML ERP Multi-tenant Pattern (อ่าน work/CLAUDE.md ก่อน)

ทุกอย่างใน service สอดคล้องกับ SML pattern:
- `smlerpmain<provider>` = Auth DB ของ tenant (table `sml_user_list`, `sml_database_list`)
- `<data_db>` = Data DB จริงที่ business data อยู่

## Auth Model (ปัจจุบัน — Phase 2)

3 ชั้น token ครอบ flow ของ user:

```
NextStep CN Coupon (web client)              smlnesservice
       │                                            │
       │  POST /auth/login                          │  [ClientAuthGuard]
       │  Authorization: Bearer <CLIENT_TOKEN> ──>  │  bcrypt.compare กับ ALLOWED_CLIENTS_JSON
       │  body: {provider, username, password}      │  [verify user via sml_user_list]
       │  <── preSelect JWT (2m) + databases ──     │  sign JWT {sub, provider, tokenType:'pre-select', clientCode}
       │                                            │
       │  POST /auth/select-database                │  [PreSelectAuthGuard]
       │  Authorization: Bearer <preSelectJWT>      │  verify pre-select + clientCode allowed
       │  body: {dataCode}                          │  [verify DB permission]
       │  <── session JWT (8h) ──                   │  sign JWT {... + database + userLevel}
       │                                            │
       │  GET /api/v1/<resource>                    │  [global JwtAuthGuard]
       │  Authorization: Bearer <sessionJWT>     ─> │  verify signature + tokenType='session'
       │                                            │  + clientCode ยัง allowed ใน registry
       │  <── data ──                               │  populate req.user = TenantContext → handler
```

**Components:**
- `ClientRegistryService` — load+verify ALLOWED_CLIENTS_JSON จาก env, cache verify 5m, `isClientAllowed()` กัน JWT เก่าหลัง rotate
- `ClientAuthGuard` — ติด `/auth/login` เท่านั้น; populate `req.clientCode`
- `JwtStrategy` (Passport) — verify session JWT, check `clientCode` allowed
- `JwtAuthGuard` — ติด global ผ่าน `GlobalJwtAuthGuard` wrapper (เคารพ `@Public()` decorator)
- `PreSelectAuthGuard` — เฉพาะ `/auth/select-database`
- `@Public()` — ข้าม guard (`/health`, `/auth/login`, `/auth/select-database`)

**ที่ลบไปแล้ว (ไม่ใช้):**
- ~~`sml_api_clients` table~~ — เปลี่ยนมาเก็บ ALLOWED_CLIENTS_JSON ใน env แทน (ไม่แตะ DB ลูกค้า)
- ~~`sml_guid` session~~ — เคยลองใช้แต่ SML ERP มี cleanup process ลบ row ทุก 5 นาที (ใน `Java/_routine.cs`) → session หายโดยไม่คาด
- ~~`/auth/refresh`~~ — JWT 8h stateless, ไม่มี server-side refresh
- ~~`/auth/logout`~~ — client ทิ้ง JWT เอง

## Endpoints (ปัจจุบัน)

```
Public
  GET  /health[?provider=demo]                  liveness + optional DB ping

Auth
  POST /api/v1/auth/login                       Authorization: Bearer <CLIENT_TOKEN>
                                                body: {provider, username, password, dataGroup?}
                                                → preSelect JWT + databases[]
  POST /api/v1/auth/select-database             Authorization: Bearer <preSelectJWT>
                                                body: {dataCode}
                                                → session JWT 8h

Business (Authorization: Bearer <sessionJWT>)
  GET  /api/v1/doc-no/next?formatCode&docDate   generate next CN doc_no
  GET  /api/v1/customers?query                  search ar_customer
  GET  /api/v1/sales-invoices?custCode          list trans_flag=44
  GET  /api/v1/sales-invoices/:docNo            header + lines + available_qty
  POST /api/v1/credit-notes                     สร้าง CN + coupon (transaction หลาย table)
  GET  /api/v1/web-coupons?query&fromDate&toDate&limit
  GET  /api/v1/reports/cn-price-diff?fromDate&toDate

Docs (dev only)
  GET  /api/docs                                Swagger UI
```

## Project Structure

```
src/
├── main.ts                          ← bootstrap + global prefix /api/v1 + Swagger
├── app.module.ts                    ← register modules + global guard/interceptors
└── core/                            ── shared infra (alt: avoid changing บ่อย)
    ├── db/
    │   ├── db.module.ts             — @Global()
    │   ├── pool-manager.service.ts  — Pool cache per DB + safeQuery + transaction
    │   ├── db.errors.ts             — QueryTimeoutError, DatabaseConnectionError
    │   └── db.types.ts              — TIMEOUTS, QueryOptions
    ├── tenant/
    │   ├── tenant.types.ts          — TenantContext {provider, database, userCode, userLevel}
    │   └── tenant.decorator.ts      — @Tenant() อ่าน request.user (Passport ตั้ง)
    ├── auth/                        ── @Global() AuthModule
    │   ├── auth.module.ts           — JwtModule + Passport + register guards
    │   ├── client-registry.service  — load ALLOWED_CLIENTS_JSON + verify/isAllowed
    │   ├── client-auth.guard.ts     — ติด /auth/login (Bearer client token)
    │   ├── jwt.strategy.ts          — Passport JWT (session) + check clientCode
    │   ├── jwt-auth.guard.ts        — base JwtAuthGuard
    │   ├── jwt.types.ts             — JwtPayload (clientCode in there)
    │   └── public.decorator.ts      — @Public() (skip global guard)
    ├── audit/audit.interceptor.ts
    ├── error/global-exception.filter + error-codes (enum)
    └── response/response.interceptor + response.types
└── modules/
    ├── auth/                        ── /auth/login + /select-database
    │   ├── auth.controller.ts
    │   ├── auth.service.ts          — sign tokens, verify user/password
    │   ├── auth.repository.ts       — sml_user_list, sml_database_list queries
    │   ├── pre-select.guard.ts      — verify pre-select token (manual JwtService)
    │   ├── duration.util.ts
    │   └── dto/login.dto + login-response.dto
    ├── credit-note/                 ── ทุก business endpoint
    │   ├── credit-note.controller.ts
    │   ├── credit-note.service.ts   — read APIs + saveCreditNote (transaction)
    │   ├── credit-note.repository.ts — raw SQL (read queries)
    │   ├── doc-no.service.ts        — format pattern parser
    │   ├── credit-note.util.ts      — parseDiscountPercent, round2, addDays, etc.
    │   └── dto/*.dto.ts             — Zod schemas + response interfaces
    └── health/health.module + controller
```

## Request Lifecycle

```
HTTP Request
   ↓
[ClientAuthGuard]     (เฉพาะ /auth/login — ติดด้วย @UseGuards)
   ↓ populate req.clientCode

หรือ

[PreSelectAuthGuard]  (เฉพาะ /auth/select-database — ติดด้วย @UseGuards)
   ↓ populate req.preSelect

หรือ

[Global JwtAuthGuard] (ทุก endpoint อื่น — APP_GUARD; @Public ข้าม)
   ↓ verify session JWT → populate req.user = TenantContext

[Controller method]   ← @Tenant() inject, Zod parse body, call service
[ResponseInterceptor] ← wrap → {success:true, data, error:null, requestId, timestamp}
[AuditInterceptor]    ← log: POST /api/v1/... 42ms OK
   ↓
HTTP Response

Error path → [GlobalExceptionFilter] → {success:false, error:{code, message}}
```

## Standard Response Envelope

```json
// Success
{"success":true, "data":{...}, "error":null, "requestId":"uuid", "timestamp":"..."}

// Error
{"success":false, "data":null, "error":{"code":"DUPLICATE_DOC_NO","message":"..."}, "requestId":"uuid", "timestamp":"..."}
```

## Environment Variables (ดู `.env.example`)

| Key | Required | Default | หมายเหตุ |
|---|---|---|---|
| `PORT` | ❌ | 3000 | |
| `DB_HOST` | ✅ | — | |
| `DB_PORT` | ❌ | 5432 | |
| `DB_USER` | ✅ | — | |
| `DB_PASSWORD` | ✅ | — | |
| `DB_NAME_PREFIX` | ❌ | `smlerpmain` | |
| `DB_SSL` | ❌ | `false` | เปิดเมื่อ PG อยู่คนละ network |
| `DB_SSL_REJECT_UNAUTHORIZED` | ❌ | `true` | |
| `JWT_SECRET` | ✅ | — | random ≥ 32 chars (HS256) |
| `PRE_SELECT_EXPIRES_IN` | ❌ | `2m` | pre-select JWT TTL |
| `SESSION_EXPIRES_IN` | ❌ | `8h` | session JWT TTL |
| `ALLOWED_CLIENTS_JSON` | ✅ | — | JSON array `[{clientCode, tokenHash}]` — bcrypt hash |

**Gen client token:**
```js
const bcrypt = require('bcrypt');
const raw = require('crypto').randomBytes(32).toString('hex');
console.log('RAW:', raw);              // เก็บที่ฝั่ง client (env ของ NextStep)
console.log('HASH:', bcrypt.hashSync(raw, 12));  // ใส่ใน ALLOWED_CLIENTS_JSON
```

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| **0** | Core infra (db, tenant, auth JWT, audit, error, response) | ✅ |
| **1** | API key + 2-step JWT + Swagger + /health + Docker | ✅ |
| **1.5** | (revert) sml_guid session — เลิกใช้ |  |
| **2** | Bearer client-token + JWT session 8h (env-based, ไม่แตะ DB ลูกค้า) | ✅ |
| **3a** | CN read endpoints (customers, invoices, coupons, reports, doc-no) | ✅ |
| **3b** | POST /credit-notes — save CN + coupon | ✅ |
| **4** | NextStep CN Coupon — ถอด `pg` direct → call smlnesservice | ⬜ Next |
| **5** | (future project) เพิ่ม module business — core reuse ได้ | ⬜ |
| **6** | Unit/integration tests สำหรับ pro-rata + doc-no parser | ⬜ |

## Conventions

### URL versioning
- `/api/v1/*` — ปัจจุบัน
- `/api/v2/*` — breaking change (coexist กับ v1 ได้)

### Auth scheme
- **Client token** — `Authorization: Bearer <CLIENT_TOKEN>` ที่ `/auth/login`
- **JWT** — `Authorization: Bearer <JWT>` ทุก endpoint อื่น (preSelect / session ตาม endpoint)

### Module pattern
- **Core modules** (`src/core/`) — shared infra, อย่าแตะบ่อย
- **Feature modules** (`src/modules/*`) — 1 module per business domain
  - Controller — REST endpoints + Swagger decorators + Zod validate
  - Service — business logic + transaction
  - Repository — raw SQL via `PoolManagerService`
  - DTO — Zod schema (request) + interface (response)

### Validation
- **Zod** (`zod` package) — ใช้ใน controller manual parse
- ไม่ใช้ `class-validator`/`ValidationPipe` ของ NestJS

### Error throwing
- ใช้ `HttpException` subclasses (`BadRequestException`, `NotFoundException`, `ConflictException`, `UnauthorizedException`)
- ใส่ `code` ใน response body ของ exception เพื่อ override ErrorCode default
- ตัวอย่าง: `throw new ConflictException({code: ErrorCode.DUPLICATE_DOC_NO, message: '...'})`

## Coding rules (มาจาก work/CLAUDE.md)

- **ห้าม connect production DB ของลูกค้า** — local clone บน company server เท่านั้น
- **Verify schema ก่อนเขียน SQL** — query `information_schema` ก่อน assume column name
- **SML naming ไม่สม่ำเสมอ** — `ar_customer` (underscore) แต่ `arvattype` (ไม่มี) — เช็คทีละชื่อ
- **ห้าม commit credentials** — `.env`/`.env.local` ถูก gitignore ไว้แล้ว
- **อธิบายก่อนรันคำสั่ง** — เจ้านายไม่ชินกับ terminal

## Reference

- Source ของ business logic: `C:\Users\never\Documents\work\NextStep_CN_Coupon\src\actions\`
- DB schema source of truth: `C:\Users\never\Documents\work\smlerp22_new\SMLERPTemplate\smldatabase.xml`
- SML session table info: `C:\Users\never\Documents\work\smlerp22_new\Java\_routine.cs` (sml_guid lifecycle)
- APP_CREATOR_CODE = `'nextstep_cn_coupon'` (ใน `ic_trans.creator_code` — marker เอกสารที่ web สร้าง)
