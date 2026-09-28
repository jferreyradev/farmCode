# 💊 Lista de Precios — Res. Conjunta 2/2025 (Argentina)

Sistema integral para que farmacias cumplan la **Resolución Conjunta 2/2025**
(Secretaría de Industria y Comercio y Secretaría de Gestión Sanitaria):
lista de precios de medicamentos **de venta bajo receta humana** disponible al
público mediante un **código QR** con la leyenda exacta
**"CONSULTE AQUÍ LISTA DE PRECIOS DE MEDICAMENTOS"**.

| Componente | Stack | Hosting |
|---|---|---|
| Frontend SPA móvil | React 18 + Tailwind CSS | Vercel / Netlify |
| API | Fastify 5 + TypeScript | Render |
| Base de datos | PostgreSQL + triggers de auditoría | Supabase |
| Cartelería | PDFKit + QRCode (CLI Node) | Local |

Manuales: [Usuario de sucursal](docs/MANUAL_USUARIO_SUCURSAL.md) ·
[Puesta en marcha en la nube](docs/MANUAL_PUESTA_EN_MARCHA.md).

---

## 📁 Estructura del repositorio

```
/
├── src/
│   ├── database/
│   │   ├── schema.sql           # DDL PostgreSQL (Supabase) + Triggers + Índices
│   │   └── db.ts                # Conexión Pool 'pg' + withTransaction()
│   ├── backend/
│   │   ├── server.ts            # Fastify App + CORS + Multipart
│   │   ├── routes/
│   │   │   ├── upload.ts        # POST /api/sucursales/:id/precios/csv
│   │   │   └── prices.ts        # GET /api/sucursales/:id/precios (+ cartel.pdf)
│   │   └── services/
│   │       ├── csvService.ts    # Parsing en stream + transacción UPSERT atómica
│   │       └── pdfService.ts    # Generador de cartel A4 con QR
│   └── frontend/
│       ├── index.html           # HTML5 Mobile-First (lista pública)
│       ├── App.jsx              # React: buscador en tiempo real + filtros
│       ├── admin.html           # Panel de administración de carga de CSV
│       ├── Admin.jsx            # Drag & drop + vista previa + validación previa
│       └── styles.css           # Estilos personalizados sobre Tailwind
├── scripts/
│   └── generate-poster.js       # CLI: genera PDF del cartel por sucursal
├── docs/
│   ├── ARCHITECTURE.md          # Diagramas Mermaid y arquitectura de datos
│   ├── API.md                   # Documentación completa de endpoints
│   ├── MANUAL_USUARIO_SUCURSAL.md # Carga de precios, consultas y cartelería
│   └── MANUAL_PUESTA_EN_MARCHA.md # Despliegue en Supabase, Render y Vercel
├── .env.example
├── package.json
├── tsconfig.json
├── vercel.json                  # Deploy estático del frontend en Vercel
└── README.md
```

---

# A. Guía de Instalación y Entorno Local

## 1. Requisitos previos

