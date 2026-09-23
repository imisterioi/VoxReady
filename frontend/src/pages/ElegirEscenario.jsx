import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import I from '../data/dictionary';

export default function ElegirEscenario() {
  const d = I.es;
  const t = d.L.u2;

  const navigate = useNavigate();

  const [escenarios, setEscenarios] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('TODOS');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const cargarEscenarios = async () => {
      try {
        setCargando(true);
        setError('');

        const response = await fetch(
          'http://localhost:3000/api/scenarios/my?email=vocero@demo.com'
        );

        if (!response.ok) {
          throw new Error('No se pudieron obtener los escenarios');
        }

        const data = await response.json();

        setEscenarios(data.scenarios || []);
      } catch (error) {
        console.error('Error cargando escenarios:', error);
        setError('No se pudieron cargar los escenarios.');
      } finally {
        setCargando(false);
      }
    };

    cargarEscenarios();
  }, []);

  const escenariosFiltrados = useMemo(() => {
    return escenarios.filter((escenario) => {
      const coincideBusqueda =
        escenario.title.toLowerCase().includes(busqueda.toLowerCase()) ||
        escenario.context.toLowerCase().includes(busqueda.toLowerCase());

      const coincideCategoria =
        filtro === 'TODOS' || escenario.category === filtro;

      return coincideBusqueda && coincideCategoria;
    });
  }, [escenarios, busqueda, filtro]);

  const seleccionarEscenario = (escenario) => {
    sessionStorage.setItem(
      'voxready_escenario_seleccionado',
      JSON.stringify(escenario)
    );

    navigate('/vocero/preparar');
  };

  return (
    <div className="animate-fade-in pb-10">
      <div className="text-xs text-[var(--muted)] mb-1">{t.crumbs}</div>

      <h2 className="text-2xl font-bold mb-1 text-[var(--ink)]">
        {t.title}
      </h2>

      <p className="text-sm text-[var(--muted)] mb-6">{t.sub}</p>

      <div className="bg-[var(--panel)] border border-[var(--line2)] rounded-lg overflow-hidden shadow-sm">

        {/* Barra del navegador falso */}
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--chrome2)] border-b border-[var(--line)]">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>

          <div className="flex-1 ml-2 bg-[var(--panel)] border border-[var(--line)] rounded-[5px] text-[11px] text-[var(--muted)] px-3 py-1">
            app.voxready.io/escenarios
          </div>
        </div>

        <div className="p-5 md:p-6">

          {/* Filtros y búsqueda */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">

            <div className="flex gap-2 flex-wrap">

              <button
                onClick={() => setFiltro('TODOS')}
                className={`border rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                  filtro === 'TODOS'
                    ? 'bg-[var(--accentsoft)] border-[var(--accent)] text-[var(--accent)]'
                    : 'bg-[var(--panel)] border-[var(--line2)] text-[var(--ink)] hover:bg-[var(--soft)]'
                }`}
              >
                Todos
              </button>

              <button
                onClick={() => setFiltro('CRISIS')}
                className={`border rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                  filtro === 'CRISIS'
                    ? 'bg-[var(--accentsoft)] border-[var(--accent)] text-[var(--accent)]'
                    : 'bg-[var(--panel)] border-[var(--line2)] text-[var(--ink)] hover:bg-[var(--soft)]'
                }`}
              >
                Crisis
              </button>

              <button
                onClick={() => setFiltro('MEDIOS')}
                className={`border rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                  filtro === 'MEDIOS'
                    ? 'bg-[var(--accentsoft)] border-[var(--accent)] text-[var(--accent)]'
                    : 'bg-[var(--panel)] border-[var(--line2)] text-[var(--ink)] hover:bg-[var(--soft)]'
                }`}
              >
                Medios
              </button>

              <button
                onClick={() => setFiltro('INSTITUCIONAL')}
                className={`border rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                  filtro === 'INSTITUCIONAL'
                    ? 'bg-[var(--accentsoft)] border-[var(--accent)] text-[var(--accent)]'
                    : 'bg-[var(--panel)] border-[var(--line2)] text-[var(--ink)] hover:bg-[var(--soft)]'
                }`}
              >
                Institucional
              </button>

            </div>

            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t.search}
              className="md:ml-auto w-full md:w-64 h-[34px] border border-[var(--line)] rounded-md bg-[var(--panel)] px-3 text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
            />

          </div>

          {/* Estado de carga */}
          {cargando && (
            <div className="py-10 text-center text-sm text-[var(--muted)]">
              Cargando escenarios...
            </div>
          )}

          {/* Error */}
          {!cargando && error && (
            <div className="py-10 text-center text-sm text-red-500">
              {error}
            </div>
          )}

          {/* Sin escenarios asignados */}
          {!cargando && !error && escenarios.length === 0 && (
            <div className="py-10 text-center text-sm text-[var(--muted)]">
              No tienes escenarios asignados actualmente. Debes esperar nuevas instrucciones.
            </div>
          )}

          {/* Sin resultados de búsqueda/filtro */}
          {!cargando &&
            !error &&
            escenarios.length > 0 &&
            escenariosFiltrados.length === 0 && (
              <div className="py-10 text-center text-sm text-[var(--muted)]">
                No se encontraron escenarios con los criterios seleccionados.
              </div>
            )}

          {/* Grid de escenarios reales */}
          {!cargando && !error && escenariosFiltrados.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

              {escenariosFiltrados.map((escenario) => (
                <div
                  key={escenario.assignmentId}
                  className="border border-[var(--line)] rounded-lg bg-[var(--panel)] p-4 flex flex-col hover:shadow-md hover:border-[var(--line2)] transition-all"
                >

                  {/* Placeholder visual */}
                  <div
                    className="h-20 border border-dashed border-[var(--line2)] rounded-md flex items-center justify-center text-xs text-[var(--muted)] mb-3"
                    style={{
                      background:
                        'repeating-linear-gradient(135deg, var(--soft), var(--soft) 7px, var(--bg) 7px, var(--bg) 14px)'
                    }}
                  >
                    {t.img}
                  </div>

                  {/* Información real del escenario */}
                  <h3 className="text-sm font-bold text-[var(--ink)] mb-2">
                    {escenario.title}
                  </h3>

                  <p className="text-xs text-[var(--muted)] leading-relaxed mb-4">
                    {escenario.context}
                  </p>

                  <div className="mt-auto flex justify-between items-center gap-2">

                    <span className="border border-[var(--line2)] rounded-full px-3 py-1 text-[11px] bg-[var(--panel)] font-medium">
                      {escenario.category}
                    </span>

                    <button
                      onClick={() => seleccionarEscenario(escenario)}
                      className="border border-[var(--accent2)] bg-[var(--accent2)] rounded-md px-4 py-1.5 text-xs text-white font-semibold hover:brightness-105 transition-all"
                    >
                      {t.start}
                    </button>

                  </div>
                </div>
              ))}

            </div>
          )}

          <div className="mt-6 bg-[var(--note)] border border-[var(--noteline)] rounded-lg p-4 text-xs text-[var(--notetext)] leading-relaxed">
            <b className="font-bold">{d.noteUX}</b> {t.note}
          </div>

        </div>
      </div>
    </div>
  );
}