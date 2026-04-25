# Expense Tracker API - Endpoints

## Base URL
`http://localhost:3000`

## Convenciones generales

- Las rutas protegidas requieren el header `Authorization: Bearer <JWT>`.
- Cuando un endpoint recibe un `:id`, siempre es el `id` del recurso indicado en la ruta, no el id del usuario autenticado.
- Salvo indicación contraria, todos los bodies se envían como JSON.

## 1) Root

### GET /
Estado básico del servicio.

Respuesta:
```json
{
  "message": "Expense Tracker API is running"
}
```

## 2) Auth

### POST /auth/register
Registra un usuario nuevo.

Body requerido:
```json
{
  "email": "user1@test.com",
  "password": "123456"
}
```

Body opcional completo:
```json
{
  "email": "user1@test.com",
  "password": "123456",
  "username": "user1",
  "first_name": "Alejandro",
  "middle_name": "Luis",
  "last_name": "Sanchez",
  "second_last_name": "Lopez",
  "birth_date": "1995-01-15",
  "phone": "+573001112233"
}
```

Campos:
- `email`: string obligatorio.
- `password`: string obligatorio.
- `username`: string opcional.
- `first_name`, `middle_name`, `last_name`, `second_last_name`, `birth_date`, `phone`: opcionales.

Respuesta `201`:
```json
{
  "message": "Usuario registrado correctamente",
  "user": {
    "id": 1,
    "email": "user1@test.com",
    "username": "user1",
    "first_name": "Alejandro",
    "middle_name": "Luis",
    "last_name": "Sanchez",
    "second_last_name": "Lopez",
    "birth_date": "1995-01-15",
    "phone": "+573001112233",
    "is_active": true,
    "created_at": "2026-04-24T12:00:00.000Z",
    "updated_at": "2026-04-24T12:00:00.000Z"
  }
}
```

### POST /auth/login
Inicia sesión y devuelve JWT.

Body:
```json
{
  "email": "user1@test.com",
  "password": "123456"
}
```

Campos:
- `email`: string obligatorio.
- `password`: string obligatorio.

Respuesta `200`:
```json
{
  "message": "Login exitoso",
  "token": "<jwt>",
  "user": {
    "id": 1,
    "email": "user1@test.com",
    "username": "user1",
    "first_name": "Alejandro",
    "middle_name": "Luis",
    "last_name": "Sanchez",
    "second_last_name": "Lopez",
    "birth_date": "1995-01-15",
    "phone": "+573001112233",
    "is_active": true
  }
}
```

### GET /auth/me
Valida el token y devuelve el payload decodificado.

Header requerido:
- `Authorization: Bearer <JWT>`

Respuesta `200`:
```json
{
  "message": "Token válido",
  "user": {
    "id": 1,
    "email": "user1@test.com",
    "username": "user1",
    "iat": 1713960000,
    "exp": 1714564800
  }
}
```

## 3) Users

### GET /users/me
Devuelve el perfil completo del usuario autenticado.

Header requerido:
- `Authorization: Bearer <JWT>`

Respuesta `200`:
```json
{
  "user": {
    "id": 1,
    "email": "user1@test.com",
    "username": "user1",
    "first_name": "Alejandro",
    "middle_name": "Luis",
    "last_name": "Sanchez",
    "second_last_name": "Lopez",
    "birth_date": "1995-01-15",
    "phone": "+573001112233",
    "is_active": true,
    "created_at": "2026-04-24T12:00:00.000Z",
    "updated_at": "2026-04-24T12:00:00.000Z"
  }
}
```

### PATCH /users/me
Actualiza el perfil del usuario autenticado.

Header requerido:
- `Authorization: Bearer <JWT>`

Body posible:
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

Campos que puede recibir:
- `username`
- `first_name`
- `middle_name`
- `last_name`
- `second_last_name`
- `birth_date`
- `phone`

Notas:
- Solo se actualizan los campos enviados.
- Si no envías ningún campo, responde `400` con `No hay campos para actualizar`.
- `username` y `phone` se validan para que no existan ya en otro usuario.

