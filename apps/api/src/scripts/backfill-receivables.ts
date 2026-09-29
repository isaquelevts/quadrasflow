// Uso único (idempotente) depois de publicar o "a receber" das reservas:
//   node dist/scripts/backfill-receivables.js          (só mostra o que faria)
//   node dist/scripts/backfill-receivables.js --apply  (aplica)
// - reservas confirmadas/concluídas de hoje em diante ganham o lançamento "a receber";
// - lançamentos em aberto de reservas canceladas ou pendentes são removidos (pagamentos nunca são apagados).
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { bookings, financeEntries } from '@quadrasflow/database';
import { client, db } from '../database.js';
import { planReceivable, syncBookingReceivable } from '../booking-finance.js';

const apply = process.argv.includes('--apply');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

const upcoming = await db.select({ id: bookings.id }).from(bookings).where(and(inArray(bookings.status, ['confirmed', 'completed']), gte(bookings.startAt, `${today}T00:00:00.000Z`)));
const stale = await db.selectDistinct({ id: bookings.id }).from(financeEntries).innerJoin(bookings, eq(bookings.id, financeEntries.bookingId))
  .where(and(isNotNull(financeEntries.bookingId), sql`${financeEntries.paidAt} IS NULL`, inArray(bookings.status, ['cancelled', 'pending'])));
const ids = [...new Set([...upcoming, ...stale].map((r) => r.id))];

let created = 0, updated = 0, removed = 0;
for (const id of ids) {
  const booking = (await db.select().from(bookings).where(eq(bookings.id, id)).limit(1))[0]!;
  const entries = await db.select().from(financeEntries).where(eq(financeEntries.bookingId, id));
  const plan = planReceivable(booking, entries);
  removed += plan.remove.length;
  if (plan.upsert?.id) { const current = entries.find((e) => e.id === plan.upsert!.id)!; if (current.amountCents !== plan.upsert.amountCents || current.description !== plan.upsert.description || current.dueDate !== plan.upsert.dueDate) updated++; }
  else if (plan.upsert) created++;
  if (apply) await db.transaction((tx) => syncBookingReceivable(tx, booking.companyId, id));
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', today, bookingsChecked: ids.length, created, updated, removed }));
await client.end({ timeout: 5 });
