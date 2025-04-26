-- Add updated_at column to tasker_profiles table
ALTER TABLE tasker_profiles 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Update existing rows to have updated_at equal to created_at
UPDATE tasker_profiles 
SET updated_at = created_at 
WHERE updated_at IS NULL; 