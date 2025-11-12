
-- Migration to add einvoiceStatus column to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS einvoice_status INTEGER NOT NULL DEFAULT 0;

-- Add comment for the column
COMMENT ON COLUMN invoices.einvoice_status IS 'E-invoice status: 0=Chưa phát hành, 1=Đã phát hành, 2=Tạo nháp, 3=Đã duyệt, 4=Đã bị thay thế (hủy), 5=Thay thế tạm, 6=Thay thế, 7=Đã bị điều chỉnh, 8=Điều chỉnh tạm, 9=Điều chỉnh, 10=Đã hủy';
