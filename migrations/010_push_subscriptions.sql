-- Suscripciones Web Push: una fila por navegador/dispositivo donde la persona
-- activó las notificaciones. El endpoint es único (lo emite el servicio push
-- del navegador); si el mismo dispositivo cambia de cuenta, la fila pasa al
-- nuevo usuario.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
