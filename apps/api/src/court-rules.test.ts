import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstStart, parseCourtRules, primeMinimum, primeWhen, ruleProblem, ruleProblemText, validateCourtRules, type CourtRules } from './court-rules.js';

const h = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const nobre: CourtRules = { step: 30, prime: [{ days: [1, 2, 3, 4, 5], from: '19:00', to: '21:00', minMinutes: 120 }] };

test('regras guardadas: padrão e normalização', () => {
  assert.deepEqual(parseCourtRules({}), { step: 30, prime: [], cuts: [] });
  assert.deepEqual(parseCourtRules(null), { step: 30, prime: [], cuts: [] });
  assert.equal(parseCourtRules({ step: 60 }).step, 60);
  assert.deepEqual(parseCourtRules({ step: 30, prime: [{ days: [5, 1, 1], from: '19:00', to: '21:00', minMinutes: 120 }, { days: [], from: '19:00', to: '21:00', minMinutes: 120 }] }).prime, [{ days: [1, 5], from: '19:00', to: '21:00', minMinutes: 120 }]);
});

test('validação das Configurações', () => {
  assert.ok('error' in validateCourtRules({ step: 45 }));
  assert.ok('error' in validateCourtRules({ step: 30, prime: [{ days: [1], from: '21:00', to: '19:00', minMinutes: 120 }] }), 'intervalo invertido');
  assert.ok('error' in validateCourtRules({ step: 30, prime: [{ days: [1], from: '19:00', to: '21:00', minMinutes: 30 }] }), 'mínimo abaixo de 1h');
  assert.ok('error' in validateCourtRules({ step: 60, prime: [{ days: [1], from: '19:00', to: '21:00', minMinutes: 90 }] }), 'horas cheias com mínimo de 1h30');
  assert.deepEqual(validateCourtRules({ step: 60, prime: [{ days: [6, 0], from: '08:00', to: '12:00', minMinutes: 180 }] }), { rules: { step: 60, prime: [{ days: [0, 6], from: '08:00', to: '12:00', minMinutes: 180 }], cuts: [] } });
});

test('só horas cheias: início e duração', () => {
  const r: CourtRules = { step: 60, prime: [] };
  assert.equal(ruleProblem(r, 3, h('19:00'), h('20:00')), null);
  assert.equal(ruleProblem(r, 3, h('19:00'), h('21:00')), null);
  assert.equal(ruleProblem(r, 3, h('19:30'), h('20:30'))?.kind, 'start');
  assert.equal(ruleProblem(r, 3, h('19:00'), h('20:30'))?.kind, 'duration');
  assert.equal(ruleProblem(DEFAULT_LIKE(), 3, h('19:30'), h('21:00')), null, 'de 30 em 30 aceita 19:30 e 1h30');
});
const DEFAULT_LIKE = (): CourtRules => ({ step: 30, prime: [] });

test('horário nobre: mínimo no total para quem encosta no intervalo', () => {
  assert.equal(ruleProblem(nobre, 3, h('19:00'), h('20:00'))?.kind, 'prime', '19h–20h recusada');
  assert.equal(ruleProblem(nobre, 3, h('20:00'), h('21:00'))?.kind, 'prime', '20h–21h recusada');
  assert.equal(ruleProblem(nobre, 3, h('19:00'), h('21:00')), null, '19h–21h aceita');
  assert.equal(ruleProblem(nobre, 3, h('18:00'), h('20:00')), null, '18h–20h aceita (2h no total)');
  assert.equal(ruleProblem(nobre, 3, h('17:00'), h('18:00')), null, 'antes do intervalo');
  assert.equal(ruleProblem(nobre, 3, h('21:00'), h('22:00')), null, 'depois do intervalo (fim exclusivo)');
  assert.equal(ruleProblem(nobre, 3, h('18:00'), h('19:00')), null, 'termina exatamente no início do nobre');
  assert.equal(ruleProblem(nobre, 6, h('19:00'), h('20:00')), null, 'sábado não está na regra');
  assert.equal(ruleProblem(nobre, 3, h('20:30'), h('21:30'))?.minMinutes, 120);
});

