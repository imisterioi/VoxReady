// Núcleo del laboratorio «En tiempo real».
//
// IMPORTANTE: faster-whisper NO hace streaming nativo. Aquí se trocea el audio y se
// transcribe cada fragmento con el servicio por petición; el texto aparece de forma
// INCREMENTAL (no en tiempo real) y el retraso se mide y se muestra.
//
// Este módulo no toca el DOM: recibe los fragmentos ya cortados y una función de
// transcripción, para poder probarlo sin navegador.

// Estadísticas de latencia (media, mediana, máximo).
export function latencyStats(values = []) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return { count: 0, avg: null, median: null, max: null };
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    count: clean.length,
    avg: Math.round(clean.reduce((a, b) => a + b, 0) / clean.length),
    median: Math.round(median),
    max: Math.round(sorted[sorted.length - 1]),
  };
}

// Reloj por defecto: MONOTÓNICO (performance.now), en milisegundos.
// IMPORTANTE: todas las marcas que entran al pipeline deben venir del MISMO reloj.
// Mezclar Date.now() con performance.now() produce diferencias del orden de 1.79e9 ms
// (epoch) que se mostraban como "1792530551.5 s" de latencia.
export const monotonicNow = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

// Máximo desfase aceptable entre una marca externa (`endedAt`) y el reloj del pipeline.
// Si se supera, la marca viene de otro reloj y NO se usa (queda null en vez de mentir).
const MAX_CLOCK_SKEW_MS = 60000;

const initialState = () => ({
  status: 'idle', // idle | running | stopping | complete | incomplete | failed | cancelled
  confirmed: '',
  provisional: '',
  pending: 0,
  generated: 0,
  processed: 0,
  failed: 0,
  maxQueueDepth: 0,
  chunks: [],
  errors: [],
  overloaded: false,
  running: false,
  processingMs: 0,
  tailMs: null,
});

