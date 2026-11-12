import { useEffect, useRef, useState } from 'react';
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
import { buildReviewView, resolveGlobal } from '../lib/practice/reviewModel';
import { AreaModal, RubricModal, ScoreDelta, TextModal } from '../components/ReviewModals';
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

// Resaltado de un texto revisado: celeste (nunca el verde/rojo reservado a las puntuaciones).
const HIGHLIGHT =
  'rounded-md border border-sky-200 bg-sky-50 text-sky-900 px-1 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200';

// Fragmentos de un texto revisado: SOLO los fragmentos cambiados se resaltan y van entre comillas; el
// resto conserva exactamente su presentación original.
function Segments({ segments }) {
  return segments.map((segment, index) => {
    if (!segment.changed) return <span key={index}>{segment.text}</span>;
    const visible = segment.text.trim();
    if (!visible) return <span key={index}>{segment.text}</span>;
    return (
      <span key={index} className={HIGHLIGHT}>
        “{visible}”
      </span>
    );
  });
}

// Texto del informe que puede haber sido revisado por una persona:
//   · sin cambios → exactamente el original;
//   · con fragmentos → se resaltan SOLO las partes cambiadas;
//   · sin fragmentos (revisión anterior o texto nuevo) → todo el texto, entre comillas y resaltado.
// Con `onClick` pasa a ser editable (modo revisión).
function EditedText({ text, edited, segments, className = '', tag: Tag = 'p', onClick, title }) {
  const hasSegments = Array.isArray(segments) && segments.length > 0;
  return (
    <Tag
      className={cx(
        className,
        !hasSegments && edited && HIGHLIGHT,
        onClick && 'cursor-pointer rounded-lg transition-shadow hover:ring-2 hover:ring-accent/40',
      )}
      onClick={onClick}
      title={title}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {hasSegments ? <Segments segments={segments} /> : edited ? `“${text}”` : text}
    </Tag>
  );
}

