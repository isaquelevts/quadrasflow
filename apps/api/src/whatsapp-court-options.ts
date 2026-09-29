export type CourtOptionSlot = { inicio: string; valor: string; amountCents: number };
export type CourtOption = { id: string; name: string; sport: string };

export function courtOptionsMessage(date: string, startTime: string, endTime: string, courts: readonly CourtOption[]): string {
  if (!courts.length) return `Não encontrei quadras disponíveis em ${date}, das ${startTime} às ${endTime}. Qual outro horário ou data você prefere?`;
  const options = courts.map((court, index) => `${index + 1}. ${court.name} · ${court.sport}`).join('\n');
  return `📅 ${date}, das ${startTime} às ${endTime}, temos estas quadras disponíveis:\n${options}\n\nQual você prefere? Envie o número.`;
}

/** Retorna, na ordem recebida, somente quadras com o horário exato disponível. */
export async function availableCourtOptions(
  courts: readonly CourtOption[],
  day: string,
  startTime: string,
  durationMinutes: number,
  checkAvailability: (courtId: string, day: string, durationMinutes: number) => Promise<{ slots: CourtOptionSlot[] }>,
): Promise<Array<CourtOption & CourtOptionSlot>> {
  const options: Array<(CourtOption & CourtOptionSlot) | null> = await Promise.all(courts.map(async (court) => {
    const result = await checkAvailability(court.id, day, durationMinutes);
    const slot = result.slots.find((candidate) => candidate.inicio === startTime);
    return slot ? { ...court, ...slot } : null;
  }));
  return options.filter((option): option is CourtOption & CourtOptionSlot => option !== null);
}
