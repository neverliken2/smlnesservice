# smlnesservice — API Gateway สำหรับ SML ERP Web Apps

NestJS service ตัวกลางระหว่าง Web/Mobile clients ↔ PostgreSQL ของลูกค้า

## ข้อมูลพื้นฐาน

| | |
|---|---|
| **Path** | `C:\Users\never\Documents\work\smlnesservice\` |
| **GitHub** | https://github.com/neverliken2/smlnesservice |
| **Stack** | NestJS 11 + TypeScript strict + pg 8 + JWT + Passport + Swagger |
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

Login flow:
1. Client ส่ง `X-API-Key` + `provider` + `username/password` → `/api/v1/auth/login`
2. Service ตรวจ API key กับ `smlerpmain<provider>.sml_api_clients` (Phase 1)
3. Service ตรวจ user กับ `smlerpmain<provider>.sml_user_list`
4. Issue JWT ที่บรรจุ `provider`, `database`, `userCode`, `userLevel`
5. Request ต่อๆ ไปแนบ `Authorization: Bearer <jwt>` — service routing query ไป DB ตรง

## Project Structure (Phase 0 — เสร็จ)

```
src/
├── main.ts                          ← bootstrap + global prefix /api/v1 + shutdown hooks
├── app.module.ts                    ← register all core modules + global filter/interceptors
├── app.controller.ts / app.service.ts  ← default NestJS (จะลบเมื่อมี real module)
└── core/
    ├── db/                          ← port จาก NextStep_CN_Coupon/src/lib/db.ts
    │   ├── db.module.ts             — @Global() — inject ที่ไหนก็ได้
    │   ├── pool-manager.service.ts  — Pool cache per database name + safeQuery + transaction
    │   ├── db.errors.ts             — QueryTimeoutError, DatabaseConnectionError
    │   └── db.types.ts              — QueryOptions, TIMEOUTS const
    ├── tenant/
    │   ├── tenant.types.ts          — TenantContext (provider, database, userCode, userLevel)
    │   └── tenant.decorator.ts      — @Tenant() อ่านจาก request.user
    ├── auth/                        ← @Global() AuthModule
    │   ├── auth.module.ts           — register JwtModule + Passport
    │   ├── jwt.strategy.ts          — verify JWT → populate request.user as TenantContext
    │   ├── jwt-auth.guard.ts        — @UseGuards(JwtAuthGuard)
    │   └── jwt.types.ts             — JwtPayload
    ├── audit/
    │   └── audit.interceptor.ts     — log METHOD /path STATUS DURATION provider=.. user=..
    ├── error/
    │   ├── global-exception.filter.ts  — map ทุก error เป็น standard envelope
    │   └── error-codes.ts           — ErrorCode enum
    └── response/
        ├── response.interceptor.ts  — wrap return เป็น {success:true, data, error:null, ...}
        └── response.types.ts        — ApiSuccessResponse / ApiErrorResponse
```

## Request Lifecycle

```
HTTP Request
   ↓
[JwtAuthGuard] (เมื่อ controller มี @UseGuards)
   ↓ verify JWT → populate request.user = TenantContext
[Controller method]              ← @Tenant() inject, PoolManager.query / transaction
   ↓ return data
[ResponseInterceptor]            ← wrap → {success:true, data, error:null, requestId, timestamp}
   ↓
[AuditInterceptor]               ← log: GET /api/v1/... 42ms OK provider=demo user=admin
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

| Key | Required | Default |
|---|---|---|
| `PORT` | ❌ | 3000 |
| `DB_HOST` | ✅ | — |
| `DB_PORT` | ❌ | 5432 |
| `DB_USER` | ✅ | — |
| `DB_PASSWORD` | ✅ | — |
| `DB_NAME_PREFIX` | ❌ | `smlerpmain` |
| `DB_SSL` | ❌ | `false` — เปิดเมื่อ PG อยู่คนละ network |
| `DB_SSL_REJECT_UNAUTHORIZED` | ❌ | `true` |
| `JWT_SECRET` | ✅ | — random ≥ 32 chars |
| `JWT_EXPIRES_IN` | ❌ | `30m` |

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| **0** | Core infra (db, tenant, auth JWT, audit, error, response) | ✅ Done |
| **1a** | Auth: `/auth/login`, ApiKeyGuard, `sml_api_clients` table seed | ⬜ Next |
| **1b** | Swagger UI + `/health` endpoint | ⬜ |
| **1c** | Dockerfile + docker-compose | ⬜ |
| **2** | Domain endpoints CN Coupon — port จาก `NextStep_CN_Coupon/src/actions/credit-note.ts` | ⬜ |
| **3** | NextStep CN Coupon ถอด `pg` → call apiClient | ⬜ |
| **4** | (เมื่อมี project ใหม่) เพิ่ม module business ใหม่ — core reuse ได้ | ⬜ |

## Conventions

### URL versioning
- `/api/v1/*` — ปัจจุบัน
- `/api/v2/*` — breaking change (coexist กับ v1 ได้)

### Auth scheme
- **API key** — `X-API-Key` header, hash ใน `smlerpmain<provider>.sml_api_clients`
- **JWT** — `Authorization: Bearer <token>`, secret จาก env, expires 30m (sliding ผ่าน `/auth/refresh`)

### Module pattern
- **Core modules** (`src/core/`) — shared infra, อย่าแตะบ่อย
- **Feature modules** (`src/modules/*`) — 1 module per business domain
  - Controller — REST endpoints + @UseGuards + @Tenant() inject
  - Service — business logic + transaction
  - Repository — raw SQL via `PoolManagerService`
  - DTO — request/response shape + (future) Zod validation

### Error throwing
- ใช้ `HttpException` subclasses (`BadRequestException`, `NotFoundException`, etc.)
- Optional: ใส่ `code` property ใน response body ของ exception เพื่อ override ErrorCode default

## Coding rules (มาจาก work/CLAUDE.md)

- **ห้าม connect production DB ของลูกค้า** — local clone บน company server เท่านั้น
- **Verify schema ก่อนเขียน SQL** — query `information_schema` ก่อน assume column name
- **SML naming ไม่สม่ำเสมอ** — `ar_customer` (underscore) แต่ `arvattype` (ไม่มี) — เช็คทีละชื่อ
- **ห้าม commit credentials** — `.env` ถูก gitignore ไว้แล้ว
- **อธิบายก่อนรันคำสั่ง** — เจ้านายไม่ชินกับ terminal

## Reference

- Source ของ business logic: `C:\Users\never\Documents\work\NextStep_CN_Coupon\src\actions\`
- DB schema source of truth: `C:\Users\never\Documents\work\smlerp22_new\SMLERPTemplate\smldatabase.xml`
