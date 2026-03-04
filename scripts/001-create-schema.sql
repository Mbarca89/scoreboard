-- 001-create-schema.sql
-- PostgreSQL schema para fixture "split deck" (1 deck / 1 cancha)

BEGIN;

-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'axl_category') THEN
    CREATE TYPE axl_category AS ENUM ('5v5 D3/D4', '3v3 D4/D5', '3v3 D6');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'axl_event_stage') THEN
    CREATE TYPE axl_event_stage AS ENUM ('GROUP', 'BRACKET', 'QUARTER', 'SEMI', 'FINAL');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'axl_slot') THEN
    CREATE TYPE axl_slot AS ENUM ('A', 'B');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'axl_block_status') THEN
    CREATE TYPE axl_block_status AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'DONE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'axl_match_result') THEN
    CREATE TYPE axl_match_result AS ENUM ('LEFT_WIN', 'RIGHT_WIN', 'DRAW');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'axl_overtime_type') THEN
    CREATE TYPE axl_overtime_type AS ENUM ('POINT', '1V1');
  END IF;
END$$;

-- Tabla: fixture_blocks
CREATE TABLE IF NOT EXISTS fixture_blocks (
  event_id           TEXT NOT NULL,
  block_id           TEXT NOT NULL,
  block_order        INT  NOT NULL,
  category           axl_category NOT NULL,
  stage              axl_event_stage NOT NULL DEFAULT 'GROUP',
  group_id           TEXT NULL,
  round_number       INT  NULL,
  scheduled_at       TIMESTAMPTZ NULL,
  active_slot        axl_slot NOT NULL DEFAULT 'A',
  status             axl_block_status NOT NULL DEFAULT 'SCHEDULED',
  notes              TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fixture_blocks_pk PRIMARY KEY (event_id, block_id),
  CONSTRAINT fixture_blocks_order_unique UNIQUE (event_id, block_order)
);

CREATE INDEX IF NOT EXISTS idx_fixture_blocks_event
  ON fixture_blocks (event_id);

-- Tabla: matches
CREATE TABLE IF NOT EXISTS matches (
  event_id              TEXT NOT NULL,
  match_id              TEXT NOT NULL,
  block_id              TEXT NOT NULL,
  slot                  axl_slot NOT NULL,
  category              axl_category NOT NULL,
  stage                 axl_event_stage NOT NULL DEFAULT 'GROUP',
  group_id              TEXT NULL,
  round_number          INT  NULL,
  scheduled_at          TIMESTAMPTZ NULL,
  display_label         TEXT NULL,
  left_team_id          TEXT NOT NULL,
  left_team_name        TEXT NOT NULL,
  left_team_logo_path   TEXT NULL,
  right_team_id         TEXT NOT NULL,
  right_team_name       TEXT NOT NULL,
  right_team_logo_path  TEXT NULL,
  left_score            INT NOT NULL DEFAULT 0,
  right_score           INT NOT NULL DEFAULT 0,
  time_remaining_sec    INT NOT NULL DEFAULT 0,
  notes                 TEXT NULL,
  is_finished           BOOLEAN NOT NULL DEFAULT FALSE,
  result_type           axl_match_result NULL,
  winner_team_id        TEXT NULL,
  is_overtime           BOOLEAN NOT NULL DEFAULT FALSE,
  overtime_type         axl_overtime_type NULL,
  overtime_winner_team_id TEXT NULL,
  reported_by_user_id   TEXT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at           TIMESTAMPTZ NULL,
  CONSTRAINT matches_pk PRIMARY KEY (event_id, match_id),
  CONSTRAINT matches_block_fk
    FOREIGN KEY (event_id, block_id)
    REFERENCES fixture_blocks (event_id, block_id)
    ON DELETE CASCADE,
  CONSTRAINT matches_block_slot_unique UNIQUE (event_id, block_id, slot),
  CONSTRAINT matches_time_remaining_nonneg CHECK (time_remaining_sec >= 0),
  CONSTRAINT matches_scores_nonneg CHECK (left_score >= 0 AND right_score >= 0),
  CONSTRAINT matches_winner_consistency CHECK (
    winner_team_id IS NULL
    OR winner_team_id = left_team_id
    OR winner_team_id = right_team_id
  )
);

CREATE INDEX IF NOT EXISTS idx_matches_event ON matches (event_id);
CREATE INDEX IF NOT EXISTS idx_matches_event_block ON matches (event_id, block_id);
CREATE INDEX IF NOT EXISTS idx_matches_event_category ON matches (event_id, category);
CREATE INDEX IF NOT EXISTS idx_matches_finished ON matches (event_id, is_finished);

-- Tabla: event_runtime_state
CREATE TABLE IF NOT EXISTS event_runtime_state (
  event_id         TEXT PRIMARY KEY,
  current_block_id TEXT NULL,
  active_slot      axl_slot NOT NULL DEFAULT 'A',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  operator_user_id TEXT NULL,
  CONSTRAINT runtime_block_fk
    FOREIGN KEY (event_id, current_block_id)
    REFERENCES fixture_blocks (event_id, block_id)
    ON DELETE SET NULL
);

-- Triggers para updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fixture_blocks_updated_at ON fixture_blocks;
CREATE TRIGGER trg_fixture_blocks_updated_at
BEFORE UPDATE ON fixture_blocks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_matches_updated_at ON matches;
CREATE TRIGGER trg_matches_updated_at
BEFORE UPDATE ON matches
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
