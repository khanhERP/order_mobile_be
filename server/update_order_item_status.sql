
-- Update order_items status column to support new status values
-- Default status is empty string (chưa gửi bếp)
-- pending = chờ chế biến
-- progress = đang xử lý  
-- completed = hoàn thành

-- Update existing order items with null or 'pending' status to empty string
UPDATE order_items SET status = '' WHERE status IS NULL OR status = 'pending';

-- Update column default value
ALTER TABLE order_items ALTER COLUMN status SET DEFAULT '';

-- Add comment to explain status values
COMMENT ON COLUMN order_items.status IS 'Order item status: "" (chưa gửi bếp), "pending" (chờ chế biến), "progress" (đang xử lý), "completed" (hoàn thành)';
