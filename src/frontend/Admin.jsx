const { useState, useRef, useEffect, useMemo } = React;

const API_BASE = String(window.API_BASE_URL || "").replace(/\/$/, "");

const COLUMNAS_REQUERIDAS = ["gtin", "nombre_comercial", "precio"];
const COLUMNAS_ESPERADAS = [
  "gtin",
  "nombre_comercial",
  "principio_activo",
  "presentacion",
  "laboratorio",
  "es_venta_libre",
  "precio",
  "disponible",
];

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/* Parser CSV RFC-4180 (maneja comillas y comas dentro de campos) */
function parseCsv(texto) {
  const filas = [];
  let campo = "";
  let fila = [];
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === "," || c === ";" && separadorPuntoYComa(texto)) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      campo = "";
      if (fila.length > 1 || fila[0] !== "") filas.push(fila);
      fila = [];
    } else {
      campo += c;
    }
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    if (fila.length > 1 || fila[0] !== "") filas.push(fila);
  }
  return filas;
}

function separadorPuntoYComa(texto) {
  const muestra = texto.slice(0, 2000);
  const pc = (muestra.match(/;/g) || []).length;
  const co = (muestra.match(/,/g) || []).length;
  return pc > co;
}

function validarPrecioCrudo(raw) {
  const s = String(raw ?? "")
    .trim()
    .replace(/[$\s]/g, "");
  if (!s) return false;
  const limpio =
    s.includes(",") && s.includes(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(",", ".");
  return Number.isFinite(Number(limpio)) && Number(limpio) >= 0;
}

function analizarArchivo(nombre, texto) {
  const filas = parseCsv(texto);
  if (filas.length === 0) {
    return { ok: false, errores: ["El archivo está vacío."], headers: [], totalFilas: 0, preview: [] };
  }

  const headers = filas[0].map((h) => h.trim().toLowerCase().replace(/^\uFEFF/, ""));
  const faltantes = COLUMNAS_REQUERIDAS.filter((c) => !headers.includes(c));
  const errores = [];
  if (faltantes.length > 0) {
    errores.push(
      `Faltan columnas obligatorias: ${faltantes.join(", ")}. Encabezados esperados: ${COLUMNAS_ESPERADAS.join(", ")}`
    );
  }

  const idxGtin = headers.indexOf("gtin");
  const idxPrecio = headers.indexOf("precio");
  const idxNombre = headers.indexOf("nombre_comercial");

  for (let i = 1; i < filas.length; i++) {
    const linea = i + 1;
    const f = filas[i];
    if (idxNombre >= 0 && !String(f[idxNombre] ?? "").trim())
      errores.push(`Línea ${linea}: 'nombre_comercial' vacío`);
    if (idxGtin >= 0 && !String(f[idxGtin] ?? "").trim())
      errores.push(`Línea ${linea}: 'gtin' vacío`);
    if (idxPrecio >= 0 && !validarPrecioCrudo(f[idxPrecio]))
      errores.push(`Línea ${linea}: precio inválido: "${f[idxPrecio]}"`);
  }
  if (errores.length > 12) errores.push(`… y ${errores.length - 12} errores más`);

  const preview = filas.slice(1, 6).map((f) => {
    const obj = {};
    headers.forEach((h, j) => (obj[h] = f[j]));
    return obj;
  });

  return {
    ok: errores.length === 0,
    errores,
    headers,
    totalFilas: filas.length - 1,
    preview,
  };
}

function Chip({ ok, children }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold " +
        (ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")
      }
    >
      {ok ? "✓" : "✗"} {children}
    </span>
  );
}

