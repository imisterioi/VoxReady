import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';
import { apiGet } from '../lib/api';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Badge, Button, Card, EmptyState, PageHeader, Segmented } from '../components/ui';

const CATEGORY = {
  CRISIS: { label: 'Crisis', tone: 'danger', icon: 'alert' },
  MEDIOS: { label: 'Medios', tone: 'accent', icon: 'mic' },
  INSTITUCIONAL: { label: 'Institucional', tone: 'neutral', icon: 'flag' },
};

export default function ElegirEscenario() {
  const t = I.es.L.u2;
  const navigate = useNavigate();

  const [escenarios, setEscenarios] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('TODOS');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const cargarEscenarios = async () => {
      try {
        setCargando(true);
        setError('');
        const data = await apiGet('/api/scenarios/my?email=vocero@demo.com');
        setEscenarios(data.scenarios || []);
      } catch (error) {
        console.error('Error cargando escenarios:', error);
        setError('No se pudieron cargar los escenarios.');
      } finally {
        setCargando(false);
      }
    };

    cargarEscenarios();
  }, [intento]);

  const escenariosFiltrados = useMemo(() => {
    return escenarios.filter((escenario) => {
      const coincideBusqueda =
        escenario.title.toLowerCase().includes(busqueda.toLowerCase()) ||
        escenario.context.toLowerCase().includes(busqueda.toLowerCase());
      const coincideCategoria = filtro === 'TODOS' || escenario.category === filtro;
      return coincideBusqueda && coincideCategoria;
    });
  }, [escenarios, busqueda, filtro]);

  const seleccionarEscenario = (escenario) => {
    sessionStorage.setItem('voxready_escenario_seleccionado', JSON.stringify(escenario));
    navigate('/vocero/preparar');
  };

  return (
    <>
      <PracticeSteps />
      <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.sub} />

      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-8">
        <Segmented options={t.filters} value={filtro} onChange={setFiltro} />
        <div className="relative md:ml-auto md:w-72">
          <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={t.search}
            className="input pl-9"
          />
        </div>
      </div>

      {cargando && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-60 rounded-2xl border border-line bg-surface p-6 animate-pulse">
              <div className="h-10 w-10 rounded-xl bg-subtle mb-6" />
              <div className="h-4 w-2/3 rounded bg-subtle mb-3" />
              <div className="h-3 w-full rounded bg-subtle mb-2" />
              <div className="h-3 w-4/5 rounded bg-subtle" />
            </div>
          ))}
        </div>
      )}

      {!cargando && error && (
        <Card>
          <EmptyState
            tone="danger"
            icon="server"
            title={error}
            description="Verifica que el backend esté corriendo en el puerto 3000 y que la base de datos tenga datos de prueba."
            action={
              <div className="flex gap-2 justify-center">
                <Button variant="secondary" icon="refresh" onClick={() => setIntento((n) => n + 1)}>
                  Reintentar
                </Button>
                <Button variant="ghost" to="/laboratorio" icon="flask">
                  Diagnóstico
                </Button>
              </div>
            }
          />
        </Card>
      )}

      {!cargando && !error && escenarios.length === 0 && (
        <Card>
          <EmptyState
            icon="layers"
            title="No tienes escenarios asignados"
            description="Tu organización aún no te ha asignado escenarios. Debes esperar nuevas instrucciones."
          />
        </Card>
      )}

      {!cargando && !error && escenarios.length > 0 && escenariosFiltrados.length === 0 && (
        <Card>
          <EmptyState icon="search" title="Sin resultados" description="No se encontraron escenarios con los criterios seleccionados." />
        </Card>
      )}

      {!cargando && !error && escenariosFiltrados.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {escenariosFiltrados.map((escenario) => {
            const cat = CATEGORY[escenario.category] || { label: escenario.category, tone: 'neutral', icon: 'layers' };
            return (
              <Card
                key={escenario.assignmentId}
                className="group flex flex-col hover:shadow-lift hover:border-line-strong transition-all"
              >
                <div className="flex items-center justify-between mb-6">
                  <span className="h-10 w-10 rounded-xl bg-subtle flex items-center justify-center text-ink">
                    <Icon name={cat.icon} size={18} />
                  </span>
                  <Badge tone={cat.tone}>{cat.label}</Badge>
                </div>
                <h3 className="text-[17px] font-semibold tracking-tight text-ink">{escenario.title}</h3>
                <p className="text-[13px] text-muted mt-2 leading-relaxed flex-1">{escenario.context}</p>
                <div className="mt-6 pt-5 border-t border-line flex items-center justify-between">
                  <span className="text-xs text-faint">
                    Asignado {new Date(escenario.assignedAt).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}
                  </span>
                  <Button size="sm" iconRight="arrowRight" onClick={() => seleccionarEscenario(escenario)}>
                    {t.start}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
