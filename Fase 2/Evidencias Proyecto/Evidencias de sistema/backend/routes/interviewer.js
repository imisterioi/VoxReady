// Entrevistador IA: siguiente pregunta de la entrevista.
//
//   POST /api/interviewer/next-question   { sessionId?: string, history?: [{role,text}] }
//     - Con sessionId: la sesión debe ser del usuario autenticado y estar en curso; el
//       escenario se toma de la sesión, nunca del cliente.
//     - Sin sessionId: entrevista genérica del Laboratorio.
//
// La orquestación (reservas, contexto compartido y modelo activo) la lleva
// `lib/interviewSession.js` a través de `lib/interviewRegistry.js`. Las dependencias son
// inyectables para poder probar la ruta sin PostgreSQL ni llamadas reales a NVIDIA.
const { requireAuth } = require('../auth');
const {
  LIMITS,
  normalizeInterviewConfig,
  resolveInterviewConfig,
  turnPlan,
  followUpBudget,
  invalidInterviewConfigPayload,
  INTERVIEW_TIMING,
} = require('../ai/interviewConfig');
const {
  generateQuestion,
  // Transporte de BAJO NIVEL (recibe el ARRAY de mensajes): lo usa SOLO el clasificador.
  // OJO: se importa con ALIAS porque mas abajo `askModel` es la dependencia de sesion
  // (destructurada de `deps`, por defecto `askModelFromContext`) y taparia este import.
  askModel: askModelLowLevel,
  // Adaptador de CONTEXTO (construye el prompt del entrevistador): despacho normal de preguntas.
  askModelFromContext,
  interviewModels,
  interviewTimeoutMs,
  isReservedQuestionStale,
  // Temas del `TOPIC_LADDER` de una pregunta: lo usa la instrumentacion B1 (solo claves de tema,
  // nunca el texto de la pregunta).
  detectTopics,
} = require('../ai/interviewer');
const { assessAnswer } = require('../ai/answerAssessment');
// Auditoria tecnica OPCIONAL de la entrevista (archivo JSONL; apagada por defecto: INTERVIEW_AUDIT=1).
const audit = require('../lib/interviewAudit');
const { preflight: preflightEvaluators, shouldProbe } = require('../lib/evaluatorHealth');
const { createInterviewSession, START_WAIT_MS } = require('../lib/interviewSession');
const { resolveLanguage, sessionLanguage } = require('../lib/language');
const defaultRegistry = require('../lib/interviewRegistry');

// La conversación la envía el navegador: se acota antes de pasarla a la IA. En los turnos del
// vocero se conservan la marca de voz (`spoke`) y la procedencia de la transcripción: distinguen
// un silencio real de una transcripción que no se pudo obtener.
const TRANSCRIPT_SOURCES = ['live', 'unavailable', 'typed'];

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((turn) => turn && typeof turn === 'object')
    .slice(-2 * LIMITS.totalTurns)
    .map((turn) => {
      const clean = {
        role: turn.role === 'interviewer' ? 'interviewer' : 'vocero',
        text: String(turn.text ?? '').slice(0, 2000),
      };
      if (clean.role !== 'vocero') return clean;
      if (turn.spoke === true) clean.spoke = true;
      const source = String(turn.transcriptSource ?? '').trim().toLowerCase();
      if (TRANSCRIPT_SOURCES.includes(source)) clean.transcriptSource = source;
      return clean;
    });
}

