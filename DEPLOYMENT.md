# smlnesservice — Deployment Guide

คู่มือ deploy smlnesservice (NestJS API gateway) บน server ลูกค้าผ่าน Docker Hub image

> สำหรับ deploy ของลูกค้าเฉพาะราย ดู `deploy/<customer-name>/DEPLOY.md`
> ไฟล์นี้เป็น **generic guide** + gotchas ที่ใช้ได้กับทุกลูกค้า

## Deployment Model

```
[Customer's PostgreSQL]  ──────  [smlnesservice container]  ──────  [Client apps: NextStep, ...]
   (PG อยู่คนละ host)               (1 instance / 1 customer)         (join docker network เดียวกัน)
```

- **1 service ต่อ 1 ลูกค้า** (Model A) — ไม่ใช่ multi-tenant ใน container เดียว
- smlnesservice **ไม่ host PG เอง** — connect ออกไปที่ PG ของลูกค้า
- Client (เช่น NextStep CN Coupon) join docker network เดียวกัน → คุยผ่าน `http://smlnesservice:3000`

## Prerequisites

- ✅ Docker + Docker Compose v2 ติดตั้งบน server ลูกค้า
- ✅ PG ของลูกค้า reachable จาก server (มี IP/hostname + port + credentials)
- ✅ มี image `neverliken/smlnesservice:latest` บน Docker Hub
- ✅ ทราบ provider name ของลูกค้า (สำหรับ verify `smlerpmain<provider>` connection)

## Step-by-Step

### 1. สร้าง docker network (ครั้งเดียวต่อ server)

ถ้า server ยังไม่มี shared network สำหรับ sml stack:

```bash
docker network create sml_app_net
```

ตรวจว่ามีอยู่แล้วหรือยัง:
```bash
docker network ls | grep sml_app_net
```

> Client apps (NextStep ฯลฯ) ต้อง join network นี้ ถึงคุย smlnesservice ได้

### 2. Generate JWT secret + client token pair

#### 2.1 JWT secret

```bash
openssl rand -hex 32
```

เก็บไว้ใส่ `JWT_SECRET` ใน `.env`

#### 2.2 Client token pair + self-test

> ⚠️ **ห้ามข้าม self-test** — bcrypt hash 1 ตัวอักษรหายตอน copy/paste = ใช้ไม่ได้
> ใน production ทำใน container เดียวกับที่จะใช้ verify (เพื่อ bcrypt version ตรงกัน)

ถ้า smlnesservice รันอยู่แล้ว — รันใน container เลย:
```bash
docker exec smlnesservice node -e "const c=require('crypto'),b=require('bcrypt'); const r=c.randomBytes(32).toString('hex'); const h=b.hashSync(r,12); console.log('RAW='+r); console.log('HASH='+h); console.log('SELF_TEST='+b.compareSync(r,h));"
```

ถ้ายังไม่มี container — รันใน image ตรงๆ:
```bash
docker run --rm neverliken/smlnesservice:latest node -e "const c=require('crypto'),b=require('bcrypt'); const r=c.randomBytes(32).toString('hex'); const h=b.hashSync(r,12); console.log('RAW='+r); console.log('HASH='+h); console.log('SELF_TEST='+b.compareSync(r,h));"
```

ผลลัพธ์ต้องได้ทั้ง 3 บรรทัด:
```
RAW=<hex 64 ตัว>
HASH=$2b$12$<22 ตัว salt><31 ตัว hash>
SELF_TEST=true          ← ต้อง true ห้ามอย่างอื่น
```

- เก็บ **RAW** ไว้สำหรับใส่ใน client (เช่น `SMLNES_CLIENT_TOKEN` ใน NextStep)
- เก็บ **HASH** ไว้ใส่ `ALLOWED_CLIENTS_JSON` ของ smlnesservice

### 3. เตรียม folder + ไฟล์

```bash
mkdir -p /home/<user>/smlnesservice
cd /home/<user>/smlnesservice
```

#### 3.1 สร้าง `docker-compose.yml`

```yaml
services:
  smlnesservice:
    image: neverliken/smlnesservice:latest
    container_name: smlnesservice
    restart: unless-stopped
    pull_policy: always
    ports:
      # host:18003 → container:3000 — สำหรับ verify/smoke test
      # bind 127.0.0.1 = เข้าได้แค่จาก localhost (ปลอดภัยกว่า)
      # ลบ block นี้ได้เมื่อ client คุยผ่าน internal network แล้ว
      - "127.0.0.1:18003:3000"
    env_file:
      - .env
    networks:
      - sml_app_net
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "-", "http://127.0.0.1:3000/health"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3

networks:
  sml_app_net:
    external: true
```

#### 3.2 สร้าง `.env`

```env
# ---- Application ----
NODE_ENV=production
PORT=3000

# ---- PostgreSQL ----
DB_HOST=<customer-pg-host>
DB_PORT=<customer-pg-port>
DB_USER=postgres
DB_PASSWORD=<customer-pg-password>
DB_NAME_PREFIX=smlerpmain
DB_SSL=false
DB_SSL_REJECT_UNAUTHORIZED=true

# ---- Auth ----
# JWT secret จาก step 2.1
JWT_SECRET=<openssl rand -hex 32>
PRE_SELECT_EXPIRES_IN=2m
SESSION_EXPIRES_IN=8h

# ---- Allowed clients ----
# ⚠️ ต้อง escape $ → $$ ทุกตัว (docker compose interpolation)
# Hash จาก step 2.2 ตัวอย่าง: $2b$12$eHL6l.j.LeApolq.nBB86uxHv...
# ใน .env ต้องเป็น:           $$2b$$12$$eHL6l.j.LeApolq.nBB86uxHv...
ALLOWED_CLIENTS_JSON=[{"clientCode":"nextstep-cn-coupon","tokenHash":"$$2b$$12$$<HASH ที่ gen>"}]
```

