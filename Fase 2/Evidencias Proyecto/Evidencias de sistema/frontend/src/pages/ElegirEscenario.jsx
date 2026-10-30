import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import { apiGet } from '../lib/api';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { InterviewSummary } from '../components/InterviewConfig';
import { Badge, Button, Card, EmptyState, PageHeader, Segmented, cx } from '../components/ui';

// Presentación por categoría: la etiqueta visible viene del diccionario activo.
const CATEGORY_META = {
  CRISIS: { tone: 'danger', icon: 'alert' },
  MEDIOS: { tone: 'accent', icon: 'mic' },
  INSTITUCIONAL: { tone: 'neutral', icon: 'flag' },
};
const isGeneral = (escenario) => escenario.scope === 'general';

export default function ElegirEscenario() {
  const { d, lang, langVersion } = useI18n();
  const t = d.L.u2;
  const navigate = useNavigate();
  // Pestañas: escenarios de la organización del vocero y catálogo general del idioma activo.
  const tabs = [
    { value: 'org', label: t.tabs.org },
    { value: 'general', label: t.tabs.general },
  ];
  // Locale únicamente para formatear fechas.
  const locale = lang === 'en' ? 'en-US' : 'es-CL';

  const [escenarios, setEscenarios] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('TODOS');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [intento, setIntento] = useState(0);
  const [pestanaElegida, setPestana] = useState(null);

  const propios = useMemo(() => escenarios.filter((e) => !isGeneral(e)), [escenarios]);
  const generales = useMemo(() => escenarios.filter(isGeneral), [escenarios]);
  // Si la organización aún no tiene escenarios para el vocero, parte en "Generales"
  const pestana = pestanaElegida || (propios.length || !generales.length ? 'org' : 'general');
  const enPestana = pestana === 'general' ? generales : propios;

  // Al cambiar el idioma activo, el catálogo anterior deja de ser válido: se descarta de inmediato
  // para no mostrar escenarios del idioma anterior como si fueran del nuevo (mientras llega el
  // catálogo nuevo se ve el estado de carga).
  useEffect(() => {
    setEscenarios([]);
    setCargando(true);
  }, [lang]);

  // El catálogo lo FILTRA EL BACKEND según el idioma del usuario. Se vuelve a pedir cuando cambia el
  // idioma efectivo ya aplicado (`langVersion`), así el catálogo abierto se actualiza sin navegar
  // fuera de la pantalla ni recargar el navegador. `langVersion` solo cambia cuando el idioma cambia
  // de verdad, por lo que no se generan peticiones duplicadas ni ciclos.
  useEffect(() => {
    let cancelled = false;
    const cargarEscenarios = async () => {
      try {
        setCargando(true);
        setError(false);
        const data = await apiGet('/api/scenarios/my');
        if (!cancelled) setEscenarios(data.scenarios || []);
      } catch (err) {
        if (cancelled) return;
        console.error('Error cargando escenarios:', err);
        setError(true);
      } finally {
        if (!cancelled) setCargando(false);
      }
    };

    cargarEscenarios();
    return () => {
      cancelled = true;
    };
  }, [intento, langVersion]);

  const escenariosFiltrados = useMemo(() => {
    return enPestana.filter((escenario) => {
      const coincideBusqueda =
        escenario.title.toLowerCase().includes(busqueda.toLowerCase()) ||
        escenario.context.toLowerCase().includes(busqueda.toLowerCase());
      const coincideCategoria = filtro === 'TODOS' || escenario.category === filtro;
      return coincideBusqueda && coincideCategoria;
    });
  }, [enPestana, busqueda, filtro]);

  const seleccionarEscenario = (escenario) => {
    sessionStorage.setItem('voxready_escenario_seleccionado', JSON.stringify(escenario));
    navigate('/vocero/preparar');
  };

  return (
    <>
      <PracticeSteps />
      <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.sub} />

      <div className="flex items-end gap-6 border-b border-line mb-6" role="tablist" aria-label={t.tabsLabel}>
        {tabs.map((tab) => {
          const activa = pestana === tab.value;
          const total = tab.value === 'general' ? generales.length : propios.length;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => setPestana(tab.value)}
              className={cx(
                '-mb-px h-11 inline-flex items-center gap-2 border-b-2 px-1 text-sm font-medium transition-colors',
                activa ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {tab.label}
              {!cargando && <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-muted">{total}</span>}
            </button>
          );
        })}
      </div>
      {pestana === 'general' && (
        <p className="-mt-2 mb-6 text-[13px] text-muted">{t.generalNote}</p>
      )}

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
            title={t.loadFailed}
            description={t.loadError}
            action={
              <div className="flex gap-2 justify-center">
                <Button variant="secondary" icon="refresh" onClick={() => setIntento((n) => n + 1)}>
                  {t.retry}
                </Button>
                <Button variant="ghost" to="/laboratorio" icon="flask">
                  {t.diagnostic}
                </Button>
              </div>
            }
          />
        </Card>
      )}

      {!cargando && !error && escenarios.length === 0 && (
        <Card>
          <EmptyState icon="layers" title={t.noScenarios.title} description={t.noScenarios.description} />
        </Card>
      )}

      {!cargando && !error && escenarios.length > 0 && enPestana.length === 0 && (
        <Card>
          {pestana === 'org' ? (
            <EmptyState
              icon="layers"
              title={t.orgEmpty.title}
              description={t.orgEmpty.description}
              action={
                <Button iconRight="arrowRight" onClick={() => setPestana('general')}>
                  {t.orgEmpty.cta}
                </Button>
              }
            />
          ) : (
            <EmptyState icon="layers" title={t.generalEmpty.title} description={t.generalEmpty.description} />
          )}
        </Card>
      )}

      {!cargando && !error && enPestana.length > 0 && escenariosFiltrados.length === 0 && (
        <Card>
          <EmptyState icon="search" title={t.noResults.title} description={t.noResults.description} />
        </Card>
      )}

      {!cargando && !error && escenariosFiltrados.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {escenariosFiltrados.map((escenario) => {
            const meta = CATEGORY_META[escenario.category] || { tone: 'neutral', icon: 'layers' };
            const categoryLabel = t.categories[escenario.category] || escenario.category;
            // Escenario personalizado escrito en otro idioma: se avisa, nunca se traduce solo.
            const otherLanguage =
              escenario.language && escenario.language !== lang ? t.inLanguage(t.languageNames[escenario.language]) : null;
            return (
              <Card
                key={`${escenario.scope || 'org'}-${escenario.id}`}
                className="group flex flex-col hover:shadow-lift hover:border-line-strong transition-all"
              >
                <div className="flex items-center justify-between mb-6">
                  <span className="h-10 w-10 rounded-xl bg-subtle flex items-center justify-center text-ink">
                    <Icon name={meta.icon} size={18} />
                  </span>
                  <Badge tone={meta.tone}>{categoryLabel}</Badge>
                </div>
                <h3 className="text-[17px] font-semibold tracking-tight text-ink">{escenario.title}</h3>
                <p className="text-[13px] text-muted mt-2 leading-relaxed flex-1">{escenario.context}</p>
                {otherLanguage && (
                  <p className="mt-3">
                    <Badge tone="warning">{otherLanguage}</Badge>
                  </p>
                )}
                <InterviewSummary interview={escenario.interview} className="mt-4 flex flex-wrap items-center gap-2" />
                <div className="mt-6 pt-5 border-t border-line flex items-center justify-between">
                  <span className="text-xs text-faint">
                    {isGeneral(escenario)
                      ? t.generalFooter
                      : `${t.assignedAt} ${new Date(escenario.assignedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`}
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
