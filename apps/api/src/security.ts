// Regras de segurança da API (sem banco, para poder testar isolado).

/** Faixas oficiais do Cloudflare (https://www.cloudflare.com/ips/), conferidas em 29/09/2026. */
export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];
/** Rede interna do servidor (Docker, Traefik, nginx). */
const PRIVATE_NETWORKS = ['loopback', 'linklocal', 'uniquelocal'];

/**
 * Em quem a API confia para saber o IP real do cliente (cabeçalho X-Forwarded-For).
 * - "cloudflare": rede interna + Cloudflare. O IP do cliente não pode ser falsificado, nem por quem pular o Cloudflare.
 * - lista separada por vírgula: faixas/palavras aceitas pelo Fastify (ex.: "loopback,10.0.0.0/8").
 * - "true": confia em qualquer um (só para testes locais; em produção permitiria falsificar o IP).
 * - vazio/"false": não confia; atrás de proxy, todos os usuários parecem o mesmo IP.
 */
export function trustProxySetting(value = ''): boolean | string[] {
  const v = value.trim().toLowerCase();
  if (!v || v === 'false') return false;
  if (v === 'true') return true;
  if (v === 'cloudflare') return [...PRIVATE_NETWORKS, ...CLOUDFLARE_RANGES];
  return v.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * Proteção contra requisições forjadas por outros sites (CSRF), além do cookie SameSite=Lax.
 * Bloqueia escrita vinda de outra origem; aceita pedidos sem Origin (integrações e servidores) e webhooks.
 */
export function crossSiteWriteBlocked(input: { method: string; url: string; origin?: string | undefined; fetchSite?: string | undefined; host?: string | undefined; allowedOrigins: string[] }) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(input.method.toUpperCase())) return false;
  if (input.url.startsWith('/api/webhooks/')) return false;
  if (input.fetchSite === 'cross-site') return true;
  if (!input.origin) return false;
  const origin = input.origin.replace(/\/$/, '').toLowerCase();
  if (input.allowedOrigins.includes(origin)) return false;
  // Mesmo site: a origem é o próprio endereço que o navegador acessou (Host), seja qual for o domínio.
  // Compara só o host porque o TLS termina antes (Cloudflare/Traefik) e o protocolo chega como http.
  try { return !input.host || new URL(origin).host !== input.host.toLowerCase(); } catch { return true; }
}

/**
 * Tentativas de senha por conta (além do limite por IP): depois de `max` erros na janela, a conta fica
 * bloqueada até a janela passar. Protege contra quem tenta senhas de uma conta a partir de vários IPs.
 */
export class AccountLockout {
  private failures = new Map<string, number[]>();
  constructor(private max = 8, private windowMs = 15 * 60_000, private now = () => Date.now()) {}
  private recent(key: string) {
    const cutoff = this.now() - this.windowMs, list = (this.failures.get(key) || []).filter((at) => at > cutoff);
    if (list.length) this.failures.set(key, list); else this.failures.delete(key);
    return list;
  }
  /** Segundos até liberar, ou 0 se a conta pode tentar. */
  retryAfter(key: string) {
    const list = this.recent(key);
    return list.length >= this.max ? Math.ceil((list[0]! + this.windowMs - this.now()) / 1000) : 0;
  }
  fail(key: string) {
    const list = this.recent(key); list.push(this.now()); this.failures.set(key, list);
    if (this.failures.size > 10_000) for (const k of [...this.failures.keys()].slice(0, 1_000)) this.failures.delete(k);
  }
  succeed(key: string) { this.failures.delete(key); }
}
