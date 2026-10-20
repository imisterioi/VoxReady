import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Button, Card, EmptyState, cx } from '../components/ui';
import { apiFetch } from '../lib/api';
import { runAnalysis } from '../lib/practice/analysisRunner';
import { describeStage } from '../lib/practice/reportAccess';
import { RESULT_KEY } from './SesionPractica';

// Motivos que el backend puede devolver en `evaluation.reason`.
const FAIL_REASONS = {
  NO_API_KEY: 'Falta la clave de la IA en el servidor.',
  INVALID_AI_RESPONSE: 'La IA devolvió una respuesta no válida. Puedes reintentar.',
  INTERRUPTED: 'La evaluación se interrumpió. Puedes reintentarla.',
  ERROR: 'Ocurrió un error al evaluar la sesión.',
};

// Envía la entrevista (transcripción + métricas) a la IA evaluadora y abre el informe.
export default function Analizando() {
  const t = I.es.L.u5;
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
    setProgress('Analizando tu entrevista…');

    // Solo se PIDE evaluación si venimos de una práctica recién terminada y no se ha
    // pedido ya en este mismo intento. Con ?sesion= solo se consulta el estado.
    const posted = postedRef.current;
    const shouldPost =
      Boolean(payload?.sessionId) && (posted.sessionId !== payload.sessionId || posted.attempt !== attempt);
    if (shouldPost) postedRef.current = { sessionId: payload.sessionId, attempt };

    const result = await runAnalysis({
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
        if (isCurrent()) setProgress(describeStage({ stage }));
      },
    });

    // Una ejecución cancelada no modifica estado ni navega.
    if (!isCurrent()) return;
    if (result.status === 'done') {
      finish(result.sessionId || sessionId);
      return;
    }
    if (result.status === 'failed') {
      setError(
        result.reason === 'TIMEOUT'
          ? 'La evaluación está tardando más de lo previsto. Puedes reintentarla.'
          : FAIL_REASONS[result.reason] || 'No se pudo completar la evaluación.',
      );
    }
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

  if (!sessionId) {
    return (
      <>
        <PracticeSteps />
        <Card className="max-w-xl mx-auto">
          <EmptyState
            icon="mic"
            title="No hay una entrevista para analizar"
            description="Primero realiza una práctica: elige un escenario, prepárate y responde al entrevistador."
            action={<Button to="/vocero/escenarios" iconRight="arrowRight">Elegir escenario</Button>}
          />
        </Card>
      </>
    );
  }

  const done = current >= steps.length;
  const answered = payload?.transcript?.length || 0;

  return (
    <>
      <PracticeSteps />

      <div className="flex justify-center">
        <Card className="w-full max-w-xl p-8 md:p-12 text-center">
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
            {error ? 'No pudimos analizar tu sesión' : done ? 'Tu informe está listo' : t.head}
          </h1>
          <p className="text-sm text-muted mt-2">
            {error
              ? error
              : done
                ? 'Abriendo tu informe…'
                : `${payload?.theme?.title || 'Entrevista'} · ${answered} respuesta${answered === 1 ? '' : 's'} · ${progress || 'la IA evaluadora suele tardar entre 10 y 40 segundos.'}`}
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

          {error && (
            <div className="mt-8 flex justify-center gap-2">
              <Button variant="secondary" to="/vocero/escenarios">
                Volver a escenarios
              </Button>
              <Button icon="refresh" onClick={() => setAttempt((a) => a + 1)}>
                Reintentar análisis
              </Button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
