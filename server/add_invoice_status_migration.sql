
-- Migration to add invoice_status column to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_status INTEGER NOT NULL DEFAULT 1;

-- Add comment for the column
COMMENT ON COLUMN invoices.invoice_status IS 'Invoice status: 1=Hoàn thành (Đơn đã thanh toán hoàn thành), 2=Đang phục vụ (Đơn đã tạo và chưa hoàn thành thanh toán), 3=Đã hủy (Người dùng sử dụng tính năng hủy đơn)';

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_status ON invoices(invoice_status);
