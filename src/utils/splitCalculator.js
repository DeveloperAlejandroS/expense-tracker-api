// Reparte un monto total en partes iguales sin perder centavos por redondeo
// flotante: todo el cálculo se hace en centavos enteros y el resto (si el
// monto no es divisible exacto) se reparte de a 1 centavo entre los
// primeros participantes de `orderedUserIds`. La suma de las partes
// devueltas siempre es exactamente igual a `totalAmount`.
const splitEqually = (totalAmount, orderedUserIds) => {
    const totalCents = Math.round(Number(totalAmount) * 100);
    const count = orderedUserIds.length;
    const baseCents = Math.floor(totalCents / count);
    const remainderCents = totalCents - baseCents * count;

    const shares = new Map();
    orderedUserIds.forEach((userId, index) => {
        const cents = baseCents + (index < remainderCents ? 1 : 0);
        shares.set(userId, cents / 100);
    });

    return shares;
};

// Calcula la parte del pagador dado lo que se le asignó explícitamente al
// resto de los participantes en un split personalizado. Devuelve null si
// la suma de los otros supera el total (split inválido).
const computePayerShareFromCustomSplit = (totalAmount, otherShares) => {
    const totalCents = Math.round(Number(totalAmount) * 100);
    const othersCents = otherShares.reduce(
        (sum, amount) => sum + Math.round(Number(amount) * 100),
        0
    );

    const payerCents = totalCents - othersCents;
    if (payerCents < 0) return null;

    return payerCents / 100;
};

module.exports = {
    splitEqually,
    computePayerShareFromCustomSplit,
};
