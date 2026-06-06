# smlnesservice — Architecture & Operations

> คู่มืออ้างอิงระยะยาว — ใช้เป็น source of truth เรื่อง architecture, security, DB lifecycle, timeouts
> อ่านคู่กับ `CLAUDE.md` (project context) + `README.md` (quickstart)

---

## 1. หลักการทำงาน (Architecture)

### บทบาท
**API Gateway** ระหว่าง web/mobile clients (NextStep CN Coupon, future projects) ↔ PostgreSQL ของลูกค้า

```
[Web/Mobile clients] ──HTTPS──> [smlnesservice]──TCP 5432──> [PostgreSQL]
                                  NestJS 11                   smlerpmain<provider> (Auth)
                                  Port 3000                   <data_db>            (Data)
                                  Non-root user
```

### Deployment model
- **Model A**: 1 service instance ต่อ 1 ลูกค้า (Docker คนละ server กับ PG ก็ได้)
- **Multi-DB ใน 1 instance**: connection pool แยกตามชื่อ DB → คุยได้ทั้ง auth DB + data DBs หลายตัว

### Request lifecycle

```
HTTP → [ClientAuthGuard | PreSelectAuthGuard | JwtAuthGuard]
     → Controller (Zod parse body, @Tenant() inject)
     → Service (business logic)
     → Repository (raw SQL via PoolManagerService)
     → ResponseInterceptor (wrap envelope)
     → AuditInterceptor (log)
     → HTTP Response

Error path → GlobalExceptionFilter → {success:false, error:{code, message}}
```

### Response envelope (มาตรฐานทุก endpoint)

```json
// Success
{"success":true, "data":{...}, "error":null, "requestId":"uuid", "timestamp":"..."}

// Error
{"success":false, "data":null, "error":{"code":"...","message":"..."}, "requestId":"...", "timestamp":"..."}
```

---

## 2. Security — 3 ชั้น Auth + อื่น ๆ

### Auth model — 3 layer Bearer/JWT

| ชั้น | Token | TTL | ใช้ที่ไหน | Verify อะไร |
|---|---|---|---|---|
| **1. Client Token** | raw 32-byte hex | ตลอดไป | `/auth/login` เท่านั้น | `bcrypt.compare(raw, hash)` กับ `ALLOWED_CLIENTS_JSON` |
| **2. Pre-select JWT** | HS256 | **2 นาที** | `/auth/select-database` | signature + `tokenType='pre-select'` + clientCode allowed |
| **3. Session JWT** | HS256 | **8 ชั่วโมง** | ทุก business endpoint | signature + `tokenType='session'` + clientCode allowed |

### Login flow ครบรอบ

```
NextStep (web)                              smlnesservice
     │  POST /auth/login                          │  [ClientAuthGuard]
     │  Authorization: Bearer <CLIENT_TOKEN> ──>  │  bcrypt.compare + verify user via sml_user_list
     │  body: {provider, username, password}      │
     │  <── preSelect JWT (2m) + databases ──     │  sign JWT
     │                                            │
     │  POST /auth/select-database                │  [PreSelectAuthGuard]
     │  Authorization: Bearer <preSelectJWT>      │  verify pre-select + clientCode allowed
     │  body: {dataCode}                          │  + verify DB permission
     │  <── session JWT (8h) ──                   │  sign JWT บรรจุ database
     │                                            │
     │  GET /api/v1/<resource>                    │  [global JwtAuthGuard]
     │  Authorization: Bearer <sessionJWT>     ─> │  verify signature + tokenType='session'
     │                                            │  + clientCode ยัง allowed ใน registry
     │  <── data ──                               │
```

### Security ทุกประเด็น

