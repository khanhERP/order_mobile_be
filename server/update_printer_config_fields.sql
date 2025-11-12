
-- Update printer config fields: change primary/secondary to employee/kitchen and add isActive
ALTER TABLE printer_configs 
ADD COLUMN IF NOT EXISTS is_employee BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS is_kitchen BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Migrate existing data: primary -> employee, secondary -> kitchen
UPDATE printer_configs SET is_employee = is_primary WHERE is_primary = true;
UPDATE printer_configs SET is_kitchen = is_secondary WHERE is_secondary = true;

-- Drop old columns
ALTER TABLE printer_configs DROP COLUMN IF EXISTS is_primary;
ALTER TABLE printer_configs DROP COLUMN IF EXISTS is_secondary;