### GET /users/search?q=texto&onlyFriends=true|false
Busca usuarios activos por email, username, nombres o teléfono.

Header requerido:
- `Authorization: Bearer <JWT>`

Query params:
- `q`: obligatorio. Texto a buscar.
- `onlyFriends`: opcional. Si es `true`, devuelve solo amigos aceptados.

Reglas de orden:
- Primero relaciones `accepted`.
- Luego `pending`.
- Luego usuarios sin relación.

Respuesta `200`:
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

## 4) Friends

Todas estas rutas están protegidas con JWT.

### POST /friends/request
Envía una solicitud de amistad.

Header requerido:
- `Authorization: Bearer <JWT>`

Body:
```json
{
  "user_id": 2
}
```

Qué id recibe:
- `user_id` es el id del usuario destino, no el id de la solicitud.

Validaciones principales:
- Debe ser un entero positivo.
- No puedes enviarte solicitud a ti mismo.
- El usuario destino debe existir y estar activo.
- No debe existir ya una relación `accepted`, `pending` o `blocked` para ese par.

Respuesta `201`:
```json
{
  "message": "Solicitud de amistad enviada",
  "friendship": {
    "id": 15,
    "user_id_1": 1,
    "user_id_2": 2,
    "status": "pending",
    "created_at": "2026-04-24T12:00:00.000Z"
  }
}
```

### GET /friends
Lista amigos con estado `accepted` del usuario autenticado.

Respuesta `200`:
```json
{
  "friends": [
    {
      "friendship_id": 15,
      "status": "accepted",
      "created_at": "2026-04-24T12:00:00.000Z",
      "id": 2,
      "email": "user2@test.com",
      "username": "user2",
      "first_name": "Maria",
      "middle_name": null,
      "last_name": "Perez",
      "second_last_name": null,
      "phone": "+573001112234"
    }
  ]
}
```

### GET /friends/requests
Lista las relaciones con estado `pending` asociadas al usuario autenticado.

Respuesta `200`:
```json
{
  "requests": [
    {
      "friendship_id": 15,
      "status": "pending",
      "created_at": "2026-04-24T12:00:00.000Z",
      "id": 2,
      "email": "user2@test.com",
      "username": "user2",
      "first_name": "Maria",
      "middle_name": null,
      "last_name": "Perez",
      "second_last_name": null,
      "phone": "+573001112234"
    }
  ]
}
```

### PATCH /friends/:id/accept
Acepta una solicitud de amistad.

Header requerido:
- `Authorization: Bearer <JWT>`

Qué id recibe:
- `:id` es el `id` del registro en la tabla `friends`, o sea el id de la solicitud/relación.
- No es el id del usuario.

Validaciones principales:
- Debe ser un entero positivo.
- La relación debe existir.
- El usuario autenticado debe ser uno de los dos participantes.
- El estado debe ser `pending`.

Respuesta `200`:
```json
{
  "message": "Solicitud aceptada",
  "friendship": {
    "id": 15,
    "user_id_1": 1,
    "user_id_2": 2,
    "status": "accepted",
    "created_at": "2026-04-24T12:00:00.000Z"
  }
}
```

### PATCH /friends/:id/block
Bloquea una relación de amistad.

Header requerido:
- `Authorization: Bearer <JWT>`

Qué id recibe:
- `:id` es el id de `friends`.

Validaciones principales:
- Debe ser un entero positivo.
- La relación debe existir.
- El usuario autenticado debe participar en esa relación.

Respuesta `200`:
```json
{
  "message": "Relación bloqueada",
  "friendship": {
    "id": 15,
    "user_id_1": 1,
    "user_id_2": 2,
    "status": "blocked",
    "created_at": "2026-04-24T12:00:00.000Z"
  }
}
```

### DELETE /friends/:id
Elimina la relación de amistad.

Header requerido:
- `Authorization: Bearer <JWT>`

Qué id recibe:
- `:id` es el id de `friends`.

