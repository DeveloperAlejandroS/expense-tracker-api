# Expense Tracker API

API REST para gestionar gastos compartidos estilo Splitwise.

Estado actual:
- Autenticacion completa con JWT.
- Creacion y listado de gastos compartidos.
- Balance personal (cuanto me deben y cuanto debo).
- Liquidacion de deudas por gasto.

## Stack

- Node.js
- Express.js
- PostgreSQL (Supabase)
- pg
- bcrypt
- jsonwebtoken
- dotenv
- cors

## Estructura del proyecto

expense-tracker-api/
- server.js
- package.json
- .env.example
- ENDPOINTS.md
- src/
  - controllers/
    - authController.js
    - expenseController.js
  - routes/
    - authRoutes.js
    - expenseRoutes.js
  - middleware/
    - verifyToken.js
  - db/
    - connection.js

## Requisitos

- Node.js 18+
- PostgreSQL accesible (Supabase recomendado)

## Variables de entorno

Usa como base el archivo .env.example.

Variables requeridas:
- PORT
- DB_HOST
- DB_NAME
- DB_USER
- DB_PASSWORD
- DB_PORT
- JWT_SECRET

## Instalacion y ejecucion

1. Instalar dependencias:

npm install

2. Crear archivo .env con tus credenciales.

3. Ejecutar en desarrollo:

npm run dev

4. Ejecutar en modo normal:

npm start

Servidor por defecto:
- http://localhost:3000

## Modelo de base de datos esperado

Tabla users:
- id (PK)
- email (UNIQUE)
- password

Tabla expenses:
- id (PK)
- amount
- description
- paid_by (FK -> users.id)
- created_at

Tabla expense_participants:
- id (PK)
- expense_id (FK -> expenses.id)
- user_id (FK -> users.id)
- amount_owed
- is_paid (BOOLEAN, default false)

SQL recomendado para columna de liquidacion:

ALTER TABLE expense_participants
ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT false;

## Logica de negocio implementada

Autenticacion:
- POST /auth/register
- POST /auth/login
- GET /auth/me

Gastos (todas protegidas con JWT):
- POST /expenses
  - Crea gasto en transaccion SQL (BEGIN/COMMIT/ROLLBACK).
  - Divide equitativamente entre creador y participantes.
- GET /expenses
  - Lista gastos donde el usuario pago o participa.
  - Incluye salida enriquecida con pagador y participantes.
- GET /expenses/balance
  - owed_to_me: suma de deudas pendientes que otros tienen conmigo.
  - i_owe: suma de deudas pendientes que yo tengo con otros.
  - net_balance = owed_to_me - i_owe.
  - Ignora registros con is_paid = true.
- PATCH /expenses/settle
  - Marca una deuda puntual como pagada (is_paid = true).
  - Solo puede hacerlo el usuario que pago originalmente el gasto.

## Seguridad

- Passwords con hashing bcrypt.
- JWT firmado con JWT_SECRET.
- Middleware verifyToken en rutas protegidas.

Header requerido para rutas protegidas:
Authorization: Bearer TU_TOKEN

## Pruebas con Postman

Flujo recomendado:
1. Registrar usuario (POST /auth/register)
2. Login (POST /auth/login)
3. Guardar token
4. Crear gasto (POST /expenses)
5. Listar gastos (GET /expenses)
6. Consultar balance (GET /expenses/balance)
7. Liquidar deuda (PATCH /expenses/settle)

Para ejemplos de payload y respuestas, revisa ENDPOINTS.md.

## Errores comunes

- 401 Token no proporcionado o invalido.
- 403 Intento de liquidar un gasto sin ser paid_by.
- 404 Gasto o deuda no encontrada.
- 500 Error interno del servidor.

## Notas

- Proyecto en JavaScript puro (CommonJS).
- No incluye frontend.
