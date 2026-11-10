// NaN, Infinity o un monto absurdo guardado en una columna numeric contamina
// todas las sumas del usuario (y de sus amigos, en gastos compartidos).
const MAX_MONEY = 1e12;

const isMoney = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_MONEY;

module.exports = { isMoney };
