-- Mapeo global entre los cuatro controles físicos y sus IDs de radio.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'axl_button_action') THEN
    CREATE TYPE axl_button_action AS ENUM (
      'BASE_LEFT',
      'PIT_LEFT',
      'BASE_RIGHT',
      'PIT_RIGHT'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS button_bindings (
  action      axl_button_action PRIMARY KEY,
  button_id  SMALLINT NOT NULL UNIQUE CHECK (button_id BETWEEN 1 AND 255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO button_bindings (action, button_id)
VALUES
  ('BASE_LEFT', 1),
  ('PIT_LEFT', 2),
  ('BASE_RIGHT', 3),
  ('PIT_RIGHT', 4)
ON CONFLICT (action) DO NOTHING;

DROP TRIGGER IF EXISTS trg_button_bindings_updated_at ON button_bindings;
CREATE TRIGGER trg_button_bindings_updated_at
BEFORE UPDATE ON button_bindings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