| ด้าน | กลไก |
|---|---|
| **Password hashing** | bcrypt 12 rounds (สำหรับ client token; SML user password ยัง plaintext ตาม legacy) |
| **Client token rotation** | `isClientAllowed()` reject JWT เก่าเมื่อ admin ลบ clientCode ออกจาก env |
| **bcrypt cost protection** | `verifyCache` cache verify 5 นาที/token (ไม่ bcrypt ทุก request) |
| **SQL injection** | Parameterized queries (`pg` driver `$1, $2` เสมอ) — never string concat |
| **Input validation** | Zod parse manual ใน controller (LoginSchema, SelectDatabaseSchema ฯลฯ) |
| **No DB write for auth** | ALLOWED_CLIENTS_JSON อยู่ใน env — **ไม่แตะ DB ลูกค้า** |
| **CSRF** | ไม่จำเป็น — Bearer auth ไม่ใช้ cookie |
| **Secrets in image** | ไม่มี — `.env*` ถูก `.dockerignore` กั้น, env mount runtime เท่านั้น |
| **Container security** | non-root user `app`, multi-stage (no build tools in runtime), tini PID 1 |
| **HTTPS** | nginx reverse proxy หน้า service (TLS 1.2/1.3) — Bearer ห้ามวิ่ง HTTP plain |
| **PG SSL** | `DB_SSL=true` เปิดเมื่อ PG อยู่คนละ network |
| **Error info leak** | `GlobalExceptionFilter` คืน `{code, message}` เท่านั้น ไม่ leak stack trace |
| **Request ID** | ทุก response มี `requestId` (uuid) → trace ใน log ได้ |
| **Swagger UI** | ปิดอัตโนมัติเมื่อ `NODE_ENV=production` |

### Active_status decision (เพิ่ม 2026-06-02)

`findUserByCode` **ไม่กรอง** `active_status` — match `user_code` อย่างเดียว แล้วเทียบ password
ตาม pattern ของ smlerp22_new (`_myFrameWork._checkUserAndPassword`) และ NextStep CN Coupon ตัวเก่า
เหตุผล: `active_status` ใน `sml_user_list` เป็น `resource_only` ใน schema → ไม่ควรเอามาเป็น gating logic
ผลกระทบ: superadmin (`active_status=0`) login ได้ตามปกติ

---

## 3. Database Connection — เปิด/ปิดอย่างไร

### เปิด — Lazy + Pool cache

```
Request มา → query("smlerpmaindemo", ...)
              ↓
         pools.get("smlerpmaindemo")
              ↓
       ┌── มี pool? ──┐
       ↓               ↓
     ใช้เลย         สร้างใหม่ (lazy)
                         ├── max=10, min=1
                         ├── keepAlive enabled (init delay 10s)
                         ├── ssl (ถ้า DB_SSL=true)
                         └── cache ลง Map<dbName, Pool>
```

ดู [`src/core/db/pool-manager.service.ts:36-72`](../src/core/db/pool-manager.service.ts)

### ใช้งาน — `pool.connect()` + `client.release()` ทุก call

```ts
const client = await pool.connect();
try {
  await client.query(`SET statement_timeout = ${timeout}`);
  const result = await client.query(sql, params);
  return result;
} catch (error) {
  // cancel running query ถ้า timeout
  await client.query('SELECT pg_cancel_backend(pg_backend_pid())').catch(() => {});
  throw error;
} finally {
  await client.query('RESET statement_timeout').catch(() => {});
  client.release();   // ← คืน connection ให้ pool (ไม่ปิดจริง)
}
```

### ปิด — 3 เหตุการณ์

| เมื่อ | ทำอะไร |
|---|---|
| **Request เสร็จ** | `client.release()` → คืน connection ให้ pool (reuse ใน request ถัดไป) |
| **Idle > 60 วินาที** | pg auto-close idle connection (จาก `idleTimeoutMillis: TIMEOUTS.IDLE`) |
| **App shutdown** (SIGTERM/SIGINT) | `enableShutdownHooks()` → `onModuleDestroy()` → loop ปิดทุก pool ด้วย `pool.end()` |