function App() {
  const [sucursal, setSucursal] = useState(() => localStorage.getItem("admin_sucursal") || "SUC-001");
  useEffect(() => localStorage.setItem("admin_sucursal", sucursal), [sucursal]);

  const [clave, setClave] = useState(() => localStorage.getItem("admin_clave") || "");
  useEffect(() => localStorage.setItem("admin_clave", clave), [clave]);

  const [archivo, setArchivo] = useState(null);
  const [analisis, setAnalisis] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [resultado, setResultado] = useState(null);
  const [errorSubida, setErrorSubida] = useState(null);
  const inputRef = useRef(null);

  const seleccionar = async (f) => {
    setResultado(null);
    setErrorSubida(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) {
      setAnalisis({ ok: false, errores: ["El archivo debe tener extensión .csv"], headers: [], totalFilas: 0, preview: [] });
      setArchivo(null);
      return;
    }
    setArchivo(f);
    const texto = await f.text();
    setAnalisis(analizarArchivo(f.name, texto));
  };

  const soltar = (e) => {
    e.preventDefault();
    setArrastrando(false);
    seleccionar(e.dataTransfer.files?.[0]);
  };

  const subir = () => {
    if (!archivo || subiendo) return;
    setSubiendo(true);
    setProgreso(0);
    setResultado(null);
    setErrorSubida(null);

    const fd = new FormData();
    fd.append("file", archivo);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/sucursales/${encodeURIComponent(sucursal.trim())}/precios/csv`);
    if (clave.trim()) {
      xhr.setRequestHeader("x-api-key", clave.trim());
      xhr.setRequestHeader("Authorization", `Bearer ${clave.trim()}`);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgreso(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setSubiendo(false);
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300) {
        setResultado(body);
      } else if (xhr.status === 401) {
        setErrorSubida(
          (body?.error || "Clave de administrador inválida.") +
            " Verificá que coincida con ADMIN_API_KEY configurada en el servidor."
        );
      } else {
        setErrorSubida(body?.error || `Error HTTP ${xhr.status}`);
      }
    };
    xhr.onerror = () => {
      setSubiendo(false);
      setErrorSubida("No se pudo conectar con la API. Verificá window.API_BASE_URL en admin.html.");
    };
    xhr.send(fd);
  };

  const urlApi = `${API_BASE || "(mismo origen)"}`;
  const puedeSubir = useMemo(
    () => archivo && analisis?.ok && !subiendo && sucursal.trim().length > 0,
    [archivo, analisis, subiendo, sucursal]
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16">
      {/* Encabezado */}
      <header className="safe-top mb-6 flex items-center justify-between gap-3 py-5">
        <div>
          <h1 className="text-xl font-bold text-brand">📤 Panel de Importación</h1>
          <p className="text-xs text-slate-500">Carga de lista de precios · Res. Conjunta 2/2025</p>
        </div>
        <a
          href={`./index.html?sucursal=${encodeURIComponent(sucursal)}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-brand px-3 py-2 text-sm font-semibold text-brand hover:bg-blue-50"
        >
          Ver lista pública ↗
        </a>
      </header>

      {!API_BASE && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          ⚠️ <code>window.API_BASE_URL</code> no está configurada en <b>admin.html</b>; se usará el mismo origen
          (<b>{location.origin}</b>). Si tu API vive en Render, editá ese valor.
        </div>
      )}

      {/* Sucursal y clave */}
      <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="sucursal" className="mb-1 block text-sm font-semibold text-slate-700">
              Sucursal destino
            </label>
            <input
              id="sucursal"
              value={sucursal}
              onChange={(e) => setSucursal(e.target.value)}
              placeholder="SUC-001"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="clave" className="mb-1 block text-sm font-semibold text-slate-700">
              Clave de administrador
            </label>
            <input
              id="clave"
              type="password"
              autoComplete="off"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              placeholder="x-api-key (ADMIN_API_KEY)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-brand focus:outline-none"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          API: <span className="font-mono">{urlApi}</span> · POST{" "}
          <span className="font-mono">/api/sucursales/{sucursal || "{id}"}/precios/csv</span> ·{" "}
          {clave.trim() ? "peticiones firmadas con x-api-key 🔒" : "sin clave (solo si el servidor no exige una)"}
        </p>
      </section>

      {/* Zona de carga */}
      <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={soltar}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          className={
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors " +
            (arrastrando ? "border-brand bg-blue-50" : "border-slate-300 hover:border-brand-light hover:bg-slate-50")
          }
        >
          <p className="text-3xl">📄</p>
          <p className="mt-2 text-sm font-medium text-slate-600">
            Arrastrá el <b>.csv</b> acá o hacé clic para elegirlo
          </p>
          <p className="mt-1 text-xs text-slate-400">
            gtin, nombre_comercial, principio_activo, presentacion, laboratorio, es_venta_libre, precio, disponible
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => seleccionar(e.target.files?.[0])}
          />
        </div>

        {archivo && analisis && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">{archivo.name}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {(archivo.size / 1024).toFixed(1)} KB
              </span>
              <Chip ok={analisis.ok}>
                {analisis.ok ? `${analisis.totalFilas} filas listas para importar` : "Con errores"}
              </Chip>
            </div>

            {analisis.errores.length > 0 && (
              <ul className="mt-3 max-h-40 space-y-1 overflow-auto rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {analisis.errores.slice(0, 12).map((err, i) => (
                  <li key={i}>• {err}</li>
                ))}
              </ul>
            )}

            {analisis.preview.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      {analisis.preview[0] &&
                        Object.keys(analisis.preview[0]).map((h) => (
                          <th key={h} className="whitespace-nowrap px-2.5 py-2 font-semibold text-slate-500 uppercase">
                            {h}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analisis.preview.map((f, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {Object.values(f).map((v, j) => (
                          <td key={j} className="whitespace-nowrap px-2.5 py-1.5 text-slate-700">
                            {String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {analisis.totalFilas > 5 && (
                  <p className="px-3 py-2 text-[11px] text-slate-400">
                    Mostrando 5 de {analisis.totalFilas} filas…
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={subir}
                disabled={!puedeSubir}
                className={
                  "rounded-lg px-5 py-2.5 text-sm font-bold text-white transition-all active:scale-95 " +
                  (puedeSubir ? "bg-brand hover:bg-brand-dark" : "cursor-not-allowed bg-slate-300")
                }
              >
                {subiendo ? `Subiendo… ${progreso}%` : "Importar precios"}
              </button>
              <button
                onClick={() => { setArchivo(null); setAnalisis(null); setResultado(null); setErrorSubida(null); }}
                disabled={subiendo}
                className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-100"
              >
                Limpiar
              </button>
            </div>

            {subiendo && (
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progreso}%` }}></div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Resultado */}
      {resultado && (
        <section className="mb-5 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-emerald-800">
            ✅ Importación completada — la transacción se confirmó (COMMIT)
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Filas procesadas", resultado.filas_procesadas],
              ["Medicamentos únicos", resultado.medicamentos_unicos],
              ["Lotes UPSERT", resultado.lotes],
              ["Duración", `${resultado.duracion_ms} ms`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-white p-3 text-center">
                <dd className="text-lg font-bold text-brand">{v}</dd>
                <dt className="text-[11px] text-slate-500">{k}</dt>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-emerald-700">
            Los cambios de precio quedaron auditados automáticamente en{" "}
            <code>historico_precios</code>.
          </p>
        </section>
      )}

      {errorSubida && (
        <section className="mb-5 rounded-xl border border-red-300 bg-red-50 p-4">
          <h2 className="text-sm font-bold text-red-800">❌ La importación fue rechazada (ROLLBACK)</h2>
          <p className="mt-2 text-sm text-red-700">{errorSubida}</p>
          <p className="mt-2 text-xs text-red-500">
            No se modificó ningún dato: toda la operación es atómica. Corregí el archivo y volvé a intentar.
          </p>
        </section>
      )}

      {/* Cartelería */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">🪧 Cartelería obligatoria (QR)</h2>
        <p className="mt-1 text-xs text-slate-500">
          Descargá el cartel A4 con la leyenda normativa y el QR apuntando a la lista pública de esta sucursal.
        </p>
        <a
          href={`${API_BASE}/api/sucursales/${encodeURIComponent(sucursal.trim() || "SUC-001")}/cartel.pdf`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Descargar cartel PDF
        </a>
      </section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
