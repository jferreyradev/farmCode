# API — Lista de Precios (Res. Conjunta 2/2025)

Base URL en producción: `https://<tu-servicio>.onrender.com`

---

## GET /health

Chequeo de estado (usar como Health Check Path en Render).

**Respuesta 200**
```json
{ "status": "ok", "db": "up", "version": "1.0.0", "uptime_s": 42 }
```
Si la base no responde devuelve `503 { "status": "degraded", "db": "down" }`.

---

## POST /api/sucursales/:id_sucursal/precios/csv

Importa/actualiza la lista de precios completa de una sucursal.
Toda la operación es **atómica**: ante cualquier fila inválida se hace ROLLBACK total.

### Parámetros de ruta

| Campo          | Tipo   | Reglas                                    |
|----------------|--------|-------------------------------------------|
| `id_sucursal`  | string | `[A-Za-z0-9._-]{1,64}`. Ej: `SUC-001`     |

### Modo A — multipart/form-data (recomendado)

```bash
curl -X POST "https://api.example.com/api/sucursales/SUC-001/precios/csv" \
  -H "Authorization: Bearer <token-opcional>" \
  -F "file=@precios.csv"
```

### Modo B — body crudo CSV (ideal para cron jobs)

```bash
curl -X POST "https://api.example.com/api/sucursales/SUC-001/precios/csv" \
  -H "Content-Type: text/csv" \
  --data-binary @precios.csv
```

### Formato del CSV (encabezados requeridos)

```csv
gtin,nombre_comercial,principio_activo,presentacion,laboratorio,es_venta_libre,precio,disponible
7790123456789,Amoxidal 500,Amoxicilina,Cápsulas x 20,Richet,false,2450.00,true
7790987654321,Ibuprofeno 400,Ibuprofeno,Comprimidos x 50,Bago,true,890.50,true
7791111222333,Rivotril 2mg,Clonazepam,Gotas x 20ml,Roche,false,3120.99,false
```

| Columna            | Obligatorio | Notas                                              |
|--------------------|-------------|----------------------------------------------------|
| `gtin`             | sí          | Código de barras; llave de negocio                 |
| `nombre_comercial` | sí          | Marca comercial                                    |
| `principio_activo` | no          | Droga / denominación común                         |
| `presentacion`     | no          | Ej: `Comprimidos x 50`                             |
| `laboratorio`      | no          |                                                    |
| `es_venta_libre`   | no (def `false`) | `true/false`, `si/no`, `1/0`                  |
| `precio`           | sí          | Acepta `1234.56`, `1234,56` o `1.234,56`; ≥ 0      |
| `disponible`       | no (def `true`)  | Los no disponibles no se muestran al público  |

> Si una sucursal no existe, se crea automáticamente con `nombre = id_sucursal`.

### Respuesta 200

```json
{
  "ok": true,
  "archivo": "precios.csv",
  "id_sucursal": "SUC-001",
  "filas_procesadas": 1520,
  "medicamentos_unicos": 1518,
  "lotes": 4,
  "duracion_ms": 834
}
```

### Errores

| Código | Cuándo                                                        |
|--------|---------------------------------------------------------------|
| 400    | `id_sucursal` inválido o falta el archivo multipart            |
| 415    | Content-Type no es `multipart/form-data` ni `text/csv`         |
| 422    | Fila inválida (incluye número de línea) o CSV vacío → rollback |
| 500    | Error de base de datos u otro error interno → rollback         |

```json
{ "ok": false, "error": "Línea 14: 'precio' inválido: \"abc\"" }
```

---

## GET /api/sucursales/:id_sucursal/precios

Lista pública de medicamentos disponibles en la sucursal.

### Query params (todos opcionales)

| Param         | Valores                       | Default | Descripción                                   |
|---------------|-------------------------------|---------|-----------------------------------------------|
| `q`           | texto libre                   | —       | Busca en `nombre_comercial` y `principio_activo` (ILIKE) |
| `venta_libre` | `true` \| `false`             | —       | Filtra OTC vs. bajo receta                    |
| `limit`       | 1–1000                        | 500     | Tamaño de página                              |
| `page`        | ≥ 1                           | 1       | Página                                        |

```bash
curl "https://api.example.com/api/sucursales/SUC-001/precios?q=amoxidal&venta_libre=false"
```

### Respuesta 200

```json
{
  "ok": true,
  "sucursal": { "id_sucursal": "SUC-001", "nombre": "Farmacia Central", "direccion": null },
  "total": 1,
  "limit": 500,
  "page": 1,
  "ultima_actualizacion": "2026-08-24 06:02",
  "items": [
    {
      "gtin": "7790123456789",
      "nombre_comercial": "Amoxidal 500",
      "principio_activo": "Amoxicilina",
      "presentacion": "Cápsulas x 20",
      "laboratorio": "Richet",
      "es_venta_libre": false,
      "precio": 2450,
      "actualizado": "2026-08-24 06:02"
    }
  ]
}
```

### Errores

| Código | Cuándo                                    |
|--------|-------------------------------------------|
| 404    | La sucursal no existe                     |
| 500    | Error interno                             |

---

## GET /api/sucursales/:id_sucursal/cartel.pdf

Genera on-the-fly el cartel A4 con la leyenda normativa y el QR de la sucursal.

```bash
curl -o cartel-SUC-001.pdf "https://api.example.com/api/sucursales/SUC-001/cartel.pdf"
```

| Código | Cuándo                        |
|--------|-------------------------------|
| 404    | La sucursal no existe         |

---

## Autenticación

### Endpoint protegido: `POST /api/sucursales/:id_sucursal/precios/csv`

Si la variable de entorno `ADMIN_API_KEY` está definida en el backend, toda
carga exige uno de estos headers:

```
x-api-key: <ADMIN_API_KEY>
Authorization: Bearer <ADMIN_API_KEY>
```

- Comparación en **tiempo constante** (timing-safe) para evitar ataques por análisis temporal.
- Sin clave o clave inválida → `401 { "ok": false, "error": "No autorizado..." }`.
- En producción sin `ADMIN_API_KEY`, el endpoint queda **abierto** y el servidor registra una advertencia al arrancar (no recomendado).
- Generación de clave segura:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

Ejemplo:

```bash
curl -X POST "https://api.example.com/api/sucursales/SUC-001/precios/csv" \
  -H "x-api-key: $ADMIN_API_KEY" \
  -F "file=@precios.csv"
```

### Endpoints públicos (sin autenticación, por diseño normativo)

`GET /api/sucursales/:id/precios`, `GET /api/sucursales/:id/cartel.pdf`,
`GET /health` y `/` son información pública a disposición del consumidor según
la Res. Conjunta 2/2025.

### Capa de datos

Las tablas tienen **RLS habilitado sin políticas públicas**: la Data API de
Supabase (anon key) no puede leer ni escribir; solo el backend, que conecta con
el rol dueño del esquema.