### Transaction — auto BEGIN / COMMIT / ROLLBACK

```ts
await poolManager.transaction(dbName, async (client) => {
  // BEGIN ออโต้
  await client.query('INSERT ...');
  await client.query('UPDATE ...');
  // COMMIT ถ้า callback success
  // ROLLBACK ถ้า throw
  // client.release() ใน finally เสมอ
});
```

### Graceful shutdown — กัน DB disconnect กลางคัน

- Dockerfile: `ENTRYPOINT ["/sbin/tini", "--"]` → tini ส่ง SIGTERM ถูก Node
- `main.ts`: `app.enableShutdownHooks()` → NestJS เรียก `onModuleDestroy()` ของทุก service
- ผลลัพธ์: ทุก pool `pool.end()` ก่อน process exit → ไม่ทิ้ง connection ค้างบน PG

---

## 4. Timeouts — ตารางสรุปครบ

ทุกค่า DB อยู่ใน [`src/core/db/db.types.ts`](../src/core/db/db.types.ts), Auth อยู่ใน env

### 🗄️ Database

| ตัวแปร | ค่า | ความหมาย |
|---|---|---|
| `CONNECTION` | **30,000 ms** (30s) | รอ pg connect ใหม่ — เผื่อ remote PG ช้า |
| `IDLE` | **60,000 ms** (60s) | ปิด connection ที่ idle เกินนี้ |
| `QUERY_DEFAULT` | **30,000 ms** (30s) | query ปกติ (CRUD) |
| `QUERY_REPORT` | **60,000 ms** (60s) | query รายงาน (`isReport: true`) |
| `QUERY_MAX` | **120,000 ms** (2 นาที) | เพดานสูงสุด — ถ้า caller request เกินจะ clamp ลง |
| **Statement timeout** | = QUERY value | `SET statement_timeout` ที่ PG ทุก connection (PG cancel เอง) |
| **Timeout race** | +2,000 ms | JS Promise race ตั้ง +2s กว่า statement timeout (เผื่อ PG cancel slow) |
| **keepAlive initial** | **10,000 ms** (10s) | TCP keepalive เริ่มหลัง connection เปิด |
| **Pool min/max** | **1 / 10** | warm 1 connection, สูงสุด 10 (per DB) |

### 🔐 Auth

| ตัวแปร | Default | env override |
|---|---|---|
| **Pre-select JWT TTL** | 2 นาที | `PRE_SELECT_EXPIRES_IN=2m` |
| **Session JWT TTL** | 8 ชั่วโมง | `SESSION_EXPIRES_IN=8h` |
| **Client token verify cache** | 5 นาที | hardcoded ใน `client-registry.service.ts` |

### 🏥 Healthcheck (Dockerfile)

| | |
|---|---|
| **Interval** | 30s |
| **Timeout** | 5s |
| **Start period** | 15s (give app time to boot) |
| **Retries** | 3 (fail 3 ครั้งติด → unhealthy) |
| **Health check DB query timeout** | 5,000 ms (`SELECT 1`) |

### 🌐 nginx reverse proxy (recommend)

| | |
|---|---|
| `proxy_connect_timeout` | 10s |
| `proxy_send_timeout` | 60s |
| `proxy_read_timeout` | 60s |

---

## 5. Operations — คำสั่งใช้บ่อย

### Local dev
```bash
npm run start:dev          # watch mode + log สวย
npm run build              # tsc → dist/
npm test                   # jest (เมื่อมี)
```

### Docker
```bash
docker pull neverliken/smlnesservice:latest
docker run -d --name smlnes -p 8003:3000 --env-file .env neverliken/smlnesservice:latest
docker logs smlnes -f
docker restart smlnes
docker rm -f smlnes
```

### Release ใหม่ — ใช้ skill ที่ทำไว้
```
/push-docker 0.0.3
```
→ build → smoke test → confirm → push ขึ้น `neverliken/smlnesservice`

