import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

/** Simulador do agente (aba "Testar agente"): roda o mesmo atendimento, mas nada sai para o WhatsApp, Mercado Pago ou equipe. */
export type SimulationEvent = { kind: 'reply' | 'note' | 'tool'; text: string };
const simulation = new AsyncLocalStorage<{ events: SimulationEvent[] }>();

export const isSimulating = () => Boolean(simulation.getStore());
export const simulationNote = (kind: SimulationEvent['kind'], text: string) => { simulation.getStore()?.events.push({ kind, text: text.slice(0, 2000) }); };
export async function runSimulation(work: () => Promise<unknown>) { const store = { events: [] as SimulationEvent[] }; await simulation.run(store, work); return store.events; }

/** Nenhum telefone real começa com 000: identifica o "cliente" do simulador de cada usuário. */
export const SIMULATOR_PREFIX = '000';
export const simulatorPhone = (userId: string) => SIMULATOR_PREFIX + (BigInt(`0x${createHash('sha256').update(userId).digest('hex').slice(0, 12)}`) % 10_000_000_000n).toString().padStart(10, '0');
export const isSimulatorPhone = (value: string) => value.replace(/\D/g, '').startsWith(SIMULATOR_PREFIX);
