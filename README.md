# Expense Tracker API

API REST para gestionar gastos compartidos estilo Splitwise.

## Estado actual

- Autenticación y perfil de usuario con JWT.
- Módulo de amigos con estados pending, accepted y blocked.
- Creación y listado de gastos compartidos.
- Balance personal y liquidación de deudas.
- Sugerencias de contactos basadas en amigos aceptados.

## Stack

- Node.js
- Express.js
- PostgreSQL
- pg
- bcrypt
- jsonwebtoken
- dotenv
- cors

## Estructura del proyecto

expense-tracker-api/
- server.js
- package.json
- ENDPOINTS.md
- README.md
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

- Node.js 18 o superior
- PostgreSQL accesible

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

## Instalación y ejecución

1. Instalar dependencias:

```bash
npm install
```

2. Crear un archivo .env con tus credenciales.

3. Ejecutar en desarrollo:

```bash
npm run dev
```

4. Ejecutar en modo normal:

```bash
npm start
```

Servidor por defecto:
- `http://localhost:3000`

## Autenticación

Las rutas protegidas usan este header:

```http
Authorization: Bearer <JWT>
```

## Endpoints principales

### Público

- `GET /` estado básico del servicio.
- `POST /auth/register` registro de usuario.
- `POST /auth/login` inicio de sesión.

### Usuario autenticado

- `GET /auth/me` valida el token y devuelve el payload.
- `GET /users/me` obtiene el perfil completo.
- `PATCH /users/me` actualiza el perfil parcial.
- `GET /users/search?q=texto&onlyFriends=true|false` busca usuarios activos.

### Amigos

- `POST /friends/request` envía una solicitud. Recibe `user_id` del usuario destino.
- `GET /friends` lista amigos aceptados.
- `GET /friends/requests` lista solicitudes pendientes.
- `PATCH /friends/:id/accept` acepta la solicitud. Recibe `:id` de `friends.id`.
- `PATCH /friends/:id/block` bloquea la relación. Recibe `:id` de `friends.id`.
- `DELETE /friends/:id` elimina la relación. Recibe `:id` de `friends.id`.

### Gastos

- `GET /expenses/contacts/suggestions` sugiere contactos para gastos.
- `POST /expenses` crea un gasto. Recibe `amount`, `description` y `participants` como array de ids de usuario.
- `GET /expenses` lista gastos donde participa o paga el usuario.
- `GET /expenses/balance` devuelve el balance acumulado.
- `PATCH /expenses/settle` liquida una deuda. Recibe `expense_id` y `user_id` del deudor.

## Formato de datos

Los detalles completos de cada body, query param, respuesta y tipo de id que recibe cada endpoint están documentados en [ENDPOINTS.md](ENDPOINTS.md).

## Flujo recomendado en Postman

1. Registrar usuario con `POST /auth/register`.
2. Iniciar sesión con `POST /auth/login`.
3. Guardar el token devuelto.
4. Buscar usuarios con `GET /users/search`.
5. Enviar solicitud con `POST /friends/request`.
6. Aceptar la solicitud con `PATCH /friends/:id/accept` usando el id de la relación.
7. Ver sugerencias de gasto con `GET /expenses/contacts/suggestions`.
8. Crear gasto con `POST /expenses`.
9. Listar gastos con `GET /expenses`.
10. Consultar balance con `GET /expenses/balance`.
11. Liquidar deuda con `PATCH /expenses/settle`.

## Seguridad y reglas de negocio

- Passwords con hashing bcrypt.
- JWT firmado con `JWT_SECRET`.
- Los participantes de gastos deben ser amigos aceptados y activos.
- La aceptación, bloqueo y eliminación de amistad trabajan sobre el id de la relación, no sobre el id del usuario.
- En liquidación de deudas, `expense_id` identifica el gasto y `user_id` identifica al deudor.

## Errores comunes

- `401` token no proporcionado o inválido.
- `403` intento de modificar una relación o gasto sin permiso.
- `400` parámetros inválidos o participantes no válidos.
- `404` recurso no encontrado.
- `409` conflicto por duplicados o estados ya procesados.
- `500` error interno del servidor.

## Notas

- Proyecto en JavaScript puro con CommonJS.