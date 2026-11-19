-- Permite los IDs de control RF enviados por node-serial-listener/Server2.js.
-- Conserva los emparejamientos existentes.
BEGIN;

ALTER TABLE public.button_bindings
  DROP CONSTRAINT IF EXISTS button_bindings_button_id_check;

ALTER TABLE public.button_bindings
  ALTER COLUMN button_id TYPE BIGINT;

ALTER TABLE public.button_bindings
  ADD CONSTRAINT button_bindings_button_id_check CHECK (button_id > 0);

COMMIT;
