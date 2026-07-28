# แผน: เขียน audit log ตัวที่สอง (`<db>_logs.erp_logs`, JSON)

> **สถานะ: ยังไม่ทำ — พักไว้ก่อน (2026-07-28)**
> เอกสารที่เว็บสร้างยังไม่โผล่ในหน้า "Full Logs" ของ SMLERP22
> ยังมี **คำถามค้าง 2 ข้อ** ที่ต้องให้เจ้าของงานตัดสินก่อนเริ่ม (ดูหัวข้อ "ยังไม่ได้ตัดสิน")

---

## 1. เรื่องย่อ

SMLERP22 เขียน audit log **2 ทาง** ทุกครั้งที่บันทึกเอกสาร ic_trans —
`_icTransControl.cs:16991-16993` เรียกติดกัน 2 บรรทัด:

```csharp
this._saveLog(this._myManageTrans._mode);   // ทางที่ 1
_writeFullLogs(this._myManageTrans._mode);  // ทางที่ 2
```

| | ทางที่ 1 | ทางที่ 2 |
|---|---|---|
| สถานะฝั่งเรา | ✅ **ทำแล้ว** (smlnesservice 0.9.0) | ❌ **ยังไม่ทำ** ← เอกสารนี้ |
| DB | `<data_db>` เช่น `demo` | **`<data_db>_logs`** เช่น `demo_logs` |
| ตาราง | `logs` | `erp_logs` |
| รูปแบบ payload | XML escape ใน `data1` | **JSON** (bytea, UTF-8) ใน `data_new` |
| โค้ดต้นทาง | `_icTransControl.cs::_createLog` | `SMLERPAudit/_logHistory.cs::WriteTransactionLog` |
| ไลบรารี | ต่อ string เอง | Newtonsoft.Json (`JObject`) |

ครอบคลุม 3 เมนูที่เว็บมี: IA (66), IS (68), RMB (54)

## 2. หลักฐานที่ตรวจแล้ว (DB demo, 2026-07-28)

```
demo_logs มีตารางเดียว: erp_logs — 408 แถว
trans_flag ที่พบ: 0,2,4,6,7,10,12,19,30,36,37,40,44,45,48,49,54,66,68,72,76,87,88,122,124,213,235,239,240,250,260,9010

IS-2607-0001 (desktop) → มีแถวใน erp_logs, data_new = JSON 2,866 bytes
IS-2607-0002 (เว็บ)    → ไม่มี
```

## 3. โครงสร้างข้อมูล

### 3.1 คอลัมน์ของ `erp_logs`

```
ignore_sync, is_lock_record, roworder,
doc_no, doc_date(date), doc_time, cust_code, user_code, date_time(timestamp),
trans_flag(smallint), trans_type(smallint),
old_doc_no, old_doc_date(date), old_doc_time, old_cust_code,
data_new(bytea), data_old(bytea),
computer_name, function_code(smallint), menu_name,
doc_amount(numeric), old_doc_amount(numeric), create_date_time_now
```

### 3.2 ค่าจริงของ IS-2607-0001 (คอลัมน์ scalar)

```json
{
  "doc_no": "IS-2607-0001", "doc_date": "2026-07-28", "doc_time": "",
  "cust_code": "", "trans_flag": 68, "trans_type": 3,
  "old_doc_no": "", "old_doc_date": "1899-12-31", "old_doc_time": "", "old_cust_code": "",
  "doc_amount": 0, "old_doc_amount": 0,
  "function_code": 1, "menu_name": "menu_ic_stk_adjust_subtract",
  "user_code": "SUPERADMIN", "computer_name": "DESKTOP-3FDCLSV"
}
```
`data_old` = ว่าง (ตอน insert), `function_code`: 1=เพิ่ม 2=แก้ 3=ลบ

> เหมือนตาราง `logs`: `doc_amount` = **0** ทั้งที่เอกสารมียอด 37.39
> (จอ IA/IS ไม่มีช่อง total_amount ให้ desktop ดึง)

### 3.3 `data_new` — JSON

6 key บนสุด:

```json
{
  "screentop":      { "doc_date":"2026-07-28", "doc_time":"10:35", "doc_no":"IS-2607-0001",
                      "doc_format_code":"IS", "doc_ref_date":"1900-1-1", "doc_ref":"null",
                      "wh_from":"ST01", "location_from":"LC01", "remark":"null" },
  "screenmore":     {},
  "screenbottom":   { "remark_2":"null", "remark_3":"null", "remark_4":"null", "remark_5":"null" },
  "screendetail":   [ { …35 field ต่อแถว… } ],
  "screengltop":    { "doc_date":"2026-07-28", "trans_direct":"0", "doc_no":"IS-2607-0001",
                      "doc_format_code":"IS", "ref_date":"1900-1-1", "ref_no":"null",
                      "period_number":"7", "account_year":"2569", "book_code":"null",
                      "journal_type":0, "description":"null", "ap_ar_code":"null",
                      "ap_ar_originate_from":"null" },
  "screengldetail": []
}
```

