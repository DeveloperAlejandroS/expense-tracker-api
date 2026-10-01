const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const db = require('../db/connection');

// Tiempo real por WebSocket. El servidor NO manda datos: manda avisos de
// "algo cambió" ({ type: 'expenses.changed' }) y el cliente vuelve a pedir
// lo que necesita por la API de siempre. Así hay una sola fuente de verdad.
//
// Las conexiones viven en memoria (Map usuario -> sockets): alcanza mientras
// la API corra en una sola instancia. Con varias haría falta un pub/sub.

const AUTH_TIMEOUT_MS = 10000;
const HEARTBEAT_MS = 30000;
const MAX_SOCKETS_PER_USER = 8;

const socketsByUser = new Map();

const addSocket = (userId, ws) => {
    let set = socketsByUser.get(userId);
    if (!set) {
        set = new Set();
        socketsByUser.set(userId, set);
    }
    // Tope por usuario: una pestaña vieja no debe acumular conexiones.
    if (set.size >= MAX_SOCKETS_PER_USER) {
        const oldest = set.values().next().value;
        oldest.close(4000, 'Demasiadas conexiones');
        set.delete(oldest);
    }
    set.add(ws);
};

const removeSocket = (userId, ws) => {
    const set = socketsByUser.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) socketsByUser.delete(userId);
};

// Avisa a una lista de usuarios. Nunca lanza.
const emit = (userIds, type) => {
    const message = JSON.stringify({ type });
    for (const id of new Set(userIds)) {
        const set = socketsByUser.get(Number(id));
        if (!set) continue;
        for (const ws of set) {
            if (ws.readyState === ws.OPEN) {
                try { ws.send(message); } catch { /* socket roto: el heartbeat lo limpia */ }
            }
        }
    }
};

const attach = (server) => {
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

    wss.on('connection', (ws) => {
        ws.isAlive = true;
        ws.userId = null;

        // El token llega en el primer mensaje (no en la URL, para que no
        // quede en logs). Sin autenticarse a tiempo, se cierra.
        const authTimer = setTimeout(() => { if (!ws.userId) ws.close(4001, 'Sin autenticar'); }, AUTH_TIMEOUT_MS);

        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('message', (raw) => {
            if (ws.userId) return; // ya autenticado: el cliente no manda nada más
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type !== 'auth' || typeof msg.token !== 'string') throw new Error('mensaje inválido');
                const decoded = jwt.verify(msg.token, process.env.JWT_SECRET);
                ws.userId = Number(decoded.id);
                addSocket(ws.userId, ws);
                clearTimeout(authTimer);
                ws.send(JSON.stringify({ type: 'ready' }));
            } catch {
                ws.close(4001, 'Token inválido');
            }
        });

        ws.on('close', () => {
            clearTimeout(authTimer);
            if (ws.userId) removeSocket(ws.userId, ws);
        });

        ws.on('error', () => { /* el close hace la limpieza */ });
    });

    // Latido: detecta conexiones muertas (teléfono sin red, pestaña congelada)
    // y mantiene vivos los proxys intermedios.
    const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
            if (!ws.isAlive) { ws.terminate(); continue; }
            ws.isAlive = false;
            try { ws.ping(); } catch { /* se limpia en el próximo ciclo */ }
        }
    }, HEARTBEAT_MS);
    wss.on('close', () => clearInterval(heartbeat));

    return wss;
};

// ---- Señales automáticas ---------------------------------------------------
// Middlewares que se montan ANTES de las rutas. Tras una mutación exitosa
// avisan a todos los involucrados, sin tocar los controladores: cualquier
// endpoint nuevo de /expenses o /friends queda cubierto solo.

const idFromPath = (req) => {
    const match = /^\/(\d+)(?:\/|$)/.exec(req.path);
    return match ? Number(match[1]) : null;
};

const expenseUserIds = async (expenseId) => {
    if (!expenseId) return [];
    const result = await db.query(
        `SELECT paid_by AS id FROM expenses WHERE id = $1
         UNION
         SELECT user_id AS id FROM expense_participants WHERE expense_id = $1`,
        [expenseId]
    );
    return result.rows.map((r) => r.id);
};

const friendshipUserIds = async (friendshipId) => {
    if (!friendshipId) return [];
    const result = await db.query('SELECT user_id_1, user_id_2 FROM friends WHERE id = $1', [friendshipId]);
    const row = result.rows[0];
    return row ? [row.user_id_1, row.user_id_2] : [];
};

const signalOnMutation = ({ type, lookup, fromBody }) => async (req, res, next) => {
    if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') return next();

    // Este middleware corre antes de verifyToken: sin un token válido no se
    // toca la base (si no, cualquiera podría forzar consultas sin sesión).
    try {
        jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), process.env.JWT_SECRET);
    } catch {
        return next();
    }

    const pathId = idFromPath(req);
    // Antes: quiénes están involucrados ahora (al borrar, después ya no se sabe).
    let before = [];
    try { before = await lookup(pathId); } catch { before = []; }

    // Para capturar el id de lo recién creado.
    let responseBody = null;
    const originalJson = res.json.bind(res);
    res.json = (body) => { responseBody = body; return originalJson(body); };

    res.on('finish', () => {
        if (res.statusCode >= 400) return;
        Promise.resolve()
            .then(async () => {
                const createdId = fromBody ? fromBody(responseBody, req) : null;
                const after = await lookup(pathId || createdId).catch(() => []);
                const extra = req.user?.id ? [req.user.id] : [];
                emit([...before, ...after, ...extra], type);
            })
            .catch((err) => console.error('Error emitiendo señal en tiempo real:', err.message));
    });

    return next();
};

const expenseSignals = signalOnMutation({
    type: 'expenses.changed',
    lookup: expenseUserIds,
    fromBody: (body) => Number(body?.expense?.id) || null,
});

const friendSignals = signalOnMutation({
    type: 'friends.changed',
    lookup: friendshipUserIds,
    fromBody: (body) => Number(body?.friendship?.id) || null,
});

module.exports = { attach, emit, expenseSignals, friendSignals };
