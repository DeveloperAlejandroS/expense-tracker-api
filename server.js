const cors = require('cors');
const express = require('express');
require('dotenv').config();

const db = require('./src/db/connection');
const authRoutes = require('./src/routes/authRoutes');
const expenseRoutes = require('./src/routes/expenseRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ message: 'Expense Tracker API is running' });
});

app.use('/auth', authRoutes);
app.use('/expenses', expenseRoutes);

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