field ของ 1 แถวใน `screendetail` (ทุกค่าเป็น **string** ยกเว้น `journal_type`):

```
line_number, ref_row, item_code, item_name, barcode, wh_code, shelf_code, unit_code,
qty, price, sum_amount, hidden_cost_1, stand_value, divide_value, item_type,
item_code_main, ref_guid, is_permium, is_get_price, price_exclude_vat, total_vat_value,
sum_amount_exclude_vat, hidden_cost_1_exclude_vat, discount_amount, user_approve,
price_mode, price_type, is_serial_number, tax_type, lot_number_1, price_set_ratio,
price_guid, mfd_date, mfn_name, remark, is_lock_cost, sum_of_cost_fix
```

### 3.4 ⚠️ 3 กับดักที่ต้องรู้ก่อนลงมือ

1. **JSON คือ snapshot ของ "หน้าจอ" ไม่ใช่ของ DB**
   IS-2607-0001 เขียน `price:"10.00"`, `sum_amount:"10.00"` แต่ `ic_trans_detail` จริงเก็บ **37.39**
   (SML คำนวณทุนเฉลี่ยทับตอน save) → JSON บันทึก *สิ่งที่ user พิมพ์* ไม่ใช่ *สิ่งที่ลงฐาน*

2. **มี artifact ของ C#/WinForms ปนมา**
   - ค่าว่างเป็น string `"null"` (ไม่ใช่ JSON null)
   - วันที่ว่างเป็น `"1900-1-1"`, `old_doc_date` เป็น `1899-12-31` (DateTime default)
   - `screendetail` มี **แถวเปล่าท้ายตาราง** — IS-2607-0001 มี 3 แถว ทั้งที่มีสินค้าจริงแถวเดียว

3. **ข้ามฐานข้อมูล → อยู่ใน transaction เดียวกับเอกสารไม่ได้**
   Postgres ไม่รองรับ cross-database transaction — ต้องเปิด pool ตัวที่สองไปที่ `<db>_logs`

---

## 4. ยังไม่ได้ตัดสิน (ต้องถามก่อนเริ่ม)

### คำถาม 1 — จัดการ error ยังไง เมื่อเขียน `erp_logs` ไม่สำเร็จ

| แนว | วิธี | แลกกับ |
|---|---|---|
| **A — best-effort** *(ผู้เขียนแผนแนะนำ)* | commit เอกสารก่อน แล้วค่อยเขียน log นอก tx ถ้าพลาด log warning เฉยๆ | เอกสารไม่มีวันพังเพราะ log แต่ log อาจหายในเคสหายาก |
| B — บังคับสำเร็จ | เขียน log ก่อน commit เอกสาร ถ้าพลาด rollback เอกสาร | audit ครบเสมอ แต่ `<db>_logs` ล่ม = บันทึกเอกสารไม่ได้เลย |
| C — ไม่ทำ | ปล่อยไว้ | เว็บใช้งานได้ปกติ แต่หน้า Full Logs ไม่เห็นเอกสารจากเว็บ |

### คำถาม 2 — JSON เอาค่าจากไหน

| ทาง | ผล |
|---|---|
| **ค่าที่ INSERT ลง DB จริง** *(แนะนำ)* | ตรงกับเอกสาร ตรวจย้อนหลังได้จริง แต่ต่างจาก desktop ในเคสที่ SML คำนวณทุนทับ |
| เลียน desktop เป๊ะ | ใส่ `"null"`, `"1900-1-1"`, แถวเปล่าท้ายตาราง ครบทุกกระเบียด — แต่ log อ่านยากขึ้นโดยไม่ได้อะไรเพิ่ม |

> เหตุผลที่เอนไป A + ค่าจริง: artifact พวก `"null"` / แถวเปล่า เป็นผลข้างเคียงของ WinForms grid
> ไม่ใช่ข้อมูลที่ตั้งใจเก็บ · ถ้าลูกค้ามี tool อ่าน log ที่ parse ตรงๆ ค่อยกลับมาทบทวนข้อนี้

---

## 5. ขั้นตอนที่ต้องทำ (เมื่อได้คำตอบแล้ว)

### 5.1 core — pool ของ `<db>_logs`

- `PoolManagerService` ตอนนี้ key ด้วย `tenant.database` — เพิ่ม helper `logsDbName(database)` → `` `${database}_logs` ``
  (mirror `MyLib/_global.cs:701` ที่ทำ `_databaseNameTemp + "_logs"`)
