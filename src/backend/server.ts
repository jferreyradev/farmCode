import 'dotenv/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { Readable } from 'node:stream';
import { registerUploadRoutes } from './routes/upload.js';
import { registerPricesRoutes } from './routes/prices.js';
import { closePool, verificarConexion } from '../database/db.js';

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024; // 64 MB

function parseAllowedOrigins(): string[] | true {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw || raw === '*') return true;
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    bodyLimit: MAX_UPLOAD_BYTES,
  });

  await app.register(cors, { origin: parseAllowedOrigins() });

  // ---- Seguridad del endpoint de carga --------------------------------
  // Si ADMIN_API_KEY está definida, todo POST a /api/sucursales/:id/precios/csv
  // exige el header 'x-api-key: <clave>' o 'Authorization: Bearer <clave>'.
  // Los GET (lista pública, cartel, health) siguen abiertos: es información
  // pública según la Res. Conjunta 2/2025.
  const adminKey = process.env.ADMIN_API_KEY;
  const claveValida = (provista: unknown): boolean => {
    if (!adminKey || typeof provista !== 'string' || provista.length === 0) return false;
    // Hash de ambos lados para comparar en tiempo constante sin filtrar longitud
    const a = createHash('sha256').update(provista, 'utf8').digest();
    const b = createHash('sha256').update(adminKey, 'utf8').digest();
    return timingSafeEqual(a, b);
  };

  app.addHook('onRequest', async (request, reply) => {
    if (!adminKey) return;
    if (request.method !== 'POST' || !request.url.startsWith('/api/sucursales/')) return;
    const h = request.headers;
    const bearer =
      typeof h.authorization === 'string' && h.authorization.startsWith('Bearer ')
        ? h.authorization.slice(7).trim()
        : undefined;
    const raw = h['x-api-key'];
    const provista = bearer ?? (Array.isArray(raw) ? raw[0] : raw);
    if (!claveValida(provista)) {
      return reply.code(401).send({
        ok: false,
        error:
          'No autorizado: falta la clave de administrador o es inválida. Enviá el header x-api-key.',
      });
    }
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
    },
  });

  // Permite además enviar el CSV crudo como body (Content-Type: text/csv),
  // útil para cron jobs con `curl --data-binary`.
  app.addContentTypeParser<string>(
    ['text/csv', 'application/csv'],
    { parseAs: 'string', bodyLimit: MAX_UPLOAD_BYTES },
    (_req, body, done) => done(null, body)
  );

  app.get('/health', async (_req, reply) => {
    const dbOk = await verificarConexion();
    if (!dbOk) return reply.code(503).send({ status: 'degraded', db: 'down' });
    return {
      status: 'ok',
      db: 'up',
      version: process.env.npm_package_version ?? '1.0.0',
      uptime_s: Math.round(process.uptime()),
    };
  });

  app.get('/', async () => ({
    servicio: 'API Lista de Precios - Res. Conjunta 2/2025',
    documentacion: '/docs (ver docs/API.md del repositorio)',
    endpoints: [
      'POST /api/sucursales/:id_sucursal/precios/csv',
      'GET  /api/sucursales/:id_sucursal/precios?q=&venta_libre=',
      'GET  /api/sucursales/:id_sucursal/cartel.pdf',
      'GET  /health',
    ],
  }));

  await app.register(registerUploadRoutes);
  await app.register(registerPricesRoutes);

  return app;
}

async function main() {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`Señal ${signal} recibida: cerrando servidor...`);
    try {
      await app.close();
      await closePool();
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error durante el apagado');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  const port = Number(process.env.PORT ?? 3000);
  if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_API_KEY) {
    app.log.warn(
      'ADMIN_API_KEY sin definir en producción: el endpoint de carga de precios queda SIN autenticación.'
    );
  }
  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err, 'No se pudo iniciar el servidor');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error fatal al arrancar:', err);
  process.exit(1);
});

export { buildApp };
export type { FastifyInstance };
// Re-export para pruebas o reuso
export { Readable };