### Monitoring URLs

| URL | คืนอะไร |
|---|---|
| `http://server:8003/` | HTML Status page (auto-refresh 5s, dark theme) |
| `http://server:8003/health` | JSON liveness (status, version, uptime) |
| `http://server:8003/health?provider=demo` | JSON + ping DB `smlerpmaindemo` + latency |

---

## 6. Production Checklist — ก่อน deploy ลูกค้า

- [ ] `JWT_SECRET` random ≥ 32 chars (`openssl rand -hex 32`) — **ไม่ใช้ของ dev**
- [ ] `ALLOWED_CLIENTS_JSON` gen ใหม่ทั้ง raw + hash, raw ใส่ที่ NextStep `.env`
- [ ] `DB_SSL=true` ถ้า PG อยู่คนละ host
- [ ] nginx + cert (TLS 1.2/1.3) หน้า service — ห้าม expose 8003 ตรง ๆ
- [ ] `NODE_ENV=production` (compose override อัตโนมัติ)
- [ ] DB user มีสิทธิ์เข้า auth DB + data DBs ครบ
- [ ] Firewall: container → PG (port 5432) เปิด
- [ ] NextStep CN Coupon: `NEXT_PUBLIC_SMLNES_BASE_URL` + `SMLNES_CLIENT_TOKEN` ตรงกัน
- [ ] เปิด healthcheck ที่ monitoring (Uptime Kuma / Healthchecks.io) ชี้ `/health`

---

## ภาคผนวก — ไฟล์อ้างอิงสำคัญ

| ไฟล์ | บทบาท |
|---|---|
| [`src/main.ts`](../src/main.ts) | bootstrap + global prefix + Swagger + graceful shutdown |
| [`src/app.module.ts`](../src/app.module.ts) | register modules + APP_GUARD/INTERCEPTOR/FILTER |
| [`src/core/db/pool-manager.service.ts`](../src/core/db/pool-manager.service.ts) | Pool cache + safeQuery + transaction |
| [`src/core/db/db.types.ts`](../src/core/db/db.types.ts) | TIMEOUTS constants |
| [`src/core/auth/client-registry.service.ts`](../src/core/auth/client-registry.service.ts) | ALLOWED_CLIENTS_JSON parsing + bcrypt verify |
| [`src/core/auth/jwt.strategy.ts`](../src/core/auth/jwt.strategy.ts) | Passport JWT strategy (session) |
| [`src/modules/auth/auth.repository.ts`](../src/modules/auth/auth.repository.ts) | sml_user_list, sml_database_list queries |
| [`src/modules/health/health.controller.ts`](../src/modules/health/health.controller.ts) | `/health` endpoint |
| [`src/modules/status/status.controller.ts`](../src/modules/status/status.controller.ts) | `/` HTML status page |
| [`Dockerfile`](../Dockerfile) | multi-stage build + healthcheck + tini |
| [`docker-compose.example.yml`](../docker-compose.example.yml) | compose template |
| [`nginx.example.conf`](../nginx.example.conf) | reverse proxy + TLS template |
| [`.env.example`](../.env.example) | env config template |
| [`.claude/skills/push-docker/SKILL.md`](../.claude/skills/push-docker/SKILL.md) | `/push-docker` release skill |

---

## ภาคผนวก — Changelog ที่สำคัญ

| Version | วันที่ | สิ่งที่เปลี่ยน |
|---|---|---|
| **0.0.2** | 2026-06-02 | + Status page HTML ที่ `/` (auto-refresh 5s) · + Fix `version` ใน /health (อ่านจาก package.json ผ่าน fs) · ลบ filter `active_status` ใน findUserByCode → superadmin login ได้ |
| **0.0.1** | 2026-06-02 | Initial Docker Hub release (Phase 0/1/2/3a/3b complete) |