// Crea la cola secuencial de fragmentos.
// - `push(blob, { endedAt })` encola un fragmento; se procesan de uno en uno.
// - `endedAt` es opcional: instante (mismo reloj monotónico) en que terminó el audio.
// - El texto del último fragmento procesado queda como PROVISIONAL hasta que llega el
//   siguiente; entonces pasa a CONFIRMADO (no se duplica).
// - `stop()` espera a que se vacíe la cola con un presupuesto de tiempo y devuelve el
//   estado final; nunca lo presenta como completo si quedan pendientes o fallos.
export function createChunkPipeline({
  transcribe,
  now = monotonicNow,
  onUpdate = () => {},
  maxQueue = 2,
  flushTimeoutMs = 30000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const state = initialState();
  const queue = [];
  let working = null;
  let lastText = '';
  // Generación de sesión: al cancelar se incrementa y los resultados tardíos se ignoran.
  let generation = 0;
  const inflight = new Set();

  const emit = () => onUpdate({ ...state, chunks: [...state.chunks], errors: [...state.errors] });

  function drain() {
    if (working) return working;
    working = (async () => {
      while (queue.length) {
        const chunk = queue.shift();
        state.pending = queue.length;
        state.running = true;
        const requestStartedAt = now();
        const controller = new AbortController();
        inflight.add(controller);
        let record;
        try {
          const result = await transcribe(chunk.blob, { index: chunk.index, signal: controller.signal });
          if (chunk.generation !== generation) continue; // sesión cancelada: se descarta
          const text = String(result?.text ?? '');
          if (lastText) state.confirmed = `${state.confirmed} ${lastText}`.trim();
          lastText = text.trim();
          state.provisional = lastText;
          state.processed += 1;
          record = {
            index: chunk.index,
            ok: true,
            chars: text.length,
            // Tiempo desde que el fragmento se encoló hasta que llegó su texto (incluye
            // espera en cola: es la latencia observable por el usuario).
            latencyMs: Math.max(0, now() - chunk.enqueuedAt),
            // Solo si `endedAt` viene del mismo reloj: audio cerrado → texto recibido.
            audioToTextMs:
              chunk.endedAt != null && Number.isFinite(chunk.endedAt)
                ? Math.max(0, now() - chunk.endedAt)
                : null,
            queueMs: Math.max(0, requestStartedAt - chunk.enqueuedAt),
            processMs: Math.max(0, now() - requestStartedAt),
            error: null,
          };
        } catch (error) {
          if (chunk.generation !== generation) continue;
          state.failed += 1;
          const message = error?.name === 'AbortError'
            ? 'Petición cancelada al detener la sesión.'
            : error?.message || 'Error de transcripción.';
          state.errors.push({ index: chunk.index, code: error?.name || 'TRANSCRIBE_ERROR', message });
          record = {
            index: chunk.index,
            ok: false,
            chars: 0,
            latencyMs: Math.max(0, now() - chunk.enqueuedAt),
            audioToTextMs: null,
            queueMs: Math.max(0, requestStartedAt - chunk.enqueuedAt),
            processMs: Math.max(0, now() - requestStartedAt),
            error: message,
          };
        } finally {
          inflight.delete(controller);
        }
        state.chunks.push(record);
        state.processingMs += record.processMs;
        state.status = 'running';
        emit();
      }
      state.pending = 0;
      state.running = false;
      state.overloaded = false;
      if (state.status === 'running') state.status = 'idle';
      emit();
    })();
    return working.finally(() => {
      working = null;
    });
  }

  return {
    push(blob, { endedAt = null } = {}) {
      if (!blob || !blob.size) {
        state.errors.push({ index: state.generated, code: 'EMPTY_CHUNK', message: 'Fragmento de audio vacío: no se envió.' });
        state.failed += 1;
        emit();
        return false;
      }
      const index = state.generated;
      const enqueuedAt = now();
      // Una marca de otro reloj (p. ej. Date.now) se descarta: mejor sin dato que un dato falso.
      const sameClock =
        endedAt != null && Number.isFinite(endedAt) && Math.abs(enqueuedAt - endedAt) <= MAX_CLOCK_SKEW_MS;
      queue.push({ blob, index, enqueuedAt, endedAt: sameClock ? endedAt : null, generation });
      state.generated += 1;
      state.pending = queue.length;
      state.maxQueueDepth = Math.max(state.maxQueueDepth, queue.length);
      state.overloaded = queue.length > maxQueue;
      state.status = 'running';
      emit();
      drain();
      return true;
    },

    getState: () => ({ ...state, chunks: [...state.chunks], errors: [...state.errors] }),

    // Espera a vaciar la cola. Devuelve el estado final y NUNCA lo declara completo si
    // quedan fragmentos pendientes o fallidos.
    async stop({ timeoutMs = flushTimeoutMs } = {}) {
      if (state.status === 'cancelled') {
        return { complete: false, pending: 0, failed: state.failed, status: 'cancelled' };
      }
      state.status = 'stopping';
      emit();
      const waitStartedAt = now();
      const deadline = waitStartedAt + Math.max(0, timeoutMs);
      while ((working || queue.length) && now() < deadline) {
        await sleep(50);
      }

      const pending = queue.length + (working ? 1 : 0);
      state.pending = queue.length;
      state.tailMs = Math.round(now() - waitStartedAt);

      if (pending > 0) {
        state.status = 'incomplete';
        state.errors.push({
          code: 'FLUSH_TIMEOUT',
          message: `Quedaron ${pending} fragmento(s) sin procesar tras esperar ${state.tailMs} ms. No se descartan: el WebM los contiene y se pueden reintentar.`,
        });
      } else {
        if (lastText) {
          state.confirmed = `${state.confirmed} ${lastText}`.trim();
          lastText = '';
          state.provisional = '';
        }
        const anyOk = state.processed > 0;
        state.status = state.failed === 0 ? 'complete' : anyOk ? 'incomplete' : 'failed';
      }
      emit();
      return {
        complete: state.status === 'complete',
        pending,
        failed: state.failed,
        status: state.status,
        tailMs: state.tailMs,
      };
    },

    // Cancela: aborta la petición en curso, descarta la cola e ignora respuestas tardías.
    cancel() {
      generation += 1;
      for (const controller of inflight) {
        try {
          controller.abort();
        } catch {
          /* ya estaba abortada */
        }
      }
      inflight.clear();
      queue.length = 0;
      state.pending = 0;
      state.running = false;
      state.overloaded = false;
      state.status = 'cancelled';
      emit();
      return { aborted: true };
    },

    text() {
      return `${state.confirmed} ${lastText}`.trim();
    },

    stats() {
      const latencies = state.chunks.map((chunk) => chunk.latencyMs);
      const audioToText = state.chunks
        .map((chunk) => chunk.audioToTextMs)
        .filter((value) => Number.isFinite(value));
      return {
        status: state.status,
        generated: state.generated,
        processed: state.processed,
        failed: state.failed,
        pending: state.pending,
        maxQueueDepth: state.maxQueueDepth,
        processingMs: state.processingMs,
        tailMs: state.tailMs,
        latency: latencyStats(latencies),
        audioToText: latencyStats(audioToText),
        errors: [...state.errors],
      };
    },
  };
}


