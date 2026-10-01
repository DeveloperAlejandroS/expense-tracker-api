const webpush = require('web-push');
const db = require('../db/connection');

// Notificaciones Web Push. Si faltan las llaves VAPID el servicio queda
// apagado y todo lo demás sigue funcionando: una notificación nunca debe
// tumbar ni demorar la operación que la disparó.
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
const enabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (enabled) {
    webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:soporte@splitit.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
    console.warn('⚠️  VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY no configuradas -- las notificaciones push están apagadas.');
}

const displayNameOf = async (userId) => {
    const result = await db.query('SELECT first_name, last_name, username FROM users WHERE id = $1', [userId]);
    const u = result.rows[0];
    if (!u) return 'Alguien';
    return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Alguien';
};

const formatMoney = (amount) => `$ ${Math.round(Number(amount) || 0).toLocaleString('es-CO')}`;

// payload: { title, body, url, tag }. No lanza: registra el error y sigue.
const notifyUser = async (userId, payload) => {
    if (!enabled) return;
    try {
        const subs = await db.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
        await Promise.all(subs.rows.map(async (s) => {
            try {
                await webpush.sendNotification(
                    { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                    JSON.stringify(payload),
                    { TTL: 60 * 60 * 24 }
                );
            } catch (err) {
                // 404/410: el navegador dio de baja la suscripción.
                if (err.statusCode === 404 || err.statusCode === 410) {
                    await db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
                } else {
                    console.error('Error enviando push:', err.statusCode || err.message);
                }
            }
        }));
    } catch (err) {
        console.error('Error en notifyUser:', err.message);
    }
};

// Dispara sin esperar: la respuesta HTTP no depende del servicio push.
const notifyLater = (userId, buildPayload) => {
    if (!enabled) return;
    Promise.resolve()
        .then(buildPayload)
        .then((payload) => notifyUser(userId, payload))
        .catch((err) => console.error('Error preparando push:', err.message));
};

module.exports = { enabled, publicKey: VAPID_PUBLIC_KEY || null, notifyUser, notifyLater, displayNameOf, formatMoney };
