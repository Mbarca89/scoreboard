-- Add logo path columns to match_live_state for team logos on the public scoreboard
ALTER TABLE match_live_state
  ADD COLUMN IF NOT EXISTS left_team_logo_path TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS right_team_logo_path TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS waiting_left_team_logo_path TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS waiting_right_team_logo_path TEXT DEFAULT NULL;
