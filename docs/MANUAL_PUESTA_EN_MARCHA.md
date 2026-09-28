# Manual de puesta en marcha

Despliegue del sistema con Supabase para PostgreSQL, Render para la API y
Vercel para las páginas web.

## 1. Preparar el repositorio

Subí el repositorio a GitHub y asegurate de que la rama que vas a desplegar
contenga los últimos cambios. El frontend usa la configuración de
`vercel.json`; la API se compila desde el `package.json` de la raíz.

## 2. Crear y preparar Supabase

1. Creá un proyecto PostgreSQL en Supabase.
2. En **SQL Editor**, ejecutá el contenido completo de
   [schema.sql](../src/database/schema.sql). Esto crea las tablas, los índices
   y los triggers de auditoría.
3. En **Connect** o **Project Settings → Database**, obtené una URI de
   PostgreSQL compatible con Render. Preferí **Session pooler** si el proyecto
   o la red requiere IPv4 y usá la URI completa que muestra Supabase.
4. Guardá la URI de forma privada: se configurará en Render como
   `DATABASE_URL`. No la pongas en el frontend ni en GitHub.

## 3. Desplegar la API en Render

1. En Render elegí **New → Web Service** y conectá el repositorio de GitHub.
2. Seleccioná la rama que contiene el código actualizado. Dejá **Root
   Directory** vacío si `package.json` está en la raíz.
3. Configurá el servicio:

   | Campo | Valor |
   |---|---|
   | Runtime | Node |
   | Build Command | `npm ci --include=dev && npm run build` |
   | Start Command | `npm start` |
   | Health Check Path | `/health` |

   No hace falta definir `PORT`: Render lo proporciona.

4. En **Environment**, agregá estas variables:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | URI de PostgreSQL de Supabase |
   | `DATABASE_SSL` | `true` |
   | `NODE_ENV` | `production` |
   | `ADMIN_API_KEY` | Clave aleatoria larga, privada y nueva |
   | `ALLOWED_ORIGINS` | Dominio exacto de Vercel, por ejemplo `https://mi-farmacia.vercel.app` |
   | `PUBLIC_APP_URL` | El mismo dominio de Vercel |

   Generá una clave admin desde una terminal local con:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Guardala en un gestor de contraseñas y cargala solo en Render y en el panel
   administrativo. No uses la clave de ejemplo ni la publiques en el repositorio.

5. Creá el Web Service y esperá el deploy. Render asignará una URL como
   `https://farmcodeservice.onrender.com`.
6. Probá `https://farmcodeservice.onrender.com/health`. La respuesta esperada
   indica `"status":"ok"` y `"db":"up"`.

## 4. Configurar y desplegar el frontend en Vercel

1. En Vercel elegí **Add New → Project** e importá el mismo repositorio.
2. Usá la raíz del repositorio y el framework **Other**. `vercel.json` fija
   `src/frontend` como directorio de salida; no se necesita compilar React por
   separado.
3. Antes de desplegar, configurá `window.API_BASE_URL` en **ambos** archivos:
   [index.html](../src/frontend/index.html) y
   [admin.html](../src/frontend/admin.html):

   ```js
   window.API_BASE_URL = "https://farmcodeservice.onrender.com";
   ```

4. Subí esos cambios a GitHub y dejá que Vercel complete el deploy. Anotá el
   dominio público que asignó, por ejemplo `https://mi-farmacia.vercel.app`.

## 5. Vincular Vercel con Render

En el panel del servicio Render, confirmá que:

- `ALLOWED_ORIGINS` contiene el origen completo de Vercel, con `https://` y sin
  una barra final. Si usás un dominio personalizado, agregá también ese origen,
  separado por coma.
- `PUBLIC_APP_URL` apunta al dominio que querés codificar en los QR.
- `DATABASE_URL` y `ADMIN_API_KEY` están configuradas allí, no en Vercel.

Guardá los cambios de entorno y redeployá Render. Para verificar CORS desde una
terminal, reemplazá el dominio por el de tu proyecto:

```bash
curl -i -X OPTIONS \
  'https://farmcodeservice.onrender.com/api/sucursales/SUC-001/precios/csv' \
  -H 'Origin: https://mi-farmacia.vercel.app' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: x-api-key'
```

La respuesta debe permitir ese origen. No uses `localhost` ni una IP local en
`PUBLIC_APP_URL` para carteles que se van a distribuir al público.

## 6. Prueba de extremo a extremo

1. Abrí `https://mi-farmacia.vercel.app/admin`.
2. Ingresá un ID de prueba, por ejemplo `PRUEBA-CARGA`, la clave
   `ADMIN_API_KEY` configurada en Render y cargá
   `examples/precios-carga-prueba.csv`.
3. Confirmá que el panel informe una importación completada.
4. Abrí `https://mi-farmacia.vercel.app/?sucursal=PRUEBA-CARGA` y revisá la
   lista. La carga de prueba crea registros en la base: no uses ese archivo con
   una sucursal comercial.
5. Probá el PDF en
   `https://farmcodeservice.onrender.com/api/sucursales/PRUEBA-CARGA/cartel.pdf`
   y escaneá el QR antes de imprimir.

## Seguridad y operación

- Las credenciales compartidas anteriormente deben rotarse antes de poner el
  servicio en producción. Actualizá la contraseña de PostgreSQL en Supabase y
  `DATABASE_URL` en Render; generá una nueva `ADMIN_API_KEY` y actualizala en
  Render y en el panel.
- No subas `.env` a GitHub. Render debe ser el único lugar con los secretos de
  la API y la base de datos.
- Cada cambio de código debe llegar a la rama conectada. Si Render muestra un
  error de compilación, revisá que el deploy corresponda al último commit y que
  el build use `npm ci --include=dev && npm run build`.