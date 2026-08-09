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
Inicia sesión y devuelve JWT. Acepta email, username o teléfono como identificador.

Body:
```json
{
  "identifier": "user1@test.com",
  "password": "123456"
}
```

Campos:
- `identifier`: string obligatorio — email, username o teléfono. Se busca por igualdad exacta en username/teléfono, y case-insensitive en email.
- `password`: string obligatorio.
- `email` sigue aceptado como alias de `identifier` por compatibilidad con clientes viejos.

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
Crea un gasto. Soporta dos formas de dividirlo mediante `split_type`.

**Split igualitario** (`split_type: "equal"`, es el default si se omite):
```json
{
  "amount": 120000,
  "description": "Cena equipo",
  "split_type": "equal",
  "participants": [2, 3]
}
```
`participants` es un array de ids de usuario (los que no son el pagador). El total se reparte en partes iguales entre el pagador y esos participantes, en centavos exactos — si no es divisible exacto, el resto de centavos se reparte de a 1 entre los primeros de la lista `[pagador, ...participants]`, así la suma de las partes siempre da el total exacto.

**Split personalizado** (`split_type: "custom"`):
```json
{
  "amount": 120000,
  "description": "Cena equipo",
  "split_type": "custom",
  "participants": [
    { "user_id": 2, "amount": 50000 },
    { "user_id": 3, "amount": 30000 }
  ]
}
```
`participants` es un array de `{ user_id, amount }` con el monto exacto de cada participante que **no** es el pagador. La parte del pagador se calcula automáticamente como `amount - suma(participants)` y debe dar `>= 0`; si la suma de los participantes supera el total, responde `400`.

Qué ids recibe:
- `paid_by` no se envía en el body; se toma del usuario autenticado.
- No incluyas al pagador dentro de `participants`.

