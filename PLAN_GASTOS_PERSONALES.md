# Plan — Módulo de Gastos Personales

## Contexto

Hoy el control de presupuesto personal vive en un Excel mensual (ver captura de referencia, julio 2026) con 5 secciones — Ingresos, Gastos Fijos, Seguimiento de Gastos (variables), Ahorros, Deudas — cada una con columnas Presupuestado/Actual, más un resumen de Flujo de Caja. La idea es migrar esto a Split.it como un módulo nuevo, personal por usuario, que además se conecte con los gastos compartidos existentes (si pagás o participás de un gasto compartido, eso debe reflejarse acá porque es plata real que salió de tu bolsillo).

Decisiones ya confirmadas:
- Los ítems de Gastos Fijos/Seguimiento se cargan a mano cada mes (no hay plantilla recurrente que se autocomplete).
- El reflejo de un gasto "tipo ahorro" hacia la sección Ahorros hoy es manual (doble carga) — en la app **esto se automatiza**: una fila puede marcarse "Es ahorro" y su monto acredita Ahorros solo, sin cargarlo dos veces.
- Integración con Split.it: si sos el pagador de un gasto compartido, la plata salió de tu bolsillo completa al crearlo, y cada liquidación de un participante te la devuelve (reduce el gasto personal neto). Si sos participante (no pagador), tu parte cuenta como gasto personal recién cuando la pagás de verdad (`status = paid`), no antes.

## Modelo de datos (nuevas tablas, mismo Postgres)

### `budget_months`
Un registro por usuario por mes.
- `id`, `user_id`, `month` (primer día del mes, `date`), `opening_cash_balance`, `opening_savings_balance`, `opening_debt_balance` (snapshot tomado del mes anterior al crear este — así un mes cerrado no se recalcula si edito meses viejos), `created_at`.
- Se crea de forma perezosa: la primera vez que el usuario abre un mes sin registro, se crea copiando los saldos de cierre del mes anterior (si no hay mes anterior, arranca en 0).

### `budget_items`
Las filas de cada sección.
- `id`, `budget_month_id`, `section` (`income` | `fixed_expense` | `tracked_expense` | `saving` | `debt`), `label`, `budgeted_amount`, `actual_amount`, `is_savings_link` (bool, solo aplica a `fixed_expense`/`tracked_expense`), `linked_saving_item_id` (FK nullable — el ítem espejo autogenerado en `saving` cuando `is_savings_link = true`), `position` (int, orden manual), `created_at`, `updated_at`.
- Sin tabla de categorías separada: `label` es texto libre, igual que en el Excel.

### `budget_split_sync`
Rastrea qué `budget_items` fueron generados automáticamente desde un gasto compartido, para poder actualizarlos cuando ese gasto cambia.
- `id`, `budget_item_id`, `expense_id`, `user_id`, `role` (`payer` | `participant`), `created_at`.

## Mecánica de integración con Split.it

Vive en un servicio nuevo (`src/services/budgetSyncService.js`) que el `expenseController` llama después de cada commit exitoso — no se mezcla la lógica de presupuesto adentro del controller de gastos.

| Evento en Split.it | Efecto en el presupuesto personal |
|---|---|
| Creás un gasto compartido (sos `paid_by`) | Se crea/actualiza un `budget_item` tipo `tracked_expense` en tu mes actual, `actual_amount` = monto total del gasto (toda la plata salió de tu bolsillo). |
| Un participante liquida su parte (`status → paid`, vía confirm o mark-paid) | Ese `budget_item` del pagador se reduce en el monto liquidado (te devolvieron esa plata). |
| Se rechaza una liquidación (`status → pending`) | El `budget_item` del pagador vuelve a subir ese monto. |
| Tu propia parte como participante pasa a `paid` | Se crea un `budget_item` tipo `tracked_expense` en **tu** mes, por tu monto — recién ahí, porque antes de pagar no salió plata real. |
| Se edita o borra el gasto compartido | Se recalculan/eliminan los `budget_items` vinculados vía `budget_split_sync`. |

