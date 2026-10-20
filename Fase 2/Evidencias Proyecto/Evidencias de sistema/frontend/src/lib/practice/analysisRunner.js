// Bucle de consulta del análisis, aislado del componente para poder probarlo.
//
// Reglas:
//  - Cada ejecución tiene su PROPIO AbortSignal: el cleanup de StrictMode (o un unmount)
//    cancela solo esa ejecución y no bloquea la siguiente.
//  - El POST /evaluate solo se hace si hay payload (práctica recién terminada) y lo decide
//    quien llama: así una entrada con ?sesion= nunca vuelve a evaluar.
//  - El informe solo se considera listo cuando el backend devuelve `session.report`.
//  - Un fallo o error de consulta NUNCA se traduce en "completado".

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cancelledError = () => Object.assign(new Error('cancelled'), { code: 'CANCELLED' });

export async function runAnalysis({
  sessionId,
  payload = null,
  postEvaluate,
  fetchSession,
  signal,
  intervalMs = 2000,
  timeoutMs = 8 * 60 * 1000,
  sleep = defaultSleep,
  onStage = () => {},
  now = () => Date.now(),
} = {}) {
  if (!sessionId) return { status: 'failed', reason: 'NO_SESSION' };

  const ensureActive = () => {
    if (signal?.aborted) throw cancelledError();
  };

  try {
    if (payload) {
      ensureActive();
      const started = await postEvaluate(sessionId, payload);
      ensureActive();
      if (started?.session?.report) return { status: 'done', sessionId };
    }

    const deadline = now() + timeoutMs;
    let lastStage;

    while (now() < deadline) {
      ensureActive();
      await sleep(intervalMs);
      ensureActive();

      const poll = await fetchSession(sessionId);
      // Una ejecución cancelada no puede seguir ni tocar estado.
      ensureActive();

      if (poll?.session?.report) return { status: 'done', sessionId };

      const evaluation = poll?.evaluation || {};
      if (evaluation.state === 'failed' || evaluation.state === 'stalled') {
        return { status: 'failed', reason: evaluation.reason || 'ERROR' };
      }
      if (evaluation.stage !== lastStage) {
        lastStage = evaluation.stage;
        onStage(evaluation.stage);
      }
    }

    return { status: 'failed', reason: 'TIMEOUT' };
  } catch (error) {
    if (error?.code === 'CANCELLED' || signal?.aborted) return { status: 'cancelled' };
    return { status: 'failed', reason: 'NETWORK' };
  }
}
