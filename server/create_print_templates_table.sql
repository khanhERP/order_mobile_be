
-- Migration để tạo bảng print_templates và printer_configs
CREATE TABLE IF NOT EXISTS print_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  template_type VARCHAR(50) NOT NULL DEFAULT 'receipt', -- 'receipt', 'invoice', 'order'
  paper_width INTEGER NOT NULL DEFAULT 80, -- 58, 80, 112 mm
  font_size INTEGER NOT NULL DEFAULT 12, -- px
  show_logo BOOLEAN NOT NULL DEFAULT true,
  show_qr BOOLEAN NOT NULL DEFAULT true,
  header_text VARCHAR(200) DEFAULT 'HÓA ĐƠN BÁN HÀNG',
  footer_text TEXT DEFAULT 'Cảm ơn quý khách đã mua hàng!',
  show_tax BOOLEAN NOT NULL DEFAULT true,
  show_discount BOOLEAN NOT NULL DEFAULT true,
  custom_css TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS printer_configs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  printer_type VARCHAR(50) NOT NULL DEFAULT 'thermal', -- 'thermal', 'inkjet', 'laser'
  connection_type VARCHAR(50) NOT NULL DEFAULT 'usb', -- 'usb', 'network', 'bluetooth'
  ip_address VARCHAR(45), -- for network printers
  port INTEGER DEFAULT 9100, -- for network printers
  mac_address VARCHAR(17), -- for bluetooth printers
  paper_width INTEGER NOT NULL DEFAULT 80, -- 58, 80, 112 mm
  print_speed INTEGER DEFAULT 100, -- mm/s
  is_primary BOOLEAN NOT NULL DEFAULT false,
  is_secondary BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_print_templates_default ON print_templates(is_default);
CREATE INDEX IF NOT EXISTS idx_print_templates_active ON print_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_printer_configs_primary ON printer_configs(is_primary);
CREATE INDEX IF NOT EXISTS idx_printer_configs_active ON printer_configs(is_active);

-- Insert default print template
INSERT INTO print_templates (name, template_type, paper_width, font_size, show_logo, show_qr, header_text, footer_text, show_tax, show_discount, is_default, is_active)
VALUES ('Mẫu mặc định', 'receipt', 80, 12, true, true, 'HÓA ĐƠN BÁN HÀNG', 'Cảm ơn quý khách đã mua hàng!', true, true, true, true)
ON CONFLICT DO NOTHING;