Reglas:
- El creador del gasto siempre entra como participante con `status: "paid"` (ya cubrió el total).
- Los demás participantes quedan con `status: "pending"`.
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
    "created_at": "2026-04-24T12:00:00.000Z",
    "updated_at": "2026-04-24T12:00:00.000Z"
  },
  "split": {
    "split_type": "equal",
    "participants_count": 3,
    "shares": { "1": 40000, "2": 40000, "3": 40000 }
  }
}
```

### PATCH /expenses/:id
Edita un gasto existente. Solo puede ejecutarlo quien lo creó (`paid_by`).

Body: igual forma que `POST /expenses` (`amount`, `description`, `split_type`, `participants`).

**Importante:** editar un gasto **reinicia el estado de pago de todos los participantes** (vuelven a `pending`, excepto el pagador que sigue `paid`), sin importar si ya había pagos confirmados. El frontend debe avisar esto al usuario antes de confirmar la edición.

Respuesta `200`: misma forma que la respuesta de `POST /expenses`, con el mensaje `"Gasto actualizado correctamente. Los estados de pago se reiniciaron."`.

### DELETE /expenses/:id
Elimina un gasto y todos sus registros de participantes. Solo puede ejecutarlo quien lo creó.

Respuesta `200`:
```json
{ "message": "Gasto eliminado correctamente" }
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
          "status": "paid",
          "paid_claimed_at": null,
          "confirmed_at": "2026-04-24T12:00:00.000Z"
        },
        {
          "user_id": 2,
          "email": "user2@test.com",
          "amount_owed": 40000,
          "status": "paid_pending_confirmation",
          "paid_claimed_at": "2026-04-24T13:00:00.000Z",
          "confirmed_at": null
        },
        {
          "user_id": 3,
          "email": "user3@test.com",
          "amount_owed": 40000,
          "status": "pending",
          "paid_claimed_at": null,
          "confirmed_at": null
        }
      ],
      "created_at": "2026-04-24T12:00:00.000Z",
      "updated_at": "2026-04-24T12:00:00.000Z"
    }
  ]
}
```

`status` de cada participante es uno de: `pending`, `paid_pending_confirmation`, `paid`. Ver la sección de liquidación de deudas más abajo para el flujo completo.

### GET /expenses/balance
Devuelve el balance del usuario autenticado, global y desglosado por amigo.

Reglas:
- Solo cuenta deudas con `status <> 'paid'` (es decir, `pending` y `paid_pending_confirmation` siguen contando como deuda activa hasta que se confirma).
- `owed_to_me` / `i_owe` son las sumas globales; `by_friend` es el mismo desglose por persona.
- `net_balance = owed_to_me - i_owe`.

Respuesta `200`:
```json
{
  "owed_to_me": 80000,
  "i_owe": 40000,
  "net_balance": 40000,
  "by_friend": [
    {
      "friend_id": 2,
      "name": "Maria Perez",
      "email": "user2@test.com",
      "owed_to_me": 80000,
      "i_owe": 0,
      "net": 80000
    },
    {
      "friend_id": 3,
      "name": "user3",
      "email": "user3@test.com",
      "owed_to_me": 0,
      "i_owe": 40000,
      "net": -40000
    }
  ]
}
```

## 5.1) Liquidación de deudas (confirmación bilateral)

Un participante pasa por hasta 3 estados: `pending` → `paid_pending_confirmation` → `paid`. Hay 4 acciones:

### PATCH /expenses/:id/claim
El propio deudor avisa que ya pagó su parte. Solo puede marcarse a sí mismo, y solo si su estado actual es `pending`. Queda en `paid_pending_confirmation` esperando que el pagador confirme.

Respuesta `200`:
```json
{
  "message": "Marcado como pagado, esperando confirmación del pagador",
  "participant": { "id": 5, "expense_id": 10, "user_id": 2, "amount_owed": 40000, "status": "paid_pending_confirmation", "paid_claimed_at": "2026-04-24T13:00:00.000Z", "confirmed_at": null }
}
```

### PATCH /expenses/:id/participants/:userId/mark-paid
El pagador (`paid_by`) marca directamente a un participante como pagado (ej. pago en efectivo), sin pasar por la confirmación. Funciona desde cualquier estado que no sea ya `paid`.

### PATCH /expenses/:id/participants/:userId/confirm
El pagador confirma un claim existente. Solo funciona si el estado actual es `paid_pending_confirmation`.

### PATCH /expenses/:id/participants/:userId/reject
El pagador rechaza un claim existente (ej. el deudor se equivocó). Solo funciona si el estado actual es `paid_pending_confirmation`; vuelve a `pending`.

Las 3 rutas con `:userId` solo pueden ser ejecutadas por quien creó el gasto (`paid_by`); si no, responden `403`.

## 5.2) Presupuesto personal (`/budget`)

Todas estas rutas están protegidas con JWT. Es un módulo personal por usuario — cada quien ve solo su propio presupuesto. Ver `PLAN_GASTOS_PERSONALES.md` para el diseño completo.

### GET /budget/:month
Trae (o crea de forma perezosa) el presupuesto de un mes. `:month` en formato `YYYY-MM`.

Al crear un mes nuevo, copia los saldos de cierre del mes anterior más reciente que exista como `opening_*`.

Respuesta `200`:
```json
{
  "month": "2026-08-01T00:00:00.000Z",
  "opening": { "cash_balance": 0, "savings_balance": 0, "debt_balance": 0 },
  "sections": {
    "income": { "items": [ { "id": 1, "section": "income", "label": "Salario", "budgeted_amount": 2000000, "actual_amount": 2000000, "is_savings_link": false, "linked_saving_item_id": null, "is_split_synced": false, "split_expense_id": null, "position": 0 } ], "budgeted_total": 2000000, "actual_total": 2000000 },
    "fixed_expense": { "items": [], "budgeted_total": 0, "actual_total": 0 },
    "tracked_expense": { "items": [], "budgeted_total": 0, "actual_total": 0 },
    "saving": { "items": [], "budgeted_total": 0, "actual_total": 0 },
    "debt": { "items": [], "budgeted_total": 0, "actual_total": 0 }
  },
  "totals": {
    "budgeted_net": 2000000,
    "actual_net": 2000000,
    "weekly_budgeted": 500000,
    "weekly_actual": 500000,
    "balance": 2000000,
    "savings_balance": 0,
    "debt_balance": 0
  }
}
```

Fórmulas: `budgeted_net/actual_net = Ingreso − Gastos Fijos − Gastos`; `weekly_* = */4`; `balance = Saldo anterior + Ingreso − Gastos Fijos − Gastos + Ahorros − Deudas`; `savings_balance = Saldo anterior ahorros + Ahorros del mes`; `debt_balance = Saldo anterior deudas − Deudas del mes`.

### POST /budget/:month/items
Crea un ítem manual. Body: `{ section, label, budgeted_amount, actual_amount, is_savings_link }`.

- `section`: uno de `income`, `fixed_expense`, `tracked_expense`, `saving`, `debt`.
- `is_savings_link` (solo válido en `fixed_expense`/`tracked_expense`): si es `true`, crea automáticamente un ítem espejo en `saving` — reemplaza la doble carga manual.

### PATCH /budget/items/:id
Edita un ítem manual. Togglear `is_savings_link` crea o borra el espejo en `saving` según corresponda.

Responde `400` si el ítem está sincronizado desde Split.it (`is_split_synced`), o si es el espejo automático de otro ítem — esos no se editan directamente.

### DELETE /budget/items/:id
Borra un ítem manual (y su espejo de ahorro si tenía uno). Misma restricción que `PATCH` para ítems sincronizados o espejos.

### Sincronización automática con Split.it
No son endpoints propios — se generan solos al usar `/expenses`:

- Al crear un gasto compartido, el pagador recibe un ítem `tracked_expense` por el monto completo (plata que salió de su bolsillo).
- Cuando un participante liquida su parte (`mark-paid` o `confirm`), el ítem del pagador baja ese monto, y el deudor recibe su propio ítem `tracked_expense` por su parte, en el mes en que efectivamente pagó.
- Editar o borrar el gasto compartido recalcula/elimina estos ítems.

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
12. `PATCH /expenses/:id/claim` (deudor)
13. `PATCH /expenses/:id/participants/:userId/confirm` (pagador)

## Notas
- Proyecto en JavaScript puro con CommonJS.
- `JWT_SECRET` debe estar en `.env`.
- `expense_participants` usa `status TEXT` (`pending` | `paid_pending_confirmation` | `paid`) en vez del antiguo `is_paid BOOLEAN`. Ver `migrations/001_expense_participant_status.sql`.