- ใช้ pool แยกต่อ tenant เหมือนเดิม แค่คนละชื่อ DB — ไม่ต้องแก้ credential (host/user เดียวกัน)
- ต้องกันเคส DB `<db>_logs` ไม่มีอยู่ (ลูกค้าบางรายอาจไม่ได้สร้าง) → ถ้าต่อไม่ได้ให้ทำตามแนวที่เลือกในคำถาม 1

### 5.2 module stock-adjust

| ไฟล์ | สิ่งที่เพิ่ม |
|---|---|
| `stock-adjust.constants.ts` | มี `IA/IS/RMB_MENU_NAME` + flag ครบแล้ว — ใช้ซ้ำได้เลย |
| `stock-adjust.util.ts` | `buildFullLogJson(header, lines)` → 6 key ตาม §3.3 |
| `stock-adjust.repository.ts` | `insertFullLog(client, params)` — INSERT `erp_logs` (คนละ pool) |
| `stock-adjust.service.ts` | เรียกหลัง/ก่อน commit ตามแนวที่เลือก — ทั้ง 3 จุด (`saveStockAdjust`, `saveStockAdjustReduce`, `saveStockBalance`) |

### 5.3 ค่าที่ใส่ในคอลัมน์ scalar

| คอลัมน์ | ค่า |
|---|---|
| `doc_no`, `doc_date`, `trans_flag`, `trans_type` | จากเอกสารที่เพิ่งบันทึก |
| `doc_time`, `cust_code`, `old_*` | `''` / `0` (desktop ก็ว่าง) |
| `function_code` | 1 (เว็บสร้างอย่างเดียว ไม่มีแก้/ลบ) |
| `menu_name` | `menu_ic_stk_adjust` / `menu_ic_stk_adjust_subtract` / `menu_ic_stk_balance` |
| `user_code` | `tenant.userCode` |
| `computer_name` | `nextstep_stock_adjust` (ตรงกับที่ใช้ในตาราง `logs` แล้ว) |
| `doc_amount` | ดูหมายเหตุ §3.2 — desktop ใส่ 0, ตาราง `logs` ฝั่งเราใส่ยอดจริง ควรทำให้สอดคล้องกัน |
| `data_new` | `Buffer.from(JSON.stringify(obj), 'utf8')` |
| `data_old` | `NULL` |

### 5.4 ทดสอบ

- unit test `buildFullLogJson` เทียบกับ JSON ของ IS-2607-0001 (key ครบ, ชนิดค่าเป็น string)
- บันทึกเอกสารจริง 1 ใบต่อเมนู แล้ว query `<db>_logs.erp_logs` ยืนยันว่ามีแถว + parse JSON ได้
- ทดสอบเคส `<db>_logs` ต่อไม่ได้ → เอกสารต้องยังบันทึกได้ (ถ้าเลือกแนว A)

---

## 6. วิธี query `<db>_logs` ตอนตรวจงาน

MCP ที่ตั้งไว้ (`postgres-data-demo`) ผูกกับ `demo` อย่างเดียว ต่อ `demo_logs` ตรงๆ ไม่ได้
ทางที่ใช้ตอนสำรวจครั้งนี้ — สคริปต์ node อ่าน connection string จาก `.mcp.json` แล้วสลับชื่อ DB
(รหัสผ่านไม่ต้องผ่านสายตา):

```js
const cfg = JSON.parse(fs.readFileSync('C:/Users/never/Documents/work/.mcp.json', 'utf8'));
const base = cfg.mcpServers['postgres-data-demo'].args.find((a) => a.startsWith('postgres'));
const conn = base.replace(/\/demo$/, '/demo_logs');
```

หรือจะเพิ่ม MCP ใหม่ `postgres-data-demo-logs` → `demo_logs` ตาม pattern ใน `work/CLAUDE.md` ก็ได้

## 7. อ้างอิงโค้ด SMLERP22

| ไฟล์ | บทบาท |
|---|---|
| `SMLInventoryControl/_icTransControl.cs:16991` | จุดที่เรียกทั้ง 2 log |
| `SMLInventoryControl/_icTransControl.cs:9296` | `_writeFullLogs` — ประกอบ JObject |
| `SMLERPAudit/_logHistory.cs:124` | `WriteTransactionLog` — INSERT `erp_logs` |
| `SMLERPAudit/_fullLogs.cs` | หน้าจอที่อ่าน `erp_logs` (เมนู `menu_trans_full_logs`) |
| `MyLib/_global.cs:701` | resolver ชื่อ DB `<db>_logs` |
| `MyLib/_myScreen.cs:799` | `_logCreate` — ทางที่ 1 (XML) เผื่อเทียบ |
