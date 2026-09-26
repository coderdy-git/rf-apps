-- Migration: Create attendance_status table
-- Run this in Supabase SQL Editor

-- Table untuk status kehadiran (Sakit, Cuti, Izin, dll)
CREATE TABLE IF NOT EXISTS attendance_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    date DATE NOT NULL,
    status_type VARCHAR(20) NOT NULL CHECK (status_type IN ('Sakit', 'Cuti', 'Izin', 'Kerja Dari Rumah')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique constraint untuk mencegah duplikat entry per hari
ALTER TABLE attendance_status
ADD CONSTRAINT unique_user_date_status UNIQUE (user_id, date);

-- Index untuk performa query
CREATE INDEX IF NOT EXISTS idx_attendance_status_user_id ON attendance_status(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status_date ON attendance_status(date);
CREATE INDEX IF NOT EXISTS idx_attendance_status_user_date ON attendance_status(user_id, date);

-- Trigger untuk auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_attendance_status_updated_at
    BEFORE UPDATE ON attendance_status
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE attendance_status ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own attendance status
CREATE POLICY "Users can view own attendance status"
    ON attendance_status FOR SELECT
    USING (auth.uid()::text = user_id::text);

-- Policy: Users can insert their own attendance status
CREATE POLICY "Users can insert own attendance status"
    ON attendance_status FOR INSERT
    WITH CHECK (auth.uid()::text = user_id::text);

-- Policy: Users can update their own attendance status
CREATE POLICY "Users can update own attendance status"
    ON attendance_status FOR UPDATE
    USING (auth.uid()::text = user_id::text);