- **Node.js ≥ 20** (`node -v`)
- **PostgreSQL 14+** local vía Docker, o cuenta gratuita en [Supabase](https://supabase.com)
- Git

Verificá versiones:

```bash
node -v
docker -v      # opcional, para Postgres local
```

## 2. Clonar e instalar dependencias

```bash
git clone https://github.com/tu-org/lista-precios-res-2-2025.git
cd lista-precios-res-2-2025
npm install
```

## 3. Configurar variables de entorno

```bash
cp .env.example .env     # Windows PowerShell: Copy-Item .env.example .env
```

Editá `.env`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/farmacia
DATABASE_SSL=false
PORT=3000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5500
PUBLIC_APP_URL=http://localhost:5500
ADMIN_API_KEY=clave-local-de-prueba
```

## 4. Levantar base de datos y ejecutar el esquema

### Opción Docker (local)

```bash
docker run --name pg-farmacia -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=farmacia -p 5432:5432 -d postgres:16
```

Aplicar el esquema (tablas, trigger de auditoría e índices):

```bash
psql "postgresql://postgres:postgres@localhost:5432/farmacia" -f src/database/schema.sql
```

> Si no tenés `psql`, podés abrir `src/database/schema.sql` y ejecutarlo completo
> en el SQL Editor de Supabase o en pgAdmin / DBeaver.

## 5. Ejecutar el servidor en desarrollo

```bash
npm run dev
# ➜ fastify listening on http://0.0.0.0:3000
```

Verificá el estado:

```bash
curl http://localhost:3000/health
# {"status":"ok","db":"up",...}
```

### Servir el frontend localmente

```bash
npx serve src/frontend -l 5500
```

- Lista pública: `http://localhost:5500/index.html?sucursal=SUC-001`
- **Panel de importación:** `http://localhost:5500/admin.html`

(Para que hablen con tu API local editá `window.API_BASE_URL` en
`src/frontend/index.html` y `src/frontend/admin.html` → `http://localhost:3000`.)

## 6. Panel de importación (sin curl)

Abrí `/admin.html` desde tu despliegue de Vercel/Netlify. Permite:

1. Definir la sucursal destino (se recuerda en `localStorage`).
2. Arrastrar o seleccionar el `.csv`.
3. **Validación previa en el navegador**: encabezados requeridos, precios y
   campos vacíos, con vista previa de las primeras 5 filas.
4. Subida multipart con **barra de progreso** real.
5. Resultado detallado (filas, lotes, duración) o error línea por línea.
6. Descarga directa del **cartel PDF** con QR de la sucursal.

> El panel es solo una comodidad: la validación autoritativa siempre corre en
> el servidor, dentro de la transacción atómica.

---

# B. Puesta en Marcha en Producción (Paso a Paso)

## 1. Supabase (Base de Datos)

1. Creá un proyecto en [supabase.com](https://supabase.com) eligiendo región
   **South America (São Paulo)**.
2. Guardá la contraseña de la base.
3. Abrí **SQL Editor → New query**, pegá todo el contenido de
   `src/database/schema.sql` y ejecutalo (**Run**). Verificarás las 4 tablas,
   el trigger `trg_auditar_cambio_precio` y los índices.
4. Obtención del string de conexión:
   **Project Settings → Database → Connection string → URI**.
   Elegí la pestaña **Session pooler** (puerto `5432`, compatible IPv4, ideal
   para Render):
   ```
   postgresql://postgres.<project-ref>:<password>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
   ```
5. Ese valor será tu `DATABASE_URL`. En Supabase dejá `DATABASE_SSL=true`.

> 🔒 El esquema ya incluye `ENABLE ROW LEVEL SECURITY` en las 4 tablas: tu
> backend se conecta como dueño (omite RLS) pero la Data API pública de
> Supabase queda bloqueada para terceros. Si querés lectura pública directa vía
> Supabase REST, descomentá las políticas al final de `schema.sql` y volvé a
> ejecutar solo ese bloque.

## 2. Render (API Backend)

1. Hacé push del repo a GitHub.
2. En [render.com](https://render.com): **New → Web Service → conectá el repo**.
3. Configuración:
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
4. Variables de entorno (Environment):
   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | URI de Supabase del paso anterior |
   | `PORT` | `10000` (Render lo inyecta automáticamente; podés omitirla) |
   | `NODE_ENV` | `production` |
   | `DATABASE_SSL` | `true` |
   | `ALLOWED_ORIGINS` | `https://tu-frontend.vercel.app` |
   | `PUBLIC_APP_URL` | `https://tu-farmacia.vercel.app` |
   | `ADMIN_API_KEY` | **Clave aleatoria larga (obligatoria en producción).** Protege el endpoint de carga. Generala con: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
5. Deploy. Anotá la URL, ej. `https://lista-precios-api.onrender.com`.

> 🔐 Con `ADMIN_API_KEY` definida, todo `POST .../precios/csv` exige el header
> `x-api-key: <clave>` (o `Authorization: Bearer <clave>`, comparación en
> tiempo constante). Sin clave en producción, el endpoint queda abierto y el
> servidor lo advierte en el log al arrancar. Esa misma clave se pega en el
> campo "Clave de administrador" del panel `/admin`.

> El plan gratuito de Render "duerme" tras 15 min de inactividad; para una
> consulta pública 24/7 se recomienda el plan Starter.

## 3. Vercel / Netlify (Frontend)

### Vercel
1. **New Project → importá el repo** (framework: *Other*).
2. `vercel.json` ya configura el output como sitio estático desde `src/frontend`.
3. Antes de desplegar, editá `src/frontend/index.html`:
   ```js
   window.API_BASE_URL = "https://lista-precios-api.onrender.com";
   ```
4. Deploy → URL pública final, ej. `https://tu-farmacia.vercel.app`.

### Netlify (alternativa)
- Build command: *(ninguno)* · Publish directory: `src/frontend`
- Mismo cambio de `window.API_BASE_URL`.

## 4. Generar y colocar la cartelería obligatoria

```bash
npm run poster -- --sucursal SUC-001 --url https://tu-farmacia.vercel.app
```

Salida: `carteleria/cartel-precios-SUC-001.pdf` (A4). Imprimilo y colocálo en
vidriera/mostrador. La leyenda impresa es exactamente:
**"CONSULTE AQUÍ LISTA DE PRECIOS DE MEDICAMENTOS"**.

También podés descargarlo desde la API ya desplegada:
`GET /api/sucursales/SUC-001/cartel.pdf`

---

# C. Pruebas y Automatización

## 1. Probar con cURL

El repo incluye un CSV de demostración con 20 medicamentos argentinos reales,
GTINs EAN-13 válidos y casos borde (precios `2450,00` / `3.150,00` / `1450.99`,
booleanos `si/no`, un producto sin stock):

```bash
examples/precios-demo.csv
```

O creá tu propio `precios.csv`:

```csv
gtin,nombre_comercial,principio_activo,presentacion,laboratorio,es_venta_libre,precio,disponible
7790123456789,Amoxidal 500,Amoxicilina,Cápsulas x 20,Richet,false,2450.00,true
7790987654321,Ibuprofeno 400,Ibuprofeno,Comprimidos x 50,Bago,true,890.50,true
7791111222333,Rivotril 2mg,Clonazepam,Gotas x 20ml,Roche,false,3120.99,false
7795555666777,Tafirol 500mg,Paracetamol,Comprimidos x 10,Gerardo Ramón,true,512.75,true
```

**Subir el CSV** (multipart):

```bash
curl -X POST "http://localhost:3000/api/sucursales/SUC-001/precios/csv" \
  -H "x-api-key: $ADMIN_API_KEY" \
  -F "file=@examples/precios-demo.csv"
```

**Subir el CSV** (body crudo, ideal para cron):

```bash
curl -X POST "http://localhost:3000/api/sucursales/SUC-001/precios/csv" \
  -H "Content-Type: text/csv" \
  -H "x-api-key: $ADMIN_API_KEY" \
  --data-binary @examples/precios-demo.csv
```

> Si en `.env` no definiste `ADMIN_API_KEY` (solo desarrollo), omití el header.

**Leer precios:**

```bash
curl "http://localhost:3000/api/sucursales/SUC-001/precios"
curl "http://localhost:3000/api/sucursales/SUC-001/precios?q=amoxidal&venta_libre=false"
```

**Descargar cartel PDF:**

```bash
curl -o cartel.pdf "http://localhost:3000/api/sucursales/SUC-001/cartel.pdf"
```

Respuesta esperada en la carga:

```json
{"ok":true,"archivo":"precios.csv","id_sucursal":"SUC-001","filas_procesadas":4,"medicamentos_unicos":4,"lotes":1,"duracion_ms":120}
```

Reimportar el mismo archivo con otro precio (ej. `2450.00 → 2590.00`) crea un
registro automático en `historico_precios` gracias al trigger.

## 2. Cron Job / Task Scheduler — Actualización diaria automática

Objetivo: todos los días a las 06:00, el ERP exporta `precios.csv` y este job
lo envía a la API.

### Linux (crontab)

```bash
crontab -e
```

Agregá (ajustá rutas):

```cron
0 6 * * * /usr/bin/curl -sS -X POST \
  -H "Content-Type: text/csv" \
  -H "x-api-key: TU_ADMIN_API_KEY" \
  --data-binary @/opt/farmacia/export/precios.csv \
  "https://lista-precios-api.onrender.com/api/sucursales/SUC-001/precios/csv" \
  >> /var/log/sync-precios.log 2>&1
```

Alternativa multipart: `curl -X POST ... -H "x-api-key: TU_ADMIN_API_KEY" -F "file=@/opt/farmacia/export/precios.csv"`.

### Windows (Task Scheduler)

Opción CLI (PowerShell como administrador):

```powershell
schtasks /Create /SC DAILY /ST 06:00 /TN "Sync Precios Res 2-2025" ^
  /TR "powershell -NoProfile -WindowStyle Hidden -Command \"Invoke-RestMethod -Method Post -Uri 'https://lista-precios-api.onrender.com/api/sucursales/SUC-001/precios/csv' -ContentType 'text/csv' -Headers @{ 'x-api-key' = 'TU_ADMIN_API_KEY' } -InFile 'C:\farmacia\export\precios.csv'\""
```

Opción gráfica:
1. **Programador de tareas → Crear tarea básica…**
2. Desencadenador: *Diario, 06:00*.
3. Acción: *Iniciar un programa* → `powershell.exe`
4. Argumentos:
   ```
   -NoProfile -Command "Invoke-RestMethod -Method Post -Uri 'https://TU-API.onrender.com/api/sucursales/SUC-001/precios/csv' -ContentType 'text/csv' -Headers @{ 'x-api-key' = 'TU_ADMIN_API_KEY' } -InFile 'C:\farmacia\export\precios.csv'"
   ```

> Verificá siempre que el archivo exportado por el ERP tenga exactamente los
> encabezados documentados en [`docs/API.md`](docs/API.md).

---

## Scripts npm disponibles

| Comando | Acción |
|---|---|
| `npm run dev` | Servidor en desarrollo con recarga (tsx watch) |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm start` | Producción: `node dist/backend/server.js` |
| `npm run typecheck` | Chequeo de tipos sin emitir |
| `npm run poster -- --sucursal SUC-001` | Genera cartel PDF |

## Solución de problemas

| Problema | Causa probable / solución |
|---|---|
| `DATABASE_URL no está definida` | Falta crear `.env` (ver paso A.3) |
| `self signed certificate` contra Supabase | Setear `DATABASE_SSL=true` |
| `422 Línea N: ...` | Corregir esa fila del CSV; nada se importó (atomicidad) |
| Frontend vacío / CORS | Agregar el origen exacto del frontend a `ALLOWED_ORIGINS` |
| `401 No autorizado` al subir CSV | Falta o no coincide el header `x-api-key` con `ADMIN_API_KEY` del servidor |
| Panel `/admin` rechaza la clave | La clave se guarda en `localStorage`; verificá mayúsculas/espacios y que sea la del entorno correcto |
| QR abre pero no carga | Revisar `window.API_BASE_URL` en `index.html` y `PUBLIC_APP_URL` |

---

Cumplimiento normativo: la leyenda impresa y digital respeta textualmente la
Resolución Conjunta 2/2025. Los cambios de precio quedan auditados en la tabla
`historico_precios` para eventuales fiscalizaciones.
