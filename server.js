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

app.use(helmet());
app.use(cors());
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