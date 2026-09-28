import type { FastifyInstance } from 'fastify';
import { query } from '../../database/db.js';
import { generarCartelPdf } from '../services/pdfService.js';

interface FilaPrecio {
  gtin: string;
  nombre_comercial: string;
  principio_activo: string;
  presentacion: string | null;
  laboratorio: string | null;
  es_venta_libre: boolean;
  precio: number;
  actualizado: string;
  total_registros: number;
}

const TZ_AR = 'America/Argentina/Buenos_Aires';

export async function registerPricesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sucursales/:id_sucursal/precios', async (request, reply) => {
    const { id_sucursal } = request.params as { id_sucursal: string };
    const qs = request.query as {
      q?: string;
      venta_libre?: string;
      limit?: string;
      page?: string;
    };

    const sucursalRes = await query<{ id_sucursal: string; nombre: string; direccion: string | null }>(
      'SELECT id_sucursal, nombre, direccion FROM sucursales WHERE id_sucursal = $1',
      [id_sucursal]
    );
    if (sucursalRes.rowCount === 0) {
      return reply.code(404).send({
        ok: false,
        error: `La sucursal '${id_sucursal}' no existe. Subí primero su lista de precios.`,
      });
    }

    const q = (qs.q ?? '').trim().slice(0, 100);
    const ventaLibre = qs.venta_libre?.toLowerCase();
    const limit = Math.min(Math.max(Number.parseInt(qs.limit ?? '500', 10) || 500, 1), 1000);
    const page = Math.max(Number.parseInt(qs.page ?? '1', 10) || 1, 1);
    const offset = (page - 1) * limit;

    const condiciones: string[] = [];
    const valores: unknown[] = [id_sucursal];

    if (q) {
      valores.push(`%${q}%`);
      const idx = valores.length;
      condiciones.push(
        `(m.nombre_comercial ILIKE $${idx} OR m.principio_activo ILIKE $${idx})`
      );
    }
    if (ventaLibre === 'true' || ventaLibre === 'false') {
      valores.push(ventaLibre === 'true');
      condiciones.push(`m.es_venta_libre = $${valores.length}`);
    }

    const whereExtra =
      condiciones.length > 0 ? `AND ${condiciones.join(' AND ')}` : 'AND TRUE';

    valores.push(limit, offset);
    const idxLimit = valores.length - 1;
    const idxOffset = valores.length;

    const sql = `
      SELECT
        m.gtin,
        m.nombre_comercial,
        m.principio_activo,
        m.presentacion,
        m.laboratorio,
        m.es_venta_libre,
        ip.precio_venta_publico::float8 AS precio,
        to_char(ip.actualizado_en AT TIME ZONE '${TZ_AR}', 'YYYY-MM-DD HH24:MI') AS actualizado,
        (count(*) OVER ())::int AS total_registros
      FROM inventario_precios ip
      JOIN medicamentos m ON m.id = ip.medicamento_id
      WHERE ip.id_sucursal = $1
        AND ip.disponible = TRUE
        ${whereExtra}
      ORDER BY m.nombre_comercial ASC
      LIMIT $${idxLimit} OFFSET $${idxOffset}
    `;

    const preciosRes = await query<FilaPrecio>(sql, valores);

    const ultimaRes = await query<{ ultima_actualizacion: string | null }>(
      `SELECT to_char(max(actualizado_en) AT TIME ZONE '${TZ_AR}', 'YYYY-MM-DD HH24:MI') AS ultima_actualizacion
       FROM inventario_precios WHERE id_sucursal = $1`,
      [id_sucursal]
    );

    const total = preciosRes.rows[0]?.total_registros ?? 0;
    const items = preciosRes.rows.map((fila: FilaPrecio) => {
      const { total_registros: _t, ...resto } = fila;
      return resto;
    });

    return reply.send({
      ok: true,
      sucursal: sucursalRes.rows[0],
      total,
      limit,
      page,
      ultima_actualizacion: ultimaRes.rows[0]?.ultima_actualizacion ?? null,
      items,
    });
  });

  app.get('/api/sucursales/:id_sucursal/cartel.pdf', async (request, reply) => {
    const { id_sucursal } = request.params as { id_sucursal: string };

    const sucursalRes = await query<{ nombre: string }>(
      'SELECT nombre FROM sucursales WHERE id_sucursal = $1',
      [id_sucursal]
    );
    if (sucursalRes.rowCount === 0) {
      return reply.code(404).send({ ok: false, error: `La sucursal '${id_sucursal}' no existe.` });
    }

    const pdfBuffer = await generarCartelPdf({
      id_sucursal,
      nombre: sucursalRes.rows[0].nombre,
    });

    return reply
      .header('Content-Type', 'application/pdf')
      .header(
        'Content-Disposition',
        `inline; filename="cartel-precios-${encodeURIComponent(id_sucursal)}.pdf"`
      )
      .send(pdfBuffer);
  });
}