// Decide si corresponde REPREGUNTAR (y con qué presupuesto) o AVANZAR a la siguiente principal.
// Reglas: una respuesta suficiente avanza siempre; no se insiste sin fundamento; el fallo de
// evaluación usa la aclaración de contingencia y, si no queda presupuesto, cierra la línea.
function decideTurn({ assessment, budget, used = {}, timeLeftMs = null } = {}) {
  const status = assessment?.status || 'unevaluable';
  const spent = { habitual: 0, clarity: 0, extraordinary: 0, contingency: 0, ...used };
  if (status === 'sufficient') return { action: 'advance', reason: 'respuesta_suficiente' };
  if (timeLeftMs != null && timeLeftMs <= 0) return { action: 'advance', reason: 'sin_tiempo', close: 'TIME_LIMIT' };
  // Fallo de evaluacion: presupuesto de CONTINGENCIA, separado del habitual (nunca = suficiencia).
  if (status === 'unevaluable') {
    if (spent.contingency < budget.contingency) return { action: 'followup', budget: 'contingency', reason: 'evaluacion_no_disponible' };
    return { action: 'advance', reason: 'sin_evaluacion_ni_contingencia', unresolved: true };
  }
  // Se detectó voz pero NO hay transcripción utilizable: caso distinto del silencio. Se permite UNA
  // intervención neutral (presupuesto de aclaración, 1 por pregunta principal) para que el vocero
  // concrete lo dicho; si ya se usó, se avanza sin inventar el contenido.
  if (status === 'no_transcript') {
    if (budget.clarity > 0 && spent.clarity < budget.clarity) {
      return { action: 'followup', budget: 'clarity', reason: status };
    }
    return { action: 'advance', reason: 'transcripcion_no_disponible', unresolved: true };
  }
  if (spent.habitual < budget.habitual) return { action: 'followup', budget: 'habitual', reason: status };
  const justified = status === 'contradiction' ? true : assessment?.justifyExtraordinary === true;
  if (spent.extraordinary < budget.extraordinary && justified) {
    return { action: 'followup', budget: 'extraordinary', reason: status };
  }
  if (budget.clarity > 0 && spent.clarity < budget.clarity) return { action: 'followup', budget: 'clarity', reason: status };
  return { action: 'advance', reason: `presupuesto_agotado:${status}`, unresolved: true };
}

