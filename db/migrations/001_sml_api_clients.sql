-- ============================================================
-- Migration 001: sml_api_clients
-- Target DB: smlerpmain<provider>   (Auth/Metadata DB ของ tenant)
-- Run on:    ทุก provider ที่จะให้ smlnesservice ทำงาน
--
-- ผู้รัน: เจ้าของ project (manual ผ่าน pgAdmin/DBeaver)
--        — ไม่มี migration tool ในเฟสนี้
-- ============================================================

CREATE TABLE IF NOT EXISTS sml_api_clients (
    client_code           varchar(50)  PRIMARY KEY,
    client_name           varchar(150) NOT NULL,
    api_key_hash          varchar(100) NOT NULL,        -- bcrypt hash (60 chars + slack)
    active_status         smallint     NOT NULL DEFAULT 1,
    create_date_time_now  timestamp    NOT NULL DEFAULT now(),
    last_used_at          timestamp    NULL,
    note                  varchar(500) NULL
);

COMMENT ON TABLE sml_api_clients IS
    'API clients ที่อนุญาตให้เรียก smlnesservice — ตรวจกับ X-API-Key header';
COMMENT ON COLUMN sml_api_clients.client_code IS 'รหัส client เช่น nextstep-cn-coupon';
COMMENT ON COLUMN sml_api_clients.api_key_hash IS 'bcrypt hash ของ raw API key (raw key อยู่ฝั่ง client เท่านั้น)';
COMMENT ON COLUMN sml_api_clients.active_status IS '1=active, 0=disabled';

-- ตัวอย่าง insert (รัน script scripts/generate-api-key.ts เพื่อได้ค่า):
-- INSERT INTO sml_api_clients (client_code, client_name, api_key_hash, note)
-- VALUES ('nextstep-cn-coupon', 'NextStep CN Coupon Web', '<bcrypt-hash>', 'production web');
