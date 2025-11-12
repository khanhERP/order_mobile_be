
CREATE TABLE IF NOT EXISTS income_vouchers (
  id SERIAL PRIMARY KEY,
  voucher_number VARCHAR(50) NOT NULL,
  date VARCHAR(10) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  account VARCHAR(50) NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  category VARCHAR(50) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_income_vouchers_date ON income_vouchers(date);
CREATE INDEX IF NOT EXISTS idx_income_vouchers_voucher_number ON income_vouchers(voucher_number);
