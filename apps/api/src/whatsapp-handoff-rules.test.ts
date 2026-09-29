import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botPaused, isOutsideHumanHours, outsideHoursText, wantsHuman } from './whatsapp-handoff-rules.js';

test('pedidos claros de atendente', () => {
  for (const text of ['atendente', 'Atendente, por favor', 'humano', 'equipe', 'quero falar com um atendente', 'Posso falar com alguém da equipe?', 'preciso de um atendente',
    'me passa pra uma pessoa', 'quero falar com o gerente', 'atendimento humano', 'não quero falar com robô', 'conversar com a equipe', '[Transcrição do áudio] quero falar com uma pessoa'])
    assert.equal(wantsHuman(text), true, text);
});

test('palavras soltas não pausam o bot', () => {
  for (const text of ['Minha equipe quer reservar sábado', 'sou da equipe de vôlei', 'somos 10 pessoas', 'a quadra comporta quantas pessoas?', 'o atendente de ontem disse que tinha vaga',
    'quero reservar para uma pessoa só', 'oi', 'quais horários vocês têm amanhã?'])
    assert.equal(wantsHuman(text), false, text);
});

test('fluxo guiado aceita "atendente" em qualquer lugar', () => {
  assert.equal(wantsHuman('o atendente de ontem disse que tinha vaga', true), true);
  assert.equal(wantsHuman('Minha equipe quer reservar sábado', true), false);
});

test('horário humano no fuso da arena', () => {
  const bot = { timeZone: 'America/Belem', humanStart: '08:00', humanEnd: '18:00', outsideHoursMessage: 'das {inicio} às {fim}' };
  assert.equal(isOutsideHumanHours(bot, new Date('2026-09-29T13:00:00Z')), false); // 10:00 em Belém
  assert.equal(isOutsideHumanHours(bot, new Date('2026-09-29T22:30:00Z')), true); // 19:30
  assert.equal(isOutsideHumanHours(bot, new Date('2026-09-29T10:59:00Z')), true); // 07:59
  assert.equal(isOutsideHumanHours({ ...bot, timeZone: '' }, new Date('2026-09-29T03:00:00Z')), false);
  assert.equal(outsideHoursText(bot), 'das 08:00 às 18:00');
});

test('pausa do bot', () => {
  const now = Date.parse('2026-09-29T12:00:00Z'), human = (hoursAgo: number) => ({ step: 'human', updatedAt: new Date(now - hoursAgo * 3_600_000).toISOString() });
  assert.equal(botPaused(undefined, { manualResumeOnly: true, reactivateAfterHours: 4 }, now), false);
  assert.equal(botPaused({ step: '', updatedAt: '' }, { manualResumeOnly: true, reactivateAfterHours: 4 }, now), false);
  assert.equal(botPaused(human(100), { manualResumeOnly: true, reactivateAfterHours: 4 }, now), true);
  assert.equal(botPaused(human(3), { manualResumeOnly: false, reactivateAfterHours: 4 }, now), true);
  assert.equal(botPaused(human(5), { manualResumeOnly: false, reactivateAfterHours: 4 }, now), false);
});
