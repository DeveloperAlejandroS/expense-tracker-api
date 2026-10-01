const express = require('express');
const verifyToken = require('../middleware/verifyToken');
const db = require('../db/connection');
const push = require('../services/pushService');

const router = express.Router();

router.use(verifyToken);

// La llave pública que el navegador necesita para suscribirse. `enabled`
// le dice al front si vale la pena ofrecer la opción.
router.get('/config', (req, res) => {
    res.status(200).json({ enabled: push.enabled, public_key: push.publicKey });
});

router.post('/subscribe', async (req, res) => {
    try {
        const { endpoint, keys } = req.body || {};
        const isHttps = typeof endpoint === 'string' && endpoint.startsWith('https://') && endpoint.length < 2000;
        if (!isHttps || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
            return res.status(400).json({ message: 'Suscripción inválida' });
        }

        await db.query(
            `
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
            `,
            [req.user.id, endpoint, keys.p256dh, keys.auth]
        );

        return res.status(201).json({ message: 'Notificaciones activadas' });
    } catch (error) {
        console.error('Error en push subscribe:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
});

router.post('/unsubscribe', async (req, res) => {
    try {
        const { endpoint } = req.body || {};
        if (typeof endpoint !== 'string') {
            return res.status(400).json({ message: 'Falta el endpoint' });
        }
        await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.id]);
        return res.status(200).json({ message: 'Notificaciones desactivadas' });
    } catch (error) {
        console.error('Error en push unsubscribe:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
});

// Para probar desde Ajustes que el dispositivo sí recibe.
router.post('/test', async (req, res) => {
    await push.notifyUser(req.user.id, { title: 'Split.it', body: 'Las notificaciones están funcionando.', url: '/#home', tag: 'test' });
    return res.status(200).json({ message: 'Notificación de prueba enviada' });
});

module.exports = router;
