// One-off runner: node scripts/run-migration.js migrations/001_expense_participant_status.sql
const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');

const run = async () => {
    const file = process.argv[2];
    if (!file) {
        console.error('Uso: node scripts/run-migration.js <archivo.sql>');
        process.exit(1);
    }

    const sql = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    console.log(`Ejecutando ${file}...`);

    try {
        await db.query(sql);
        console.log('✅ Migración aplicada correctamente');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error aplicando migración:', err.message);
        process.exit(1);
    }
};

run();
