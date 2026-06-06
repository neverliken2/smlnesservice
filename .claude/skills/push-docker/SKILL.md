---
name: push-docker
description: |
  Build → tag → smoke-test → push Docker image ของ smlnesservice ขึ้น Docker Hub
  (default: neverliken/smlnesservice). Triggers: "push docker", "release docker",
  "deploy docker image", "ออก image ใหม่", "build image แล้ว push". รับ tag ผ่าน
  $ARGUMENTS หรือถามถ้าไม่ระบุ.
---

# push-docker — build → tag → smoke → push

## เป้าหมาย

ออก Docker image ของ smlnesservice version ใหม่ → push ขึ้น Docker Hub
ปลายทาง: `neverliken/smlnesservice:<tag>` (+ `:latest` ถ้าเจ้านายเลือก)

## Default conventions

| | |
|---|---|
| **Registry** | Docker Hub |
| **Account** | `neverliken` |
| **Image** | `neverliken/smlnesservice` |
| **Dockerfile** | `./Dockerfile` (multi-stage, อยู่แล้ว) |
| **Smoke test port (host)** | `13000` → container `:3000` |

## Workflow — ทำตามลำดับ ห้ามข้าม

### Step 1 — รับ/ยืนยัน tag

- ถ้า `$ARGUMENTS` มี tag (เช่น `0.0.2`, `v1.0.0`) → ใช้เลย
- ถ้าไม่มี → อ่าน `package.json` field `version`, เสนอ tag ตามนั้น + ถามด้วย `AskUserQuestion`:
  - "ใช้ `<package.version>` หรือ tag อื่น?"
  - ถามด้วยว่าจะ tag `latest` ด้วยไหม (แนะนำ: ใช่ ถ้าเป็น release ปกติ)
- ห้าม tag ซ้ำกับที่มีบน Docker Hub แล้ว — ตรวจด้วย `docker manifest inspect neverliken/smlnesservice:<tag> 2>&1`
  - ถ้าเจอ → เตือน + ถามว่าจะ overwrite ไหม

### Step 2 — Pre-flight checks (parallel)

ยิงพร้อมกันใน 1 message:

1. `docker --version` — มี Docker
2. `docker info 2>&1 | grep -i username` — login Docker Hub แล้วหรือยัง
3. `git status --short` — working tree clean ไหม (เตือนถ้า dirty)
4. `ls Dockerfile` — Dockerfile มีจริง
5. `npm run build 2>&1 | tail -5` — TypeScript compile ผ่าน (กัน push image พัง)

ถ้าข้อ 2 ไม่ login → หยุด แจ้งให้รัน `docker login -u neverliken` เอง
ถ้าข้อ 3 dirty → แจ้งเจ้านาย ถามว่าจะ continue/commit-first/abort
ถ้าข้อ 5 fail → หยุด แก้ก่อน

### Step 3 — Build

```bash
docker build -t neverliken/smlnesservice:<tag> .
```

- รัน `run_in_background: true` (build อาจ 1-3 นาที)
- รอ notification แทน polling
- หลัง build เสร็จ ตรวจ exit code + ขนาด image:
  ```bash
  docker images neverliken/smlnesservice:<tag>
  ```
- ถ้าขนาด > 300 MB → เตือน (image baseline = ~173 MB)

### Step 4 — Smoke test (ห้ามข้าม)

รัน container ด้วย dummy env → ยิง `/health` → หยุด container

```bash
docker rm -f smlnes-push-smoke 2>&1 | head -1
docker run -d --name smlnes-push-smoke -p 13000:3000 \
  -e NODE_ENV=production \
  -e JWT_SECRET=dummy-test-secret-at-least-32-chars-long-xxxx \
  -e ALLOWED_CLIENTS_JSON='[{"clientCode":"smoke","tokenHash":"$2b$12$abcdefghijklmnopqrstuvwx"}]' \
  -e DB_HOST=127.0.0.1 -e DB_USER=postgres -e DB_PASSWORD=dummy \
  neverliken/smlnesservice:<tag>
sleep 5
curl -sf http://localhost:13000/health
SMOKE_EXIT=$?
docker rm -f smlnes-push-smoke
```

- ถ้า `/health` ไม่ 200 → หยุด แสดง `docker logs smlnes-push-smoke` แล้วถามว่าจะแก้/อะไร
- ถ้าผ่าน → คน container ออก แล้วไปต่อ

### Step 5 — Confirm กับเจ้านาย ก่อน push

แสดงสรุปแล้วถามด้วย `AskUserQuestion`:

```
✅ Build       neverliken/smlnesservice:<tag>  (<size> MB)
✅ Smoke test  /health 200
✅ TS compile  pass
⏳ พร้อม push ขึ้น Docker Hub — confirm?
```

Option:
- ✅ Push (`<tag>` only)
- ✅ Push (`<tag>` + `latest`)
- ❌ Abort

**ห้าม push ก่อน confirm — เพราะ push ไป registry คือ visible to others / hard to undo**

### Step 6 — Push

```bash
docker push neverliken/smlnesservice:<tag>
# ถ้าเลือก :latest ด้วย
docker tag neverliken/smlnesservice:<tag> neverliken/smlnesservice:latest
docker push neverliken/smlnesservice:latest
```

- รัน `run_in_background: true` (push อาจ 1-5 นาที — ขึ้นกับ network + cache)
- รอ notification

### Step 7 — Verify pushed

```bash
docker manifest inspect neverliken/smlnesservice:<tag> 2>&1 | head -5
```

แสดงสรุป + URL:
```
✅ Pushed neverliken/smlnesservice:<tag>
   Pull command: docker pull neverliken/smlnesservice:<tag>
   Hub URL:      https://hub.docker.com/r/neverliken/smlnesservice/tags
```

## Safety rules

- **ห้าม push โดยไม่ผ่าน Step 4 smoke test**
- **ห้าม push โดยไม่ Step 5 confirm**
- **ห้าม overwrite tag ที่มีอยู่แล้วโดยไม่ confirm**
- **ห้าม push ถ้า git dirty โดยไม่ถามก่อน** — แม้ไม่ block แต่เจ้านายควรรู้
- **ห้ามใช้ `--no-cache` ถ้าเจ้านายไม่สั่ง** — เปลือง time
- **ห้าม `docker login` ให้** — เจ้านาย login เอง

## ตัวอย่าง invocation

```
ผู้ใช้:  /push-docker 0.1.0
→ skill: รับ tag 0.1.0 → ถาม latest? → pre-flight → build → smoke → confirm → push

ผู้ใช้:  /push-docker
→ skill: อ่าน package.json version → เสนอ tag → ถาม confirm → ดำเนินการ
```
