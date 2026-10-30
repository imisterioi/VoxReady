import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Button, Card, EmptyState, cx } from '../components/ui';
import { apiFetch } from '../lib/api';
import { runAnalysis } from '../lib/practice/analysisRunner';
import { describeEvaluationError } from '../lib/practice/evaluationErrors';
import { describeStage, failureMessage } from '../lib/practice/reportAccess';
import { RESULT_KEY } from './SesionPractica';

// Los motivos que el backend puede devolver en `evaluation.reason` se traducen desde el diccionario
// (`analysis.fail`). Mensajes SIEMPRE genéricos: nunca se muestran modelos, proveedores, códigos
// HTTP ni detalles internos (el detalle técnico queda en la consola del backend).

// Envía la entrevista (transcripción + métricas) a la IA evaluadora y abre el informe.
export default function Analizando() {
  const { d } = useI18n();
  const t = d.L.u5;
  const an = d.analysis;
  // Textos del aviso de «sigue en segundo plano» y de los errores, en el idioma activo.
  const { pendingTitle: PENDING_TITLE, pendingMessage: PENDING_MESSAGE } = d.report.pending;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // El id puede venir del resultado recién guardado o de la URL (?sesion=).
  // Con la URL se puede volver a consultar el estado tras recargar, sin re-evaluar.
  const [payload] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(RESULT_KEY));
    } catch {
      return null;
    }
  });
  const sessionId = payload?.sessionId || params.get('sesion') || null;

  const steps = [
    { label: t.p1, icon: 'file' },
    { label: t.p2, icon: 'mic' },
    { label: t.p3, icon: 'person' },
    { label: t.p4, icon: 'sparkles' },
  ];

  const [current, setCurrent] = useState(0);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [attempt, setAttempt] = useState(0);
  // El informe tardó más de lo esperado (reintentos automáticos en curso): se muestra un mensaje
  // informativo, sin errores técnicos, y el sondeo continúa en segundo plano.
  const [slow, setSlow] = useState(false);
  // Cada ejecución del análisis tiene su propio AbortController: el cleanup de
  // StrictMode cancela ESA ejecución y no bloquea la siguiente.
  const runRef = useRef(null);
  // Evita repetir el POST /evaluate en el mismo intento (StrictMode remonta el efecto).
  const postedRef = useRef({ sessionId: null, attempt: -1 });

  const finish = useCallback(
    (sessionId) => {
      setCurrent(steps.length);
      sessionStorage.removeItem(RESULT_KEY);
      setTimeout(() => navigate(`/vocero/informe?sesion=${sessionId}`), 700);
    },
    [navigate, steps.length],
  );

  const evaluate = useCallback(async () => {
    if (!sessionId) return;
    // Cancela la ejecución anterior (si la hubiera) y abre una nueva.
    runRef.current?.abort();
    const controller = new AbortController();
    runRef.current = controller;
    const isCurrent = () => runRef.current === controller && !controller.signal.aborted;

    setError('');
    setCurrent(0);
    setProgress(an.analyzing);

    // Solo se PIDE evaluación si venimos de una práctica recién terminada y no se ha
    // pedido ya en este mismo intento. Con ?sesion= solo se consulta el estado.
    const posted = postedRef.current;
    const shouldPost =
      Boolean(payload?.sessionId) && (posted.sessionId !== payload.sessionId || posted.attempt !== attempt);
    if (shouldPost) postedRef.current = { sessionId: payload.sessionId, attempt };

    let result;
    try {
      result = await runAnalysis({
        sessionId,
        payload: shouldPost ? payload : null,
        signal: controller.signal,
        postEvaluate: (id, body) =>
          apiFetch(`/api/sessions/${id}/evaluate`, {
            method: 'POST',
            body: { transcript: body.transcript, metrics: body.metrics },
          }),
        fetchSession: (id) => apiFetch(`/api/sessions/${id}`),
        onStage: (stage) => {
          if (isCurrent()) setProgress(describeStage({ stage }, d.report));
        },
      });
    } catch (error) {
      // 503 (integración desactivada), 422 (sin ventanas válidas) y 502 (fallo de
      // transcripción) se muestran como mensaje claro; nunca se abre el informe.
      if (isCurrent()) setError(describeEvaluationError(error, d.evalErrors) || '');
      return;
    }

    // Una ejecución cancelada no modifica estado ni navega.
    if (!isCurrent()) return;
    if (result.status === 'done') {
      finish(result.sessionId || sessionId);
      return;
    }
    if (result.status === 'failed') {
      // Un fallo de evaluación se explica con la clasificación del backend (`errorKind`): temporal
      // (se reintentará solo) o pendiente de revisión técnica. Nunca se muestran códigos internos.
      const fromEvaluation = result.errorKind ? failureMessage({ errorKind: result.errorKind }, d.report) : '';
      setError(
        fromEvaluation ||
          an.fail[result.reason] ||
          (result.httpStatus ? describeEvaluationError({ status: result.httpStatus }, d.evalErrors) : '') ||
          an.genericError,
      );
      return;
    }
    // El sondeo se agotó pero la generación continúa en el backend: se muestra el aviso de «sigue en
    // segundo plano» (no es un error) y NO se cancela nada. El informe llegará a «Mi progreso».
    if (result.status === 'pending') setSlow(true);
  }, [sessionId, payload, attempt, finish]);

  // Arranca al entrar (con payload recién guardado o con ?sesion=) y cancela al salir.
  useEffect(() => {
    if (!sessionId) return undefined;
    evaluate();
    return () => {
      runRef.current?.abort();
    };
  }, [sessionId, evaluate]);

  // Avance visual mientras la IA trabaja (el último paso espera la respuesta real)
  useEffect(() => {
    if (error || current >= steps.length - 1) return;
    const id = setTimeout(() => setCurrent((c) => c + 1), 2500);
    return () => clearTimeout(id);
  }, [current, error, steps.length]);

  // Objetivo de experiencia: informe en ~60 s. Si sigue pendiente, se avisa sin pedir nada al
  // vocero (la evaluación continúa sola, con reintentos automáticos en el backend).
  useEffect(() => {
    if (error) return undefined;
    const id = setTimeout(() => setSlow(true), 60000);
    return () => clearTimeout(id);
  }, [error]);

  if (!sessionId) {
    return (
      <>
        <PracticeSteps />
        <Card className="max-w-xl mx-auto">
          <EmptyState
            icon="mic"
            title={an.noSessionTitle}
            description={an.noSessionDesc}
            action={<Button to="/vocero/escenarios" iconRight="arrowRight">{an.chooseScenario}</Button>}
          />
        </Card>
      </>
    );
  }

  const done = current >= steps.length;
  const pending = slow && !done && !error;
  const answered = payload?.transcript?.length || 0;

  return (
    <>
      <PracticeSteps />

      <div className="flex justify-center">
        <Card className="w-full max-w-xl p-8 md:p-12 text-center">
          {pending ? (
            <div>
              <div className="h-20 w-20 mx-auto mb-8 rounded-full bg-accent-soft text-accent-fg flex items-center justify-center">
                <Icon name="sparkles" size={28} strokeWidth={1.75} />
              </div>
              <h1 className="font-display font-semibold text-[28px] leading-tight tracking-[-0.025em] text-ink">{PENDING_TITLE}</h1>
              <p className="text-sm text-muted mt-2">{PENDING_MESSAGE}</p>
              {/* El vocero puede salir: el proceso ya reclamado continúa en el backend. */}
              <div className="mt-8 flex justify-center">
                <Button variant="secondary" to="/vocero/progreso">
                  {an.goProgress}
                </Button>
              </div>
            </div>
          ) : (
            <>
          <div className="relative h-20 w-20 mx-auto mb-8">
            {!done && !error && <span className="absolute inset-0 rounded-full border-2 border-subtle border-t-accent animate-spin" />}
            <span
              className={cx(
                'absolute rounded-full flex items-center justify-center transition-colors',
                error ? 'inset-0 bg-danger/10 text-danger' : done ? 'inset-0 bg-success/10 text-success' : 'inset-2 bg-accent-soft text-accent-fg',
              )}
            >
              <Icon name={error ? 'alert' : done ? 'check' : 'sparkles'} size={done || error ? 30 : 24} strokeWidth={done ? 2.5 : 1.75} />
            </span>
          </div>

          <h1 className="font-display font-semibold text-[28px] leading-tight tracking-[-0.025em] text-ink">
            {error ? an.errorTitle : done ? an.doneTitle : t.head}
          </h1>
          <p className="text-sm text-muted mt-2">
            {error
              ? error
              : done
                ? an.opening
                : `${payload?.theme?.title || an.interview} · ${an.answers(answered)} · ${progress || an.fallbackProgress}`}
          </p>

          <ul className="mt-10 space-y-1 text-left">
            {steps.map((s, i) => {
              const state = done || i < current ? 'done' : i === current && !error ? 'active' : 'pending';
              return (
                <li
                  key={s.label}
                  className={cx('flex items-center gap-4 rounded-xl px-4 h-14 transition-all', state === 'active' && 'bg-subtle', state === 'pending' && 'opacity-40')}
                >
                  <span
                    className={cx(
                      'h-8 w-8 rounded-lg flex items-center justify-center',
                      state === 'done' ? 'bg-success/10 text-success' : state === 'active' ? 'bg-accent-soft text-accent-fg' : 'bg-subtle text-faint',
                    )}
                  >
                    <Icon name={state === 'done' ? 'check' : s.icon} size={15} strokeWidth={state === 'done' ? 2.5 : 1.75} />
                  </span>
                  <span className={cx('text-sm flex-1', state === 'pending' ? 'text-muted' : 'text-ink font-medium')}>{s.label}</span>
                  {state === 'active' && <span className="h-4 w-4 rounded-full border-2 border-line border-t-accent animate-spin" />}
                </li>
              );
            })}
          </ul>
            </>
          )}

          {error && (
            <div className="mt-8 flex justify-center gap-2">
              <Button variant="secondary" to="/vocero/escenarios">
                {an.backToScenarios}
              </Button>
              <Button icon="refresh" onClick={() => setAttempt((a) => a + 1)}>
                {an.retry}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