test('várias regras: vale a maior exigência que encosta na reserva', () => {
  const r: CourtRules = { step: 30, prime: [{ days: [3], from: '18:00', to: '20:00', minMinutes: 90 }, { days: [3], from: '19:30', to: '22:00', minMinutes: 180 }] };
  assert.equal(primeMinimum(r, 3, h('18:00'), h('19:00')), 90);
  assert.equal(primeMinimum(r, 3, h('19:00'), h('20:00')), 180);
  assert.equal(primeMinimum(r, 4, h('19:00'), h('20:00')), 0);
});

test('textos para o cliente', () => {
  assert.equal(primeWhen(nobre.prime[0]!), 'seg a sex, das 19h às 21h');
  assert.equal(primeWhen({ days: [0, 6], from: '08:00', to: '12:30', minMinutes: 120 }), 'dom, sáb, das 8h às 12h30');
  assert.equal(primeWhen({ days: [0, 1, 2, 3, 4, 5, 6], from: '18:00', to: '23:00', minMinutes: 120 }), 'todos os dias, das 18h às 23h');
  assert.equal(ruleProblemText({ kind: 'duration' }, 'Society 1'), 'A Society 1 é alugada só em horas cheias (1h, 2h, 3h…).');
  assert.equal(ruleProblemText({ kind: 'start' }, 'Society 1'), 'Na Society 1 os horários começam sempre em hora cheia (19:00, 20:00…).');
  assert.equal(ruleProblemText(ruleProblem(nobre, 3, h('19:00'), h('20:00'))!, 'Areia 1'), 'No horário nobre (seg a sex, das 19h às 21h), a Areia 1 é alugada por no mínimo 2h.');
});

test('mínimo de 2h e 3h: começa em qualquer hora cheia', () => {
  assert.equal(parseCourtRules({ step: 120 }).step, 120);
  assert.equal(parseCourtRules({ step: 180 }).step, 180);
  assert.equal(parseCourtRules({ step: 90 }).step, 30, 'valor desconhecido volta ao padrão');
  const dois: CourtRules = { step: 120, prime: [] }, tres: CourtRules = { step: 180, prime: [] };
  assert.equal(ruleProblem(dois, 3, h('09:00'), h('11:00')), null, '09–11 aceita');
  assert.equal(ruleProblem(dois, 3, h('09:00'), h('12:00')), null, '09–12 (3h) aceita');
  assert.equal(ruleProblem(dois, 3, h('07:00'), h('12:00')), null, '5h aceita');
  assert.equal(ruleProblem(dois, 3, h('09:00'), h('10:00'))?.kind, 'minimum', '1h recusada');
  assert.equal(ruleProblem(dois, 3, h('09:30'), h('11:30'))?.kind, 'start', 'só hora cheia');
  assert.equal(ruleProblem(dois, 3, h('09:00'), h('11:30'))?.kind, 'duration', '2h30 recusada');
  assert.equal(ruleProblem(tres, 3, h('10:00'), h('13:00')), null, '3h aceita');
  assert.equal(ruleProblem(tres, 3, h('10:00'), h('14:00')), null, '4h aceita');
  assert.equal(ruleProblem(tres, 3, h('10:00'), h('12:00'))?.minMinutes, 180, '2h recusada');
  assert.equal(firstStart(dois, h('09:10')), h('10:00'));
  assert.equal(firstStart(dois, h('09:00')), h('09:00'));
});

test('mínimo de 2h/3h: validação e mensagens', () => {
  assert.ok('rules' in validateCourtRules({ step: 120, prime: [] }));
  assert.ok('rules' in validateCourtRules({ step: 120, prime: [{ days: [5], from: '18:00', to: '23:00', minMinutes: 180 }] }), 'mínimo de 3h no horário nobre de uma quadra de 2h');
  assert.ok('error' in validateCourtRules({ step: 120, prime: [{ days: [5], from: '18:00', to: '23:00', minMinutes: 150 }] }), '2h30 não é hora cheia');
  const dois: CourtRules = { step: 120, prime: [] };
  assert.equal(ruleProblemText(ruleProblem(dois, 3, h('08:00'), h('09:00'))!, 'Society 1'), 'A Society 1 é alugada por no mínimo 2h (pode começar em qualquer hora cheia).');
  assert.equal(ruleProblemText(ruleProblem(dois, 3, h('08:30'), h('10:30'))!, 'Society 1'), 'Na Society 1 os horários começam sempre em hora cheia (19:00, 20:00…).');
});