Validaciones principales:
- Debe ser un entero positivo.
- La relación debe existir.
- El usuario autenticado debe participar en esa relación.

Respuesta `200`:
```json
{
  "message": "Relación eliminada correctamente"
}
```

## 5) Expenses

Todas estas rutas están protegidas con JWT.

### GET /expenses/contacts/suggestions
Devuelve contactos sugeridos para crear gastos.

Reglas:
- Solo amigos con estado `accepted`.
- Solo usuarios activos.

Respuesta `200`:
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
Crea un gasto y lo divide en partes iguales.

Body:
```json
{
  "amount": 120000,
  "description": "Cena equipo",
  "participants": [2, 3]
}
```

Qué ids recibe:
- `participants` debe ser un array de ids de usuario.
- `paid_by` no se envía en el body; se toma del usuario autenticado.

Campos:
- `amount`: número mayor que 0.
- `description`: string obligatorio.
- `participants`: array obligatorio de ids de usuarios.

Reglas:
- El creador del gasto siempre entra como participante y se marca con `is_paid = true`.
- Los demás participantes quedan con `is_paid = false`.
- Solo se permiten participantes que sean amigos aceptados y activos del creador.

Respuesta `201`:
```json
{
  "message": "Gasto creado correctamente",
  "expense": {
    "id": 10,
    "amount": 120000,
    "description": "Cena equipo",
    "paid_by": 1,
    "created_at": "2026-04-24T12:00:00.000Z"
  },
  "split": {
    "participants_count": 3,
    "amount_owed": 40000
  }
}
```

### GET /expenses
Lista los gastos donde el usuario paga o participa.

Respuesta `200`:
```json
{
  "expenses": [
    {
      "id": 10,
      "amount": 120000,
      "description": "Cena equipo",
      "paid_by": {
        "id": 1,
        "email": "user1@test.com"
      },
      "paid_by_me": true,
      "my_share_amount": 40000,
      "participants_count": 3,
      "participants": [
        {
          "user_id": 1,
          "email": "user1@test.com",
          "amount_owed": 40000,
          "is_paid": true
        },
        {
          "user_id": 2,
          "email": "user2@test.com",
          "amount_owed": 40000,
          "is_paid": false
        },
        {
          "user_id": 3,
          "email": "user3@test.com",
          "amount_owed": 40000,
          "is_paid": false
        }
      ],
      "created_at": "2026-04-24T12:00:00.000Z"
    }
  ]
}
```

### GET /expenses/balance
Devuelve el balance del usuario autenticado.

Reglas:
- Solo cuenta deudas con `is_paid = false`.
- `owed_to_me` suma lo que otros me deben.
- `i_owe` suma lo que yo debo a otros.
- `net_balance = owed_to_me - i_owe`.

Respuesta `200`:
```json
{
  "owed_to_me": 80000,
  "i_owe": 40000,
  "net_balance": 40000
}
```

### PATCH /expenses/settle
Liquida la deuda de un participante en un gasto.

Body:
```json
{
  "expense_id": 10,
  "user_id": 2
}
```

Qué ids recibe:
- `expense_id` es el id del gasto en la tabla `expenses`.
- `user_id` es el id del deudor, o sea el participante que va a quedar marcado como pagado.
- No se recibe el id del pagador; se toma del usuario autenticado.

Validaciones principales:
- `expense_id` debe ser un entero positivo.
- `user_id` debe ser un entero positivo.
- No puedes liquidar tu propia deuda.
- Solo puede ejecutar la acción quien creó el gasto (`paid_by`).

Respuesta `200`:
```json
{
  "message": "Deuda marcada como pagada",
  "settlement": {
    "id": 1,
    "expense_id": 10,
    "user_id": 2,
    "amount_owed": 40000,
    "is_paid": true
  }
}
```

## 6) Errores comunes

### 400
```json
{
  "message": "Email y password son requeridos"
}
```

Ejemplos adicionales:
```json
{
  "message": "user_id debe ser un entero positivo"
}
```

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
