const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const db = require('./src/db/connection');
const authRoutes = require('./src/routes/authRoutes');
const usersRoutes = require('./src/routes/usersRoutes');
const friendsRoutes = require('./src/routes/friendsRoutes');
const expenseRoutes = require('./src/routes/expenseRoutes');
const budgetRoutes = require('./src/routes/budgetRoutes');
const libretaRoutes = require('./src/routes/libretaRoutes');
const debtsRoutes = require('./src/routes/debtsRoutes');
const pushRoutes = require('./src/routes/pushRoutes');
const realtime = require('./src/services/realtimeService');

const app = express();

// Render pone un proxy delante: sin esto todos los usuarios comparten la IP
// del proxy y, con ella, el mismo cupo de intentos de login.
app.set('trust proxy', 1);

// `cors()` sin opciones refleja cualquier origen. El JWT va en el header
// Authorization (no en cookie), así que esto no abre un CSRF clásico -- pero
// no hay razón para no restringirlo. `ALLOWED_ORIGINS` es una lista separada
// por comas (ver .env.example); si no está seteada, se cae a permitir todo
// (como antes) para no romper despliegues existentes que todavía no la
// configuraron, pero deja un aviso en el log.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

if (allowedOrigins.length === 0) {
    console.warn('⚠️  ALLOWED_ORIGINS no está configurada -- CORS acepta cualquier origen. Configúrala en producción.');
}

const corsOptions = allowedOrigins.length > 0
    ? {
        origin: (origin, callback) => {
            // Sin `origin` = same-origin, curl, apps móviles -- siempre se deja pasar.
            if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
            const err = new Error('Origen no permitido por CORS');
            err.isCorsRejection = true;
            return callback(err);
        },
    }
    : {};

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '100kb' }));

// Freno general por IP: nadie legítimo hace 600 peticiones en 5 minutos.
app.use(rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Demasiadas peticiones, intenta de nuevo en unos minutos' },
}));

// Tope de texto: un nombre o una descripción no necesitan 50.000 caracteres.
// La foto y la suscripción push tienen su propia validación.
const LONG_FIELDS = new Set(['avatar_url', 'endpoint', 'p256dh', 'auth']);
const MAX_TEXT = 300;
const hasLongText = (value, key) => {
    if (typeof value === 'string') return !LONG_FIELDS.has(key) && value.length > MAX_TEXT;
    if (value && typeof value === 'object') return Object.entries(value).some(([k, v]) => hasLongText(v, k));
    return false;
};
app.use((req, res, next) => {
    if (hasLongText(req.body)) return res.status(400).json({ message: `Texto demasiado largo (máximo ${MAX_TEXT} caracteres)` });
    return next();
});

app.get('/', (req, res) => {
    res.json({ message: 'Expense Tracker API is running' });
});

app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use('/friends', realtime.friendSignals, friendsRoutes);
app.use('/expenses', realtime.expenseSignals, expenseRoutes);
app.use('/budget', budgetRoutes);
app.use('/libreta', libretaRoutes);
app.use('/debts', debtsRoutes);
app.use('/push', pushRoutes);

app.use((req, res) => {
    res.status(404).json({ message: 'Recurso no encontrado' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err.isCorsRejection) {
        return res.status(403).json({ message: 'Origen no permitido' });
    }
    // JSON mal formado o cuerpo demasiado grande: es un error del cliente, no del servidor.
    if (err.status >= 400 && err.status < 500) {
        return res.status(err.status).json({ message: 'Petición inválida' });
    }
    console.error('Error no manejado:', err);
    res.status(500).json({ message: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3000;

const checkConnection = async () => {
    try {
        const res = await db.query('SELECT NOW()');
        console.log('✅ Conexión a Postgres exitosa:', res.rows[0].now);
    } catch (err) {
        console.error('❌ Error conectando a la DB:', err.stack);
    }
};

const server = app.listen(PORT, async () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    await checkConnection();
});

// Tiempo real: WebSocket en /ws sobre el mismo servidor HTTP.
realtime.attach(server);
