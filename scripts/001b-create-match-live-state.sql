BEGIN;

-- Tabla que usa tu route handler /api/... (ON CONFLICT (event_id))
CREATE TABLE IF NOT EXISTS match_live_state (
  event_id TEXT PRIMARY KEY,

  active_match_id TEXT NULL,
  active_slot axl_slot NOT NULL DEFAULT 'A',

  break_timer_sec INT NOT NULL DEFAULT 60,
  game_timer_sec  INT NOT NULL DEFAULT 0,

  -- Si querés más estricto podés hacerlo ENUM después,
  -- pero por ahora TEXT es lo más simple.
  timer_mode    TEXT NOT NULL DEFAULT 'IDLE',
  timer_running BOOLEAN NOT NULL DEFAULT FALSE,

  left_score  INT NOT NULL DEFAULT 0,
  right_score INT NOT NULL DEFAULT 0,

  left_team_name  TEXT NOT NULL DEFAULT '',
  right_team_name TEXT NOT NULL DEFAULT '',

  -- Logos (esto cubre lo que tu 002 agrega, así que incluso podrías NO correr el 002)
  left_team_logo_path  TEXT NULL,
  right_team_logo_path TEXT NULL,

  waiting_match_id TEXT NULL,
  waiting_left_score  INT NOT NULL DEFAULT 0,
  waiting_right_score INT NOT NULL DEFAULT 0,
  waiting_left_team_name  TEXT NOT NULL DEFAULT '',
  waiting_right_team_name TEXT NOT NULL DEFAULT '',
  waiting_left_team_logo_path  TEXT NULL,
  waiting_right_team_logo_path TEXT NULL,

  category TEXT NOT NULL DEFAULT '',

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger updated_at (ya existe la función set_updated_at() en tu 001)
DROP TRIGGER IF EXISTS trg_match_live_state_updated_at ON match_live_state;
CREATE TRIGGER trg_match_live_state_updated_at
BEFORE UPDATE ON match_live_state
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;