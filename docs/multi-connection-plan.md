# Multi-Connection Plan — deploy เดียว เชื่อม PG ได้หลายลูกค้า

> สถานะ: ✅ Phase 1 เสร็จ (v0.5.0, 2026-07-08) — Phase 2 (reload/status) ยังไม่เริ่ม
> วันที่ร่าง: 2026-07-08

## ปัญหา

- smlnesservice deploy อยู่ที่ server บริษัท ให้ทีม support ใช้กับฐานบริษัท
- ลูกค้าบางรายอยากให้ support ใช้ระบบกับฐานของเขาด้วย และ PG ของลูกค้าเชื่อม online ได้
- Model ปัจจุบัน (1 instance : 1 ลูกค้า) บังคับให้ต้องไป deploy เพิ่มที่ฝั่งลูกค้า ทั้งที่ไม่จำเป็น
  และไปกินทรัพยากร server ลูกค้า

## เป้าหมาย

Instance เดียวที่ server บริษัท route ไป PG ได้หลายที่ตาม `provider` ที่ user login เข้ามา

```
[Support กรอก provider "next"]  ──> smlnesservice ──TCP 5432──> PG บริษัท
[Support กรอก provider "kungg"] ──>   (instance เดียว)  ──TCP 5432/SSL──> PG ลูกค้า kungg (online)
```

**หลักการ:** `provider` เป็น routing key — มันอยู่ใน login body และ `TenantContext` (ผ่าน JWT)
อยู่แล้วทุก request → **frontend ทุกตัวไม่ต้องแก้**

## สิ่งที่ยึดไว้ (constraints)

1. **Backward compatible** — instance เดิมของลูกค้า (เช่น `deploy/customer-kungg`) ที่ใช้
   `DB_HOST` env ต้องทำงานต่อได้โดยไม่แตะ config
2. **ห้ามกระทบ CN flow** — append-only ตาม convention เดิม (แต่รอบนี้จำเป็นต้องแก้ signature
   ของ PoolManagerService ซึ่ง CN ใช้ด้วย → ต้อง regression test CN)
3. ลูกค้าที่ PG อยู่ใน LAN ไม่เปิด online → ยังใช้ model A (deploy ที่ site) ต่อไป

---

## Phase 1 — Connection Registry

### 1.1 ไฟล์ config ใหม่: `connections.json`

Mount เข้า container (ไม่ใช้ env — หลีกเลี่ยงปัญหา escape `$` และ env บวมเมื่อลูกค้าเยอะ)

```json
{
  "connections": [
    {
      "provider": "kungg",
      "host": "kungg-pg.example.com",
      "port": 5432,
      "user": "smlnes_svc",
      "password": "...",
      "ssl": true,
      "sslRejectUnauthorized": true,
      "poolMax": 10,
      "dbNamePrefix": "smlerpmain"
    }
  ]
}
```

- Path กำหนดผ่าน env `CONNECTIONS_FILE` (default: ไม่มีไฟล์ = โหมดเดิมล้วน)
- **Fallback rule:** provider ที่ไม่อยู่ในไฟล์ → ใช้ `DB_HOST/DB_USER/...` จาก env เหมือนเดิม
  (นี่คือสิ่งที่ทำให้ backward compatible — instance บริษัทให้ provider ของบริษัทวิ่ง env เดิม
  แล้ว list เฉพาะลูกค้า online ในไฟล์)
- `ssl`, `poolMax`, `dbNamePrefix` เป็น **per-connection** (ลูกค้า LAN ไม่ใช้ SSL,
  ลูกค้า online บังคับ SSL)

### 1.2 Service ใหม่: `src/core/db/connection-registry.service.ts`

- โหลด + validate ด้วย Zod ตอน `onModuleInit` — ผิด format / provider ซ้ำ / field ขาด
  → **fail fast** ตอน start พร้อม error message บอกตำแหน่ง
- expose `resolve(provider): ConnectionConfig` — คืน entry จากไฟล์ หรือ fallback env
- ห้าม log password เด็ดขาด (log แค่ host + provider)

### 1.3 แก้ `PoolManagerService`

| จุด | เดิม | ใหม่ |
|---|---|---|
| Pool key | `dbName` | `provider:dbName` — กันลูกค้าสองรายมี DB ชื่อซ้ำ (เช่น ต่างคนต่างมี `demo`) |
| `getPool(dbName)` | อ่าน env ตรง | `getPool(provider, dbName)` → ถาม registry |
| `getAuthPool(provider)` | env prefix | ใช้ `dbNamePrefix` ของ entry นั้น |
| `buildSslOption()` | global env | per-connection จาก registry |
| `query/transaction/checkHealth` | รับ `databaseName` | รับ `provider` เพิ่ม |

### 1.4 ไล่แก้ call sites (~50 จุด)

Signature เปลี่ยนเป็น `query(provider, database, sql, params, options)` — ทุก service มี
`TenantContext` (มี `provider` + `database`) อยู่แล้ว แค่ส่งเพิ่ม

