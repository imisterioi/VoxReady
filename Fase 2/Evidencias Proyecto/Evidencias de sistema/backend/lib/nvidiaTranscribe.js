// Transcripción oficial de la sesión: UNA petición a NVIDIA por respuesta.
//
// Whisper Large v3 en NVIDIA Build devuelve texto pero NO marcas temporales utilizables,
// así que no se alinea nada: se recorta el audio de cada ventana [startMs, endMs] (lo hace
// el cliente Python) y se transcribe por separado. Cada texto queda atado a SU turno.
const { runAsr } = require('./nvidiaAsr');
const { windowsForTurns } = require('./nvidiaWindows');
const { transcribeWindow, defaultEngines, DEFAULT_TIMEOUTS } = require('./asrChain');

const MODEL_KEY = 'whisper-large-v3';

// Serie estricta: `await` dentro del bucle ⇒ nunca hay dos peticiones a la vez (el
// servicio limita la concurrencia). Cada respuesta recorre la cadena de respaldo.
async function transcribeAnswers({
  filePath,
  turns = [],
  padMs,
  language = 'multi',
  runAsrImpl,
  engines,
  onAttempt,
  budgetMs,
} = {}) {
  const windows = windowsForTurns({ turns, padMs });
  const usable = windows.filter((window) => window.ok);

  if (!usable.length) {
    return {
      ok: false,
      code: 'NO_WINDOWS',
      message: 'Ninguna respuesta tiene tiempos utilizables; no se puede transcribir la sesión.',
      windows,
    };
  }

  // Si el llamador inyecta `runAsrImpl` (pruebas), la cadena se limita a ese motor.
  // Inyección para pruebas: si llega `runAsrImpl`, la cadena se limita a ese motor (no se
  // tocan los respaldos reales). En producción se usan los tres motores en paralelo.
  const chain =
    engines ||
    (runAsrImpl
      ? [
          {
            id: 'nvidia-whisper-large-v3',
            timeoutMs: DEFAULT_TIMEOUTS['nvidia-whisper-large-v3'],
            transcribe: (window, { timeoutMs, signal }) =>
              runAsrImpl({ modelKey: 'whisper-large-v3', language, timeoutMs, signal, ...window }),
          },
        ]
      : defaultEngines({ language }));
  const down = new Set();
  const answers = turns.map(() => '');
  const enginesUsed = turns.map(() => null);
  const failures = [];
  // Auditoría técnica por respuesta: qué motor la transcribió, qué intentos hubo y cuánto
  // tardó cada uno. No incluye el texto (no duplica contenido sensible).
  const diagnostics = turns.map((_, index) => ({
    index,
    status: 'pending',
    engine: null,
    code: null,
    attempts: [],
    totalMs: null,
  }));

  for (const window of usable) {
    const result = await transcribeWindow({
      window: { filePath, startMs: window.startMs, endMs: window.endMs },
      engines: chain,
      down,
      budgetMs,
    });
    diagnostics[window.index] = {
      index: window.index,
      status: result.ok ? 'ok' : 'failed',
      engine: result.engine || null,
      code: result.ok ? null : result.code,
      attempts: result.attempts,
      totalMs: result.totalMs ?? null,
    };
    if (typeof onAttempt === 'function') onAttempt({ index: window.index, ...result });
    if (!result.ok) {
      failures.push({ index: window.index, code: result.code, attempts: result.attempts });
      continue;
    }
    answers[window.index] = result.text;
    enginesUsed[window.index] = result.engine;
  }

  if (failures.length) {
    return {
      ok: false,
      code: 'ANSWER_TRANSCRIPTION_FAILED',
      message: `${failures.length} respuesta(s) no se pudieron transcribir con ningún motor.`,
      failures,
      windows,
      answers,
      enginesUsed,
      diagnostics,
    };
  }

  return { ok: true, answers, windows, enginesUsed, diagnostics, model: MODEL_KEY };
}

module.exports = { transcribeAnswers, MODEL_KEY };
