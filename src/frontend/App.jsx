const { useState, useEffect, useMemo, useRef } = React;

const API_BASE = String(window.API_BASE_URL || "").replace(/\/$/, "");

const fmtARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function obtenerSucursalDeUrl() {
  const params = new URLSearchParams(window.location.search);
  const id = (params.get("sucursal") || "SUC-001").trim();
  return /^[\w.\-]{1,64}$/.test(id) ? id : "SUC-001";
}

function BadgeCategoria({ esVentaLibre }) {
  return esVentaLibre ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      Venta libre
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
      Bajo receta
    </span>
  );
}

function TarjetaProducto({ item }) {
  return (
    <article className="card-enter flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-semibold leading-snug text-slate-900">{item.nombre_comercial}</h3>
        {item.principio_activo && (
          <p className="mt-0.5 truncate text-xs text-slate-500">{item.principio_activo}</p>
        )}
        <p className="mt-1 truncate text-xs text-slate-400">
          {[item.presentacion, item.laboratorio].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-1.5">
          <BadgeCategoria esVentaLibre={item.es_venta_libre} />
        </div>
      </div>
      <p className="shrink-0 text-right text-base font-bold text-brand">{fmtARS.format(item.precio)}</p>
    </article>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando precios">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl border border-slate-200 bg-white p-4">
          <div className="h-4 w-2/3 rounded bg-slate-200"></div>
          <div className="mt-2 h-3 w-1/2 rounded bg-slate-100"></div>
          <div className="mt-3 h-4 w-1/4 rounded bg-slate-100"></div>
        </div>
      ))}
    </div>
  );
}

const FILTROS = [
  { id: "todos", etiqueta: "Todos" },
  { id: "receta", etiqueta: "Bajo receta" },
  { id: "libre", etiqueta: "Venta libre" },
];

function App() {
  const sucursalId = useRef(obtenerSucursalDeUrl()).current;

  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [textoBusqueda, setTextoBusqueda] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("todos");

  // Debounce del buscador (búsqueda local sobre la lista ya cargada)
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(textoBusqueda.trim()), 180);
    return () => clearTimeout(t);
  }, [textoBusqueda]);

  const cargarPrecios = async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/sucursales/${encodeURIComponent(sucursalId)}/precios?limit=1000`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) {
        let msg = `Error ${res.status}`;
        try {
          const body = await res.json();
          if (body && body.error) msg = body.error;
        } catch (_) {}
        throw new Error(msg);
      }
      setData(await res.json());
    } catch (e) {
      setError(e.message || "No se pudo conectar con el servidor");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarPrecios();
  }, [sucursalId]);

  const itemsFiltrados = useMemo(() => {
    if (!data || !Array.isArray(data.items)) return [];
    const q = normalizar(busqueda);
    return data.items.filter((it) => {
      if (filtro === "receta" && it.es_venta_libre) return false;
      if (filtro === "libre" && !it.es_venta_libre) return false;
      if (!q) return true;
      return (
        normalizar(it.nombre_comercial).includes(q) ||
        normalizar(it.principio_activo).includes(q)
      );
    });
  }, [data, busqueda, filtro]);

  const nombreSucursal =
    data?.sucursal?.nombre && data.sucursal.nombre !== sucursalId
      ? data.sucursal.nombre
      : null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      {/* Encabezado */}
      <header className="safe-top sticky top-0 z-10 bg-brand shadow-md">
        <div className="px-4 pb-3 pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-bold text-white">
                💊 Lista de Precios
              </h1>
              <p className="truncate text-xs text-blue-200">
                {nombreSucursal ? `${nombreSucursal} · ` : ""}Sucursal {sucursalId}
              </p>
            </div>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-blue-50">
              Res. Conj. 2/2025
            </span>
          </div>

          {/* Buscador */}
          <div className="relative mt-3">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              inputMode="search"
              value={textoBusqueda}
              onChange={(e) => setTextoBusqueda(e.target.value)}
              placeholder="Buscar por marca o droga…"
              aria-label="Buscar medicamento por nombre comercial o principio activo"
              className="w-full rounded-lg border border-transparent bg-white py-2.5 pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-light focus:outline-none"
            />
            {textoBusqueda && (
              <button
                onClick={() => setTextoBusqueda("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filtros de categoría */}
          <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-lg bg-white/10 p-1" role="tablist">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filtro === f.id}
                onClick={() => setFiltro(f.id)}
                className={
                  "rounded-md px-2 py-1.5 text-xs font-semibold transition-colors " +
                  (filtro === f.id
                    ? "bg-white text-brand shadow-sm"
                    : "text-blue-100 hover:bg-white/10")
                }
              >
                {f.etiqueta}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Contenido */}
      <main className="flex-1 px-4 py-4">
        {!cargando && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-sm font-medium text-red-700">⚠️ {error}</p>
            <button
              onClick={cargarPrecios}
              className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white active:scale-95"
            >
              Reintentar
            </button>
          </div>
        )}

        {cargando && <Skeleton />}

        {!cargando && !error && (
          <>
            <p className="mb-3 text-xs text-slate-500">
              {itemsFiltrados.length} de {data?.total ?? 0} productos disponibles
              {data?.ultima_actualizacion ? ` · Actualizado: ${data.ultima_actualizacion}` : ""}
            </p>

            {itemsFiltrados.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
                <p className="text-3xl">🔍</p>
                <p className="mt-2 text-sm font-medium text-slate-600">
                  No se encontraron medicamentos
                </p>
                <p className="mt-1 text-xs text-slate-400">Probá con otro término o cambiá el filtro.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {itemsFiltrados.map((item) => (
                  <TarjetaProducto key={item.gtin} item={item} />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Pie normativo */}
      <footer className="safe-bottom mt-6 bg-slate-900 px-4 py-4 text-center">
        <p className="text-xs font-medium text-slate-300">
          Res. Conjunta 2/2025. Precios finales de venta al público en ARS
        </p>
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