| ไฟล์ | จุด |
|---|---|
| `modules/auth/auth.repository.ts` | 3 (+ ย้าย `authDbName()` ไปใช้ registry) |
| `modules/auth/cn-permission.service.ts` | 2 |
| `modules/auth/stock-adjust-permission.service.ts` | 2 |
| `modules/credit-note/credit-note.repository.ts` | 10 |
| `modules/credit-note/credit-note.service.ts` | 1 (transaction) |
| `modules/stock-adjust/stock-adjust.repository.ts` | 12 (รวม transaction) |
| `modules/dashboard/dashboard.repository.ts` | ~25 |
| `core/doc-no/doc-no.repository.ts` | 2 |
| `core/erp-option/erp-option.repository.ts` | 1 |
| `modules/health/health.controller.ts` | 1 (checkHealth) |

> วิธีคุมความเสี่ยง: เปลี่ยน signature แล้วให้ TypeScript strict ฟ้องทุกจุดที่ยังไม่ส่ง
> provider — compile ผ่าน = ครบ ไม่มีจุดหลุด

### 1.5 เอกสาร + ตัวอย่าง

- `connections.json.example` พร้อม comment
- อัปเดต `.env.example`, `CLAUDE.md`, `DEPLOYMENT.md`, `docker-compose.example.yml`
  (เพิ่ม volume mount)
- Bump minor version (API ไม่ breaking — internal refactor)

### 1.6 ทดสอบ Phase 1

- [ ] Unit: registry — parse ถูก, provider ซ้ำ → fail, fallback env ทำงาน
- [ ] Local: จำลอง 2 provider ชี้ PG local คนละ instance/port → login สลับ provider
      แล้ว query ไปถูกฐาน
- [ ] Regression CN + Stock Adjust + Dashboard บนฐาน demo (โหมด fallback env ล้วน =
      พิสูจน์ว่า instance เดิมไม่พัง)

---

## Phase 2 — Reload + Status (ไม่ต้อง restart)

- env ใหม่ `ADMIN_TOKEN` (raw, ไม่ใช่ bcrypt — ใช้ครั้งคราวโดยเจ้านายคนเดียว)
- `POST /admin/reload` — อ่าน `connections.json` ใหม่ + validate; entry ที่เปลี่ยน →
  drain pool เก่า (`pool.end()`) แล้วสร้างใหม่ lazily; validate ไม่ผ่าน → **คง config เดิม**
  ตอบ 400 พร้อมรายละเอียด (ห้ามล้ม service)
- `GET /admin/connections/status` — list ทุก provider: host (mask), ping healthy/latency,
  จำนวน pool ที่เปิดอยู่ — **ไม่โชว์ password**
- (option) หน้า status page เดิม (`/`) เพิ่มตาราง provider จาก endpoint นี้

## Phase 3 — Admin UI (ยังไม่ทำ)

รอลูกค้าเยอะจนแก้ไฟล์ไม่ไหว ค่อยพิจารณา — บันทึกไว้เฉยๆ

---

## Deployment checklist ต่อลูกค้าใหม่ (online)

1. ขอลูกค้า **whitelist เฉพาะ IP ของ server บริษัท** ที่ firewall/pg_hba — ห้ามเปิด 5432 สาธารณะ
2. ขอ/สร้าง PG user แยกสำหรับ service (ไม่ใช้ superuser) — สิทธิ์เท่าที่ web apps ใช้
3. เปิด SSL ฝั่ง PG ลูกค้าถ้าทำได้ (`ssl: true` ใน entry; self-signed →
   `sslRejectUnauthorized: false` พร้อมรับความเสี่ยง MITM)
4. เช็ค `provider` ของลูกค้า**ไม่ชนกับที่มีอยู่แล้ว** ใน instance บริษัท (registry validate ให้ แต่เช็คตั้งแต่ตอนคุยกับลูกค้าจะดีกว่า)
5. เพิ่ม entry ใน `connections.json` → `POST /admin/reload`
6. ทดสอบ: `/health?provider=<ลูกค้า>` → healthy แล้วค่อยให้ support login จริง

## ความเสี่ยงที่ยอมรับ / ต้องรู้

| เรื่อง | ผลกระทบ |
|---|---|
| Server บริษัทถือ credentials ลูกค้าหลายราย | โดนเจาะทีเดียวกระทบทุกราย — จำกัดสิทธิ์ PG user + จำกัดคนเข้าถึงไฟล์ config |
| `JWT_SECRET` ใช้ร่วมทุก provider | secret หลุด = ปลอม token ได้ทุกลูกค้า — เก็บให้ดี, rotate ได้ (ทุกคน login ใหม่) |
| Latency ไป PG ลูกค้าผ่าน internet | query ละหลายสิบ ms — ยอมรับได้สำหรับงาน support ไม่ใช่หน้างานขาย |
| Upgrade instance เดียวกระทบทุก provider | เทสให้ครบก่อน deploy; ลูกค้า model A เดิมไม่กระทบ |