Estos ítems quedan de solo lectura en la UI (con una etiqueta "vinculado a Split.it" y link al detalle del gasto) — no se editan a mano para no desincronizarlos.

## Fórmulas (replicando el Excel)

- `Total sección` = suma de `actual_amount` (o `budgeted_amount` en la columna Presupuestado) de sus ítems, incluyendo los `saving` autogenerados por `is_savings_link`.
- `Presupuestado (hero)` = `Ingreso − Gastos Fijos − Gastos` (antes de ahorros/deudas/saldo anterior).
- `Saldo semanal` = `Presupuestado / 4`.
- `Balance (Flujo de Caja)` = `+ Saldo anterior + Ingreso − Gastos Fijos − Gastos + Ahorros − Deudas` *(el `+` en Ahorros es tal cual tu fórmula actual — confirmá si es intencional)*.
- `Balance Ahorros` = `Saldo anterior + Ahorros del mes (incluye los is_savings_link)`.
- `Balance Deudas` = `Saldo anterior − Deudas pagadas` (a definir signo exacto con vos).
- Al cerrar/pasar de mes, estos balances se snapshotean como `opening_*` del mes siguiente.

## Endpoints (sketch)

- `GET /budget/:month` — trae o crea (lazy) el mes, con ítems agrupados por sección y totales ya calculados.
- `POST /budget/:monthId/items` — crear ítem `{ section, label, budgeted_amount, actual_amount, is_savings_link }`.
- `PATCH /budget/items/:id` — editar.
- `DELETE /budget/items/:id` — borrar (si tiene `linked_saving_item_id`, borra también el espejo).
- Los ítems sincronizados desde Split.it no se crean por estos endpoints — los gestiona `budgetSyncService` internamente; el frontend solo los lee.

## Pantallas (sketch)

- Nueva vista "Personal" (desbloquea el ícono de alcancía ya reservado en la nav), con selector de mes (← Julio 2026 →).
- Header con las dos cards hero: Presupuestado y Saldo semanal (Presupuestado vs Actual, como hoy).
- 5 paneles glass editables: Ingresos, Gastos Fijos, Seguimiento de Gastos, Ahorros, Deudas — cada fila con label + presupuestado + actual + botón borrar, más "+ agregar fila".
- Toggle "Es ahorro" en filas de Gastos Fijos/Seguimiento — reemplaza la doble carga manual.
- Card de Flujo de Caja con el balance final.
- Sub-sección propia y separada ("Gastos compartidos · Split.it") dentro del panel de Seguimiento de Gastos, con los ítems sincronizados de solo lectura y link al detalle del gasto original.

## Decisiones finales (ya resueltas)

1. **Signo Ahorros**: se suma, tal cual el Excel. `Balance = Saldo anterior + Ingreso − Gastos Fijos − Gastos + Ahorros − Deudas`.
2. **Fórmula Deudas**: `Balance Deudas = Saldo anterior − pagos del mes`. Los ítems de la sección `debt` de este mes son pagos a deudas existentes, no deudas nuevas — el balance solo baja.
3. **Cierre de mes**: automático. Al entrar por primera vez a un mes sin `budget_months`, se crea copiando los saldos de cierre (`Balance` de Flujo de Caja, Ahorros y Deudas) del mes anterior como `opening_*`. Sin botón ni paso manual.
4. **Ubicación de ítems sincronizados de Split.it**: sub-sección propia y separada dentro del panel de gastos — no se mezclan con las filas manuales de Seguimiento de Gastos.

## Estado

**Implementado.** Backend: `migrations/002_budget_module.sql`, `src/services/budgetSyncService.js`, `src/controllers/budgetController.js`, `src/routes/budgetRoutes.js`, hooks en `expenseController.js`. Frontend: `PersonalBudgetView.jsx`, `BudgetSectionPanel.jsx`, `utils/budgetHelpers.js`, wired en `App.jsx`/`Sidebar.jsx`/`BottomIsland.jsx`/`SideDrawer.jsx`. Ver `ENDPOINTS.md` sección 5.2 para el contrato de API.
