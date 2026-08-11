const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
require('dotenv').config();

const db = require('./src/db/connection');
const authRoutes = require('./src/routes/authRoutes');
const usersRoutes = require('./src/routes/usersRoutes');
const friendsRoutes = require('./src/routes/friendsRoutes');
const expenseRoutes = require('./src/routes/expenseRoutes');
const budgetRoutes = require('./src/routes/budgetRoutes');
const libretaRoutes = require('./src/routes/libretaRoutes');
const debtsRoutes = require('./src/routes/debtsRoutes');

const app = express();

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

app.get('/', (req, res) => {
    res.json({ message: 'Expense Tracker API is running' });
});

app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use('/friends', friendsRoutes);
app.use('/expenses', expenseRoutes);
app.use('/budget', budgetRoutes);
app.use('/libreta', libretaRoutes);
app.use('/debts', debtsRoutes);

app.use((req, res) => {
    res.status(404).json({ message: 'Recurso no encontrado' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err.isCorsRejection) {
        return res.status(403).json({ message: 'Origen no permitido' });
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

app.listen(PORT, async () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    await checkConnection();
});