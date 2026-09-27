import { Readable } from 'node:stream';
import type { PoolClient } from 'pg';
import csvParser from 'csv-parser';
import { withTransaction } from '../../database/db.js';

export interface ImportResult {
  id_sucursal: string;
  filas_procesadas: number;
  medicamentos_unicos: number;
  lotes: number;
  duracion_ms: number;
}

interface FilaNormalizada {
  gtin: string;
  nombre_comercial: string;
  principio_activo: string;
  presentacion: string;
  laboratorio: string;
  es_venta_libre: boolean;
  precio: string; // se envía como texto para el cast a NUMERIC
  disponible: boolean;
}

const BATCH_SIZE = 500;

const VALORES_VERDADEROS = new Set(['1', 'true', 'si', 'sí', 'y', 'yes', 'v', 'verdadero']);
const VALORES_FALSOS = new Set(['0', 'false', 'no', 'n', 'falso']);

function str(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : valor == null ? '' : String(valor).trim();
}

function parseBool(
  raw: unknown,
  porDefecto: boolean,
  linea: number,
  campo: string
): boolean {
  const v = str(raw).toLowerCase();
  if (v === '') return porDefecto;
  if (VALORES_VERDADEROS.has(v)) return true;
  if (VALORES_FALSOS.has(v)) return false;
  throw new Error(`Línea ${linea}: valor inválido para '${campo}': "${str(raw)}"`);
}

export function parsePrecio(raw: unknown, linea: number): string {
  let s = str(raw).replace(/[$\s]/g, '');
  if (!s) throw new Error(`Línea ${linea}: el campo 'precio' está vacío`);

  const tieneComa = s.includes(',');
  const tienePunto = s.includes('.');
  if (tieneComa && tienePunto) {
    // Formato es-AR "1.234,56": puntos de miles, coma decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (tieneComa) {
    s = s.replace(',', '.');
  }

  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Línea ${linea}: 'precio' inválido: "${str(raw)}"`);
  }
  return n.toFixed(2);
}

function normalizarFila(row: Record<string, unknown>, linea: number): FilaNormalizada {
  const gtin = str(row.gtin).replace(/\s+/g, '');
  if (!gtin) throw new Error(`Línea ${linea}: el campo 'gtin' está vacío`);

  const nombreComercial = str(row.nombre_comercial);
  if (!nombreComercial) throw new Error(`Línea ${linea}: el campo 'nombre_comercial' está vacío`);

  return {
    gtin,
    nombre_comercial: nombreComercial,
    principio_activo: str(row.principio_activo),
    presentacion: str(row.presentacion),
    laboratorio: str(row.laboratorio),
    es_venta_libre: parseBool(row.es_venta_libre, false, linea, 'es_venta_libre'),
    precio: parsePrecio(row.precio, linea),
    disponible: parseBool(row.disponible, true, linea, 'disponible'),
  };
}

async function flushBatch(
  tx: PoolClient,
  idSucursal: string,
  batch: Map<string, FilaNormalizada>
): Promise<void> {
  const rows = [...batch.values()];
  batch.clear();
  if (rows.length === 0) return;

  // UPSERT del catálogo maestro de medicamentos (por GTIN)
  await tx.query(
    `INSERT INTO medicamentos AS m
        (gtin, nombre_comercial, principio_activo, presentacion, laboratorio, es_venta_libre)
     SELECT r.gtin, r.nombre_comercial, r.principio_activo, r.presentacion, r.laboratorio, r.es_venta_libre
     FROM unnest(
            $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::boolean[]
         ) AS r(gtin, nombre_comercial, principio_activo, presentacion, laboratorio, es_venta_libre)
     ON CONFLICT (gtin) DO UPDATE SET
        nombre_comercial = EXCLUDED.nombre_comercial,
        principio_activo = EXCLUDED.principio_activo,
        presentacion     = EXCLUDED.presentacion,
        laboratorio      = EXCLUDED.laboratorio,
        es_venta_libre   = EXCLUDED.es_venta_libre,
        actualizado_en   = now()`,
    [
      rows.map((r) => r.gtin),
      rows.map((r) => r.nombre_comercial),
      rows.map((r) => r.principio_activo),
      rows.map((r) => r.presentacion),
      rows.map((r) => r.laboratorio),
      rows.map((r) => r.es_venta_libre),
    ]
  );

  // UPSERT de precios por sucursal. El trigger trg_auditar_cambio_precio
  // registra automáticamente en historico_precios cuando cambia el precio.
  await tx.query(
    `INSERT INTO inventario_precios AS ip
        (id_sucursal, medicamento_id, precio_venta_publico, disponible)
     SELECT $1, m.id, r.precio::numeric(12,2), r.disponible
     FROM unnest($2::text[], $3::text[], $4::boolean[]) AS r(gtin, precio, disponible)
     JOIN medicamentos m ON m.gtin = r.gtin
     ON CONFLICT (id_sucursal, medicamento_id) DO UPDATE SET
        precio_venta_publico = EXCLUDED.precio_venta_publico,
        disponible           = EXCLUDED.disponible,
        actualizado_en       = now()`,
    [idSucursal, rows.map((r) => r.gtin), rows.map((r) => r.precio), rows.map((r) => r.disponible)]
  );
}

export async function importCsvFromStream(
  input: Readable,
  idSucursal: string
): Promise<ImportResult> {
  const inicio = Date.now();

  const parser = csvParser({
    mapHeaders: ({ header }) =>
      header
        .toString()
        .trim()
        .toLowerCase()
        .replace(/^\uFEFF/, '')
        .replace(/\s+/g, '_'),
  });

  // Propaga errores del stream de entrada al parser para abortar la iteración
  input.on('error', (err) => parser.destroy(err));
  input.pipe(parser);

  let filasProcesadas = 0;
  let medicamentosUnicos = 0;
  let lotes = 0;
  let linea = 1; // línea 1 = encabezado

  return withTransaction(async (tx) => {
    // Garantiza que la sucursal exista (creación automática en primera carga)
    await tx.query(
      `INSERT INTO sucursales (id_sucursal, nombre)
       VALUES ($1, $1)
       ON CONFLICT (id_sucursal) DO NOTHING`,
      [idSucursal]
    );

    const batch = new Map<string, FilaNormalizada>();

    try {
      for await (const row of parser) {
        linea++;
        filasProcesadas++;

        const fila = normalizarFila(row as Record<string, unknown>, linea);

        // Deduplicación intra-lote: si el GTIN se repite, gana la última fila
        batch.set(fila.gtin, fila);

        if (batch.size >= BATCH_SIZE) {
          await flushBatch(tx, idSucursal, batch);
          medicamentosUnicos += BATCH_SIZE;
          lotes++;
        }
      }

      if (batch.size > 0) {
        await flushBatch(tx, idSucursal, batch);
        medicamentosUnicos += batch.size;
        lotes++;
        batch.clear();
      }
    } catch (err) {
      parser.destroy();
      throw err; // withTransaction ejecutará ROLLBACK atómico
    }

    if (filasProcesadas === 0) {
      throw new Error(
        'CSV sin filas de datos. Verificá que las columnas sean: gtin, nombre_comercial, principio_activo, presentacion, laboratorio, es_venta_libre, precio, disponible'
      );
    }

    return {
      id_sucursal: idSucursal,
      filas_procesadas: filasProcesadas,
      medicamentos_unicos: medicamentosUnicos,
      lotes,
      duracion_ms: Date.now() - inicio,
    };
  });
}
