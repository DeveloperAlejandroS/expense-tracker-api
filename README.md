# Expense Tracker API

API REST para gestionar gastos compartidos estilo Splitwise.

Estado actual:
- Autenticacion y perfil de usuario con JWT.
- Modulo de amigos (pending / accepted / blocked).
- Creacion/listado de gastos compartidos.
- Balance personal y liquidacion de deudas.
- Sugerencias de contactos para gastos basadas en amigos aceptados.

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
    - usersController.js
    - friendsController.js
    - expenseController.js
  - routes/
    - authRoutes.js
    - usersRoutes.js
    - friendsRoutes.js
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

## Logica de negocio implementada

Autenticacion:
- POST /auth/register
- POST /auth/login
- GET /auth/me

Usuarios:
- GET /users/me
- PATCH /users/me
- GET /users/search

Friends:
- POST /friends/request
- GET /friends
- GET /friends/requests
- PATCH /friends/:id/accept
- PATCH /friends/:id/block
- DELETE /friends/:id

Gastos (todas protegidas con JWT):
- POST /expenses
  - Crea gasto en transaccion SQL (BEGIN/COMMIT/ROLLBACK).
  - Divide equitativamente entre creador y participantes.
  - Solo permite participantes que sean amigos aceptados del creador.
- GET /expenses/contacts/suggestions
  - Devuelve contactos sugeridos para crear gastos (amigos aceptados).
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
Authorization: Bearer TU_TOKEN (No, no es el real por si acaso listillo)

## Pruebas con Postman

Flujo recomendado:
1. Registrar usuario (POST /auth/register)
2. Login (POST /auth/login)
3. Guardar token
4. Buscar usuarios (GET /users/search)
5. Enviar solicitud de amistad (POST /friends/request)
6. Aceptar solicitud (PATCH /friends/:id/accept)
7. Ver sugerencias para gasto (GET /expenses/contacts/suggestions)
8. Crear gasto (POST /expenses)
9. Listar gastos (GET /expenses)
10. Consultar balance (GET /expenses/balance)
11. Liquidar deuda (PATCH /expenses/settle)

Para ejemplos de payload y respuestas, revisa ENDPOINTS.md.

## Errores comunes

- 401 Token no proporcionado o invalido.
- 403 Intento de liquidar un gasto sin ser paid_by.
- 400 Participantes no validos (no son amigos aceptados).
- 404 Gasto o deuda no encontrada.
- 500 Error interno del servidor.

## Notas

- Proyecto en JavaScript puro (CommonJS).