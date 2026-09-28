# Manual de usuario de sucursal

Guía para cargar y consultar la lista de precios de una sucursal, y descargar su
cartel con código QR.

## Direcciones

Reemplazá `<frontend>` por el dominio de Vercel de tu farmacia.

- Panel de carga: `https://<frontend>/admin`
- Lista pública: `https://<frontend>/?sucursal=SUC-001`
- Cartel PDF: `https://farmcodeservice.onrender.com/api/sucursales/SUC-001/cartel.pdf`

## Cargar o actualizar precios

1. Abrí el panel de carga de la farmacia.
2. En **Sucursal destino**, escribí el identificador de la sucursal, por
   ejemplo `SUC-001`. Usá el mismo identificador cada vez que actualices esa
   sucursal. Solo se admiten letras, números, punto, guion y guion bajo, con un
   máximo de 64 caracteres.
3. Escribí la clave de administrador configurada como `ADMIN_API_KEY` en
   Render. No la compartas ni la pongas en el archivo CSV.
4. Arrastrá el CSV al panel o selecciónalo desde el equipo.
5. Revisá la vista previa y el número de filas. Corregí los errores que muestre
   el panel antes de continuar.
6. Seleccioná **Importar precios**. Esperá la confirmación de importación.
7. Abrí **Ver lista pública** para verificar los precios de esa sucursal.

El CSV debe tener estos encabezados, en este orden recomendado:

```csv
gtin,nombre_comercial,principio_activo,presentacion,laboratorio,es_venta_libre,precio,disponible
```

`gtin`, `nombre_comercial` y `precio` son obligatorios. `es_venta_libre` y
`disponible` aceptan `true`/`false`, `si`/`no` o `1`/`0`. Si se omiten,
quedan como `false` y `true`, respectivamente. Los precios aceptan punto o
coma decimal; si el CSV usa comas como separador de columnas, poné entre
comillas los importes con coma decimal, por ejemplo `"2450,00"`.

Una importación correcta agrega o actualiza productos de esa sucursal. **No
borra** productos que no estén incluidos en el nuevo archivo. Si una fila es
inválida, se rechaza el archivo completo y se hace rollback; no se aplican
cambios parciales.

## Ejemplo: segunda sucursal

Supongamos que una farmacia incorpora una sucursal Norte. Usá el identificador
`SUC-002` en el panel y cargá el CSV exportado por el ERP de esa sucursal. La
primera carga crea la sucursal automáticamente, y su nombre inicial será
`SUC-002`.

La lista pública quedará en:

```text
https://<frontend>/?sucursal=SUC-002
```

Para mostrar un nombre más descriptivo, como “Farmacia Norte”, ejecutá en el
SQL Editor de Supabase:

```sql
UPDATE sucursales
SET nombre = 'Farmacia Norte'
WHERE id_sucursal = 'SUC-002';
```

El archivo [precios-carga-prueba.csv](../examples/precios-carga-prueba.csv)
sirve para comprobar la importación: sus productos y códigos son ficticios.
Para probarlo, usá un identificador aislado como `PRUEBA-CARGA`, no una
sucursal en producción. Para `SUC-002`, cargá el CSV real de esa sucursal.

## Descargar e imprimir el cartel

Desde el panel, seleccioná la sucursal y hacé clic en **Descargar cartel PDF**.
También podés abrir directamente:

```text
https://farmcodeservice.onrender.com/api/sucursales/SUC-002/cartel.pdf
```

El PDF es tamaño A4 y el QR lleva a la página pública de esa sucursal. Antes de
imprimir varias copias, escaneá el QR con un teléfono que no esté conectado a
la red interna y confirmá que abre la lista pública correcta.

## Problemas frecuentes

- **401 No autorizado:** revisá que la clave del panel coincida con
  `ADMIN_API_KEY` en Render.
- **Error de conexión:** confirmá que el frontend esté publicado y que Render
  tenga `ALLOWED_ORIGINS` configurado con el dominio exacto de Vercel.
- **Sucursal inexistente en la lista:** verificá el identificador de la URL y
  que haya finalizado una importación para esa sucursal.
- **422 / archivo rechazado:** corregí las filas señaladas por el panel. La
  importación no aplica cambios parciales.

El panel recuerda la sucursal y la clave en el almacenamiento local del
navegador. En un equipo compartido, no guardes la clave o borrá los datos del
sitio al terminar.