import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import I from '../data/dictionary';
import { CHARTCOLORS } from '../data/mockData';
import Icon from '../components/Icon';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, cx } from '../components/ui';
import useApiData from '../hooks/useApiData';
import { formatDate } from '../data/directory';
import { lessonsForArea } from '../data/lessons';
import { evaluatedSessions, historyStatus } from '../lib/practice/sessionHistory';
import { analyticsPath, progressPath } from '../lib/practice/progressSource';
import { historyWindow } from '../lib/practice/historyPaging';
import Pagination from '../components/Pagination';

const AREAS = [
  { key: 'expression', label: 'Expresión' },
  { key: 'voice', label: 'Tono de voz' },
  { key: 'coherence', label: 'Coherencia' },
  { key: 'empathy', label: 'Empatía' },
];

// Progreso real del vocero a partir de sus prácticas evaluadas (GET /api/sessions).
//
// audience:
//  - 'user'  → el propio vocero ve su progreso (comportamiento original, sin `?userId=`).
//  - 'admin' → el administrador del cliente consulta el progreso de UNO de sus voceros
//    (`/admin/vocero/:userId`). El backend valida el rol y la organización: el identificador
//    de la ruta nunca es la autorización.
export default function MiProgreso({ audience = 'user' }) {
  const t = I.es.L.u7;
  const isAdmin = audience === 'admin';
  const { userId = null } = useParams();
  // Historial paginado en el servidor: 10 filas al entrar, ampliables a 20 dentro de la página.
  const [historyPage, setHistoryPage] = useState(1);
  const [expanded, setExpanded] = useState(false);
  // El vocero siempre consulta lo suyo; el administrador, el vocero indicado en la ruta.
  const history = useApiData(progressPath({ audience, userId, page: historyPage }));
  const sessions = useMemo(() => history.data?.sessions || [], [history.data]);
  const total = history.data?.total ?? sessions.length;
  const win = historyWindow({ total, page: historyPage, expanded });
  // Filas visibles de la página actual (10, o 20 si se amplió el historial).
  const visibleSessions = useMemo(() => sessions.slice(0, win.visible), [sessions, win.visible]);
  // Nombre del vocero consultado: lo informa el backend junto con sus sesiones.
  const voceroName = isAdmin ? history.data?.user?.name || null : null;
  // Estadísticas (series, tendencia, recomendaciones): ventana acotada e independiente de la
  // página del historial, para que el progreso no cambie al pasar de página.
  const analytics = useApiData(analyticsPath({ audience, userId }));
  const analyticsSessions = useMemo(() => analytics.data?.sessions || [], [analytics.data]);
  // Solo las evaluadas alimentan puntajes, tendencias y recomendaciones: nunca se inventan datos.
  const evaluated = useMemo(() => evaluatedSessions(analyticsSessions), [analyticsSessions]);
  const latestReport = useApiData(evaluated[0] ? `/api/sessions/${evaluated[0].id}` : null);

  // Serie cronológica (últimas 8 prácticas evaluadas)
  const chrono = useMemo(() => [...evaluated].reverse().slice(-8), [evaluated]);
  const series = AREAS.map((a) => chrono.map((s) => s.areas.find((x) => x.key === a.key)?.score ?? null));
  const globalSeries = chrono.map((s) => s.score);

  // Calendario (recordatorio local)
  const today = new Date();
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);
  const [hovered, setHovered] = useState(null);

  const W = 640, H = 240, pl = 32, pr = 12, pt = 16, pb = 28;
  const n = Math.max(chrono.length, 2);
  const getX = (i) => Math.round(pl + (i * (W - pl - pr)) / (n - 1));
  const getY = (v) => Math.round(pt + ((100 - v) / 100) * (H - pt - pb));

  const polyline = (values) => {
    const pts = values.map((v, i) => (v == null ? null : `${getX(i)},${getY(v)}`)).filter(Boolean);
    return pts.join(' ');
  };

  const handlePrevMonth = () => (calMonth === 0 ? (setCalMonth(11), setCalYear(calYear - 1)) : setCalMonth(calMonth - 1));
  const handleNextMonth = () => (calMonth === 11 ? (setCalMonth(0), setCalYear(calYear + 1)) : setCalMonth(calMonth + 1));
  const daysCount = new Date(calYear, calMonth + 1, 0).getDate();
  const offset = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
  const isToday = (day) => day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
  const isPast = (day) => new Date(calYear, calMonth, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Área más débil y recomendaciones del último informe EVALUADO (nunca de una sesión pendiente).
  const lastAreas = evaluated[0]?.areas?.filter((a) => a.score != null) || [];
  const weakest = lastAreas.length ? lastAreas.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  const mejoras = latestReport.data?.session?.report?.mejoras || [];
  const lessons = lessonsForArea(weakest?.key, 3);

  const header = isAdmin ? (
    <PageHeader
      eyebrow="Administración · Progreso"
      title={voceroName ? `Progreso de ${voceroName}` : 'Progreso del vocero'}
      description="Métricas, puntuaciones por área y evolución histórica de las prácticas evaluadas de este vocero."
      actions={
        <Button to="/admin/voceros" variant="secondary" icon="arrowLeft">
          Volver a voceros
        </Button>
      }
    />
  ) : (
    <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.sub} />
  );

  // El administrador llega desde la lista de voceros: sin identificador no hay nada que mostrar.
  if (isAdmin && !userId) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon="users"
            title="No se indicó el vocero"
            description="Abre el progreso desde la lista de voceros de tu organización."
            action={
              <Button to="/admin/voceros" variant="secondary">
                Ver voceros
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  // Un fallo del backend (permiso, red…) se informa: no se disfraza de "sin datos".
  if (isAdmin && history.error) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            tone="danger"
            icon="server"
            title="No se pudo cargar el progreso"
            description={history.error}
            action={
              <Button variant="secondary" icon="refresh" onClick={history.reload}>
                Reintentar
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  if (history.loading && !history.data) {
    return (
      <>
        {isAdmin && header}
        <Card>
          <EmptyState icon="refresh" title={isAdmin ? 'Cargando el progreso…' : 'Cargando tu progreso…'} />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}

      {total === 0 ? (
        <Card className="mb-6">
          <EmptyState
            icon="chart"
            title="Aún no hay datos de progreso"
            description={
              isAdmin
                ? 'Este vocero todavía no tiene prácticas registradas.'
                : 'Completa tu primera práctica para ver tu evolución por área.'
            }
            action={isAdmin ? undefined : <Button to="/vocero/escenarios" variant="accent" icon="mic">Practicar ahora</Button>}
          />
        </Card>
      ) : (
        <>
          {/* Resumen por área: última vs primera práctica */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {AREAS.map((a, i) => {
              const values = series[i].filter((v) => v != null);
              const current = values.at(-1);
              const change = values.length > 1 ? current - values[0] : null;
              return (
                <Card key={a.key} className="p-5">
                  <div className="flex items-center gap-2 text-[13px] text-muted">
                    <span className="h-2 w-2 rounded-full" style={{ background: CHARTCOLORS[i] }} />
                    {a.label}
                  </div>
                  <div className="flex items-baseline gap-2 mt-3">
                    <span className="text-[28px] font-semibold tracking-tight tabular-nums text-ink leading-none">{current ?? '—'}</span>
                    {change != null && (
                      <span className={cx('text-xs font-medium', change >= 0 ? 'text-success' : 'text-danger')}>
                        {change >= 0 ? '▲' : '▼'} {Math.abs(change)}
                      </span>
                    )}
                  </div>
                  {current == null && <div className="text-xs text-faint mt-2">No medido aún</div>}
                </Card>
              );
            })}
          </div>

          {/* Gráfico de tendencia */}
          <Card className="mb-6">
            <CardHeader
              title={t.trendL}
              description={isAdmin ? `Últimas ${chrono.length} práctica(s)` : `Tus últimas ${chrono.length} práctica(s)`}
              action={
                <div className="hidden sm:flex gap-4 flex-wrap">
                  {AREAS.map((a, i) => (
                    <span key={a.key} className="text-xs text-muted flex items-center gap-1.5">
                      <span className="block w-3 h-[3px] rounded-full" style={{ background: CHARTCOLORS[i] }} />
                      {a.label}
                    </span>
                  ))}
                  <span className="text-xs text-muted flex items-center gap-1.5">
                    <span className="block w-3 border-t-2 border-dashed border-ink/60" /> Global
                  </span>
                </div>
              }
            />
            {chrono.length < 2 ? (
              <p className="text-sm text-muted">Necesitas al menos 2 prácticas para ver la tendencia.</p>
            ) : (
              <>
                <div className="w-full overflow-x-auto">
                  <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px] block" onMouseLeave={() => setHovered(null)}>
                    {[25, 50, 75, 100].map((g) => (
                      <g key={g}>
                        <line x1={pl} y1={getY(g)} x2={W - pr} y2={getY(g)} stroke="rgb(var(--line))" strokeWidth="1" strokeDasharray={g === 100 ? '0' : '3 4'} />
                        <text x={pl - 10} y={getY(g) + 3} fontSize="10" fill="rgb(var(--faint))" textAnchor="end">
                          {g}
                        </text>
                      </g>
                    ))}
                    {hovered !== null && <line x1={getX(hovered)} x2={getX(hovered)} y1={pt} y2={H - pb} stroke="rgb(var(--line-strong))" strokeWidth="1" />}
                    <polyline points={polyline(globalSeries)} fill="none" stroke="rgb(var(--ink) / 0.55)" strokeWidth="2" strokeDasharray="5 4" />
                    {series.map((values, si) => (
                      <g key={si}>
                        <polyline points={polyline(values)} fill="none" stroke={CHARTCOLORS[si]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        {values.map((v, i) =>
                          v == null ? null : (
                            <circle key={i} cx={getX(i)} cy={getY(v)} r={hovered === i ? 4.5 : 2.5} fill="rgb(var(--surface))" stroke={CHARTCOLORS[si]} strokeWidth="2" />
                          ),
                        )}
                      </g>
                    ))}
                    {chrono.map((_, i) => (
                      <rect
                        key={i}
                        x={getX(i) - (W - pl - pr) / (n - 1) / 2}
                        y={pt}
                        width={(W - pl - pr) / (n - 1)}
                        height={H - pt - pb}
                        fill="transparent"
                        onMouseEnter={() => setHovered(i)}
                      />
                    ))}
                    {chrono.map((s, i) => (
                      <text key={s.id} x={getX(i)} y={H - 8} fontSize="10" fill="rgb(var(--faint))" textAnchor="middle">
                        {new Date(s.completedAt).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}
                      </text>
                    ))}
                  </svg>
                </div>
                <div className="h-6 mt-2 text-xs text-muted flex flex-wrap gap-x-4">
                  {hovered !== null && (
                    <>
                      <span className="text-ink font-medium truncate max-w-[220px]">{chrono[hovered].theme?.title}</span>
                      <span>
                        Global: <b className="text-ink font-medium">{globalSeries[hovered]}</b>
                      </span>
                      {AREAS.map((a, i) => (
                        <span key={a.key} className="tabular-nums">
                          <span style={{ color: CHARTCOLORS[i] }}>●</span> {a.label}: <b className="text-ink font-medium">{series[i][hovered] ?? '—'}</b>
                        </span>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </Card>

          {/* Historial paginado: 10 filas al entrar, ampliables a 20; paginación si hay más de 20 */}
          <Card padded={false} className="overflow-hidden mb-6">
            <div className="p-6 pb-0">
              <CardHeader
                title={isAdmin ? 'Prácticas del vocero' : 'Tus prácticas'}
                description={
                  win.showPagination
                    ? `${total} práctica(s) · mostrando ${visibleSessions.length} · página ${win.page} de ${win.pages}`
                    : `${total} práctica(s)`
                }
                action={
                  isAdmin ? undefined : (
                    <Button to="/vocero/escenarios" size="sm" variant="accent" icon="mic">
                      Practicar
                    </Button>
                  )
                }
              />
            </div>
            <ul className="divide-y divide-line border-t border-line">
              {visibleSessions.map((s) => {
                const status = historyStatus(s);
                // El administrador abre el informe en su propia ruta (audiencia admin).
                const reportTo = isAdmin ? `/admin/informe?sesion=${s.id}` : `/vocero/informe?sesion=${s.id}`;
                return (
                <li key={s.id}>
                  <Link to={reportTo} className="flex items-center gap-4 px-6 py-4 hover:bg-subtle/50 transition-colors">
                    <span className="h-11 w-11 rounded-xl bg-subtle flex items-center justify-center font-display font-semibold text-ink tabular-nums">
                      {s.score ?? '—'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{s.theme?.title || 'Práctica'}</div>
                      <div className="text-xs text-muted">{formatDate(s.completedAt || s.createdAt)}</div>
                      {/* Estado del informe informado por el backend (nunca inferido ni inventado). */}
                      <div className="mt-1.5">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                    </div>
                    <div className="hidden md:flex gap-1.5">
                      {(s.areas || []).map((a) => (
                        <Badge key={a.key} tone="outline">
                          {a.label}: {a.score ?? '—'}
                        </Badge>
                      ))}
                    </div>
                    <Icon name="chevronRight" size={16} className="text-faint" />
                  </Link>
                </li>
                );
              })}
            </ul>

            {/* Ampliar de 10 a 20 (solo si hay más de 10 y quedan filas por mostrar en la página) */}
            {win.showExpand && win.canExpand && (
              <div className="border-t border-line">
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="w-full flex items-center justify-center gap-2 py-3 text-[13px] font-medium text-muted hover:text-ink hover:bg-subtle/50 transition-colors"
                >
                  <Icon name="chevronDown" size={16} className={expanded ? 'rotate-180' : ''} />
                  {expanded ? 'Ver menos' : `Ver más (${Math.min(win.inBlock, 20) - win.visible} más)`}
                </button>
              </div>
            )}

            {/* Paginación: solo cuando hay más de 20 sesiones */}
            {win.showPagination && (
              <div className="border-t border-line px-6 py-4">
                <Pagination
                  page={win.page}
                  pages={win.pages}
                  onChange={(next) => {
                    setExpanded(false); // cada página empieza mostrando 10
                    setHistoryPage(next);
                  }}
                />
              </div>
            )}
          </Card>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recomendaciones reales */}
        <Card>
          <CardHeader
            title={t.recoTitle}
            description={
              weakest
                ? isAdmin
                  ? `Área más débil: ${weakest.label.toLowerCase()}`
                  : `Tu área más débil: ${weakest.label.toLowerCase()}`
                : isAdmin
                  ? 'Basadas en la última práctica del vocero'
                  : 'Basadas en tu última práctica'
            }
          />
          <div className="space-y-3">
            {mejoras.slice(0, 3).map((m, i) => (
              <div key={m} className="flex gap-4 p-4 rounded-xl border border-line">
                <span className="h-7 w-7 rounded-full bg-subtle text-muted text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                <p className="text-[13px] text-ink leading-relaxed">{m}</p>
              </div>
            ))}
            {!mejoras.length && (
              <p className="text-sm text-muted">
                {isAdmin
                  ? 'Este vocero aún no tiene recomendaciones de la IA.'
                  : 'Tras tu primera práctica verás aquí las recomendaciones de la IA.'}
              </p>
            )}
          </div>
          {/* Las microlecciones son del vocero (ruta propia): el administrador solo las ve aquí
              cuando consulta su propio progreso. */}
          {!isAdmin && (
            <div className="mt-5 pt-5 border-t border-line">
              <div className="text-xs text-muted mb-3">Lecciones sugeridas</div>
              <div className="flex flex-wrap gap-2">
                {lessons.map((l) => (
                  <Button key={l.id} variant="secondary" size="sm" icon="book" to={`/vocero/leccion/${l.id}`}>
                    {l.title}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Calendario: recordatorio personal del vocero (no aplica a la vista del administrador) */}
        {!isAdmin && (
        <Card className="flex flex-col">
          <CardHeader title={t.calTitle} description={t.calHelp} />
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium capitalize text-ink">
              {t.months[calMonth]} {calYear}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={handlePrevMonth} aria-label="Mes anterior">
                <Icon name="chevronLeft" size={16} />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleNextMonth} aria-label="Mes siguiente">
                <Icon name="chevronRight" size={16} />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {t.weekdays.map((w) => (
              <div key={w} className="text-[11px] font-medium text-faint text-center pb-2">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: offset }).map((_, i) => (
              <div key={`e-${i}`} />
            ))}
            {Array.from({ length: daysCount }, (_, i) => i + 1).map((day) => {
              const isSelected = selectedDate?.day === day && selectedDate?.month === calMonth && selectedDate?.year === calYear;
              const past = isPast(day);
              return (
                <button
                  key={day}
                  disabled={past}
                  onClick={() => setSelectedDate({ day, month: calMonth, year: calYear })}
                  className={cx(
                    'relative h-10 rounded-lg text-[13px] tabular-nums transition-colors',
                    isSelected ? 'bg-primary text-primary-ink font-semibold' : past ? 'text-faint/50 cursor-not-allowed' : 'text-ink hover:bg-subtle',
                  )}
                >
                  {day}
                  {isToday(day) && !isSelected && <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-accent" />}
                </button>
              );
            })}
          </div>
          <div className="mt-auto pt-6 flex items-center justify-between gap-4 border-t border-line">
            <div>
              <div className="text-xs text-muted">{t.nextLabel}</div>
              <div className="text-sm font-medium text-ink mt-0.5">
                {selectedDate ? `${selectedDate.day} de ${t.months[selectedDate.month]}` : t.calNone}
              </div>
            </div>
            <Button
              disabled={!selectedDate}
              onClick={() => toast.success(`Recordatorio: práctica el ${selectedDate.day} de ${t.months[selectedDate.month]}`)}
              icon="calendar"
            >
              {t.calBtn}
            </Button>
          </div>
        </Card>
        )}
      </div>
    </>
  );
}
