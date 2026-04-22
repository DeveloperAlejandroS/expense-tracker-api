# Expense Tracker API - Endpoints (Borrador)

## Base URL
`http://localhost:3000`

## Autenticacion

### POST /auth/register
Crea un usuario nuevo.

Body:
```json
{
  "email": "user1@test.com",
  "password": "123456"
}
```

Respuesta esperada (201):
```json
{
  "message": "Usuario registrado correctamente",
  "user": {
    "id": 1,
    "email": "user1@test.com"
  }
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

Respuesta esperada (200):
```json
{
  "message": "Login exitoso",
  "token": "<JWT>",
  "user": {
    "id": 1,
    "email": "user1@test.com"
  }
}
```

### GET /auth/me
Ruta protegida para validar token.

Header:
- `Authorization: Bearer <JWT>`

Respuesta esperada (200):
```json
{
  "message": "Token valido",
  "user": {
    "id": 1,
    "email": "user1@test.com",
    "iat": 1710000000,
    "exp": 1710600000
  }
}
```

## Gastos (protegidos)
Todas las rutas usan:
- `Authorization: Bearer <JWT>`

### POST /expenses
Crea un gasto y reparte de forma equitativa entre creador + participantes.

Body:
```json
{
  "amount": 120000,
  "description": "Cena equipo",
  "participants": [2, 3]
}
```

Respuesta esperada (201):
```json
{
  "message": "Gasto creado correctamente",
  "expense": {
    "id": 10,
    "amount": "120000",
    "description": "Cena equipo",
    "paid_by": 1,
    "created_at": "2026-04-22T00:00:00.000Z"
  },
  "split": {
    "participants_count": 3,
    "amount_owed": 40000
  }
}
```

### GET /expenses
Lista gastos donde el usuario logueado pago o participa, con salida enriquecida.

Respuesta esperada (200):
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
          "amount_owed": 40000
        },
        {
          "user_id": 2,
          "email": "user2@test.com",
          "amount_owed": 40000
        },
        {
          "user_id": 3,
          "email": "user3@test.com",
          "amount_owed": 40000
        }
      ],
      "created_at": "2026-04-22T00:00:00.000Z"
    }
  ]
}
```

### GET /expenses/balance
Devuelve balance del usuario logueado.
Importante: ignora deudas ya liquidadas (`is_paid = true`).

Respuesta esperada (200):
```json
{
  "owed_to_me": 80000,
  "i_owe": 40000,
  "net_balance": 40000
}
```

### PATCH /expenses/settle
Marca como pagada la deuda de un usuario para un gasto.

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

Respuesta esperada (200):
```json
{
  "message": "Deuda marcada como pagada",
  "settlement": {
    "id": 34,
    "expense_id": 10,
    "user_id": 2,
    "amount_owed": "40000",
    "is_paid": true
  }
}
```

Errores esperados:
- `403` si el usuario logueado no es quien pago el gasto.
- `404` si la deuda no existe o ya estaba liquidada.

## Errores comunes

### 401 Token faltante o invalido
```json
{
  "message": "Token no proporcionado"
}
```

O:
```json
{
  "message": "Token invalido o expirado"
}
```

### 500 Error interno
```json
{
  "message": "Error interno del servidor"
}
```
