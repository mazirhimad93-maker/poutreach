/*
  # Fix campaign goal column type

  1. Changes
    - Change `goal` column in `campaigns` table from `integer` to `text`
    - This aligns the database schema with the application's usage of the field as a descriptive text area

  2. Notes
    - The application treats the goal field as a text description, not a numeric value
    - This migration will convert any existing integer values to text format
*/

-- Change the goal column from integer to text
ALTER TABLE campaigns 
ALTER COLUMN goal TYPE text USING goal::text;