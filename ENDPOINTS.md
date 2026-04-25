# Expense Tracker API - Endpoints

## Base URL
`http://localhost:3000`

## Header para rutas protegidas
`Authorization: Bearer <JWT>`

## 1) Auth

### POST /auth/register
Registra un usuario.

Body minimo:
```json
{
  "email": "user1@test.com",
  "password": "123456"
}
```

Body extendido opcional:
```json
{
  "email": "user1@test.com",
  "password": "123456",
  "username": "user1",
  "first_name": "Alejandro",
  "middle_name": "",
  "last_name": "Sanchez",
  "second_last_name": "Lopez",
  "birth_date": "1995-01-15",
  "phone": "+573001112233"
}
```

### POST /auth/login
Inicia sesion y devuelve JWT.

Body:
```json
{
  "email": "user1@test.com",
  "password": "123456"
}
```

### GET /auth/me
Valida el token y devuelve el payload decodificado.

## 2) Users

### GET /users/me
Perfil completo del usuario autenticado.

### PATCH /users/me
Actualizacion parcial del perfil.

Body ejemplo:
```json
{
  "username": "alejandro",
  "first_name": "Alejandro",
  "middle_name": "Luis",
  "last_name": "Sanchez",
  "second_last_name": "Lopez",
  "birth_date": "1995-01-15",
  "phone": "+573001112233"
}
```

### GET /users/search?q=texto
Busca usuarios activos por email, username, nombres o telefono.

Reglas:
- Prioriza amigos `accepted`.
- Luego relaciones `pending`.
- Luego usuarios sin relacion.

Query params opcionales:
- `onlyFriends=true` para devolver solo amigos aceptados.

Respuesta ejemplo:
```json
{
  "users": [
    {
      "id": 2,
      "email": "user2@test.com",
      "username": "user2",
      "first_name": "Maria",
      "middle_name": null,
      "last_name": "Perez",
      "second_last_name": null,
      "phone": "+573001112234",
      "is_active": true,
      "friendship_status": "accepted",
      "is_friend_accepted": true
    }
  ]
}
```

## 3) Friends

### POST /friends/request
Envia solicitud de amistad.

Body:
```json
{
  "user_id": 2
}
```

### GET /friends
Lista amigos con estado `accepted`.

### GET /friends/requests
Lista relaciones con estado `pending` asociadas al usuario.

### PATCH /friends/:id/accept
Acepta una solicitud.

### PATCH /friends/:id/block
Bloquea la relacion.

### DELETE /friends/:id
Elimina la relacion.

## 4) Expenses

### GET /expenses/contacts/suggestions
Sugerencias de contactos para crear gasto.

Reglas:
- Solo amigos `accepted`.
- Solo usuarios activos.

Respuesta ejemplo:
```json
{
  "suggestions": [
    {
      "id": 2,
      "email": "user2@test.com",
      "username": "user2",
      "first_name": "Maria",
      "middle_name": null,
      "last_name": "Perez",
      "second_last_name": null,
      "phone": "+573001112234",
      "friendship_since": "2026-04-24T12:00:00.000Z"
    }
  ]
}
```

### POST /expenses
Crea gasto y divide en partes iguales.

Reglas:
- Dueño (`paid_by`) inicia con `is_paid = true`.
- Demas participantes inician con `is_paid = false`.
- Participantes deben ser amigos `accepted` del creador.

Body:
```json
{
  "amount": 120000,
  "description": "Cena equipo",
  "participants": [2, 3]
}
```

### GET /expenses
Lista gastos donde el usuario paga o participa.

Incluye:
- pagador
- participantes
- `my_share_amount`
- `is_paid` por participante

### GET /expenses/balance
Devuelve balance del usuario autenticado.

Regla:
- Ignora deudas ya pagadas (`is_paid = true`).

Respuesta ejemplo:
```json
{
  "owed_to_me": 80000,
  "i_owe": 40000,
  "net_balance": 40000
}
```

### PATCH /expenses/settle
Liquida deuda de un participante en un gasto.

Body:
```json
{
  "expense_id": 10,
  "user_id": 2
}
```

Reglas:
- Solo puede liquidar quien creo el gasto (`paid_by`).
- `user_id` debe ser el deudor.

## Errores comunes

### 400
```json
{
  "message": "Email y password son requeridos"
}
```

En gastos:
```json
{
  "message": "Solo puedes agregar amigos aceptados como participantes",
  "invalid_participants": [7, 9]
}
```

### 401
```json
{
  "message": "Token no proporcionado"
}
```

### 403
```json
{
  "message": "No tienes permiso para liquidar este gasto"
}
```

### 404
```json
{
  "message": "Gasto no encontrado"
}
```

### 409
```json
{
  "message": "El email ya está registrado"
}
```

### 500
```json
{
  "message": "Error interno del servidor"
}
```

## Flujo recomendado de prueba
1. `POST /auth/register`
2. `POST /auth/login`
3. Guardar token
4. `GET /users/me`
5. `GET /users/search?q=...`
6. `POST /friends/request`
7. `PATCH /friends/:id/accept`
8. `GET /expenses/contacts/suggestions`
9. `POST /expenses`
10. `GET /expenses`
11. `GET /expenses/balance`
12. `PATCH /expenses/settle`

## Notas
- Proyecto en JavaScript puro con CommonJS.
- `JWT_SECRET` debe estar en `.env`.
- `expense_participants` requiere `is_paid BOOLEAN NOT NULL DEFAULT false`.