> 🔒 **ป้องกัน secrets:** `chmod 600 .env` ให้อ่านได้แค่ owner

### 4. Deploy

```bash
docker compose pull
docker compose up -d
docker compose logs -f smlnesservice
```

ต้องเห็น log:
```
[Nest] LOG [ClientRegistryService] Loaded 1 allowed client(s): nextstep-cn-coupon
🚀 smlnesservice listening on http://localhost:3000
```

กด `Ctrl+C` ออกจาก log (container ยังรันต่อ)

### 5. Verify

#### 5.1 Hash ใน container ต้องครบ (ไม่หายส่วนกลาง)

```bash
docker exec smlnesservice printenv ALLOWED_CLIENTS_JSON
```

ต้องเห็น hash เป็น `$2b$12$<salt><hash>` ครบ — ถ้าเห็น `$2b$12.xxx` (ขาดส่วน salt) = ไม่ได้ escape `$$`

#### 5.2 Health endpoints (จาก host)

```bash
# Liveness
curl http://127.0.0.1:18003/health

# DB ping (เปลี่ยน demo เป็น provider ลูกค้า)
curl 'http://127.0.0.1:18003/health?provider=demo'
```

ผลที่คาดหวัง:
- `/health` → `{"status":"ok","version":"..."}`
- `/health?provider=demo` → `db.healthy:true`

#### 5.3 Login test (ใช้ raw token จาก step 2.2)

```bash
curl -X POST http://127.0.0.1:18003/api/v1/auth/login \
  -H "Authorization: Bearer <RAW token>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"demo","username":"superadmin","password":"smladmin"}'
```

ต้องได้ JSON มี `preSelectToken` + `databases[]` กลับมา

## Update Image (deploy version ใหม่)

```bash
cd /home/<user>/smlnesservice
docker compose pull
docker compose up -d
docker compose logs -f --tail 30 smlnesservice
```

## Troubleshooting

### `Loaded 0 allowed client(s)` ใน log

= `ALLOWED_CLIENTS_JSON` parse ไม่ได้ — เช็ค:
1. JSON syntax ถูกไหม (มี `[]`, `{}`, `""` ครบ)
2. ทั้งบรรทัดอยู่บรรทัดเดียว (ไม่ break line)
3. `tokenHash` ต้องขึ้นต้น `$2` (bcrypt hash)

### Hash ใน container ขาดส่วนกลาง (เช่น `$2b$12.Ceqyz` แทนที่จะเป็น `$2b$12$Xk2it5.Ceqyz`)

= docker compose ตีความ `$Xx` เป็น variable interpolation → แทนด้วยค่าว่าง

**วิธีแก้:** escape ทุก `$` ใน `ALLOWED_CLIENTS_JSON` เป็น `$$` แล้ว `down + up`

### Client app ได้ `401 INVALID_API_KEY` ทั้งที่ token ดูเหมือนถูก

ทดสอบ bcrypt compare ตรงๆ (bypass guard):

```bash
docker exec smlnesservice node -e "const b=require('bcrypt'); console.log(b.compareSync('<RAW token client>', '<HASH ใน .env>'))"
```

- `true` = pair ถูก → bug อยู่ที่ client ส่ง request (header/auth scheme ผิด?)
- `false` = pair ไม่ใช่คู่กัน → gen ใหม่ + self-test

### Client app resolve `smlnesservice` ไม่ได้

= ไม่ได้ join network เดียวกัน

```bash
docker inspect <client-container> --format '{{json .NetworkSettings.Networks}}'
```

ต้องเห็น `sml_app_net` (หรือชื่อ network ที่ smlnesservice อยู่)

### แก้ `.env` แล้วค่าไม่เปลี่ยน

`docker restart` **ไม่ reload `env_file`** — ต้อง:
```bash
docker compose down && docker compose up -d
```

## Gotchas ที่ต้องจำ

| ปัญหา | สาเหตุ | วิธีแก้ |
|---|---|---|
| Hash ใน container ขาดส่วนกลาง | docker compose interpolate `$Xxx` ใน .env | escape `$` → `$$` ใน `ALLOWED_CLIENTS_JSON` |
| Self-test ไม่ผ่าน | bcrypt version mismatch / copy-paste ตก | gen ใน container เดียวกับที่ verify (`docker exec smlnesservice node -e ...`) |
| แก้ .env แล้วค่าไม่เปลี่ยน | `restart` ไม่ reload env_file | `down` + `up` |
| Client login = INVALID_API_KEY | token / hash ไม่ match | ทดสอบด้วย `bcrypt.compareSync()` ตรงๆ |
| Client connect ไม่ได้ | ไม่อยู่ network เดียวกัน | join `sml_app_net` ใน client compose |

## Reference

- Architecture: [docs/architecture.md](docs/architecture.md)
- Customer-specific deploy: [deploy/](deploy/) (gitignored)
- Client side guide: NextStep CN Coupon → `DEPLOYMENT.md` ของ project นั้น
