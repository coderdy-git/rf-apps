-- RLS policies for the existing `attendances` table.
-- Run this in Supabase SQL Editor.
-- Assumes Supabase Auth (Google) is the source of auth.uid().

ALTER TABLE attendances ENABLE ROW LEVEL SECURITY;

-- Drop old policies if re-running
DROP POLICY IF EXISTS "Users can view own attendance" ON attendances;
DROP POLICY IF EXISTS "Users can insert own attendance" ON attendances;
DROP POLICY IF EXISTS "Users can update own attendance" ON attendances;

-- Users may only read their own rows
CREATE POLICY "Users can view own attendance"
    ON attendances FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Users may only insert rows for themselves
CREATE POLICY "Users can insert own attendance"
    ON attendances FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Users may only update their own rows
CREATE POLICY "Users can update own attendance"
    ON attendances FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