module.exports = function registerInterviewerRoutes(app, prisma, deps = {}) {
  const {
    askModel = askModelFromContext,
    models = interviewModels,
    timeoutFor = interviewTimeoutMs,
    createSession = createInterviewSession,
    registry = defaultRegistry,
    generate = generateQuestion,
    questionAllowed = () => true,
    startWaitMs = () => START_WAIT_MS,
    // Reloj e inactividad de la sesion: inyectables para poder probar el cierre por tiempo con un
    // reloj simulado, sin esperas reales. Sin inyectar, se usan los valores de produccion.
    now,
    sleep,
    // Evaluación de suficiencia: cadena de modelos del entrevistador en modo `raw` (JSON) y
    // timeout propio, independiente del de generación de preguntas.
    assess = assessAnswer,
    // Transporte del CLASIFICADOR: `assessAnswer` entrega un ARRAY de mensajes ya construidos, asi
    // que su transporte es `askModel` (mensajes), NO `askModelFromContext` (objeto de contexto).
    // Es una dependencia PROPIA para poder inyectar un doble en las pruebas sin tocar el despacho
    // normal de preguntas, que sigue usando `askModelFromContext`.
    assessAskModel = askModelLowLevel,
    assessTimeoutMs = () => Number(process.env.AI_ASSESS_TIMEOUT_MS) || 15000,
  } = deps;


  // Registro técnico por sesión (sin claves, sin texto de preguntas ni respuestas del vocero).
  const trace = (key, event) => {
    try {
      console.log('[IA]', String(key).slice(0, 8), JSON.stringify(event));
    } catch {
      /* el registro nunca debe romper la entrevista */
    }
  };

  // Una sola instancia por sesión: reservas, contexto y modelo activo compartidos. Se siembra
  // desde el historial (las reservas previas NO se recuperan: viven en memoria).
  const sessionFor = (key, theme, history) =>
    registry.getOrCreate(key, () => {
      const session = createSession({
        sessionId: key,
        models: models(),
        timeoutMs: timeoutFor(),
        // Auditoria (opcional): cada solicitud REAL al proveedor se anota con el contexto del
        // despacho (sesion, turno, tipo y nivel). Apagada, la llamada es exactamente la de antes.
        askModel: (model, context) => {
          const auditedFetch = audit.isEnabled()
            ? audit.fetchRecorder({
                kind: 'generation',
                sessionId: key,
                // El despacho de arranque no trae `turn` (el contexto inicial no lo lleva): el
                // primer turno es, por definicion, el 0.
                turn: Number.isFinite(context?.turn) ? context.turn : context?.phase === 'start' ? 0 : null,
                level: context?.cfg?.aggressiveness || null,
                model,
                dispatchKind: context?.kind || null,
                phase: context?.phase || null,
              })
            : null;
          return askModel(model, context, { timeoutMs: timeoutFor(), ...(auditedFetch ? { fetchImpl: auditedFetch } : {}) });
        },
        logger: (event) => trace(key, event),
        // Una reserva generada antes de la última respuesta puede haber quedado obsoleta: si su
        // tema ya quedó respondido de forma suficiente (y repite el enunciado), se descarta y se
        // genera otra con la memoria actualizada. Solo se mira el estado `sufficient`.
        isObsolete: (item, sessionState) => isReservedQuestionStale(item, sessionState),
        ...(now ? { now } : {}),
        ...(sleep ? { sleep } : {}),
      });
      const cfg = normalizeInterviewConfig(theme.interviewConfig);
      const seeded = session.seed({ history, kindFor: (index) => turnPlan(cfg, index).kind });
      return { session, lastUsedAt: Date.now(), answeredTurns: seeded.voceroCount };
    });

  app.post('/api/interviewer/next-question', requireAuth(prisma), async (req, res) => {
    try {
      const { sessionId } = req.body || {};
      const history = cleanHistory(req.body?.history);

      let theme = null;
      let plan = null;
      // Sesión de la práctica: se conserva para resolver el idioma con el que fue iniciada.
      let session = null;
      if (sessionId) {
        session = await prisma.session.findUnique({
          where: { id: String(sessionId) },
          include: { theme: true },
        });
        if (!session || session.userId !== req.user.id) {
          return res.status(404).json({ status: 'error', mensaje: 'Sesión no encontrada.' });
        }
        if (session.score != null) {
          return res.status(409).json({ status: 'error', mensaje: 'Esta entrevista ya fue evaluada.' });
        }
        theme = session.theme;

        // `plan` se usa para el `kind` del turno y para el prompt. NO se usa para cerrar la
        // entrevista: `turnPlan` cuenta las intervenciones del entrevistador contra un total
        // nominal (`questionCount x (1 + followUps)`), pero las repreguntas ADAPTATIVAS tambien
        // consumen intervenciones sin formar parte de ese total. Cerrar con `plan.done` terminaba
        // la entrevista con preguntas principales pendientes (defecto corregido: ver el cierre
        // autoritativo por `mainsAsked` mas abajo).
        plan = turnPlan(
          normalizeInterviewConfig(theme.interviewConfig),
          history.filter((turn) => turn.role === 'interviewer').length,
        );
      }

      if (!questionAllowed(req.user.id)) {
        return res.status(429).json({ status: 'error', mensaje: 'Demasiadas preguntas en poco tiempo. Espera unos minutos.' });
      }

      // Orquestación centralizada: una sesión de entrevista por práctica, reutilizada entre
      // solicitudes (reservas, contexto y modelo activo compartidos). Sin cancelación por victoria.
      const timeoutMs = timeoutFor();
      const voceroTurns = history.filter((turn) => turn.role === 'vocero');
      const startedAt = Date.now();
      // Idioma de la práctica: el que se congeló al crear la sesión; si la sesión es histórica (o no
      // hay sesión), el del vocero o el de su organización.
      const lang = sessionLanguage(session, req.user, req.user.tenant);
      let result;
      let meta = null;
      // Snapshot de la sesión conservado desde la rama donde `entry` existe: la rama de error
      // recuperable (`!result.ok`) está FUERA de ese ámbito, así que no puede referenciar `entry`
      // (hacerlo lanzaba `ReferenceError: entry is not defined` y perdía la traza `no-question`).
      let sessionSnapshot = null;

      if (sessionId) {
        const key = String(sessionId);
        const entry = sessionFor(key, theme, history);
        registry.touch(key);
        // Red de seguridad: si el precalentamiento no lanzó la comprobación anticipada (por
        // ejemplo, al reanudar una sesión), se lanza aquí una sola vez. `shouldProbe()` evita
        // repetirla en cada pregunta: solo dispara si no hay tanda en vuelo ni resultado reciente.
        if (shouldProbe()) preflightEvaluators({ reason: 'turn' });

        // `recordAnswer()` solo guarda la respuesta real (no cambia el turno) y se registra
        // una única vez por respuesta: el contador evita duplicados entre solicitudes.
        while (entry.answeredTurns < voceroTurns.length) {
          entry.session.recordAnswer(voceroTurns[entry.answeredTurns]?.text || '');
          entry.answeredTurns += 1;
        }

        // --- E1: evaluacion adaptativa antes de decidir el turno ---
        const configError = invalidInterviewConfigPayload(theme.interviewConfig);
        if (configError) return res.status(422).json(configError);
        const cfg = normalizeInterviewConfig(theme.interviewConfig);
        const budget = followUpBudget(cfg);
        const resolved = resolveInterviewConfig(theme);
        const mainsTotal = cfg.questionCount;
        // Sincroniza el estado con el historial real del cliente: si el historial ya trae mas
        // preguntas formuladas que las que la sesion registro (sesion creada por `prewarm`, o
        // reinicio del backend), se reconstruye antes de decidir. `seed()` deduplica por texto.
        const askedInHistory = history.filter((turn) => turn.role === 'interviewer').length;
        if (entry.session.snapshot().turn < askedInHistory) {
          entry.session.seed({ history, kindFor: (index) => turnPlan(cfg, index).kind });
        }
        const before = entry.session.snapshot();
        // Una entrevista cerrada (por tiempo, por ejemplo) no genera más preguntas: se responde el
        // cierre y no se consumen reservas precargadas que ya no corresponden a ningún turno.
        if (before.closeReason) {
          return res.status(409).json({
            status: 'error',
            code: 'INTERVIEW_DONE',
            done: true,
            closeReason: before.closeReason,
            mensaje: 'La entrevista ya se cerró.',
            mainsAsked: before.mainsAsked,
            mainsTotal,
            pendingMains: Math.max(0, mainsTotal - before.mainsAsked),
          });
        }
        // Completar las preguntas principales no cierra la entrevista: antes se evalúa la última
        // respuesta y se permite la aclaración que corresponda (más abajo, tras la decisión del turno).
        const context = {
          theme,
          history,
          cfg,
          plan,
          // Idioma efectivo del vocero: el entrevistador pregunta y repregunta en ese idioma.
          lang,
          // Organización del vocero: ya viene cargada en `req.user` (requireAuth incluye el
          // tenant), así que no hace falta ninguna consulta adicional. El prompt solo la usa si
          // existe y nunca inventa datos de la organización.
          tenant: req.user?.tenant ? { name: req.user.tenant.name, sector: req.user.tenant.sector } : null,
          timing: { targetMs: resolved.estimatedMinutes * 60000, marginMs: INTERVIEW_TIMING.extraMarginMs },
        };
        // Última respuesta del vocero. `spoke` y `hasTranscript` distinguen el silencio real de un
        // fallo de transcripción: si habló y no hay texto, NO se clasifica como silencio.
        const lastVocero = voceroTurns.length ? voceroTurns[voceroTurns.length - 1] : null;
        const answer = lastVocero ? lastVocero.text : '';
        const spoke = lastVocero ? lastVocero.spoke === true : false;
        const hasTranscript = Boolean(String(answer ?? '').trim());
        const lastInterviewer = [...history].reverse().find((turn) => turn.role === 'interviewer');
        const mainQuestion = lastInterviewer ? lastInterviewer.text : '';
        let assessment = null;
        let decision = { action: 'advance', reason: before.turn === 0 ? 'inicio' : 'sin_respuesta' };
        // Cierre de la entrevista (por tiempo). La respuesta de ESTA petición ya quedó registrada
        // y evaluada; el cierre solo evita pedir otra intervención. `pendingMains` conserva las
        // preguntas principales que no se realizaron (no se marcan como respondidas).
        // Auditoria (opcional): resumen del turno (clasificacion, decision, presupuestos y pregunta
        // entregada). Se escribe tambien en los caminos de cierre.
        const auditTurn = (extra = {}) => {
          const snap = entry.session.snapshot();
          return audit.writeTurn({
            sessionId: key,
            turn: before.turn,
            level: cfg.aggressiveness,
            planKind: plan.kind,
            mainQuestion,
            answer,
            assessment: assessment
              ? {
                  status: assessment.status,
                  source: assessment.source,
                  reason: assessment.reason || null,
                  focus: assessment.focus || null,
                  evidence: assessment.evidence || [],
                }
              : null,
            decision,
            budgetConfig: budget,
            usedBudget: snap.usedByBudget,
            followUpsForMain: snap.followUpsForMain,
            mainsAsked: snap.mainsAsked,
            mainsTotal,
            elapsedMs: snap.elapsedMs,
            ...extra,
          });
        };
        const closeInterview = (reason, detail) => {
          const after = entry.session.snapshot();
          const pending = Math.max(0, mainsTotal - after.mainsAsked);
          trace(key, {
            event: 'close',
            reason,
            detail: detail || null,
            elapsedMs: after.elapsedMs,
            maxDurationMs: resolved.maxDurationMs,
            mainsAsked: after.mainsAsked,
            mainsTotal,
            pendingMains: pending,
          });
          auditTurn({ event: 'close', closeReason: reason, detail: detail || null, question: null });
          return {
            status: 'ok',
            question: null,
            kind: null,
            number: after.turn,
            total: after.turn,
            done: true,
            closeReason: reason,
            mainsAsked: after.mainsAsked,
            mainsTotal,
            pendingMains: pending,
            assessment: assessment ? { status: assessment.status, source: assessment.source } : null,
            decision: { action: 'close', budget: null, reason: detail || 'sin_tiempo_para_otra_intervencion' },
            interview: resolved,
            model: null,
            ms: Date.now() - startedAt,
            elapsedMs: after.elapsedMs,
          };
        };
        if (before.turn > 0) {
          // Orden obligatorio: evaluar la respuesta antes de entregar pregunta o reserva.
          assessment = await assess({
            mainQuestion,
            answer,
            spoke,
            hasTranscript,
            history,
            previousAnswers: voceroTurns.slice(0, -1).map((turn) => turn.text),
            cfg,
            followUpsUsed: before.followUpsForMain,
            extraordinaryUsed: before.usedByBudget.extraordinary,
            budget,
            models: models(),
            askModel: (model, messages, options = {}) => {
              // Auditoria (opcional): el clasificador entra aqui una vez por modelo consultado.
              const auditedFetch = audit.isEnabled()
                ? audit.fetchRecorder({ kind: 'classification', sessionId: key, turn: before.turn, level: cfg.aggressiveness, model })
                : null;
              return assessAskModel(model, messages, {
                ...options,
                raw: true,
                timeoutMs: assessTimeoutMs(),
                lang,
                ...(auditedFetch ? { fetchImpl: auditedFetch } : {}),
              });
            },
            timeoutMs: assessTimeoutMs(),
          });
          decision = decideTurn({
            assessment,
            budget,
            used: before.usedByBudget,
            // Cierre por tiempo: solo si el escenario define una duración máxima (estimatedMinutes).
            // Sin duración configurada NO hay límite: la estimación automática es una referencia.
            timeLeftMs:
              resolved.maxDurationMs == null
                ? null
                : resolved.maxDurationMs + INTERVIEW_TIMING.extraMarginMs - before.elapsedMs,
          });
          entry.session.recordResolution({ status: assessment.status, reason: assessment.reason || decision.reason });
          if (decision.close) entry.session.setCloseReason(decision.close);
        }
        // Estado de la última respuesta (ya calculado por el clasificador existente): viaja en el
        // contexto para que el prompt lo use según el nivel. No se recalcula nada aquí.
        context.assessmentStatus = assessment?.status || null;
        // Estado por turno del clasificador (ya registrado por la sesión): permite que la memoria
        // del prompt distinga "ya lo pregunté" de "ya me lo respondió". Sin datos, el prompt deja
        // el tema solo como preguntado.
        context.resolutions = entry.session.snapshot().resolutions;
        trace(key, {
          event: 'assessment',
          status: assessment ? assessment.status : null,
          source: assessment ? assessment.source : null,
          action: decision.action,
          budget: decision.budget || null,
          reason: decision.reason,
          mainsAsked: before.mainsAsked,
          mainsTotal,
          followUpsForMain: before.followUpsForMain,
          ms: assessment ? assessment.ms : null,
        });
        // Cierre decidido por la evaluación (no queda tiempo para otra intervención): se responde el
        // cierre con done=true en vez de pedir una pregunta nueva.
        if (decision.close) return res.json(closeInterview(decision.close, decision.reason));
        // Cierre por tiempo: se activa cuando el tiempo transcurrido alcanza el máximo configurado.
        // `before.elapsedMs` es el tiempo medido al llegar esta petición, después de registrar la
        // respuesta y antes de evaluarla:
        //  - la respuesta en curso queda registrada y evaluada antes del cierre;
        //  - el reloj es el de la sesión (no se reinicia por cambio de tema ni por repregunta);
        //  - `msPerTurn` no adelanta el cierre y queda como valor informativo de la configuración.
        const timeUp =
          before.turn > 0 &&
          resolved.maxDurationMs != null &&
          before.elapsedMs >= resolved.maxDurationMs;
        if (timeUp) {
          entry.session.setCloseReason('TIME_LIMIT');
          return res.json(closeInterview('TIME_LIMIT', 'sin_tiempo_para_otra_intervencion'));
        }
        // Único punto donde la entrevista termina por sí sola: todas las preguntas principales ya se
        // entregaron y la evaluación de la última respuesta no pide otra aclaración. Una repregunta
        // adaptativa no la cierra mientras queden principales pendientes. `decideTurn` garantiza que
        // no hay bucle: devuelve `advance` cuando la respuesta es suficiente o los presupuestos se
        // agotan.
        if (before.mainsAsked >= mainsTotal && decision.action !== 'followup') {
          entry.session.setCloseReason('COMPLETED');
          auditTurn({ event: 'close', closeReason: 'COMPLETED', detail: null, question: null });
          return res.status(409).json({
            status: 'error',
            code: 'INTERVIEW_DONE',
            done: true,
            closeReason: 'COMPLETED',
            mensaje: 'La entrevista ya completó todas sus preguntas principales.',
            mainsAsked: before.mainsAsked,
            mainsTotal,
            pendingMains: Math.max(0, mainsTotal - before.mainsAsked),
          });
        }
        if (decision.action === 'followup') {
          result = await entry.session.next({
            needsFollowUp: true,
            originAnswer: answer,
            // Contexto real de la repregunta: pregunta principal en curso, foco detectado por la
            // evaluación y si hay transcripción utilizable. Sin esto, la repregunta se apoyaba en
            // el plan interno y no en lo que el vocero dijo.
            focus: assessment?.focus || null,
            mainQuestion,
            hasTranscript,
            budget: decision.budget,
            context,
            timeoutMs,
          });
        } else if (before.turn === 0) {
          result = await entry.session.start({ context, timeoutMs: startWaitMs() });
        } else {
          result = await entry.session.next({ context, timeoutMs });
        }
        {
          const after = entry.session.snapshot();
          // Se conserva para la rama de error recuperable, que vive fuera de este ámbito.
          sessionSnapshot = after;
          const remaining = Math.max(0, mainsTotal - after.mainsAsked);
          meta = {
            kind: result.kind || plan.kind,
            number: after.turn,
            total: after.turn + remaining * (1 + budget.perMain),
            // `done` NO se adelanta al entregar la ultima principal: la peticion siguiente decide
            // si hace falta una aclaracion mas o si la entrevista termina. `done: true` solo
            // aparece en las respuestas de CIERRE (409 INTERVIEW_DONE) o de cierre por tiempo.
            done: false,
            mainsAsked: after.mainsAsked,
            mainsTotal,
          };
        }
        result = { ...result, plan, assessment, decision };
        // Instrumentacion B1/B3: estado del pool, origen de la pregunta entregada y trazabilidad
        // del foco. Solo tamanos, claves de tema y contadores: sin textos de preguntas, respuestas
        // del vocero ni prompts. Es puro registro: no altera ninguna decision.
        const afterSnap = sessionSnapshot || entry.session.snapshot();
        const poolLogMark = (before.poolLog || []).reduce((max, item) => Math.max(max, item.n || 0), 0);
        const poolCandidates = (snap) =>
          (snap.reserved || []).map((candidate) => ({
            forMain: candidate.forMain ?? null,
            historyLen: candidate.historyLen ?? null,
            topics: detectTopics([candidate.question]),
          }));
        const lastMainAskedBefore = [...(before.asked || [])].reverse().find((item) => item.kind !== 'followup') || null;
        auditTurn({
          event: 'turn',
          ok: result.ok !== false,
          error: result.code || null,
          question: result.question || null,
          deliveredKind: result.kind || null,
          model: result.model || null,
          // B1: que habia en el pool, de donde salio la pregunta entregada y con cuanta antiguedad.
          pool: {
            before: (before.reserved || []).length,
            after: (afterSnap.reserved || []).length,
            candidates: poolCandidates(afterSnap),
            log: (afterSnap.poolLog || []).filter((item) => (item.n || 0) > poolLogMark).slice(0, 8),
          },
          delivery: {
            origin: result?.origin || null,
            fromPool: result?.origin === 'reserva_previa',
            answersAtReserve: result?.historyLenAtReserve ?? null,
            answersAtDelivery: result?.answersAtDelivery ?? null,
          },
          // B3: enlace estable entre la evaluacion, el foco del clasificador y la repregunta.
          // Identificadores: `followUpId` = evento evaluado (sesion + turno de la respuesta),
          // `mainQuestionId` = principal en curso, `followUpQuestionId` = repregunta asociada.
          focusTrace: {
            followUpId: `${key}:${before.turn}`,
            mainNumber: before.mainsAsked,
            mainQuestionId: `${key}:main-${before.mainsAsked}`,
            mainQuestionAskedTurn: lastMainAskedBefore ? lastMainAskedBefore.turn : null,
            followUpQuestionId:
              decision.action === 'followup' && assessment?.focus
                ? `${key}:fu-${before.mainsAsked}.${before.followUpsForMain + 1}`
                : null,
            followUpTurn: result?.question && (result?.kind || null) === 'followup' ? afterSnap.turn : null,
            focusPresent: Boolean(assessment?.focus),
            focusChars: assessment?.focus ? String(assessment.focus).length : 0,
            focusFromModel: assessment?.focus ? assessment.source || null : null,
            followUpRequested: decision.action === 'followup',
            focusUsedInPrompt: decision.action === 'followup' && Boolean(assessment?.focus),
            followUpGenerated: Boolean(result?.question) && (result?.kind || null) === 'followup',
          },
        });
      } else {
        result = { ...(await generate({ theme, history })), ok: true };
      }

      if (!result.ok) {
        // Error recuperable: las consultas pendientes siguen en segundo plano.
        const snapshot = sessionId ? sessionSnapshot : null;
        trace(sessionId || 'sin-sesion', {
          event: 'no-question',
          phase: plan?.kind || 'generic',
          code: result.code || 'UNKNOWN',
          turn: snapshot?.turn ?? null,
          reserved: snapshot?.reserved.length ?? null,
          pending: result.pending ?? snapshot?.pending ?? null,
          models: models().length,
          ms: Date.now() - startedAt,
        });
        return res.status(502).json({ status: 'error', mensaje: 'El entrevistador IA no respondió. Intenta de nuevo.' });
      }

      res.json({
        status: 'ok',
        question: result.question,        // Posición dentro de la entrevista: número de turno, total y si es repregunta
        kind: result.kind || result.plan.kind,
        number: meta ? meta.number : result.plan.number,
        total: meta ? meta.total : result.plan.total,
        done: Boolean(meta && meta.done),
        mainsAsked: meta ? meta.mainsAsked : null,
        mainsTotal: meta ? meta.mainsTotal : null,
        assessment: result.assessment ? { status: result.assessment.status, source: result.assessment.source } : null,
        decision: result.decision ? { action: result.decision.action, budget: result.decision.budget || null, reason: result.decision.reason } : null,
        interview: theme ? resolveInterviewConfig(theme) : null,
        model: result.model,
        ms: result.ms ?? Date.now() - startedAt,
      });
    } catch (error) {
      console.error('Error generando pregunta:', error.message);
      res.status(error.code === 'NO_API_KEY' ? 503 : 502).json({
        status: 'error',
        mensaje: error.code === 'NO_API_KEY'
          ? 'La IA no está configurada: falta NVIDIA_API_KEY en backend/.env.local'
          : 'El entrevistador IA no respondió. Intenta de nuevo.',
      });
    }
  });
  // Precalentamiento: consulta los modelos durante la preparación SIN consumir turno ni marcar
  // la pregunta como formulada. Idempotente: si ya hay una tanda en vuelo, no lanza otra.
  app.post('/api/interviewer/prewarm', requireAuth(prisma), async (req, res) => {
    try {
      const { sessionId } = req.body || {};
      if (!sessionId) return res.status(400).json({ status: 'error', mensaje: 'Falta sessionId.' });

      const session = await prisma.session.findUnique({ where: { id: String(sessionId) }, include: { theme: true } });
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ status: 'error', mensaje: 'Sesión no encontrada.' });
      }
      if (session.score != null) {
        return res.status(409).json({ status: 'error', mensaje: 'Esta entrevista ya fue evaluada.' });
      }

      const history = cleanHistory(req.body?.history);
      const key = String(sessionId);
      const entry = sessionFor(key, session.theme, history);
      registry.touch(key);

      // Una entrevista ya CERRADA no precarga reservas: no habría turnos que las usaran.
      if (entry.session.snapshot().closeReason) {
        return res.json({ status: 'ok', closed: true, reserved: entry.session.snapshot().reserved.length, pending: entry.session.pendingCount(), already: true });
      }

      const result = await entry.session.prewarm({
        context: {
          theme: session.theme,
          history,
          cfg: normalizeInterviewConfig(session.theme.interviewConfig),
          // Estado por turno del clasificador: las reservas se generan sabiendo qué temas ya se
          // preguntaron y cuáles ya quedaron respondidos.
          resolutions: entry.session.snapshot().resolutions,
        },
      });
      // Comprobación anticipada de los modelos EVALUADORES: se lanza en segundo plano y NO se
      // espera (no bloquea la preparación ni la entrevista). El módulo la deduplica y limita el
      // intervalo, así que repetir el precalentamiento no multiplica solicitudes.
      preflightEvaluators({ reason: 'prewarm' });
      // Instrumentacion B1: estado del pool al terminar el prewarm (evento relevante). Solo
      // contadores y claves de tema; el texto de las preguntas no se registra aqui.
      const prewarmSnap = entry.session.snapshot();
      if (audit.isEnabled()) {
        audit.append({
          type: 'pool',
          event: 'prewarm',
          sessionId: key,
          reserved: prewarmSnap.reserved.length,
          answersAtReserve: prewarmSnap.answers.length,
          rounds: result.rounds ?? null,
          candidates: prewarmSnap.reserved.map((item) => ({
            forMain: item.forMain ?? null,
            historyLen: item.historyLen ?? null,
            topics: detectTopics([item.question]),
          })),
          log: prewarmSnap.poolLog.slice(-8),
        });
      }
      return res.json({
        status: 'ok',
        reserved: result.reserved ?? 0,
        pending: result.pending ?? 0,
        already: Boolean(result.already),
        // Informativo para el operador (campos nuevos: el contrato previo no cambia).
        poolTopics: prewarmSnap.reserved.map((item) => detectTopics([item.question])),
        answers: prewarmSnap.answers.length,
      });
    } catch (error) {
      console.error('Error en el precalentamiento del entrevistador:', error.message);
      return res.status(502).json({ status: 'error', mensaje: 'El entrevistador IA no respondió. Intenta de nuevo.' });
    }
  });
};

module.exports.cleanHistory = cleanHistory;
module.exports.decideTurn = decideTurn;
