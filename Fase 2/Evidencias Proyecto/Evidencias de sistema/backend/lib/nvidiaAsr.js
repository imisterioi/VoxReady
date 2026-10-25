// Ejecuta el cliente oficial de Riva (Python) para los ASR alojados de NVIDIA Build.
// No ejecuta modelos localmente: el script sólo envía audio a grpc.nvcf.nvidia.com.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { asrModel, isCallable } = require('./nvidiaCatalog');

const SCRIPT = path.join(__dirname, '..', 'nvidia', 'asr_client.py');
const TIMEOUT_MS = Number(process.env.NVIDIA_ASR_TIMEOUT_MS) || 120000;

// Intérprete de Python: PYTHON_EXECUTABLE (ruta absoluta) → NVIDIA_PYTHON → `python`.
// Se leen las comillas que a veces se pegan al copiar una ruta en Windows; los argumentos
// van como array, así que las rutas con espacios funcionan sin escapar nada más.
function resolvePython(env = process.env) {
  const raw = env.PYTHON_EXECUTABLE || env.NVIDIA_PYTHON || 'python';
  return String(raw)
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/^'(.*)'$/, '$1')
    .trim();
}

const PYTHON = resolvePython();

// Devuelve siempre un objeto: nunca lanza y nunca incluye la API key.
function runAsr({ modelKey, filePath, language, startMs, endMs, timeoutMs = TIMEOUT_MS, signal = null, spawnImpl = spawn, env = process.env } = {}) {
  const model = asrModel(modelKey);
  if (!model) return Promise.resolve({ ok: false, code: 'UNKNOWN_MODEL', message: 'Modelo no reconocido.' });
  if (!isCallable(model)) {
    return Promise.resolve({
      ok: false,
      code: 'NOT_AVAILABLE',
      message: `${model.label}: ${model.availability === 'early_access' ? 'requiere acceso temprano' : 'sin endpoint publicado'}.`,
    });
  }
  if (!env.NVIDIA_API_KEY) {
    return Promise.resolve({ ok: false, code: 'NO_KEY', message: 'Falta NVIDIA_API_KEY en el backend.' });
  }

  const args = [
    SCRIPT,
    '--function-id',
    model.functionId,
    '--server',
    model.host,
    '--language',
    language || model.language,
    '--input-file',
    filePath,
  ];
  // Ventana opcional (ms): el cliente recorta el audio antes de transcribir.
  if (Number.isFinite(Number(startMs))) args.push('--start-ms', String(Math.max(0, Math.round(Number(startMs)))));
  if (Number.isFinite(Number(endMs))) args.push('--end-ms', String(Math.max(0, Math.round(Number(endMs)))));

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    let child;
    const python = resolvePython(env);
    try {
      child = spawnImpl(python, args, { env, windowsHide: true });
    } catch (error) {
      return finish({ ok: false, code: 'SPAWN_ERROR', message: error?.message || 'No se pudo iniciar el cliente.' });
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Cancelación REAL: se mata el proceso hijo (y con él el gRPC en curso). No es un
    // `Promise.race`: el proceso deja de existir y no sigue consumiendo recursos.
    const onAbort = () => {
      try {
        child.kill();
      } catch {
        /* ya terminó */
      }
      finish({ ok: false, code: 'CANCELLED', message: 'Petición cancelada: otro motor ya resolvió.' });
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* el proceso ya terminó */
      }
      finish({ ok: false, code: 'TIMEOUT', message: `Sin respuesta del modelo en ${timeoutMs} ms.` });
    }, timeoutMs);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    child.on?.('error', (error) => {
      clearTimeout(timer);
      const missing = error?.code === 'ENOENT';
      finish({
        ok: false,
        code: missing ? 'PYTHON_MISSING' : 'SPAWN_ERROR',
        message: missing
          ? `No se encontró el intérprete de Python «${python}». Define PYTHON_EXECUTABLE con su ruta absoluta.`
          : error?.message || 'No se pudo iniciar el cliente de Riva.',
      });
    });
    child.on?.('close', () => {
      clearTimeout(timer);
      if (timedOut) return undefined; // el timeout ya resolvió con su propio motivo
      const line = stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
        .pop();
      if (!line) {
        return finish({
          ok: false,
          code: 'BAD_OUTPUT',
          message: (stderr.trim() || 'El cliente no devolvió resultado.').slice(-300),
        });
      }
      try {
        const parsed = JSON.parse(line);
        return finish({ ...parsed, modelKey: model.key, model: model.model });
      } catch {
        return finish({ ok: false, code: 'BAD_OUTPUT', message: `Respuesta no interpretable del cliente: ${line.slice(0, 120)}` });
      }
    });
    return undefined;
  });
}

module.exports = { runAsr, resolvePython, SCRIPT, PYTHON, TIMEOUT_MS };
