// Último respaldo: Whisper Small del servicio local, sobre el MISMO fragmento.
// El servicio local sólo acepta archivos completos, así que se extrae la ventana a un
// WAV temporal (PyAV, ya instalado), se envía con el cliente existente y se borra.
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolvePython } = require('./nvidiaAsr');
const { transcribeFile } = require('./whisperClient');

const SLICER = path.join(__dirname, '..', 'nvidia', 'slice_window.py');
const TIMEOUT_MS = Number(process.env.EVAL_LOCAL_ASR_TIMEOUT_MS) || 60000;

function sliceWindow({ filePath, startMs, endMs, outPath, spawnImpl = spawn, env = process.env } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    let child;
    try {
      child = spawnImpl(
        resolvePython(env),
        [SLICER, '--input-file', filePath, '--start-ms', String(startMs), '--end-ms', String(endMs), '--out', outPath],
        { env, windowsHide: true },
      );
    } catch (error) {
      return finish({ ok: false, code: 'SPAWN_ERROR', message: error?.message });
    }

    let stdout = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ya terminó */
      }
      finish({ ok: false, code: 'TIMEOUT', message: 'El recorte del audio no terminó a tiempo.' });
    }, TIMEOUT_MS);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.on?.('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, code: error?.code === 'ENOENT' ? 'PYTHON_MISSING' : 'SPAWN_ERROR', message: error?.message });
    });
    child.on?.('close', () => {
      clearTimeout(timer);
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
      if (!line) return finish({ ok: false, code: 'BAD_OUTPUT', message: 'El recorte no devolvió resultado.' });
      try {
        return finish(JSON.parse(line));
      } catch {
        return finish({ ok: false, code: 'BAD_OUTPUT', message: 'Respuesta no interpretable del recorte.' });
      }
    });
    return undefined;
  });
}

// Mutex de una sola inferencia local: aunque una petición se abandone, el servicio local
// no vuelve a recibir otra hasta que la anterior haya terminado de verdad (no hay colas
// ocultas ni dos inferencias simultáneas).
let localQueue = Promise.resolve();
function runExclusive(task) {
  const run = localQueue.then(task, task);
  localQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Devuelve { ok, text } o { ok:false, code, message }. Nunca lanza.
async function transcribeWindowLocal({
  filePath,
  startMs,
  endMs,
  modelKey = process.env.EVAL_WHISPER_MODEL || 'small',
  language = '',
  timeoutMs = Number(process.env.ASR_LOCAL_TIMEOUT_MS) || 30000,
  signal = null,
  sliceImpl = sliceWindow,
  transcribeImpl = transcribeFile,
} = {}) {
  if (signal?.aborted) return { ok: false, code: 'CANCELLED', message: 'Ya no era necesaria.' };

  return runExclusive(async () => {
    const outPath = path.join(os.tmpdir(), `voxready-window-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  try {
    const slice = await sliceImpl({ filePath, startMs, endMs, outPath, timeoutMs });
    if (!slice?.ok) return { ok: false, code: slice?.code || 'SLICE_FAILED', message: slice?.message };

    // `timeoutMs` cubre la petición HTTP completa y la aborta (AbortSignal.timeout), no sólo
    // la espera: el limitador del servicio local se libera al abortar.
    const result = await transcribeImpl(outPath, { model: modelKey, timeoutMs, language });
    if (!result?.ok) return { ok: false, code: result?.code || 'LOCAL_ASR_ERROR', message: result?.message };
    const text = String(result.text ?? '').trim();
    if (!text) return { ok: false, code: 'EMPTY_TRANSCRIPT', message: 'Whisper local devolvió texto vacío.' };
    return { ok: true, text, model: result.modelKey || modelKey };
  } catch (error) {
    return { ok: false, code: 'LOCAL_ASR_ERROR', message: error?.message || 'Fallo del Whisper local.' };
  } finally {
    // Se borra también cuando hay timeout o error: nunca queda audio temporal.
    fs.unlink(outPath).catch(() => {});
  }
  });
}

module.exports = { transcribeWindowLocal, sliceWindow, SLICER };
