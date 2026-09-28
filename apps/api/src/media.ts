import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

const mediaRoot = process.env.ARENA_MEDIA_DIR || '/data/media';
const maxBytes = 6 * 1024 * 1024;
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

function companyFolder(companyId: string) {
  return createHash('sha256').update(companyId).digest('hex').slice(0, 32);
}

export async function registerMediaRoutes(app: FastifyInstance) {
  app.post('/api/arena/media', { config: { rateLimit: { max: 30, timeWindow: 60 * 60 * 1000 } }, onRequest: app.authenticate }, async (request, reply) => {
    const user = request.user;
    if (!user) throw fail(401, 'Entre na sua conta para continuar.');
    if (user.role !== 'arena_admin') throw fail(403, 'Somente o administrador da arena pode enviar imagens.');
    if (!user.company) throw fail(403, 'Esta conta não pertence a uma arena.');
    const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'image/webp') throw fail(415, 'Envie uma imagem WebP.');
    const image = request.body;
    if (!Buffer.isBuffer(image) || image.length < 16 || image.length > maxBytes) throw fail(400, 'A imagem precisa ter entre 16 bytes e 6 MB.');
    if (image.toString('ascii', 0, 4) !== 'RIFF' || image.toString('ascii', 8, 12) !== 'WEBP') throw fail(400, 'O arquivo enviado não é uma imagem WebP válida.');

    const folder = companyFolder(user.company.id);
    const filename = `${randomUUID()}.webp`;
    const directory = join(mediaRoot, folder);
    await mkdir(directory, { recursive: true, mode: 0o750 });
    await writeFile(join(directory, filename), image, { flag: 'wx', mode: 0o640 });
    return reply.code(201).send({ url: `/api/arena/media/${folder}/${filename}` });
  });

  app.get<{ Params: { folder: string; filename: string } }>('/api/arena/media/:folder/:filename', async (request, reply) => {
    const { folder, filename } = request.params;
    if (!/^[a-f0-9]{32}$/.test(folder) || !/^[a-f0-9-]{36}\.webp$/.test(filename)) throw fail(404, 'Imagem não encontrada.');
    try {
      const image = await readFile(join(mediaRoot, folder, filename));
      if (image.length > maxBytes || image.toString('ascii', 0, 4) !== 'RIFF' || image.toString('ascii', 8, 12) !== 'WEBP') throw fail(404, 'Imagem não encontrada.');
      return reply.type('image/webp').header('cache-control', 'public, max-age=31536000, immutable').header('x-content-type-options', 'nosniff').send(image);
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'statusCode' in cause) throw cause;
      throw fail(404, 'Imagem não encontrada.');
    }
  });
}
