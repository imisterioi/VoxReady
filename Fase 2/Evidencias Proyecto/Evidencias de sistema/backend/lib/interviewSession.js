// Estado centralizado de una entrevista + orquestación de modelos del entrevistador.
//
// Reglas:
//  - Todas las consultas se lanzan EN paralelo y ninguna se cancela porque otra responda antes;
//    las respuestas útiles quedan como reserva.
//  - El estado (reservadas / formuladas / respuestas / repreguntas / turno) vive aquí.
//  - Una reserva se consume UNA sola vez.
//  - Una respuesta tardía no avanza el turno: solo engrosa la reserva.
//  - Módulo puro: recibe `askModel` inyectado y se prueba sin red.
const START_WAIT_MS = 10000;
const DEFAULT_RESERVE = 3;
// Tamano maximo del registro de instrumentacion del pool (B1): se conservan las ultimas entradas.
const POOL_LOG_MAX = 60;
function createInterviewSession({
  sessionId,
  models = [],
  askModel,
  reserveTarget = DEFAULT_RESERVE,
  startWaitMs = START_WAIT_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = () => {},
  // Predicado OPCIONAL (inyectado): decide si una reserva quedó obsoleta porque su objetivo ya
  // fue respondido. Se mantiene inyectado para que este módulo siga siendo puro y probable sin
  // red ni dependencias del prompt. Firma: (item, { asked, resolutions }) => boolean.
  isObsolete = null,
} = {}) {
  if (!sessionId) throw new Error('sessionId requerido');
  if (typeof askModel !== 'function') throw new Error('askModel requerido');
  // El predicado de obsolescencia es opcional: si no es una función, simplemente no se aplica.
  const reserveIsObsolete = typeof isObsolete === 'function' ? isObsolete : null;

  const state = {
    sessionId,
    turn: 0,
    reserved: [],
    asked: [],
    answers: [],
    followups: [],
    activeModel: null,
    disabled: new Set(),
    pending: new Map(),
    disposed: false,
    sequence: 0,
    base: null,
    // Contadores separados: preguntas principales vs repreguntas de la principal actual.
    mainsAsked: 0,
    followUpsForMain: 0,
    usedByBudget: { habitual: 0, clarity: 0, extraordinary: 0, contingency: 0 },
    resolutions: [],
    closeReason: null,
    startedAt: null,
    timing: null,
    // Instrumentacion B1: registro ACOTADO de lo que ocurre con el pool de reservas. Solo
    // eventos, motivos y contadores: nunca textos de preguntas ni respuestas del vocero.
    poolLog: [],
    poolSeq: 0,
  };

  const liveModels = () => models.filter((model) => !state.disabled.has(model));
  // `view` expone tambien de donde salio la reserva (`forMain`, `historyLen`) SOLO cuando existen:
  // asi la forma de `asked`/`followups` (que no los llevan) no cambia.
  const view = (item) => ({
    question: item.question,
    kind: item.kind,
    turn: item.turn,
    ...(typeof item.forMain === 'number' ? { forMain: item.forMain } : {}),
    ...(typeof item.historyLen === 'number' ? { historyLen: item.historyLen } : {}),
  });

  // Instrumentacion B1: una entrada por decision sobre el pool. Es puro registro (no altera
  // ninguna seleccion) y nunca guarda el texto de la pregunta: solo el evento, su motivo y
  // contadores (tamano del pool y numero de respuestas existentes).
  function notePool(event, extra = {}) {
    if (state.poolLog.length >= POOL_LOG_MAX) state.poolLog.shift();
    state.poolSeq += 1;
    state.poolLog.push({
      n: state.poolSeq,
      event,
      turn: state.turn,
      pool: state.reserved.length,
      answers: state.answers.length,
      ...extra,
    });
  }

  const snapshot = () => ({
    sessionId: state.sessionId,
    turn: state.turn,
    activeModel: state.activeModel,
    reserved: state.reserved.map(view),
    asked: state.asked.map(view),
    answers: state.answers.map((item) => ({ text: item.text, turn: item.turn })),
    followups: state.followups.map(view),
    pending: state.pending.size,
    mainsAsked: state.mainsAsked,
    followUpsForMain: state.followUpsForMain,
    usedByBudget: { ...state.usedByBudget },
    resolutions: state.resolutions.map((item) => ({ ...item })),
    closeReason: state.closeReason,
    elapsedMs: state.startedAt ? now() - state.startedAt : 0,
    // Instrumentacion B1: copia acotada de las ultimas decisiones sobre el pool (sin textos).
    poolLog: state.poolLog.slice(-20).map((entry) => ({ ...entry })),
  });

  // Contexto común: distingue lo reservado (aún no formulado) de lo formulado y de las respuestas.
  // `base` es el contexto de producción (theme/history/cfg/plan) que envía la ruta y que
  // `buildSystemPrompt` necesita para leer la configuración del escenario. Se conserva como último
  // contexto recibido para las tandas en segundo plano.
  const contextFor = ({ kind, originAnswer = null, focus = null, mainQuestion = null, hasTranscript = null, base = state.base } = {}) => ({
    ...(base || {}),
    sessionId: state.sessionId,
    turn: state.turn,
    kind,
    originAnswer,
    // Contexto de la repregunta: pregunta principal en curso, foco y estado real de la respuesta.
    focus,
    mainQuestion,
    hasTranscript,
    asked: snapshot().asked,
    answers: snapshot().answers,
    followups: snapshot().followups,
    reservedNotAsked: snapshot().reserved,
    // Estado por turno del clasificador de respuestas (ya existente): permite al prompt
    // distinguir un tema preguntado de uno respondido, también tras un reinicio.
    resolutions: snapshot().resolutions,
  });

  const usable = (question) => typeof question === 'string' && question.trim().length > 0;

  function handleResult({ model, kind, result, startedAt, requestId, dispatchTurn }) {
    if (state.disposed) return;
    const question = typeof result === 'string' ? result : result?.question;
    if (!usable(question)) return;
    if (state.asked.some((item) => item.question === question)) {
      if (kind === 'normal') notePool('reserva_descartada', { reason: 'texto_ya_preguntado', model, requestId });
      return;
    }

    if (kind === 'normal') {
      if (state.reserved.length >= reserveTarget) {
        notePool('reserva_descartada', { reason: 'pool_completo', model, requestId });
        return;
      }
      if (state.reserved.some((item) => item.question === question)) {
        notePool('reserva_descartada', { reason: 'duplicada_en_pool', model, requestId });
        return;
      }
      state.reserved.push({ question, kind, model, requestId, forMain: state.mainsAsked + 1, historyLen: state.answers.length });
      notePool('reserva_aceptada', { model, requestId, forMain: state.mainsAsked + 1, historyLen: state.answers.length });
      logger({ event: 'reserved', requestId, model, ms: now() - startedAt, turn: state.turn });
      return;
    }
    // A1/A3: la candidata pertenece al turno LOGICO del despacho (`dispatchTurn`), no al turno
    // que estuviera activo al llegar. Si ese turno ya se resolvio (la repregunta se entrego y
    // `state.turn` avanzo), el resultado llega tarde: se DESCARTA en vez de quedarse en la cola
    // para un turno distinto. (`result.turn` no sirve para esto: `askModel` no lo devuelve.)
    if (dispatchTurn !== state.turn) {
      logger({ event: 'followup-dropped', requestId, model, dispatchTurn: dispatchTurn ?? null, turn: state.turn });
      return;
    }
    state.followups.push({ question, model, turn: state.turn, dispatchTurn, requestId });
    logger({ event: 'followup-ready', requestId, model, turn: state.turn, dispatchTurn });
  }

  function handleError({ model, error, requestId }) {
    if (state.disposed) return;
    // Error definitivo → se desactiva solo ese modelo; el resto sigue trabajando.
    const definitive = ['HTTP 401', 'HTTP 403', 'HTTP 404', 'HTTP 410'].some((token) =>
      String(error?.message || '').includes(token),
    );
    if (definitive) {
      state.disabled.add(model);
      logger({ event: 'model-disabled', model, reason: error?.message });
    } else if (error?.code === 'CONTEXT_BUILD_FAILED') {
      // Defecto de preparación del contexto (no del proveedor): se registra UNA vez y no se
      // atribuye a los modelos ni los desactiva.
      if (!state.contextErrorLogged) {
        state.contextErrorLogged = true;
        logger({ event: 'context-build-error', requestId, code: error.code, reason: error?.message });
      }
    } else {
      logger({ event: 'model-transient-error', requestId, model, code: error?.code || null, reason: error?.message });
    }
  }

  function dispatch({ kind, context }) {
    const requestId = `${state.sessionId}:${++state.sequence}`;
    const startedAt = now();
    // A1: turno LOGICO del despacho (viaja en el contexto). Se captura aqui, en el momento de
    // lanzar la generacion, y no en el de la llegada: una respuesta tardia sigue perteneciendo a
    // este turno aunque cuando llegue `state.turn` ya haya avanzado.
    const dispatchTurn = Number.isFinite(context?.turn) ? context.turn : state.turn;
    for (const model of liveModels()) {
      state.pending.set(`${requestId}#${model}`, { model, kind });
      Promise.resolve()
        .then(() => askModel(model, context))
        .then((result) => handleResult({ model, kind, result, startedAt, requestId, dispatchTurn }))
        .catch((error) => handleError({ model, error, requestId }))
        .finally(() => state.pending.delete(`${requestId}#${model}`));
    }
    logger({ event: 'dispatch', requestId, kind, models: liveModels().length, turn: state.turn, dispatchTurn });
    return requestId;
  }

  // Reservas: son CANDIDATAS a pregunta principal. Se descartan las ya formuladas, las repetidas
  // (texto normalizado), las generadas para una principal que ya quedo atras (obsoletas) y —si el
  // llamador inyecta `isObsolete`— las que piden algo que YA quedo respondido de forma suficiente.
  function takeReserved() {
    const seen = new Set();
    const stateForCheck = reserveIsObsolete
      ? { asked: state.asked.map(view), resolutions: state.resolutions.map((item) => ({ ...item })) }
      : null;
    while (state.reserved.length) {
      const item = state.reserved.shift();
      const text = String(item.question || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (state.asked.some((asked) => asked.question === item.question)) {
        notePool('reserva_descartada', { reason: 'texto_ya_preguntado', model: item.model || null });
        continue;
      }
      if (seen.has(text)) {
        notePool('reserva_descartada', { reason: 'duplicada_en_lote', model: item.model || null });
        continue;
      }
      if (typeof item.forMain === 'number' && item.forMain < state.mainsAsked) {
        notePool('reserva_descartada', { reason: 'principal_ya_entregada', model: item.model || null, forMain: item.forMain });
        continue; // obsoleta
      }
      // Obsoleta por respuesta: la reserva pide un tema ya respondido (solo con estado suficiente).
      if (reserveIsObsolete && reserveIsObsolete(item, stateForCheck)) {
        notePool('reserva_descartada', { reason: 'obsoleta_por_respuesta', model: item.model || null });
        continue;
      }
      seen.add(text);
      notePool('reserva_entregada', {
        model: item.model || null,
        requestId: item.requestId || null,
        forMain: typeof item.forMain === 'number' ? item.forMain : null,
        historyLen: typeof item.historyLen === 'number' ? item.historyLen : null,
      });
      return item;
    }
    return null;
  }

  // A1/A3: consumo de repreguntas. Solo se entrega una candidata del turno pedido (`turn`);
  // cualquier candidata de otro turno se descarta en el acto (no vuelve a la cola, no se reutiliza
  // en un turno posterior ni se acumula). Se conserva el orden de llegada: gana la PRIMERA
  // candidata valida de ESE turno, de modo que un resultado tardio del mismo turno todavia sirve.
  function takeFollowUp(turn) {
    while (state.followups.length) {
      const item = state.followups.shift();
      if (item.dispatchTurn === turn) return item;
      logger({ event: 'followup-dropped', model: item.model || null, dispatchTurn: item.dispatchTurn ?? null, turn });
    }
    return null;
  }

  function accept(item) {
    state.turn += 1;
    state.asked.push({ question: item.question, kind: item.kind, model: item.model, turn: state.turn, budget: item.budget || null });
    if (!state.activeModel) state.activeModel = item.model;
    if (!state.startedAt) state.startedAt = now();
    if (item.kind === 'followup') {
      state.followUpsForMain += 1;
      const bucket = state.usedByBudget[item.budget] != null ? item.budget : 'habitual';
      state.usedByBudget[bucket] += 1;
    } else {
      // Nueva pregunta principal: se reinician los presupuestos de repregunta de la anterior.
      state.mainsAsked += 1;
      state.followUpsForMain = 0;
      state.usedByBudget = { habitual: 0, clarity: 0, extraordinary: 0, contingency: 0 };
    }
    return {
      ok: true,
      question: item.question,
      kind: item.kind,
      model: item.model,
      turn: state.turn,
      budget: item.budget || null,
      mainNumber: state.mainsAsked,
      // Instrumentacion B1/B3: de donde salio la pregunta entregada y con cuanta antiguedad.
      origin: item.origin || null,
      historyLenAtReserve: typeof item.historyLen === 'number' ? item.historyLen : null,
      answersAtDelivery: state.answers.length,
    };
  }


  const prewarmState = { running: false, rounds: 0 };

  async function waitFor(pick, deadlineMs) {
    const deadline = now() + deadlineMs;
    while (now() < deadline && !state.disposed) {
      await sleep(25);
      const item = pick();
      if (item) return item;
    }
    // Comprobacion FINAL determinista: si el plazo vencio justo cuando llegaba una candidata (o
    // el plazo era 0), se consume igualmente en lugar de devolver un falso "no llego nada".
    return state.disposed ? null : pick() || null;
  }

  // Reconstruye el estado desde el historial disponible (p. ej. tras reiniciar el backend o
  // perder el registro en memoria). `kindFor(i)` decide normal/repregunta con la regla real
  // del proyecto (interviewConfig/turnPlan), que el llamador inyecta.
  // NO recupera reservas previas (viven en memoria y no persisten): solo lo ya formulado.
  function seed({ history = [], kindFor = () => 'normal' } = {}) {
    let interviewerCount = 0;
    let seededAnswers = 0;
    let voceroCount = 0;
    for (const turn of Array.isArray(history) ? history : []) {
      const text = String(turn?.text ?? '').trim();
      if (!text) continue;
      if (turn.role === 'interviewer') {
        if (!state.asked.some((item) => item.question === text)) {
          const kind = kindFor(interviewerCount);
          state.turn += 1;
          state.asked.push({ question: text, kind, model: null, turn: state.turn });
          // Las preguntas principales reconstruidas tambien cuentan: sin esto el cierre por
          // `mainsAsked` permitiria superar la cantidad configurada tras un reinicio.
          if (kind === 'main') state.mainsAsked += 1;
        }
        interviewerCount += 1;
      } else {
        voceroCount += 1; // entradas vistas del historial (para no volver a registrarlas)
        if (!state.answers.some((item) => item.text === text && item.turn === state.turn)) {
          state.answers.push({ text, turn: state.turn });
          seededAnswers += 1;
        }
      }
    }
    return { interviewerCount, voceroCount, seededAnswers, turn: state.turn };
  }

  const api = {
    snapshot,
    contextFor,
    seed,

    // Preparación anticipada: tandas ACOTADAS de consultas en paralelo. No cancela nada al
    // obtener la primera válida y no repite tandas si el frontend vuelve a preguntar.
    async prewarm({ context = {}, rounds = reserveTarget, waitPerRoundMs = 2000 } = {}) {
      if (prewarmState.running) {
        notePool('prewarm_repetido', { reserved: state.reserved.length });
        return { ok: true, already: true, reserved: state.reserved.length, pending: state.pending.size };
      }
      prewarmState.running = true;
      try {
        for (let round = 0; round < rounds && state.reserved.length < reserveTarget; round += 1) {
          dispatch({ kind: 'normal', context: { ...context, phase: 'prewarm' } });
          prewarmState.rounds += 1;
          notePool('prewarm_ronda', { round: round + 1, historyLen: state.answers.length });
          const deadline = now() + waitPerRoundMs;
          while (now() < deadline && state.reserved.length < reserveTarget && !state.disposed) {
            await sleep(25);
          }
          if (state.reserved.length >= reserveTarget) break;
        }
      } finally {
        prewarmState.running = false;
      }
      notePool('prewarm_fin', { reserved: state.reserved.length, rounds: prewarmState.rounds, historyLen: state.answers.length });
      return { ok: true, reserved: state.reserved.length, pending: state.pending.size, rounds: prewarmState.rounds };
    },

    // Inicio: reserva disponible → inmediata. Si no, espera como máximo `timeoutMs` sin cancelar
    // las solicitudes que siguen en segundo plano.
    async start({ context = {}, timeoutMs = startWaitMs } = {}) {
      const reserved = takeReserved();
      if (reserved) return accept({ ...reserved, origin: 'reserva_previa' });
      const requestId = dispatch({ kind: 'normal', context: { ...context, phase: 'start' } });
      const item = await waitFor(() => takeReserved(), timeoutMs);
      if (item) return accept({ ...item, origin: item.requestId === requestId ? 'generada_en_la_solicitud' : 'reserva_previa' });
      notePool('sin_pregunta_en_tiempo', { phase: 'start', pending: state.pending.size });
      return { ok: false, code: 'NO_QUESTION_IN_TIME', pending: state.pending.size };
    },

    // Siguiente pregunta. `needsFollowUp` viene de la regla actual (interviewConfig).
    async next({ context = {}, needsFollowUp = false, originAnswer = null, focus = null, mainQuestion = null, hasTranscript = null, budget = null, timeoutMs = startWaitMs } = {}) {
      // Conserva el contexto de producción (theme/history/cfg/plan) para las tandas en segundo
      // plano: `contextFor` lo reutiliza y así toda consulta usa la configuración real.
      if (context && context.cfg) state.base = context;
      if (needsFollowUp) {
        // Turno logico que se esta pidiendo: se captura ANTES del despacho (es el mismo que viaja
        // en el contexto) y no cambia hasta que `accept` entregue la repregunta. Mientras siga
        // siendolo, una candidata tardia de un intento anterior del MISMO turno sigue valiendo.
        const pendingTurn = state.turn;
        dispatch({ kind: 'followup', context: contextFor({ kind: 'followup', originAnswer, focus, mainQuestion, hasTranscript }) });
        const item = await waitFor(() => takeFollowUp(pendingTurn), timeoutMs);
        if (item) return accept({ ...item, kind: 'followup', budget, origin: 'repregunta' });
        notePool('sin_repregunta_en_tiempo', { pending: state.pending.size });
        return { ok: false, code: 'NO_FOLLOWUP_IN_TIME', pending: state.pending.size };
      }

      const reserved = takeReserved();
      if (reserved) return accept({ ...reserved, origin: 'reserva_previa' });
      const requestId = dispatch({ kind: 'normal', context: contextFor({ kind: 'normal' }) });
      const item = await waitFor(() => takeReserved(), timeoutMs);
      if (item) return accept({ ...item, origin: item.requestId === requestId ? 'generada_en_la_solicitud' : 'reserva_previa' });
      notePool('sin_pregunta_en_tiempo', { phase: 'next', pending: state.pending.size });
      return { ok: false, code: 'NO_QUESTION_IN_TIME', pending: state.pending.size };
    },

    // Respuesta real del vocero: es lo que verán los respaldos en su siguiente solicitud.
    recordAnswer(text) {
      const value = String(text ?? '').trim();
      if (!value) return false;
      state.answers.push({ text: value, turn: state.turn });
      return true;
    },

    // Resultado de la evaluación de la respuesta actual (resuelto / pendiente).
    recordResolution({ status = 'unknown', reason = '' } = {}) {
      state.resolutions.push({ turn: state.turn, mainNumber: state.mainsAsked, status, reason });
      return state.resolutions.length;
    },

    setCloseReason(reason) {
      state.closeReason = reason ? String(reason) : null;
      return state.closeReason;
    },

    setActiveModel(model) {
      if (!model || state.disabled.has(model)) return false;
      state.activeModel = model;
      logger({ event: 'active-model', model, turn: state.turn });
      return true;
    },

    // Fin de sesión: nada pendiente puede volver a tocar el estado ni avanzar turnos.
    dispose() {
      state.disposed = true;
      state.pending.clear();
      state.reserved = [];
      // A3: las candidatas de repregunta tampoco sobreviven al cierre (no se acumulan).
      state.followups = [];
      return true;
    },

    isDisposed: () => state.disposed,
    pendingCount: () => state.pending.size,
    disabledModels: () => [...state.disabled],
  };

  // Serializa `start`/`next` POR SESIÓN: dos solicitudes concurrentes del mismo turno no
  // pueden consumir dos preguntas (el turno avanza una sola vez por pregunta aceptada).
  let lock = Promise.resolve();
  const serialize = (task) => {
    const run = lock.then(task, task);
    lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    ...api,
    start: (options) => serialize(() => api.start(options)),
    next: (options) => serialize(() => api.next(options)),
  };
}

module.exports = { createInterviewSession, START_WAIT_MS, DEFAULT_RESERVE };