// Estado centralizado de una entrevista + orquestación de modelos del entrevistador.
//
// Reglas:
//  - Todas las consultas se lanzan EN PARALELO y NINGUNA se cancela porque otra responda antes;
//    las respuestas útiles quedan como reserva.
//  - El estado (reservadas / formuladas / respuestas / repreguntas / turno) vive aquí.
//  - Una reserva se consume UNA sola vez.
//  - Una respuesta tardía no avanza el turno: solo engrosa la reserva.
//  - Módulo puro: recibe `askModel` inyectado y se prueba sin red.
const START_WAIT_MS = 10000;
const DEFAULT_RESERVE = 3;
function createInterviewSession({
  sessionId,
  models = [],
  askModel,
  reserveTarget = DEFAULT_RESERVE,
  startWaitMs = START_WAIT_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = () => {},
} = {}) {
  if (!sessionId) throw new Error('sessionId requerido');
  if (typeof askModel !== 'function') throw new Error('askModel requerido');

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
  };

  const liveModels = () => models.filter((model) => !state.disabled.has(model));
  const view = (item) => ({ question: item.question, kind: item.kind, turn: item.turn });

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
  });

  // Contexto común: distingue lo reservado (aún NO formulado) de lo formulado y de las respuestas.
  // `base` es el contexto de producción (theme/history/cfg/plan) que envía la ruta: sin él,
  // `buildSystemPrompt` no puede leer la configuración del escenario (fallaba con
  // "reading 'aggressiveness'"). Se conserva como último contexto recibido para las tandas en
  // segundo plano, de modo que todas las consultas usen la MISMA configuración del escenario.
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
  });

  const usable = (question) => typeof question === 'string' && question.trim().length > 0;

  function handleResult({ model, kind, result, startedAt, requestId }) {
    if (state.disposed) return;
    const question = typeof result === 'string' ? result : result?.question;
    if (!usable(question)) return;
    if (state.asked.some((item) => item.question === question)) return;

    if (kind === 'normal') {
      if (state.reserved.length >= reserveTarget) return;
      if (state.reserved.some((item) => item.question === question)) return;
      state.reserved.push({ question, kind, model, requestId, forMain: state.mainsAsked + 1, historyLen: state.answers.length });
      logger({ event: 'reserved', requestId, model, ms: now() - startedAt, turn: state.turn });
      return;
    }
    if (result?.turn != null && result.turn !== state.turn) return; // repregunta de otro turno
    state.followups.push({ question, model, turn: state.turn });
    logger({ event: 'followup-ready', requestId, model, turn: state.turn });
  }

  function handleError({ model, error, requestId }) {
    if (state.disposed) return;
    // Error definitivo → se desactiva SOLO ese modelo; el resto sigue trabajando.
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
    for (const model of liveModels()) {
      state.pending.set(`${requestId}#${model}`, { model, kind });
      Promise.resolve()
        .then(() => askModel(model, context))
        .then((result) => handleResult({ model, kind, result, startedAt, requestId }))
        .catch((error) => handleError({ model, error, requestId }))
        .finally(() => state.pending.delete(`${requestId}#${model}`));
    }
    logger({ event: 'dispatch', requestId, kind, models: liveModels().length, turn: state.turn });
    return requestId;
  }

  // Reservas: son CANDIDATAS a pregunta principal. Se descartan las ya formuladas, las repetidas
  // (texto normalizado) y las generadas para una principal que ya quedo atras (obsoletas).
  function takeReserved() {
    const seen = new Set();
    while (state.reserved.length) {
      const item = state.reserved.shift();
      const text = String(item.question || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (state.asked.some((asked) => asked.question === item.question)) continue;
      if (seen.has(text)) continue;
      if (typeof item.forMain === 'number' && item.forMain < state.mainsAsked) continue; // obsoleta
      seen.add(text);
      return item;
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
    return null;
  }

  // Reconstruye el estado desde el historial disponible (p. ej. tras reiniciar el backend o
  // perder el registro en memoria). `kindFor(i)` decide normal/repregunta con la regla REAL
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
        return { ok: true, already: true, reserved: state.reserved.length, pending: state.pending.size };
      }
      prewarmState.running = true;
      try {
        for (let round = 0; round < rounds && state.reserved.length < reserveTarget; round += 1) {
          dispatch({ kind: 'normal', context: { ...context, phase: 'prewarm' } });
          prewarmState.rounds += 1;
          const deadline = now() + waitPerRoundMs;
          while (now() < deadline && state.reserved.length < reserveTarget && !state.disposed) {
            await sleep(25);
          }
          if (state.reserved.length >= reserveTarget) break;
        }
      } finally {
        prewarmState.running = false;
      }
      return { ok: true, reserved: state.reserved.length, pending: state.pending.size, rounds: prewarmState.rounds };
    },

    // Inicio: reserva disponible → inmediata. Si no, espera como máximo `timeoutMs` sin cancelar
    // las solicitudes que siguen en segundo plano.
    async start({ context = {}, timeoutMs = startWaitMs } = {}) {
      const reserved = takeReserved();
      if (reserved) return accept(reserved);
      dispatch({ kind: 'normal', context: { ...context, phase: 'start' } });
      const item = await waitFor(() => takeReserved(), timeoutMs);
      if (item) return accept(item);
      return { ok: false, code: 'NO_QUESTION_IN_TIME', pending: state.pending.size };
    },

    // Siguiente pregunta. `needsFollowUp` viene de la regla actual (interviewConfig).
    async next({ context = {}, needsFollowUp = false, originAnswer = null, focus = null, mainQuestion = null, hasTranscript = null, budget = null, timeoutMs = startWaitMs } = {}) {
      // Conserva el contexto de producción (theme/history/cfg/plan) para las tandas en segundo
      // plano: `contextFor` lo reutiliza y así toda consulta usa la configuración real.
      if (context && context.cfg) state.base = context;
      if (needsFollowUp) {
        dispatch({ kind: 'followup', context: contextFor({ kind: 'followup', originAnswer, focus, mainQuestion, hasTranscript }) });
        const item = await waitFor(() => state.followups.shift(), timeoutMs);
        if (item) return accept({ ...item, kind: 'followup', budget });
        return { ok: false, code: 'NO_FOLLOWUP_IN_TIME', pending: state.pending.size };
      }

      const reserved = takeReserved();
      if (reserved) return accept(reserved);
      dispatch({ kind: 'normal', context: contextFor({ kind: 'normal' }) });
      const item = await waitFor(() => takeReserved(), timeoutMs);
      if (item) return accept(item);
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