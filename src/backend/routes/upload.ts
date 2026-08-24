import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { importCsvFromStream } from '../services/csvService.js';

const ID_SUCURSAL_RE = /^[\w.\-]{1,64}$/;

export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/sucursales/:id_sucursal/precios/csv', async (request, reply) => {
    const { id_sucursal } = request.params as { id_sucursal: string };

    if (!ID_SUCURSAL_RE.test(id_sucursal)) {
      return reply.code(400).send({
        ok: false,
        error:
          'id_sucursal inválido. Solo se permiten letras, números, punto, guion y guion bajo (máx. 64).',
      });
    }

    const contentType = String(request.headers['content-type'] ?? '');
    let csvStream: Readable;
    let filename = 'precios.csv';

    try {
      if (/^(text\/csv|application\/csv)/i.test(contentType)) {
        csvStream = Readable.from(request.body as string);
      } else if (contentType.includes('multipart/form-data')) {
        const part = await request.file();
        if (!part) {
          return reply.code(400).send({
            ok: false,
            error:
              "No se encontró el archivo en el formulario multipart. Usá el campo 'file' (curl -F \"file=@precios.csv\").",
          });
        }
        filename = part.filename || filename;
        part.file.on('limit', () => {
          part.file.destroy(new Error('El archivo excede el tamaño máximo permitido (64 MB).'));
        });
        csvStream = part.file;
      } else {
        return reply.code(415).send({
          ok: false,
          error:
            'Content-Type no soportado. Enviá multipart/form-data con un campo de archivo, o text/csv con el contenido crudo.',
        });
      }

      const resultado = await importCsvFromStream(csvStream, id_sucursal);
      request.log.info(resultado, 'Importación de precios completada');

      return reply.code(200).send({ ok: true, archivo: filename, ...resultado });
    } catch (err) {
      request.log.error(err, 'Error importando CSV');
      const mensaje = err instanceof Error ? err.message : 'Error desconocido';
      const esErrorDeDatos =
        /Línea \d+/.test(mensaje) || /CSV/i.test(mensaje) || /precio|gtin|nombre/i.test(mensaje);
      return reply
        .code(esErrorDeDatos ? 422 : 500)
        .send({ ok: false, error: mensaje });
    }
  });
}
