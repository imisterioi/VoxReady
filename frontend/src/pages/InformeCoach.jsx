import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Progress, ScoreRing, cx } from '../components/ui';
import { apiFetch } from '../lib/api';
import { formatDate } from '../data/directory';
import { lessonsForArea } from '../data/lessons';
import SessionVideo from '../components/SessionVideo';

const AREA_ICONS = { expression: 'person', voice: 'mic', coherence: 'message', empathy: 'users' };

// Informe tipo coach de una sesión real (GET /api/sessions/:id).
// Sin ?sesion= muestra la práctica más reciente del vocero.
// audience: 'user' (vocero), 'admin' (admin del cliente) o 'master' (configurador maestro).
export default function InformeCoach({ audience = 'user' }) {
  const isVocero = audience === 'user';
  const t = I.es.L.u6;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionId = params.get('sesion');

  const [state, setState] = useState({ loading: true, error: '', session: null });
  const [openTurn, setOpenTurn] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let id = sessionId;
        if (!id && !isVocero) return !cancelled && setState({ loading: false, error: 'No se indicó la práctica.', session: null });
        if (!id) {
          const { sessions } = await apiFetch('/api/sessions');
          id = sessions[0]?.id;
          if (!id) return !cancelled && setState({ loading: false, error: '', session: null });
        }
        const { session } = await apiFetch(`/api/sessions/${id}`);
        if (!cancelled) setState({ loading: false, error: '', session });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, session: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, isVocero]);

  const { loading, error, session } = state;
  const report = session?.report;

  if (loading || error || !report) {
    return (
      <>
        {isVocero && <PracticeSteps />}
        <Card className="max-w-xl mx-auto">
          {loading ? (
            <EmptyState icon="refresh" title="Cargando tu informe…" />
          ) : error ? (
            <EmptyState tone="danger" icon="alert" title="No se pudo cargar el informe" description={error} />
          ) : (
            <EmptyState
              icon="file"
              title="Aún no tienes informes"
              description="Completa una práctica para recibir tu evaluación. Te recomendamos la “Prueba integral”."
              action={<Button to="/vocero/escenarios" iconRight="arrowRight">Practicar ahora</Button>}
            />
          )}
        </Card>
      </>
    );
  }

  const measuredAreas = report.areas.filter((a) => a.score != null);
  const weakest = measuredAreas.length ? measuredAreas.reduce((a, b) => (b.score < a.score ? b : a)).key : null;
  const transcript = session.transcript || [];
  const perQuestion = Object.fromEntries((report.porPregunta || []).map((p) => [Number(p.pregunta), p]));

  const lessons = lessonsForArea(weakest, 2);
  const review = session.review;
  const backTo = audience === 'admin' ? '/admin/practicas' : audience === 'master' ? '/maestro/etiquetado' : null;

  const retry = () => {
    if (session.theme) {
      sessionStorage.setItem('voxready_escenario_seleccionado', JSON.stringify({ id: session.theme.id, title: session.theme.title }));
    }
    navigate('/vocero/preparar');
  };

  return (
    <>
      {isVocero ? (
        <PracticeSteps />
      ) : (
        <Button variant="ghost" size="sm" icon="arrowLeft" to={backTo} className="-ml-3 mb-6">
          Volver
        </Button>
      )}
      <PageHeader
        eyebrow={`${session.theme?.title || 'Práctica'} · ${formatDate(session.completedAt || session.createdAt)}`}
        title={isVocero ? t.title : `Informe de ${session.user?.name || 'vocero'}`}
        actions={
          isVocero && (
            <>
              <Button variant="secondary" icon="chart" to="/vocero/progreso">
                Mi progreso
              </Button>
              <Button variant="accent" icon="repeat" onClick={retry}>
                {t.redo}
              </Button>
            </>
          )
        }
      />

      {review && (
        <Card className="mb-6 border-brand/30 bg-brand/[0.04]">
          <div className="flex items-start gap-3">
            <span className="h-9 w-9 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
              <Icon name="shield" size={16} />
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-ink">Revisado por un experto · {review.reviewer?.name}</div>
              {review.comment && <p className="text-[13px] text-muted mt-1 leading-relaxed">“{review.comment}”</p>}
              <div className="flex flex-wrap gap-2 mt-3">
                {report.areas.map((a) =>
                  review.scores?.[a.key] != null ? (
                    <Badge key={a.key} tone="outline">
                      {a.label}: IA {a.score ?? '—'} → experto {review.scores[a.key]}
                    </Badge>
                  ) : null,
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Resumen coach */}
      <Card className="p-0 overflow-hidden mb-6">
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr]">
          <div className="flex flex-col items-center justify-center gap-4 p-8 border-b md:border-b-0 md:border-r border-line bg-subtle/40">
            <ScoreRing value={report.global ?? 0} />
            <div className="text-center">
              <div className="text-sm font-medium text-ink">{t.globalL}</div>
              <div className="text-xs text-muted mt-1">
                {report.pattern ? report.pattern.name || `Patrón v${report.pattern.version}` : report.patternVersion ? `Patrón maestro v${report.patternVersion}` : 'Pesos por defecto'}
              </div>
            </div>
          </div>

          <div className="p-6 md:p-8">
            {report.cita && (
              <blockquote className="font-display font-medium text-[20px] md:text-[23px] leading-[1.45] tracking-[-0.015em] text-ink">
                “{report.cita}”
              </blockquote>
            )}
            {report.resumen && <p className="text-sm text-muted mt-4 leading-relaxed">{report.resumen}</p>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-8">
              {[
                { title: t.good, items: report.fortalezas, icon: 'check', tone: 'bg-success/10 text-success' },
                { title: t.improve, items: report.mejoras, icon: 'target', tone: 'bg-accent-soft text-accent-fg' },
              ].map((col) => (
                <div key={col.title}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={cx('h-6 w-6 rounded-md flex items-center justify-center', col.tone)}>
                      <Icon name={col.icon} size={13} strokeWidth={2.5} />
                    </span>
                    <span className="text-sm font-semibold text-ink">{col.title}</span>
                  </div>
                  <ul className="space-y-2">
                    {(col.items || []).map((item) => (
                      <li key={item} className="text-[13px] text-muted leading-relaxed pl-8">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Grabación y lecciones recomendadas */}
      <div className={cx('grid grid-cols-1 gap-6 mb-6', isVocero && 'lg:grid-cols-[1.4fr_1fr]')}>
        <Card padded={false} className="overflow-hidden">
          <div className="p-6 pb-4">
            <CardHeader className="mb-0" title="Tu grabación" description="Revísala para ver lo que midió el análisis" />
          </div>
          <SessionVideo sessionId={session.id} />
        </Card>

        {isVocero && (
        <Card>
          <CardHeader title="Lecciones recomendadas" description={weakest ? 'Según tu área más débil' : 'Para seguir mejorando'} />
          <div className="space-y-3">
            {lessons.map((l) => (
              <Link
                key={l.id}
                to={`/vocero/leccion/${l.id}`}
                className="flex gap-3 rounded-xl border border-line p-3 hover:border-line-strong hover:bg-subtle/50 transition-colors"
              >
                <img src={`https://i.ytimg.com/vi/${l.video.id}/mqdefault.jpg`} alt="" className="h-14 w-24 rounded-lg object-cover shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink line-clamp-2">{l.title}</div>
                  <div className="text-xs text-muted mt-1">{l.minutes} min · video</div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
        )}
      </div>

      {/* Detalle por área */}
      <h2 className="text-[15px] font-semibold text-ink mb-4">{t.detail}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {report.areas.map((area) => (
          <Card key={area.key} className="p-5 flex flex-col">
            <div className="flex items-center justify-between mb-5">
              <span className="h-9 w-9 rounded-lg bg-subtle text-ink flex items-center justify-center">
                <Icon name={AREA_ICONS[area.key]} size={16} />
              </span>
              {area.key === weakest && <Badge tone="accent">A reforzar</Badge>}
            </div>
            <div className="text-[13px] text-muted">{area.label}</div>
            <div className="text-[28px] font-semibold tracking-tight text-ink tabular-nums mt-1 mb-4">
              {area.score ?? '—'}
              <span className="text-sm text-faint font-normal">{area.score != null ? ' /100' : ' no medido'}</span>
            </div>
            <Progress value={area.score ?? 0} tone={area.key === weakest ? 'accent' : 'ink'} />

            {area.details?.length > 0 && (
              <ul className="mt-4 pt-4 border-t border-line space-y-2">
                {area.details
                  .filter((d) => d.value != null)
                  .map((d) => (
                    <li key={d.key} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted truncate">{d.label}</span>
                      <span className={cx('tabular-nums font-medium', d.score >= 70 ? 'text-ink' : d.score >= 40 ? 'text-warning' : 'text-danger')}>
                        {d.value} {d.unit === '%' || d.unit === '°' || d.unit === 's' ? d.unit : ''}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
            <p className="text-[11px] text-faint mt-auto pt-4">
              {area.source} · peso {area.weight}%
            </p>
          </Card>
        ))}
      </div>

      {/* Mensajes clave y líneas rojas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader
            title="Mensajes clave"
            description={`${report.mensajesClave.filter((m) => m.cubierto).length} de ${report.mensajesClave.length} sostenidos en la entrevista`}
          />
          <ul className="space-y-3">
            {report.mensajesClave.map((m) => (
              <li key={m.mensaje} className="flex gap-3 text-sm">
                <span className={cx('h-6 w-6 rounded-md flex items-center justify-center shrink-0', m.cubierto ? 'bg-success/10 text-success' : 'bg-subtle text-faint')}>
                  <Icon name={m.cubierto ? 'check' : 'x'} size={13} strokeWidth={2.5} />
                </span>
                <span className={m.cubierto ? 'text-ink' : 'text-muted'}>{m.mensaje}</span>
              </li>
            ))}
            {report.mensajesClave.length === 0 && <li className="text-sm text-muted">El escenario no tiene mensajes clave definidos.</li>}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Líneas rojas"
            description={
              report.lineasRojas.some((l) => l.cruzada)
                ? `Cruzaste ${report.lineasRojas.filter((l) => l.cruzada).length} línea(s) roja(s)`
                : 'No cruzaste ninguna línea roja'
            }
          />
          <ul className="space-y-3">
            {report.lineasRojas.map((l) => (
              <li key={l.linea} className={cx('rounded-xl border p-3 text-sm', l.cruzada ? 'border-danger/25 bg-danger/[0.04]' : 'border-line')}>
                <div className="flex gap-3">
                  <Icon name={l.cruzada ? 'alert' : 'shield'} size={16} className={cx('mt-0.5 shrink-0', l.cruzada ? 'text-danger' : 'text-success')} />
                  <span className={l.cruzada ? 'text-ink' : 'text-muted'}>{l.linea}</span>
                </div>
                {l.cruzada && l.evidencia && <p className="text-xs text-danger mt-2 pl-7 italic">Dijiste: “{l.evidencia}”</p>}
              </li>
            ))}
            {report.lineasRojas.length === 0 && <li className="text-sm text-muted">El escenario no tiene líneas rojas definidas.</li>}
          </ul>
        </Card>
      </div>

      {/* Entrevista pregunta por pregunta */}
      <Card padded={false} className="overflow-hidden mb-6">
        <div className="p-6 pb-0">
          <CardHeader title="Tu entrevista" description="Pregunta por pregunta, con lo que se midió en cada respuesta" />
        </div>
        <ul className="divide-y divide-line border-t border-line">
          {transcript.map((turn, i) => {
            const feedback = perQuestion[i + 1];
            const open = openTurn === i;
            return (
              <li key={i}>
                <button onClick={() => setOpenTurn(open ? null : i)} className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-subtle/50 transition-colors">
                  <span className="h-7 w-7 rounded-full bg-subtle text-muted text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="flex-1 text-sm text-ink line-clamp-1">{turn.question}</span>
                  {feedback?.puntaje != null && <span className="text-sm font-semibold tabular-nums text-ink">{feedback.puntaje}</span>}
                  <Icon name="chevronDown" size={16} className={cx('text-faint transition-transform', open && 'rotate-180')} />
                </button>
                {open && (
                  <div className="px-6 pb-5 pl-[68px] space-y-3">
                    <p className="text-sm text-muted leading-relaxed">
                      <b className="text-ink font-medium">Tu respuesta: </b>
                      {turn.answer || <i>(no respondiste)</i>}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {turn.metrics?.wpm != null && <Badge tone="outline">{Math.round(turn.metrics.wpm)} palabras/min</Badge>}
                      <Badge tone={turn.metrics?.fillers ? 'warning' : 'outline'}>{turn.metrics?.fillers || 0} muletillas</Badge>
                      {turn.metrics?.latencyMs != null && <Badge tone="outline">Empezaste en {(turn.metrics.latencyMs / 1000).toFixed(1)} s</Badge>}
                      {turn.metrics?.longPauses > 0 && <Badge tone="outline">{turn.metrics.longPauses} pausas largas</Badge>}
                    </div>
                    {feedback?.comentario && (
                      <p className="text-[13px] text-ink rounded-xl bg-subtle/60 p-3 flex gap-2">
                        <Icon name="sparkles" size={14} className="text-accent-fg mt-0.5 shrink-0" />
                        {feedback.comentario}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <p className="text-xs text-faint text-center flex items-center justify-center gap-1.5">
        <Icon name="info" size={13} />
        Evaluado por IA ({report.ai?.evaluator}) ·{' '}
        {report.pattern
          ? `${report.pattern.name || `Patrón v${report.pattern.version}`}${report.pattern.source === 'scenario' ? ' (patrón exclusivo del escenario)' : report.pattern.source === 'vocero' ? ' (patrón exclusivo del vocero)' : ''}`
          : 'pesos por defecto'}{' '}
        · pesos: expresión {report.weights.expression}%, tono {report.weights.voice}%, coherencia {report.weights.coherence}%, empatía {report.weights.empathy}%
      </p>
    </>
  );
}
