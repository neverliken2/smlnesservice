export interface InvoiceHeader {
  doc_no: string;
  doc_date: string;
  cust_code: string;
  cust_name: string; // empty — client มี cust_name จาก ListSalesInvoices ก่อนหน้าแล้ว
  total_amount: number;
  vat_type: number;
  vat_rate: number;
  discount_word: string;
  inquiry_type: number;
}

export interface InvoiceDetailLine {
  line_number: number;
  item_code: string;
  item_name: string;
  unit_code: string;
  qty: number;
  available_qty: number;
  price: number;
  discount: string;
  discount_amount: number;
  sum_amount: number;
  sum_amount_exclude_vat: number;
  total_vat_value: number;
  wh_code: string;
  shelf_code: string;
  vat_type: number;
  item_type: number;
  set_ref_line: string;
  set_ref_price: number;
  set_ref_qty: number;
  is_permium: number;
}

export interface InvoiceDetailResponse {
  header: InvoiceHeader;
  lines: InvoiceDetailLine[];
}
