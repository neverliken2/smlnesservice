# =============================================================
# smlnesservice — Multi-stage Dockerfile
# Deployment model A: 1 service ต่อ 1 ลูกค้า (PG อยู่คนละ host)
# =============================================================

# ---------- Stage 1: builder ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Native deps (bcrypt) ต้องมี python + build-base ตอน build เท่านั้น
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runtime

# Non-root user
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# tini = PID 1 ที่จัดการ SIGTERM/SIGINT ส่งต่อ Node ได้ดี
RUN apk add --no-cache tini

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package*.json ./

ENV NODE_ENV=production
ENV PORT=3000

USER app
EXPOSE 3000

# healthcheck เรียก /health (no auth, no global prefix)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
