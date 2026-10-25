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
  retryIntervalMs = 15000,
  timeoutMs = 30 * 60 * 1000,
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
    let lastStage = null;
    let waitMs = intervalMs;

    while (now() < deadline) {
      ensureActive();
      await sleep(waitMs);
      ensureActive();

      const poll = await fetchSession(sessionId);
      // Una ejecución cancelada no puede seguir ni tocar estado.
      ensureActive();

      if (poll?.session?.report) return { status: 'done', sessionId };

      const evaluation = poll?.evaluation || {};
      // Reintentos automáticos del backend: la sesión sigue en cola (3 min, o pausas de 15 min).
      // El cliente NO lo trata como fallo: espacia el sondeo y sigue esperando sin mostrar errores
      // técnicos. `exhausted` tampoco es un error visible: el informe puede llegar más adelante.
      if (evaluation.state === 'retrying' || evaluation.state === 'exhausted') {
        waitMs = retryIntervalMs;
        const stage = evaluation.state === 'exhausted' ? 'exhausted' : 'pending';
        if (stage !== lastStage) {
          lastStage = stage;
          onStage(stage);
        }
        continue;
      }
      if (evaluation.state === 'failed' || evaluation.state === 'stalled') {
        // `errorKind` (clasificación del backend) decide el mensaje; nunca se muestran códigos.
        return {
          status: 'failed',
          reason: evaluation.reason || 'ERROR',
          errorKind: evaluation.errorKind ?? null,
        };
      }
      waitMs = intervalMs;
      if (evaluation.stage !== lastStage) {
        lastStage = evaluation.stage;
        onStage(evaluation.stage);
      }
    }

    // El sondeo del cliente se agota, pero la generación NO se cancela: sigue en el backend y el
    // informe aparecerá en «Mi progreso». Por eso NO es un fallo: se informa de que sigue en curso.
    return { status: 'pending', reason: 'STILL_RUNNING' };
  } catch (error) {
    if (error?.code === 'CANCELLED' || signal?.aborted) return { status: 'cancelled' };
    // Se conserva el motivo REAL (código de la API y estado HTTP) para poder registrar y elegir
    // el mensaje adecuado. La interfaz NO muestra detalles técnicos: `Analizando` los traduce a
    // textos genéricos (nunca nombres de modelos, proveedores, códigos HTTP ni mensajes de API).
    return {
      status: 'failed',
      reason: error?.code || 'NETWORK',
      httpStatus: Number.isFinite(error?.status) ? error.status : null,
    };
  }
}
