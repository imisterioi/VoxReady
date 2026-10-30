import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Progress, ScoreRing, cx } from '../components/ui';
import { apiFetch } from '../lib/api';
import { formatDate } from '../data/directory';
import { lessonsForArea } from '../data/lessons';
import SessionVideo from '../components/SessionVideo';
import { reportAccess, resolveReportSessionId } from '../lib/practice/reportAccess';
import { RESULT_KEY } from './SesionPractica';

// Práctica recién terminada por el vocero (SesionPractica guarda ahí su sesión). Permite abrir
// el informe de ESA sesión sin ?sesion=; si su informe no está listo, se muestra el estado.
function recentSessionId() {
  try {
    return JSON.parse(sessionStorage.getItem(RESULT_KEY))?.sessionId || null;
  } catch {
    return null;
  }
}

const AREA_ICONS = { expression: 'person', voice: 'mic', coherence: 'message', empathy: 'users' };

// 75 → "1 min 15 s" · 8.4 → "8 s"
function formatSeconds(value) {
  if (value == null) return '—';
  const total = Math.round(value);
  return total >= 60 ? `${Math.floor(total / 60)} min ${total % 60} s` : `${total} s`;
}

// Informe tipo coach de una sesión real (GET /api/sessions/:id).
// Sin ?sesion= muestra la práctica más reciente del vocero.
// audience: 'user' (vocero), 'admin' (admin del cliente) o 'master' (configurador maestro).
export default function InformeCoach({ audience = 'user' }) {
  const isVocero = audience === 'user';
  const { d, lang } = useI18n();
  const t = d.L.u6;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionId = params.get('sesion');

  const [state, setState] = useState({ loading: true, error: '', session: null, evaluation: null });
  const [openTurn, setOpenTurn] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Al cambiar de sesión se descarta la anterior: nunca se muestra el informe ni el
    // vídeo de otra práctica mientras llega la nueva.
    setState({ loading: true, error: '', session: null, evaluation: null });
    (async () => {
      try {
        const target = resolveReportSessionId({ paramId: sessionId, recentId: recentSessionId() });
        let id = target.id;
        if (!id && !isVocero) return !cancelled && setState({ loading: false, error: d.report.notInformed, session: null, evaluation: null });
        if (!id) {
          // Sin sesion concreta no se consulta el historial: no se muestra ningun informe.
          id = null; // nunca se sustituye por el informe de otra practica
          if (!id) return !cancelled && setState({ loading: false, error: '', session: null, evaluation: null });
        }
        const { session, evaluation } = await apiFetch(`/api/sessions/${id}`);
        if (!cancelled) setState({ loading: false, error: '', session, evaluation: evaluation || null });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, session: null, evaluation: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, isVocero]);

  const { loading, error, session, evaluation } = state;
  const report = session?.report;
  const access = reportAccess({ session, evaluation, error, texts: d.report });

  // Sin prácticas todavía (el vocero no tiene ninguna sesión): mensaje de bienvenida.
  const noSessions = !loading && !error && !session;

  if (loading) {
    return (
      <>
        {isVocero && <PracticeSteps />}
        <Card className="max-w-xl mx-auto">
          <EmptyState icon="refresh" title={t.loading} />
        </Card>
      </>
    );
  }

  // El informe solo se muestra cuando el backend confirma que ESA sesión está completa.
  // No se indico ninguna sesion concreta: no se muestra ningun informe (nunca el de otra
  // practica). Mensaje explicito en vez de reutilizar un resultado anterior.
  if (noSessions) {
    return (
      <>
        {isVocero && <PracticeSteps />}
        <Card className="max-w-xl mx-auto">
          <EmptyState
            icon="file"
            title={t.noReportTitle}
            description={t.noReportDesc}
            action={
              isVocero ? (
                <Button to="/vocero/progreso" iconRight="arrowRight">{t.seeHistory}</Button>
              ) : (
                <Button to="/vocero/escenarios" iconRight="arrowRight">{t.practiceNow}</Button>
              )
            }
          />
        </Card>
      </>
    );
  }

  if (!access.canOpen) {
    const retryable = access.state === 'processing' || access.state === 'pending';
    return (
      <>
        {isVocero && <PracticeSteps />}
        <Card className="max-w-xl mx-auto">
          <EmptyState
            tone={access.state === 'error' || access.state === 'failed' ? 'danger' : undefined}
            icon={noSessions ? 'file' : retryable ? 'refresh' : 'alert'}
            title={noSessions ? t.noReportsTitle : access.title}
            description={
              noSessions
                ? t.noReportsDesc
                : access.description
            }
            action={
              noSessions ? (
                <Button to="/vocero/escenarios" iconRight="arrowRight">{t.practiceNow}</Button>
              ) : retryable && isVocero && session?.id ? (
                <Button to={`/vocero/analizando?sesion=${session.id}`} iconRight="arrowRight">{t.seeAnalysis}</Button>
              ) : access.state === 'failed' ? (
                <Button to="/vocero/escenarios">{t.backToScenarios}</Button>
              ) : undefined
            }
          />
        </Card>
      </>
    );
  }

  const measuredAreas = report.areas.filter((a) => a.score != null);
  const weakest = measuredAreas.length ? measuredAreas.reduce((a, b) => (b.score < a.score ? b : a)).key : null;
  const transcript = session.transcript || [];
  const perQuestion = Object.fromEntries((report.porPregunta || []).map((p) => [Number(p.pregunta), p]));

  const sens = report.sensibilidad; // las prácticas anteriores a este análisis no lo tienen
  const perQuestionVideo = Object.fromEntries((sens?.porPregunta || []).map((p) => [Number(p.pregunta), p]));

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
          {t.back}
        </Button>
      )}
      <PageHeader
        eyebrow={`${session.theme?.title || t.sessionFallback} · ${formatDate(session.completedAt || session.createdAt, lang)}`}
        title={isVocero ? t.title : t.reportOf(session.user?.name || d.L.dir.vocero)}
        actions={
          isVocero && (
            <>
              <Button variant="secondary" icon="chart" to="/vocero/progreso">
                {t.progressL}
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
              <div className="text-sm font-semibold text-ink">{t.reviewedBy(review.reviewer?.name)}</div>
              {review.comment && <p className="text-[13px] text-muted mt-1 leading-relaxed">“{review.comment}”</p>}
              <div className="flex flex-wrap gap-2 mt-3">
                {report.areas.map((a) =>
                  review.scores?.[a.key] != null ? (
                    <Badge key={a.key} tone="outline">
                      {t.aiVsExpert(a.label, a.score ?? '—', review.scores[a.key])}
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
                {report.pattern
                  ? report.pattern.name || t.patternOf(report.pattern.version)
                  : report.patternVersion
                    ? t.masterPatternOf(report.patternVersion)
                    : t.defaultWeights}
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
            <CardHeader className="mb-0" title={t.recordingTitle} description={t.recordingDesc} />
          </div>
          <SessionVideo sessionId={session.id} />
        </Card>

        {isVocero && (
        <Card>
          <CardHeader title={t.lessonsTitle} description={weakest ? t.lessonsWeakest : t.lessonsImprove} />
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
                  <div className="text-xs text-muted mt-1">{l.minutes} min · {t.videoL}</div>
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
              {area.key === weakest && <Badge tone="accent">{t.reinforce}</Badge>}
            </div>
            <div className="text-[13px] text-muted">{area.label}</div>
            <div className="text-[28px] font-semibold tracking-tight text-ink tabular-nums mt-1 mb-4">
              {area.score ?? '—'}
              <span className="text-sm text-faint font-normal">{area.score != null ? t.outOf100 : t.notMeasured}</span>
            </div>
            <Progress value={area.score ?? 0} tone={area.key === weakest ? 'accent' : 'ink'} />

            {area.details?.length > 0 && (
              <ul className="mt-4 pt-4 border-t border-line space-y-2">
                {area.details
                  .filter((d) => d.value != null || d.verified === false)
                  .map((d) => (
                    <li key={d.key} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted truncate">{d.label}</span>
                      {d.value == null ? (
                        // Criterio no verificable (p. ej. velocidad sin audio): se dice, no se puntúa.
                        <span className="text-faint italic" title={d.reason || ''}>{t.notVerified}</span>
                      ) : (
                        <span className={cx('tabular-nums font-medium', d.score >= 70 ? 'text-ink' : d.score >= 40 ? 'text-warning' : 'text-danger')}>
                          {d.value} {d.unit === '%' || d.unit === '°' || d.unit === 's' ? d.unit : ''}
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            )}
            <p className="text-[11px] text-faint mt-auto pt-4">
              {area.source} · {t.weightOf(area.weight)}
            </p>
          </Card>
        ))}
      </div>

      {/* Análisis de sensibilidad del video: mirada y risa */}
      {sens && (
        <Card className="mb-6">
          <CardHeader
            title={t.sensTitle}
            description={t.sensDesc(formatSeconds(sens.totalSeconds))}
          />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: t.sensFacing, value: formatSeconds(sens.facingSeconds), hint: sens.facingPct != null ? t.pctOfTime(sens.facingPct) : null, icon: 'eye' },
              { label: t.sensAway, value: formatSeconds(sens.awaySeconds), hint: sens.awayPct != null ? t.pctOfTime(sens.awayPct) : null, icon: 'search' },
              {
                label: t.sensSmile,
                value: sens.smileSeconds != null ? formatSeconds(sens.smileSeconds) : '—',
                hint: sens.smileSeconds != null ? (sens.smilePct != null ? t.pctOfTime(sens.smilePct) : null) : t.noFace,
                icon: 'sparkles',
              },
              {
                label: t.sensLaugh,
                value: sens.risa?.detectada ? (sens.risa.consistencia != null ? `${sens.risa.consistencia}` : '—') : '—',
                suffix: sens.risa?.detectada && sens.risa.consistencia != null ? t.outOf100 : '',
                hint: !sens.risa ? t.couldNotMeasure : sens.risa.detectada ? t.laughAligned : t.laughNone,
                icon: 'message',
                alert: sens.risa?.detectada && sens.risa.consistencia != null && sens.risa.consistencia < 50,
              },
            ].map((item) => (
              <div key={item.label} className={cx('rounded-xl border p-4', item.alert ? 'border-danger/25 bg-danger/[0.04]' : 'border-line')}>
                <div className="flex items-center justify-between text-muted">
                  <span className="text-[13px]">{item.label}</span>
                  <Icon name={item.icon} size={15} className="text-faint" />
                </div>
                <div className="text-[24px] font-semibold tracking-tight text-ink tabular-nums mt-2">
                  {item.value}
                  {item.suffix && <span className="text-sm text-faint font-normal">{item.suffix}</span>}
                </div>
                {item.hint && <div className="text-xs text-faint mt-1">{item.hint}</div>}
              </div>
            ))}
          </div>
          {sens.risa?.detectada && sens.risa.comentario && (
            <p className="text-[13px] text-ink rounded-xl bg-subtle/60 p-3 flex gap-2 mt-4">
              <Icon name="sparkles" size={14} className="text-accent-fg mt-0.5 shrink-0" />
              {sens.risa.comentario}
            </p>
          )}
        </Card>
      )}

      {/* Mensajes clave y líneas rojas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader
            title={t.keyMsgsTitle}
            description={t.keyMsgsDesc(report.mensajesClave.filter((m) => m.cubierto).length, report.mensajesClave.length)}
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
            {report.mensajesClave.length === 0 && <li className="text-sm text-muted">{t.noKeyMsgs}</li>}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title={t.redLinesTitle}
            description={
              report.lineasRojas.some((l) => l.cruzada)
                ? t.redLinesCrossed(report.lineasRojas.filter((l) => l.cruzada).length)
                : t.redLinesNone
            }
          />
          <ul className="space-y-3">
            {report.lineasRojas.map((l) => (
              <li key={l.linea} className={cx('rounded-xl border p-3 text-sm', l.cruzada ? 'border-danger/25 bg-danger/[0.04]' : 'border-line')}>
                <div className="flex gap-3">
                  <Icon name={l.cruzada ? 'alert' : 'shield'} size={16} className={cx('mt-0.5 shrink-0', l.cruzada ? 'text-danger' : 'text-success')} />
                  <span className={l.cruzada ? 'text-ink' : 'text-muted'}>{l.linea}</span>
                </div>
                {l.cruzada && l.evidencia && <p className="text-xs text-danger mt-2 pl-7 italic">{t.youSaid(l.evidencia)}</p>}
              </li>
            ))}
            {report.lineasRojas.length === 0 && <li className="text-sm text-muted">{t.noRedLines}</li>}
          </ul>
        </Card>
      </div>

      {/* Entrevista pregunta por pregunta */}
      <Card padded={false} className="overflow-hidden mb-6">
        <div className="p-6 pb-0">
          <CardHeader title={t.interviewTitle} description={t.interviewDesc} />
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
                      <b className="text-ink font-medium">{t.yourAnswer}</b>
                      {turn.answer || <i>{t.noAnswer}</i>}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {turn.metrics?.wpm != null && <Badge tone="outline">{t.wpm(Math.round(turn.metrics.wpm))}</Badge>}
                      <Badge tone={turn.metrics?.fillers ? 'warning' : 'outline'}>{t.fillers(turn.metrics?.fillers || 0)}</Badge>
                      {turn.metrics?.latencyMs != null && <Badge tone="outline">{t.startedIn((turn.metrics.latencyMs / 1000).toFixed(1))}</Badge>}
                      {turn.metrics?.longPauses > 0 && <Badge tone="outline">{t.longPauses(turn.metrics.longPauses)}</Badge>}
                      {perQuestionVideo[i + 1]?.awaySeconds >= 1 && (
                        <Badge tone="outline">{t.lookedAway(formatSeconds(perQuestionVideo[i + 1].awaySeconds))}</Badge>
                      )}
                      {perQuestionVideo[i + 1]?.smileSeconds >= 0.5 && (
                        <Badge tone="warning">{t.smiledOrLaughed(formatSeconds(perQuestionVideo[i + 1].smileSeconds))}</Badge>
                      )}
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
        {t.evaluatedByAi(report.ai?.evaluator)} ·{' '}
        {report.pattern
          ? `${report.pattern.name || t.patternOf(report.pattern.version)}${
              report.pattern.source === 'scenario'
                ? t.scenarioPattern
                : report.pattern.source === 'vocero'
                  ? t.voceroPattern
                  : ''
            }`
          : t.defaultWeightsLower}{' '}
        · {t.weightsSummary(report.weights)}
      </p>
    </>
  );
}
