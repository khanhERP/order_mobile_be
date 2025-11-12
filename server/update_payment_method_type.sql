
-- Migration to update payment_method column type from varchar to integer
-- First add new column
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method_code INTEGER DEFAULT 1;

-- Update existing records based on text values
UPDATE invoices 
SET payment_method_code = CASE 
  WHEN payment_method = 'cash' OR payment_method = 'tiền mặt' THEN 1
  WHEN payment_method = 'card' OR payment_method = 'creditCard' OR payment_method = 'debitCard' 
       OR payment_method = 'momo' OR payment_method = 'zalopay' OR payment_method = 'vnpay' 
       OR payment_method = 'qrCode' OR payment_method = 'einvoice' THEN 2
  ELSE 2
END;

-- Drop old column and rename new column
ALTER TABLE invoices DROP COLUMN IF EXISTS payment_method;
ALTER TABLE invoices RENAME COLUMN payment_method_code TO payment_method;

-- Update orders table as well for consistency
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method_code INTEGER DEFAULT 1;

UPDATE orders 
SET payment_method_code = CASE 
  WHEN payment_method = 'cash' OR payment_method = 'tiền mặt' THEN 1
  WHEN payment_method = 'card' OR payment_method = 'creditCard' OR payment_method = 'debitCard' 
       OR payment_method = 'momo' OR payment_method = 'zalopay' OR payment_method = 'vnpay' 
       OR payment_method = 'qrCode' OR payment_method = 'einvoice' THEN 2
  ELSE 2
END;

ALTER TABLE orders DROP COLUMN IF EXISTS payment_method;
ALTER TABLE orders RENAME COLUMN payment_method_code TO payment_method;
