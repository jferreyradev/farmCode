-- ============================================================================
-- Sistema de Lista de Precios - Res. Conjunta 2/2025 (Secretaría de Industria
-- y Comercio / Secretaría de Gestión Sanitaria - Argentina)
--
-- DDL PostgreSQL compatible con Supabase.
-- Ejecutar completo en el SQL Editor de Supabase o vía psql:
--   psql "$DATABASE_URL" -f src/database/schema.sql
-- ============================================================================

-- Extensión para búsquedas por similitud (ILIKE '%texto%') con índices GIN
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----------------------------------------------------------------------------
-- Tabla: sucursales
-- Puntos de venta de la farmacia. El id_sucursal es un código de negocio
-- legible (ej: SUC-001) para que pueda venir en el QR y en el ERP sin exponer UUIDs.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sucursales (
    id_sucursal   TEXT        PRIMARY KEY,
    nombre        TEXT        NOT NULL,
    direccion     TEXT,
    telefono      TEXT,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Tabla: medicamentos
-- Catálogo maestro identificado por GTIN (código de barras EAN-13).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS medicamentos (
    id               BIGSERIAL    PRIMARY KEY,
    gtin             TEXT         NOT NULL UNIQUE,
    nombre_comercial TEXT         NOT NULL,
    principio_activo TEXT         NOT NULL DEFAULT '',
    presentacion     TEXT,
    laboratorio      TEXT,
    es_venta_libre   BOOLEAN      NOT NULL DEFAULT FALSE,
    creado_en        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actualizado_en   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Tabla: inventario_precios
-- Precio final de venta al público por sucursal y medicamento.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventario_precios (
    id_sucursal          TEXT          NOT NULL REFERENCES sucursales(id_sucursal) ON DELETE CASCADE,
    medicamento_id       BIGINT        NOT NULL REFERENCES medicamentos(id) ON DELETE CASCADE,
    precio_venta_publico NUMERIC(12,2) NOT NULL CHECK (precio_venta_publico >= 0),
    disponible           BOOLEAN       NOT NULL DEFAULT TRUE,
    actualizado_en       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (id_sucursal, medicamento_id)
);

-- ----------------------------------------------------------------------------
-- Tabla: historico_precios
-- Auditoría automática de cambios de precio (alimentada por el trigger).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historico_precios (
    id              BIGSERIAL     PRIMARY KEY,
    id_sucursal     TEXT          NOT NULL,
    medicamento_id  BIGINT        NOT NULL,
    precio_anterior NUMERIC(12,2),
    precio_nuevo    NUMERIC(12,2),
    origen_cambio   TEXT          NOT NULL DEFAULT 'CSV',  -- CSV | MANUAL | OTRO
    registrado_en   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- TRIGGER: auditar_cambio_precio
-- Inserta automáticamente un registro en historico_precios cada vez que el
-- campo precio_venta_publico cambia de valor en inventario_precios.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auditar_cambio_precio()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.precio_venta_publico IS DISTINCT FROM OLD.precio_venta_publico THEN
        INSERT INTO historico_precios
            (id_sucursal, medicamento_id, precio_anterior, precio_nuevo, origen_cambio)
        VALUES
            (OLD.id_sucursal, OLD.medicamento_id, OLD.precio_venta_publico, NEW.precio_venta_publico, 'CSV');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditar_cambio_precio ON inventario_precios;
CREATE TRIGGER trg_auditar_cambio_precio
AFTER UPDATE OF precio_venta_publico ON inventario_precios
FOR EACH ROW
EXECUTE FUNCTION auditar_cambio_precio();

-- ----------------------------------------------------------------------------
-- TRIGGER: mantener actualizado_en en medicamentos
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tocar_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tocar_actualizado_en ON medicamentos;
CREATE TRIGGER trg_tocar_actualizado_en
BEFORE UPDATE ON medicamentos
FOR EACH ROW
EXECUTE FUNCTION tocar_actualizado_en();

-- ----------------------------------------------------------------------------
-- ÍNDICES optimizados para búsqueda por nombre comercial y principio activo.
-- Los índices GIN trgm aceleran ILIKE '%termino%' desde el frontend.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_medicamentos_nombre_trgm
    ON medicamentos USING gin (nombre_comercial gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_medicamentos_principio_trgm
    ON medicamentos USING gin (principio_activo gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_medicamentos_nombre_lower
    ON medicamentos (lower(nombre_comercial));

CREATE INDEX IF NOT EXISTS idx_inventario_sucursal_disponible
    ON inventario_precios (id_sucursal, disponible);

CREATE INDEX IF NOT EXISTS idx_historico_sucursal_fecha
    ON historico_precios (id_sucursal, registrado_en DESC);

-- ----------------------------------------------------------------------------
-- SEGURIDAD SUPABASE: Row Level Security
--
-- El backend se conecta con el rol dueño de las tablas (connection string con
-- usuario postgres), que omite RLS, por lo que la API sigue funcionando igual.
--
-- Al activar RLS SIN políticas públicas, la Data API automática de Supabase
-- (anon key) queda bloqueada para estas tablas: nadie puede leer ni escribir
-- los precios desde fuera salvo a través de tu propio backend.
--
-- Si algún día querés exponer lectura pública vía la Data API de Supabase,
-- descomentá la política de ejemplo al final de este archivo.
-- ----------------------------------------------------------------------------
ALTER TABLE sucursales         ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicamentos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario_precios ENABLE ROW LEVEL SECURITY;
ALTER TABLE historico_precios  ENABLE ROW LEVEL SECURITY;

-- Política opcional de SOLO LECTURA pública (descomentar solo si la necesitás):
-- CREATE POLICY "lectura_publica_sucursales"
--     ON sucursales FOR SELECT TO anon, authenticated USING (true);
-- CREATE POLICY "lectura_publica_medicamentos"
--     ON medicamentos FOR SELECT TO anon, authenticated USING (true);
-- CREATE POLICY "lectura_publica_inventario"
--     ON inventario_precios FOR SELECT TO anon, authenticated USING (true);
