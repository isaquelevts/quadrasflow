type PriceSlot = { weekday: number; startTime: string; endTime: string; priceCents: number };

/** Prices reservations in 30-minute blocks, using the configured weekly tariff. */
export function bookingAmountCents(startAt: string, endAt: string, fallbackHourlyCents: number, slots: PriceSlot[]) {
  const start = Date.parse(startAt), end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || (end - start) % 1_800_000) {
    throw new Error('Invalid reservation interval');
  }
  let total = 0;
  for (let instant = start; instant < end; instant += 1_800_000) {
    const date = new Date(instant), weekday = date.getUTCDay();
    const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
    const slot = slots.find((item) => item.weekday === weekday && item.startTime <= time && time < item.endTime);
    total += Math.round((slot?.priceCents ?? fallbackHourlyCents) / 2);
  }
  return total;
}
