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
    "requested_by": 1,
    "created_at": "2026-04-24T12:00:00.000Z"
  }
}
```

`requested_by` guarda quién de los dos la mandó — es lo que distingue "recibida" de "enviada" en `GET /friends/requests` vs `GET /friends/requests/sent`, y lo que evita que puedas aceptar tu propia solicitud pegándole directo al endpoint (ver `PATCH /friends/:id/accept`).

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
Lista las solicitudes con estado `pending` que **otros te enviaron a ti** — las únicas que puedes aceptar/rechazar. Excluye las que tú mismo enviaste (`requested_by <> tu id`).

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

### GET /friends/requests/sent
Lista las solicitudes con estado `pending` que **tú enviaste** y siguen esperando que el otro las acepte (`requested_by = tu id`). De solo lectura — no hay acción posible sobre ellas desde aquí, solo esperar. Mismo formato de respuesta que `GET /friends/requests`.

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
- El usuario autenticado **no** debe ser quien la envió (`requested_by === userId` → `403`, "No puedes aceptar una solicitud que tú mismo enviaste") — antes de esto no había forma de distinguir remitente de destinatario y era posible auto-aceptar la propia solicitud pegándole directo al endpoint.

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

## 5.1) Liquidación de deudas (confirmación bilateral, con abonos parciales)

Un participante pasa por hasta 3 estados: `pending` → `paid_pending_confirmation` → `paid`. Además de `status`, cada participante acumula `amount_paid` (lo ya confirmado) y `pending_claim_amount` (lo reclamado, esperando confirmación) — así que un mismo gasto puede liquidarse en varios abonos, no solo de una vez. Hay 4 acciones, y las dos primeras aceptan un `amount` opcional en el body:

### PATCH /expenses/:id/claim
El propio deudor avisa que pagó (parte o todo) de lo que debe. Solo puede marcarse a sí mismo, y solo si su estado actual es `pending`.

Body opcional: `{ "amount": 20000 }` — si se omite, usa el saldo restante completo (`amount_owed − amount_paid`). Si `amount` supera el saldo restante, responde `400`.

Queda en `paid_pending_confirmation` con `pending_claim_amount` = lo reclamado, esperando que el pagador confirme.

Respuesta `200`:
```json
{
  "message": "Marcado como pagado, esperando confirmación del pagador",
  "participant": { "id": 5, "expense_id": 10, "user_id": 2, "amount_owed": 40000, "amount_paid": 0, "pending_claim_amount": 20000, "status": "paid_pending_confirmation", "paid_claimed_at": "2026-04-24T13:00:00.000Z", "confirmed_at": null }
}
```

### PATCH /expenses/:id/participants/:userId/mark-paid
El pagador (`paid_by`) marca directamente a un participante como pagado, parcial o totalmente (ej. pago en efectivo), sin pasar por la confirmación. Mismo `amount` opcional que `/claim` (por defecto, el saldo restante). Funciona desde cualquier estado que no sea ya `paid`.

### PATCH /expenses/:id/participants/:userId/confirm
El pagador confirma un claim existente: `pending_claim_amount` pasa a sumarse a `amount_paid` y se limpia. Solo funciona si el estado actual es `paid_pending_confirmation`. El participante solo pasa a `status: "paid"` cuando `amount_paid` alcanza `amount_owed` — si quedó saldo, vuelve a `pending` para el próximo abono.

### PATCH /expenses/:id/participants/:userId/reject
El pagador rechaza un claim existente (ej. el deudor se equivocó). Solo funciona si el estado actual es `paid_pending_confirmation`; limpia `pending_claim_amount` y vuelve a `pending` (sin tocar `amount_paid`).

Las 3 rutas con `:userId` solo pueden ser ejecutadas por quien creó el gasto (`paid_by`); si no, responden `403`.

**Nota sobre `req.body`:** estas rutas no requieren body — Express deja `req.body` como `undefined` (no `{}`) cuando no hay header `Content-Type: application/json` (que es como llama el frontend al caso "pagar todo"), así que el acceso al `amount` opcional siempre usa `req.body?.amount`.

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
    "income": { "items": [ { "id": 1, "section": "income", "label": "Salario", "budgeted_amount": 2000000, "actual_amount": 2000000, "is_savings_link": false, "linked_saving_item_id": null, "is_split_synced": false, "split_expense_id": null, "split_role": null, "is_pending": false, "position": 0 } ], "budgeted_total": 2000000, "actual_total": 2000000, "pending_total": 0 },
    "fixed_expense": { "items": [], "budgeted_total": 0, "actual_total": 0, "pending_total": 0 },
    "tracked_expense": { "items": [], "budgeted_total": 0, "actual_total": 0, "pending_total": 0 },
    "saving": { "items": [], "budgeted_total": 0, "actual_total": 0, "pending_total": 0 },
    "debt": { "items": [], "budgeted_total": 0, "actual_total": 0, "pending_total": 0 }
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

Fórmulas: `budgeted_net/actual_net = Ingreso − Gastos Fijos − Gastos`; `weekly_* = */4`; `balance = Saldo anterior + Ingreso − Gastos Fijos − Gastos + Ahorros − Deudas` (patrimonio líquido del mes, incluye lo apartado a Ahorros); `savings_balance = Saldo anterior ahorros + Ahorros del mes`; `debt_balance = Saldo anterior deudas − Deudas del mes`; `carry_forward_cash = balance − Ahorros del mes` (caja realmente disponible, sin la parte ya apartada).

**`carry_forward_cash` vs. `balance`:** `balance` es cuánto vales en total este mes (caja + lo que apartaste a ahorros), pero ese dinero ahorrado no es gastable — ya vive aparte en `savings_balance`. Por eso el mes siguiente NO hereda `opening_cash_balance` desde `balance` sino desde `carry_forward_cash`: si se usara `balance` directo, lo apartado a ahorros quedaría contado dos veces hacia adelante (una vez en la caja del mes que viene, y otra en `opening_savings_balance`, que también arrastra `savings_balance`).

**`is_pending`:** un ítem con `is_pending: true` es una obligación *visible* (tu parte de un gasto compartido que todavía no pagaste de verdad) — aparece en `items` de su sección para que no se pierda de vista, pero **no** suma en `budgeted_total`/`actual_total` de esa sección ni en ningún total de `totals` (balance, saldo semanal, etc.), porque ese dinero todavía no se movió. Su monto se expone aparte en `pending_total` por sección. Pasa a `is_pending: false` (y ahí sí empieza a contar) recién cuando termina de pagarse y el pagador lo confirma — ver 5.1.

### PATCH /budget/:month/opening
Corrige/siembra a mano los saldos de apertura del mes (`cash_balance`, `savings_balance`, `debt_balance`). Body: cualquier subconjunto de esos tres campos — al menos uno es requerido.

```json
{ "debt_balance": 300000 }
```

Es también la forma correcta de registrar una **deuda nueva** (no un pago a una deuda que ya tenías): súmale el monto al `debt_balance` actual. La sección `debt` de `GET /budget/:month` es solo para pagos hechos este mes (`debt_balance = saldo inicial − pagos del mes`) — crear ahí un ítem por una deuda nueva invertiría el signo del balance.

**Recálculo hacia adelante:** si ya existen meses posteriores para este usuario (por haberlos abierto antes), sus `opening_*` se recalculan en cascada automáticamente para que el saldo siga fluyendo de un mes al otro — corregir agosto también corrige lo que septiembre había heredado mal. Esto mismo pasa automáticamente después de crear/editar/borrar un ítem o registrar un abono (`recomputeForwardChainForMonth` en `budgetSyncService.js`), no solo al tocar `opening` directo.

### POST /budget/:month/items
Crea un ítem manual. Body: `{ section, label, budgeted_amount, actual_amount, link_to_saving_item_id }`.

- `section`: uno de `income`, `fixed_expense`, `tracked_expense`, `saving`, `debt`.
- `link_to_saving_item_id` (opcional, solo válido en `fixed_expense`/`tracked_expense`): id de un ítem **que ya exista** en la sección `saving`, del mismo mes. Si se manda, el `actual_amount` de este ítem se **suma** (no reemplaza) al ítem de ahorro elegido — nunca se crea un ahorro nuevo en automático. Si el id no existe, no es tuyo, no está en `saving`, o no es del mismo mes, responde `400`. `is_savings_link` en la respuesta queda como `true`/`false` según si quedó vinculado, pero ya no se manda como input.

### PATCH /budget/items/:id
Edita un ítem manual. Mismo `link_to_saving_item_id` que en el create — mandarlo `null` desvincula el ítem (revierte el aporte que le había hecho al ahorro). Cambiar de un ahorro a otro revierte el aporte del viejo destino y lo aplica al nuevo; cambiar el `actual_amount` de un ítem ya vinculado aplica solo la diferencia al ahorro, no lo pisa.

Responde `400` si el ítem está sincronizado desde Split.it (`is_split_synced`) — esos no se editan directamente.

### PATCH /budget/items/:id/contribute
Abono: suma `amount` a `actual_amount` de un ítem propio (usado para "meterle más dinero" a un ahorro o deuda existente sin duplicar la fila). Body: `{ "amount": 50000 }` (`amount` debe ser positivo).

Si el ítem tiene `linked_saving_item_id` (fue vinculado vía `link_to_saving_item_id`), el abono también se suma al ahorro vinculado (`actual_amount` **y** `budgeted_amount` suben ahí). Misma restricción que `PATCH`/`DELETE` para ítems sincronizados desde Split.it.

Respuesta `200`: `{ "message": "Abono registrado", "item": { ...fila actualizada... } }`.

### DELETE /budget/items/:id
Borra un ítem manual. Si estaba vinculado a un ahorro (`linked_saving_item_id`), revierte el aporte que le había hecho — el ahorro en sí **no se borra**, sigue existiendo como el ítem independiente que siempre fue. Misma restricción que `PATCH` para ítems sincronizados.

### Sincronización automática con Split.it
No son endpoints propios — se generan solos al usar `/expenses`:

- Al crear un gasto compartido, el pagador recibe un ítem `tracked_expense` **confirmado** (`is_pending: false`) por **su propia parte** (`shares.get(paid_by)`, no el monto total), en su propio mes — lo que le corresponde a otros no es un gasto suyo, es dinero que va a recuperar. `split_role: "payer"`. (Antes esto se creaba por el monto completo, lo que inflaba "Gastos" incluso cuando la parte del pagador era $0 — por ejemplo, si le prestas o le vendes algo a alguien y te debe el 100%, tú no gastaste nada.)
- Cada otro participante recibe, en ese mismo momento y en **su propio mes actual**, un ítem `tracked_expense` **pendiente** (`is_pending: true`) por su parte — visible como obligación, pero fuera de sus totales hasta que la pague. `split_role: "participant"`.
- Cada abono confirmado (`mark-paid`/`confirm`, ver 5.1) genera o incrementa, en el mes actual del **pagador**, un ítem `income` **"Reembolso: `<descripción>`"** por ese monto exacto — la devolución entra como Ingreso real, no como una resta al ítem de Gastos del pagador (que ya no se toca después de creado). `split_role: "payer_income"`. Puede haber varios de estos por el mismo gasto si los abonos caen en meses distintos. Recién cuando el participante terminó de pagar el 100% de su parte, su propio ítem pasa a `is_pending: false` y empieza a contar en su balance.
- Editar o borrar el gasto compartido recalcula/elimina todos estos ítems (payer, participantes y cualquier reembolso ya recibido).

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
