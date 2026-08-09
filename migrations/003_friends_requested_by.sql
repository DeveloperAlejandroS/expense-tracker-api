-- friends no guardaba quién inició la solicitud (user_id_1/user_id_2 se
-- ordenan por MIN/MAX, no por quién la envió), lo que impedía distinguir
-- "solicitudes enviadas" de "recibidas" y permitía que el propio solicitante
-- aceptara su propia solicitud pegándole directo al endpoint.
--
-- Backfill: para filas existentes no hay forma de recuperar quién la envió
-- de verdad, así que se asume user_id_1 (el id menor) como aproximación
-- razonable — no afecta relaciones ya aceptadas, solo las pendientes.

ALTER TABLE friends
  ADD COLUMN IF NOT EXISTS requested_by INTEGER REFERENCES users(id);

UPDATE friends SET requested_by = user_id_1 WHERE requested_by IS NULL;

ALTER TABLE friends ALTER COLUMN requested_by SET NOT NULL;