// Indicador de cambio de puntuación: se comparte con las ventanas de revisión (mismo lenguaje visual).

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
  // Modo REVISIÓN: la persona que etiqueta ve EXACTAMENTE el mismo informe que el vocero, con los
  // mismos componentes y distribución, pero con los elementos editables (se abren en ventanas).
  const isReview = audience === 'review';
  const { d, lang, releasePracticeLock } = useI18n();
  const t = d.L.u6;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionId = params.get('sesion');

  const [state, setState] = useState({ loading: true, error: '', session: null, evaluation: null });
  const [openTurn, setOpenTurn] = useState(null);
  // Revisión humana en curso (solo en modo revisión): el borrador se aplica ENCIMA del informe.
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editArea, setEditArea] = useState(null);
  const [editText, setEditText] = useState(null);
  const [rubricOpen, setRubricOpen] = useState(false);
  // Comentario adicional: SIEMPRE disponible para quien revisa (opcional y siempre visible).
  const [commentDraft, setCommentDraft] = useState('');
  const commentLoadedFor = useRef(null);

  useEffect(() => {
    let cancelled = false;
    // Al cambiar de sesión se descarta la anterior: no se muestra el informe ni el
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
        if (!cancelled) {
          setState({ loading: false, error: '', session, evaluation: evaluation || null });
          // En modo revisión se parte del BORRADOR guardado (si lo hay): nunca del informe publicado.
          setDraft(session.reviewDraft || null);
        }
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

  // El comentario adicional se carga UNA vez por sesión (desde el borrador guardado): así guardar
  // otra sección no pisa lo que la persona está escribiendo.
  useEffect(() => {
    const loaded = state.session?.id;
    if (!loaded || commentLoadedFor.current === loaded) return;
    commentLoadedFor.current = loaded;
    setCommentDraft(state.session?.reviewDraft?.comment || '');
  }, [state.session]);

  // Sin prácticas todavía (el vocero no tiene ninguna sesión): mensaje de bienvenida.
  const noSessions = !loading && !error && !session;

  // La práctica termina cuando el informe está disponible: a partir de ahí el idioma vuelve a poder
  // cambiarse (el informe ya se generó con el idioma congelado de la sesión).
  useEffect(() => {
    if (access.canOpen) releasePracticeLock();
  }, [access.canOpen, releasePracticeLock]);

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
  // Vista del informe. En modo REVISIÓN se aplica el BORRADOR en curso (así la persona ve el
  // resultado de sus cambios tal como quedará); fuera de ese modo, la revisión PUBLICADA.
  const view = report ? buildReviewView({ report, review: isReview ? draft : review }) : null;

  // Guarda el borrador SIN publicar (lo que el vocero sigue viendo es el informe original).
  // La combinación es POR SECCIONES para que cada ventana envíe solo lo que cambió sin borrar el resto.
  const saveDraft = async (patch) => {
    try {
      setSaving(true);
      const merged = {
        ...(draft || {}),
        ...patch,
        texts: { ...(draft?.texts || {}), ...(patch.texts || {}) },
        lists: { ...(draft?.lists || {}), ...(patch.lists || {}) },
        questions: { ...(draft?.questions || {}), ...(patch.questions || {}) },
        areas: { ...(draft?.areas || {}), ...(patch.areas || {}) },
        details: { ...(draft?.details || {}), ...(patch.details || {}) },
      };
      const { draft: saved } = await apiFetch(`/api/sessions/${session.id}/review`, { method: 'PUT', body: merged });
      setDraft(saved);
      toast.success(t.draftSavedToast);
      return saved;
    } catch (error) {
      toast.error(error.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Guarda el comentario adicional como borrador (opcional). Si se deja vacío, se BORRA: el apartado
  // desaparece del informe del vocero. No se publica hasta pulsar «Revisar y enviar».
  const saveComment = async () => {
    const current = String(commentDraft ?? '').trim();
    const stored = String(draft?.comment ?? '').trim();
    if (current === stored) return; // nada que guardar
    await saveDraft({ comment: commentDraft });
  };

  // Abre el editor de un área con la puntuación ORIGINAL de la IA como referencia.
  const openArea = (area) => {
    const original = (report.areas || []).find((item) => item.key === area.key) || {};
    setEditArea({
      ...area,
      originalScore: original.score ?? null,
      details: (area.details || []).map((detail) => ({
        ...detail,
        originalScore: (original.details || []).find((item) => item.key === detail.key)?.score ?? null,
      })),
    });
  };

  // «Revisar y enviar»: publica la revisión (el vocero la recibe y se genera la notificación).
  const publish = async () => {
    try {
      setSaving(true);
      await apiFetch(`/api/sessions/${session.id}/review`, {
        method: 'POST',
        // El comentario adicional se envía siempre: así queda publicado aunque no se haya guardado
        // antes el borrador (vacío = sin comentario, el apartado no aparece en el informe).
        body: { ...(draft || {}), comment: commentDraft },
      });
      toast.success(t.reviewSent);
      navigate('/maestro/etiquetado');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const backTo = audience === 'admin' ? '/admin/practicas' : audience === 'master' || isReview ? '/maestro/etiquetado' : null;

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
          isReview ? (
            <>
              <Button variant="secondary" icon="sliders" onClick={() => setRubricOpen(true)}>
                {t.viewRubric}
              </Button>
              <Button variant="accent" icon="check" onClick={publish} disabled={saving}>
                {saving ? t.saving : t.reviewAndSend}
              </Button>
            </>
          ) : isVocero ? (
            <>
              <Button variant="secondary" icon="chart" to="/vocero/progreso">
                {t.progressL}
              </Button>
              <Button variant="accent" icon="repeat" onClick={retry}>
                {t.redo}
              </Button>
            </>
          ) : null
        }
      />

      {isReview && (
        <Card className="mb-6 border-accent/30 bg-accent-soft/40">
          <div className="flex items-start gap-3">
            <span className="h-9 w-9 rounded-lg bg-accent-soft text-accent-fg flex items-center justify-center shrink-0">
              <Icon name="edit" size={16} />
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-ink">{t.reviewModeTitle}</div>
              <p className="text-[13px] text-muted mt-1 leading-relaxed">{t.reviewModeHint}</p>
              {draft && <Badge tone="accent" className="mt-2">{t.draftSaved}</Badge>}
            </div>
          </div>
        </Card>
      )}

      {review && !isReview && (
        <Card className="mb-6 border-brand/30 bg-brand/[0.04]">
          <div className="flex items-start gap-3">
            <span className="h-9 w-9 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
              <Icon name="shield" size={16} />
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-ink">{t.reviewedBy(review.reviewer?.name)}</div>
              <p className="text-[13px] text-muted mt-1 leading-relaxed">
                {t.reviewedNote}
                {review.sentAt ? ` · ${formatDate(review.sentAt, lang)}` : ''}
              </p>
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
            {view.texts.cita.value && (
              <EditedText
                tag="blockquote"
                text={view.texts.cita.edited ? view.texts.cita.value : `“${view.texts.cita.value}”`}
                edited={view.texts.cita.edited}
                segments={view.texts.cita.segments}
                onClick={isReview ? () => setEditText({ field: 'cita' }) : undefined}
                title={isReview ? t.clickToEdit : undefined}
                className="font-display font-medium text-[20px] md:text-[23px] leading-[1.45] tracking-[-0.015em] text-ink"
              />
            )}
            {view.texts.resumen.value && (
              <EditedText
                text={view.texts.resumen.value}
                edited={view.texts.resumen.edited}
                segments={view.texts.resumen.segments}
                onClick={isReview ? () => setEditText({ field: 'resumen' }) : undefined}
                title={isReview ? t.clickToEdit : undefined}
                className="text-sm text-muted mt-4 leading-relaxed"
              />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-8">
              {[
                { key: 'fortalezas', title: t.good, list: view.lists.fortalezas, icon: 'check', tone: 'bg-success/10 text-success' },
                { key: 'mejoras', title: t.improve, list: view.lists.mejoras, icon: 'target', tone: 'bg-accent-soft text-accent-fg' },
              ].map((col) => (
                <div
                  key={col.title}
                  onClick={isReview ? () => setEditText({ field: col.key }) : undefined}
                  title={isReview ? t.clickToEdit : undefined}
                  role={isReview ? 'button' : undefined}
                  tabIndex={isReview ? 0 : undefined}
                  className={cx(
                    'rounded-xl',
                    isReview && 'cursor-pointer transition-shadow hover:ring-2 hover:ring-accent/40',
                  )}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className={cx('h-6 w-6 rounded-md flex items-center justify-center', col.tone)}>
                      <Icon name={col.icon} size={13} strokeWidth={2.5} />
                    </span>
                    <span className="text-sm font-semibold text-ink">{col.title}</span>
                  </div>
                  <ul className="space-y-2">
                    {(col.list.items || []).map((item, index) => (
                      <li key={`${item.value}-${index}`} className="pl-8">
                        <EditedText
                          text={item.value}
                          edited={item.edited}
                          segments={item.segments}
                          className="text-[13px] text-muted leading-relaxed"
                        />
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
                to="/vocero/leccion"
                className="flex gap-3 rounded-xl border border-line p-3 hover:border-line-strong hover:bg-subtle/50 transition-colors"
              >
                <span className="h-14 w-24 rounded-lg bg-subtle flex items-center justify-center shrink-0">
                  <Icon name="book" size={18} className="text-faint" />
                </span>
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
        {view.areas.map((area) => (
          <Card
            key={area.key}
            className={cx(
              'p-5 flex flex-col',
              isReview && 'cursor-pointer transition-all hover:border-accent/60 hover:shadow-lift',
            )}
            onClick={isReview ? () => openArea(area) : undefined}
            title={isReview ? t.clickToEdit : undefined}
            role={isReview ? 'button' : undefined}
            tabIndex={isReview ? 0 : undefined}
          >
            <div className="flex items-center justify-between mb-5">
              <span className="h-9 w-9 rounded-lg bg-subtle text-ink flex items-center justify-center">
                <Icon name={AREA_ICONS[area.key]} size={16} />
              </span>
              {area.key === weakest && <Badge tone="accent">{t.reinforce}</Badge>}
            </div>
            <div className="text-[13px] text-muted">{area.label}</div>
            <div
              className={cx(
                'text-[28px] font-semibold tracking-tight tabular-nums mt-1 mb-4 flex items-center gap-2',
                area.delta > 0 ? 'text-success' : area.delta < 0 ? 'text-danger' : 'text-ink',
              )}
            >
              {area.score ?? '—'}
              <ScoreDelta delta={area.delta} />
              <span className="text-sm text-faint font-normal">{area.score != null ? t.outOf100 : t.notMeasured}</span>
            </div>
            <Progress value={area.score ?? 0} tone={area.key === weakest ? 'accent' : 'ink'} />

            {area.feedback && <EditedText text={area.feedback} edited className="text-[12px] text-ink mt-3 leading-relaxed" />}

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
                        <span className="flex items-center gap-1.5">
                          <span className={cx('tabular-nums font-medium', d.score >= 70 ? 'text-ink' : d.score >= 40 ? 'text-warning' : 'text-danger')}>
                            {d.value} {d.unit === '%' || d.unit === '°' || d.unit === 's' ? d.unit : ''}
                          </span>
                          {d.delta !== 0 && (
                            <span className={cx('flex items-center gap-0.5 text-[11px] tabular-nums font-medium', d.delta > 0 ? 'text-success' : 'text-danger')}>
                              <ScoreDelta delta={d.delta} />
                              {d.score}
                            </span>
                          )}
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

      {/* Comentario adicional (al final de «Detalle por área»): para quien revisa está SIEMPRE
          disponible (opcional); en el informe del vocero solo aparece si hay comentario escrito,
          sin textos genéricos cuando no lo hay. */}
      {isReview ? (
        <Card className="mb-6">
          <CardHeader title={t.additionalComment} description={t.additionalCommentHint} />
          <textarea
            className={cx('textarea min-h-[96px]', commentDraft && 'border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10')}
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            onBlur={saveComment}
            placeholder={t.additionalCommentPh}
            aria-label={t.additionalComment}
          />
        </Card>
      ) : (
        !view.comment.empty && (
          <Card className="mb-6">
            <CardHeader
              title={t.additionalComment}
              description={view.reviewer?.name ? t.reviewedBy(view.reviewer.name) : ''}
            />
            <EditedText text={view.comment.text} edited className="text-sm text-ink leading-relaxed" />
          </Card>
        )
      )}

      {/* Ventanas de edición (solo en modo revisión): los cambios se guardan como borrador. */}
      {isReview && (
        <>
          <AreaModal
            area={editArea}
            open={Boolean(editArea)}
            saving={saving}
            // Puntaje general EN VIVO: al cambiar subcriterios se recalcula con la rúbrica del informe.
            previewGlobal={(areaScore) =>
              resolveGlobal(report, {
                ...Object.fromEntries((view?.areas || []).map((item) => [item.key, item.score])),
                [editArea?.key]: areaScore,
              })
            }
            onSave={async (patch) => {
              const saved = await saveDraft(patch);
              if (saved) setEditArea(null);
            }}
            onClose={() => setEditArea(null)}
          />
          <TextModal
            field={editText?.field || null}
            view={view}
            open={Boolean(editText)}
            saving={saving}
            onSave={async (patch) => {
              const saved = await saveDraft(patch);
              if (saved) setEditText(null);
            }}
            onClose={() => setEditText(null)}
          />
          <RubricModal sessionId={session.id} open={rubricOpen} onClose={() => setRubricOpen(false)} />
        </>
      )}

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
                    <div
                      onClick={isReview ? () => setEditText({ field: `question:${i + 1}` }) : undefined}
                      title={isReview ? t.clickToEdit : undefined}
                      role={isReview ? 'button' : undefined}
                      tabIndex={isReview ? 0 : undefined}
                      className={cx(isReview && 'cursor-pointer rounded-xl transition-shadow hover:ring-2 hover:ring-accent/40')}
                    >
                      {feedback?.comentario && (
                        <p className="text-[13px] text-ink rounded-xl bg-subtle/60 p-3 flex gap-2">
                          <Icon name="sparkles" size={14} className="text-accent-fg mt-0.5 shrink-0" />
                          {feedback.comentario}
                        </p>
                      )}
                    </div>
                    {view.questions[i + 1]?.edited && (
                      <EditedText
                        text={view.questions[i + 1].value}
                        edited
                        segments={view.questions[i + 1].segments}
                        className="text-[13px] leading-relaxed"
                      />
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
