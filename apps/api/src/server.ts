import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ErrorResponseSchema, HealthResponseSchema } from '@quadrasflow/contracts';
import { registerAuthRoutes } from './auth.js';
import { registerArenaRoutes } from './arena.js';
import { client as databaseClient } from './database.js';
import { registerFinanceMonthlyRoutes } from './finance-monthly.js';
import { registerTournamentRoutes } from './tournaments.js';
import { registerPublicRoutes } from './public.js';
import { registerWhatsAppRoutes } from './whatsapp.js';
import { registerPlatformRoutes } from './platform.js';
import { registerUserRoutes } from './users.js';
import { registerMercadoPagoRoutes } from './mercadopago.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-quadrasflow-secret', 'req.headers.x-api-key'],
    serializers: {
      req(request) {
        return { method: request.method, url: request.url.split('?')[0] || '', host: request.host, remoteAddress: request.ip };
      },
    },
  },
  trustProxy: process.env.TRUST_PROXY === 'true',
  requestIdHeader: 'x-request-id',
  bodyLimit: 1_000_000,
}).withTypeProvider<TypeBoxTypeProvider>();

await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
await app.register(swagger, {
  openapi: {
    info: { title: 'QuadrasFlow API', version: '1.0.0', description: 'API REST da plataforma QuadrasFlow.' },
    servers: [{ url: '/api/v1' }],
  },
});
await app.register(swaggerUi, { routePrefix: '/docs' });

app.get('/api/v1/health', {
  schema: {
    tags: ['system'],
    response: { 200: HealthResponseSchema, 500: ErrorResponseSchema },
  },
}, async () => ({ ok: true as const, service: 'quadrasflow-api', version: '1.0.0' }));

app.get('/api/health', async () => ({ ok: true as const }));
await registerAuthRoutes(app);
await registerArenaRoutes(app);
await registerFinanceMonthlyRoutes(app);
await registerTournamentRoutes(app);
await registerPublicRoutes(app);
await registerWhatsAppRoutes(app);
await registerPlatformRoutes(app);
await registerUserRoutes(app);
await registerMercadoPagoRoutes(app);
app.addHook('onClose', async () => { await databaseClient.end({ timeout: 5 }); });

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'Request failed');
  const candidateStatus = error instanceof Error && 'statusCode' in error ? Number(error.statusCode) : 500;
  const status = candidateStatus >= 400 && candidateStatus < 600 ? candidateStatus : 500;
  const code = status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
  const message = status >= 500 ? 'Ocorreu um erro interno.' : error instanceof Error ? error.message : 'Solicitação inválida.';
  return reply.status(status).send({ error: { code, message, requestId: request.id } });
});

const host = process.env.API_HOST || '127.0.0.1';
const port = Number(process.env.API_PORT || 3012);
await app.listen({ host, port });
