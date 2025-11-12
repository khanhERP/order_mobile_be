
-- Create e-invoice connections table
CREATE TABLE IF NOT EXISTS einvoice_connections (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  tax_code VARCHAR(20) NOT NULL,
  login_id VARCHAR(50) NOT NULL,
  password TEXT NOT NULL,
  software_name VARCHAR(50) NOT NULL,
  login_url TEXT,
  sign_method VARCHAR(20) NOT NULL DEFAULT 'Ký server',
  cqt_code VARCHAR(20) NOT NULL DEFAULT 'Cấp nhật',
  notes TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_einvoice_connections_symbol ON einvoice_connections(symbol);
CREATE INDEX IF NOT EXISTS idx_einvoice_connections_active ON einvoice_connections(is_active);