test('horário de corte: ninguém atravessa as 21h, exceto quem pega a noite toda (17h ou antes até o fechamento)', () => {
  const r = parseCourtRules({ step: 120, prime: [], cuts: [{ days: [0, 1, 2, 3, 4, 5, 6], at: '21:00', crossFrom: '17:00' }] }), close = h('24:00');
  const ok = (s: string, e: string) => ruleProblem(r, 3, h(s), e === '24:00' ? 1440 : h(e), 0, close);
  assert.equal(ok('17:00', '21:00'), null, '17–21');
  assert.equal(ok('18:00', '21:00'), null, '18–21');
  assert.equal(ok('19:00', '21:00'), null, '19–21');
  assert.equal(ok('21:00', '23:00'), null, '21–23');
  assert.equal(ok('21:00', '24:00'), null, '21–00');
  assert.equal(ok('17:00', '24:00'), null, '17–00 (a noite toda)');
  assert.equal(ok('16:00', '24:00'), null, '16–00 (começa antes das 17h)');
  assert.equal(ok('20:00', '24:00')?.kind, 'cut', '20–00 perde a tarde');
  assert.equal(ok('17:00', '22:00')?.kind, 'cut', '17–22');
  assert.equal(ok('20:00', '23:00')?.kind, 'cut', '20–23');
  assert.equal(ok('20:00', '21:00')?.kind, 'minimum', '20–21 barrado pelo mínimo de 2h');
  assert.equal(ruleProblem(r, 3, h('17:00'), 1440, 0, h('23:00'))?.kind, 'cut', 'fechamento às 23h: 17–00 não é "até o fechamento"');
  assert.equal(ruleProblem(r, 3, h('17:00'), h('23:00'), 0, h('23:00')), null, 'fechamento às 23h: 17–23 vai até o fechamento');
  assert.equal(ruleProblem(r, 3, h('17:00'), 1440, 0)?.kind, 'cut', 'sem o fechamento conhecido, a exceção não vale');
});

test('horário de corte: dias, sem exceção, validação e mensagem', () => {
  const semana = parseCourtRules({ step: 60, prime: [], cuts: [{ days: [1, 2, 3, 4, 5], at: '21:00', crossFrom: null }] });
  assert.equal(ruleProblem(semana, 6, h('20:00'), h('22:00'), 0, 1440), null, 'sábado não está na regra');
  assert.equal(ruleProblem(semana, 3, h('17:00'), 1440, 0, 1440)?.kind, 'cut', 'sem exceção, nem a noite toda atravessa');
  assert.deepEqual(parseCourtRules({ step: 30, prime: [] }).cuts, [], 'quadra antiga sem cortes');
  assert.ok('rules' in validateCourtRules({ step: 120, prime: [], cuts: [{ days: [5], at: '21:00', crossFrom: '17:00' }] }));
  assert.ok('error' in validateCourtRules({ step: 120, prime: [], cuts: [{ days: [], at: '21:00', crossFrom: null }] }), 'sem dias');
  assert.ok('error' in validateCourtRules({ step: 120, prime: [], cuts: [{ days: [5], at: '21:00', crossFrom: '22:00' }] }), 'exceção depois do corte');
  assert.ok('error' in validateCourtRules({ step: 120, prime: [], cuts: Array.from({ length: 6 }, () => ({ days: [1], at: '21:00', crossFrom: null })) }), 'mais de 5');
  const r = parseCourtRules({ step: 120, prime: [], cuts: [{ days: [3], at: '21:00', crossFrom: '17:00' }] });
  assert.equal(ruleProblemText(ruleProblem(r, 3, h('20:00'), h('23:00'), 0, 1440)!, 'Areia 1'), 'Às 21:00 começa outra turma na Areia 1: a reserva precisa terminar às 21:00 ou começar a partir das 21:00 (ou ir das 17:00, ou antes, até o fechamento).');
});
