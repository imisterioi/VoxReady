import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL, apiFetch, getToken } from '../lib/api';
import Icon from '../components/Icon';
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, cx } from '../components/ui';
import { createRecognizer, speechRecognitionSupported } from '../lib/practice/speech';
import {
  EXAMPLE_SCRIPT,
  buildRunRecord,
  clearRuns,
  compareWithReference,
  formatPercent,
  loadRuns,
  removeRun,
  saveRun,
  toCSV,
  toJSON,
} from '../lib/lab/transcription';
import {
  COMPARE_ALL_ID,
  DEFAULT_ENGINE_ID,
  ENGINES,
  comparisonIds,
  describeSelection,
  enginesRecord,
  finishResult,
  getEngine,
  idleResult,
  runEnginesSequentially,
  summarizeComparison,
  supportsFileInput,
  targetIdsFor,
} from '../lib/lab/engines';

// Laboratorio de transcripción (EXPERIMENTAL).
//
// Compara, sobre la MISMA intervención hablada:
//   - Web Speech API del navegador (escucha el micrófono en vivo)
//   - Whisper (faster-whisper) como servicio local, al que se envía la grabación
//
// Reglas del experimento:
//  - No crea ni toca sesiones oficiales: no usa /api/sessions ni la evaluación.
//  - El audio vive SOLO en memoria mientras dura la prueba (no se guarda por defecto).
//  - El navegador NO puede transcribir un archivo: Web Speech API solo escucha el
//    micrófono, así que no se simula lo que la API no permite.
//  - No se reproduce audio por los altavoces ni se usan dispositivos virtuales.

const MAX_FILE_MB = 25;

const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) =>
    MediaRecorder.isTypeSupported(m),
  ) || '';
}

function formatMs(ms) {
  if (ms == null || Number.isNaN(ms)) return 'no medido';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

function formatSeconds(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return 'no medido';
  return `${seconds.toFixed(2)} s`;
}

function formatBytes(bytes) {
  if (bytes == null) return 'no medido';
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Duración real del audio decodificado en el navegador (si el códec lo permite)
async function measureAudioDuration(blob) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  const ctx = new AudioCtx();
  try {
    const buffer = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buffer);
    return decoded.duration;
  } catch {
    return null;
  } finally {
    ctx.close?.().catch?.(() => {});
  }
}

const STATUS_UI = {
  presente: { tone: 'success', label: 'presente' },
  cambiada: { tone: 'warning', label: 'cambiada' },
  omitida: { tone: 'danger', label: 'omitida' },
  vacia: { tone: 'neutral', label: 'vacía' },
};

// ---------------------------------------------------------------- Subcomponentes

function EnginePanel({ title, icon, subtitle, result, accent }) {
  const word = result?.word;
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-start gap-3 p-5 pb-3">
        <span className={cx('h-9 w-9 rounded-xl flex items-center justify-center shrink-0', accent || 'bg-subtle text-muted')}>
          <Icon name={icon} size={17} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
            {result?.status && (
              <Badge tone={result.status === 'ok' ? 'success' : result.status === 'error' ? 'danger' : 'neutral'}>
                {result.status === 'ok' ? 'listo' : result.status === 'error' ? 'error' : result.status}
              </Badge>
            )}
          </div>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>

      <div className="px-5 pb-5">
        <div className="rounded-xl bg-subtle/50 border border-line px-4 py-3 text-[13px] leading-relaxed text-ink min-h-[72px] whitespace-pre-wrap break-words">
          {result?.text ? result.text : <span className="text-faint">Sin transcripción todavía.</span>}
        </div>

        {result?.error && (
          <p className="text-xs text-danger mt-3 flex items-start gap-1.5">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            <span>{result.error}</span>
          </p>
        )}

        {word && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
              <div className="rounded-lg border border-line px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">WER</div>
                <div className="text-[15px] font-semibold tabular-nums text-ink">{formatPercent(word.wer)}</div>
              </div>
              <div className="rounded-lg border border-line px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">Sustituciones</div>
                <div className="text-[15px] font-semibold tabular-nums text-ink">{word.substitutions}</div>
              </div>
              <div className="rounded-lg border border-line px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">Omisiones</div>
                <div className="text-[15px] font-semibold tabular-nums text-ink">{word.deletions}</div>
              </div>
              <div className="rounded-lg border border-line px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">Inserciones</div>
                <div className="text-[15px] font-semibold tabular-nums text-ink">{word.insertions}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-muted">
              <span>Palabras del guion: <b className="text-ink tabular-nums">{word.referenceWords}</b></span>
              <span>Palabras transcritas: <b className="text-ink tabular-nums">{word.hypothesisWords}</b></span>
              {result.char?.cer != null && <span>CER: <b className="text-ink tabular-nums">{formatPercent(result.char.cer)}</b></span>}
              {result.totalMs != null && <span>Tiempo total: <b className="text-ink tabular-nums">{formatMs(result.totalMs)}</b></span>}
              {result.processingMs != null && (
                <span>Procesamiento: <b className="text-ink tabular-nums">{formatMs(result.processingMs)}</b></span>
              )}
              {result.loadMs > 0 && (
                <span>Carga del modelo: <b className="text-ink tabular-nums">{formatMs(result.loadMs)}</b></span>
              )}
              {result.durationAfterVad != null && result.durationSeconds > 0 && (
                <span>
                  Audio conservado por el VAD:{' '}
                  <b className="text-ink tabular-nums">{formatSeconds(result.durationAfterVad)}</b>
                </span>
              )}
              {result.rtf != null && <span>RTF: <b className="text-ink tabular-nums">{result.rtf}</b></span>}
            </div>

            {result.model && (
              <p className="text-xs text-faint mt-2 font-mono">
                {result.model}
                {result.config ? ` · ${result.config}` : ''}
              </p>
            )}

            {result.keywords?.length > 0 && (
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-wide text-muted mb-2">Palabras clave del guion</div>
                <div className="flex flex-wrap gap-1.5">
                  {result.keywords.map((k) => (
                    <Badge key={k.keyword} tone={STATUS_UI[k.status]?.tone || 'neutral'}>
                      {k.keyword}
                      {k.status === 'cambiada' && k.match ? ` → ${k.match}` : ''}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}


// ---------------------------------------------------------------- Laboratorio

export default function TranscriptionLab() {
  const [script, setScript] = useState(EXAMPLE_SCRIPT);
  const [status, setStatus] = useState('idle'); // idle | recording | processing | done
  const [wsLive, setWsLive] = useState('');
  // Resultados de la última prueba, uno por motor y en el orden en que se ejecutaron.
  const [engineResults, setEngineResults] = useState([]);
  // Motor elegido en el selector: uno de los tres o la comparación de todos.
  const [engineId, setEngineId] = useState(DEFAULT_ENGINE_ID);
  const [audioInfo, setAudioInfo] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [runs, setRuns] = useState(() => loadRuns());
  const [health, setHealth] = useState(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [options, setOptions] = useState({ lowercase: true, stripPunctuation: true, stripAccents: false });
  const [showDiff, setShowDiff] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recognizerRef = useRef(null);
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);
  const blobRef = useRef(null);
  const settingsRef = useRef({});
  const fileInputRef = useRef(null);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const releaseAll = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    try {
      recognizerRef.current?.stop?.();
    } catch {
      /* el reconocedor ya estaba detenido */
    }
    recognizerRef.current = null;
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    } catch {
      /* la grabadora ya estaba detenida */
    }
    recorderRef.current = null;
    releaseMic();
  }, [releaseMic]);

  // Al salir de la página se liberan micrófono, grabadora y reconocedor
  useEffect(() => () => releaseAll(), [releaseAll]);

  const checkHealth = useCallback(async (silent = false) => {
    if (!silent) setCheckingHealth(true);
    try {
      const data = await apiFetch('/api/lab/health');
      setHealth(data);
    } catch (err) {
      setHealth({
        available: false,
        forbidden: err.status === 403,
        detail:
          err.status === 403
            ? 'Tu rol no tiene permiso para usar el laboratorio de transcripción (solo configurador maestro y administrador del sistema).'
            : err.message || 'No se pudo consultar el backend.',
      });
    } finally {
      if (!silent) setCheckingHealth(false);
    }
  }, []);

  useEffect(() => {
    checkHealth(true);
  }, [checkHealth]);

  // Cierra el resultado de un motor: calcula sus métricas contra el guion (o las marca
  // como no medibles si todavía no hay guion) y decide si es un resultado válido.
  const finishFor = useCallback(
    (engine, draft) => finishResult(engine, draft, { reference: script, options }),
    [script, options],
  );

  const persistRun = useCallback((run) => {
    setRuns(saveRun(run));
  }, []);


  // ---------------------------------------------------------------- Envío a Whisper

  // Envía el MISMO audio al servicio local. `modelKey` elige el modelo ('base' o 'small');
  // sin él, el servicio usa su modelo por defecto (comportamiento de Whisper Base).
  const sendToWhisper = useCallback(async (blob, modelKey) => {
    const started = performance.now();
    try {
      const query = modelKey ? `?model=${encodeURIComponent(modelKey)}` : '';
      const response = await fetch(`${API_URL}/api/lab/transcribe${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': blob.type || 'audio/webm',
          Authorization: `Bearer ${getToken() || ''}`,
        },
        body: blob,
      });
      const clientMs = Math.round(performance.now() - started);
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        return {
          status: 'error',
          text: '',
          clientMs,
          error:
            response.status === 403
              ? 'Tu rol no tiene permiso para transcribir con Whisper (solo configurador maestro y administrador del sistema).'
              : data?.mensaje || `El backend respondió con estado ${response.status}.`,
        };
      }
      return {
        status: 'ok',
        text: String(data.text || ''),
        modelKey: data.modelKey ?? modelKey ?? null,
        modelName: data.modelName ?? null,
        // `processingMs` es SOLO inferencia; `loadMs` es lo que tardó el servicio en
        // cargar el modelo (0 si ya estaba cargado en memoria). No se mezclan.
        processingMs: data.processingMs ?? null,
        loadMs: data.modelLoadMs ?? null,
        proxyMs: data.proxyMs ?? null,
        totalMs: data.totalMs ?? clientMs,
        clientMs,
        rtf: data.rtf ?? null,
        durationSeconds: data.durationSeconds ?? null,
        segments: Array.isArray(data.segments) ? data.segments.length : 0,
        device: data.config?.device ?? null,
        model: data.config?.model
          ? `${data.config.model} (${data.config.device}/${data.config.compute_type})`
          : null,
        config: data.config
          ? `lang ${data.config.language} · beam ${data.config.beam_size} · vad ${data.config.vad_filter}`
          : null,
      };
    } catch (err) {
      return {
        status: 'error',
        text: '',
        clientMs: Math.round(performance.now() - started),
        error: `No se pudo contactar el backend (${err.message}).`,
      };
    }
  }, []);

  // ---------------------------------------------------------------- Motores

  // Speech API trabaja EN VIVO desde el micrófono: su resultado se arma con el texto ya
  // capturado durante la grabación. No puede transcribir un archivo y no se simula.
  const speechDraft = useCallback(({ text, failed, totalMs, supported }) => {
    if (!supported) {
      return {
        status: 'no_disponible',
        text: '',
        error: 'Speech API no está disponible en este navegador: no se puede comparar.',
      };
    }
    if (failed) {
      return { status: 'error', text: String(text || ''), error: 'Speech API falló al cerrar el reconocimiento.' };
    }
    if (!String(text || '').trim()) {
      return {
        status: 'error',
        text: '',
        error: 'Speech API no devolvió texto (silencio, error de red o idioma no soportado).',
      };
    }
    return { status: 'ok', text: String(text), totalMs };
  }, []);

  // Ejecuta EN SERIE los motores elegidos sobre el MISMO audio. Si uno falla, se registra
  // su error y los demás continúan; los resultados se muestran a medida que llegan.
  const runSelectedEngines = useCallback(
    async ({ blob, speech }) => {
      const targets = targetIdsFor(engineId).map(getEngine).filter(Boolean);
      setEngineResults(targets.map((engine) => idleResult(engine, 'pendiente')));
      return runEnginesSequentially(
        targets.map((engine) => engine.id),
        async (engine) => {
          if (engine.kind === 'browser-speech') return finishFor(engine, speechDraft(speech));
          const raw = await sendToWhisper(blob, engine.modelKey);
          return finishFor(engine, raw);
        },
        {
          onResult: (result) =>
            setEngineResults((previous) =>
              previous.map((item) => (item.engineId === result.engineId ? result : item)),
            ),
        },
      );
    },
    [engineId, finishFor, sendToWhisper, speechDraft],
  );

  // ---------------------------------------------------------------- Prueba con micrófono

  const startTest = useCallback(async () => {
    setError('');
    setNotice('');
    if (!script.trim()) {
      setError('Escribe o pega un guion de referencia antes de empezar.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('Este navegador no permite grabar audio (MediaRecorder no está disponible).');
      return;
    }

    setEngineResults([]);
    setAudioInfo(null);
    setWsLive('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
      streamRef.current = stream;
      settingsRef.current = stream.getAudioTracks()[0]?.getSettings?.() || {};

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) chunksRef.current.push(event.data);
      };
      recorder.start(1000);
      recorderRef.current = recorder;

      if (speechRecognitionSupported) {
        const recognizer = createRecognizer({
          onUpdate: (live) => setWsLive([live.finalText, live.interim].filter(Boolean).join(' ')),
          onError: (code) => {
            if (code === 'network') {
              setNotice('Web Speech API informó un error de red: puede necesitar conexión a Internet.');
            }
          },
        });
        recognizerRef.current = recognizer;
        recognizer?.start();
      } else {
        setNotice('Este navegador no implementa Web Speech API: en esta prueba solo se medirá Whisper.');
      }

      startedAtRef.current = performance.now();
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((performance.now() - startedAtRef.current) / 1000), 200);
      setStatus('recording');
    } catch (err) {
      releaseMic();
      setStatus('idle');
      setError(`No se pudo acceder al micrófono (${err.message || 'permiso denegado'}).`);
    }
  }, [script, releaseMic]);


  const finishTest = useCallback(async () => {
    if (status !== 'recording') return;
    setStatus('processing');
    clearInterval(timerRef.current);
    timerRef.current = null;

    const startedAtIso = new Date().toISOString();
    const startedAt = startedAtRef.current;
    const finishedAt = performance.now();

    // 1) Web Speech API: se detiene y se recupera el texto final
    let wsText = '';
    let wsFailed = false;
    if (speechRecognitionSupported) {
      try {
        wsText = recognizerRef.current?.stop?.() || '';
      } catch {
        wsFailed = true;
      }
    }
    recognizerRef.current = null;

    // 2) Grabadora: se cierra y el audio queda SOLO en memoria
    const recorder = recorderRef.current;
    const blob = await new Promise((resolve) => {
      const fallback = new Blob(chunksRef.current, { type: 'audio/webm' });
      if (!recorder || recorder.state === 'inactive') {
        resolve(fallback);
        return;
      }
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }));
      recorder.stop();
    });
    recorderRef.current = null;
    releaseMic();

    blobRef.current = blob;
    setHasAudio(true);
    const measured = await measureAudioDuration(blob);
    const durationSeconds = measured ?? (finishedAt - startedAt) / 1000;
    const wsTotalMs = Math.round(finishedAt - startedAt);

    const audio = {
      durationSeconds: Number(durationSeconds.toFixed(2)),
      durationMeasured: measured != null,
      sizeBytes: blob.size,
      mimeType: blob.type || 'audio/webm',
      sampleRate: settingsRef.current.sampleRate ?? null,
      channels: settingsRef.current.channelCount ?? null,
      constraints: AUDIO_CONSTRAINTS,
      deviceId: settingsRef.current.deviceId ?? null,
    };
    setAudioInfo(audio);

    // 3) Se ejecutan en serie los motores elegidos sobre el MISMO audio grabado. Speech
    //    API se arma con el texto que ya se capturó en vivo durante la grabación.
    const results = await runSelectedEngines({
      blob,
      speech: {
        text: wsText,
        failed: wsFailed,
        totalMs: wsTotalMs,
        supported: speechRecognitionSupported,
      },
    });

    // 4) Registro de la ejecución (sin audio, sin credenciales y con todos los motores)
    const warnings = [];
    if (!speechRecognitionSupported) warnings.push('Navegador sin Web Speech API');
    if (measured == null) warnings.push('Duración del audio aproximada (no se pudo decodificar en el navegador)');
    for (const result of results) {
      if (result.status === 'error') warnings.push(`${result.engineShort}: ${result.error}`);
    }

    const anyOk = results.some((result) => result.status === 'ok');
    persistRun(
      buildRunRecord({
        reference: script,
        engines: enginesRecord(results),
        audio,
        whisperConfig: health?.service?.config || {},
        warnings,
        status: anyOk ? 'ok' : 'parcial',
        startedAt: startedAtIso,
        finishedAt: new Date().toISOString(),
        notes: `Motores: ${results.map((r) => `${r.engineShort}=${r.status}`).join(', ')}`,
      }),
    );
    setStatus('done');
  }, [status, script, runSelectedEngines, health, persistRun, releaseMic]);

  // Descartar: detiene todo, libera el micrófono y borra el audio en memoria
  const discardTest = useCallback(() => {
    releaseAll();
    blobRef.current = null;
    setHasAudio(false);
    setEngineResults([]);
    setAudioInfo(null);
    setWsLive('');
    setElapsed(0);
    setError('');
    setNotice('');
    setStatus('idle');
  }, [releaseAll]);


  // ---------------------------------------------------------------- Solo Whisper (archivo)

  const transcribeFile = useCallback(
    async (file) => {
      setError('');
      setNotice('');
      if (!file) return;
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        setError(`El archivo supera el máximo de ${MAX_FILE_MB} MB.`);
        return;
      }
      if (!script.trim()) {
        setError('Escribe o pega un guion de referencia antes de transcribir un archivo.');
        return;
      }

      // Speech API solo escucha el micrófono: con un archivo no se puede usar (y no se
      // simula). Se avisa y se ejecutan los motores Whisper que se hayan elegido.
      const requested = targetIdsFor(engineId).map(getEngine).filter(Boolean);
      const fileEngines = requested.filter(supportsFileInput);
      if (fileEngines.length !== requested.length) {
        setNotice(
          'Speech API no puede transcribir un archivo (solo escucha el micrófono en vivo): se omite en esta prueba.',
        );
      }
      if (!fileEngines.length) {
        setEngineResults([]);
        setError('Elige Whisper Base o Whisper Small para transcribir un archivo.');
        return;
      }

      setFileBusy(true);
      setEngineResults(fileEngines.map((engine) => idleResult(engine, 'pendiente')));
      try {
        const measured = await measureAudioDuration(file);
        const audio = {
          durationSeconds: measured != null ? Number(measured.toFixed(2)) : null,
          durationMeasured: measured != null,
          sizeBytes: file.size,
          mimeType: file.type || 'desconocido',
          origen: 'archivo',
          nombre: file.name,
        };
        setAudioInfo(audio);

        const results = await runEnginesSequentially(
          fileEngines.map((engine) => engine.id),
          async (engine) => finishFor(engine, await sendToWhisper(file, engine.modelKey)),
          {
            onResult: (result) =>
              setEngineResults((previous) =>
                previous.map((item) => (item.engineId === result.engineId ? result : item)),
              ),
          },
        );

        const warnings = results
          .filter((result) => result.status === 'error')
          .map((result) => `${result.engineShort}: ${result.error}`);
        const anyOk = results.some((result) => result.status === 'ok');
        persistRun(
          buildRunRecord({
            reference: script,
            engines: enginesRecord(results),
            audio,
            whisperConfig: health?.service?.config || {},
            warnings,
            status: anyOk ? 'ok' : 'parcial',
            notes: `Prueba con archivo cargado (${results.map((r) => r.engineShort).join(', ')})`,
          }),
        );
        setStatus('done');
      } finally {
        setFileBusy(false);
      }
    },
    [script, engineId, finishFor, sendToWhisper, health, persistRun],
  );

  // ---------------------------------------------------------------- Exportación e historial

  const exportJSON = useCallback(() => {
    download(`voxready-lab-transcripcion-${Date.now()}.json`, toJSON(runs), 'application/json');
  }, [runs]);

  const exportCSV = useCallback(() => {
    download(`voxready-lab-transcripcion-${Date.now()}.csv`, toCSV(runs), 'text/csv;charset=utf-8');
  }, [runs]);

  const lastRun = runs[0] || null;

  // Diferencias entre las dos primeras transcripciones disponibles de la última prueba
  // (para inspección). Funciona igual con dos motores o con los tres.
  const diffOps = useMemo(() => {
    const texts = ['webspeech', 'whisper', 'whisper_small']
      .map((key) => lastRun?.engines?.[key]?.text)
      .filter((text) => Boolean(text));
    if (texts.length < 2) return [];
    return compareWithReference(texts[0], texts[1], { options }).word.ops.slice(0, 400);
  }, [lastRun, options]);


  // ---------------------------------------------------------------- Vista

  const serviceReady = Boolean(health?.available && health?.service?.model_loaded);
  const serviceUp = Boolean(health?.available);
  const forbidden = Boolean(health?.forbidden);
  const recording = status === 'recording';
  const busy = status === 'processing' || fileBusy;

  // Motor(es) elegido(s) y resumen de la última comparación.
  const selectedEngine = getEngine(engineId);
  const comparisonSummary = useMemo(() => summarizeComparison(engineResults), [engineResults]);

  // Estado de los modelos locales según /health: se informan base y small por separado.
  const modelStatus = useMemo(() => {
    const models = health?.service?.models;
    if (!models) return null;
    return Object.values(models)
      .map((model) => {
        const state = model.loaded ? 'cargado' : model.load_error ? `error (${model.load_error})` : 'sin cargar';
        const i = model.inference || {};
        // Se muestra la decodificación efectiva de cada modelo (idioma, beam y si usa
        // contexto): permite comprobar de un vistazo que Base y Small no se mezclan.
        const decode = i.beam_size != null ? `${i.language || 'es'} · beam ${i.beam_size}${i.initial_prompt_chars ? ' · contexto' : ''}` : '';
        return `${model.key ?? model.model}: ${state}${decode ? ` (${decode})` : ''}`;
      })
      .join(' · ');
  }, [health]);

  return (
    <>
      {/* Aislamiento respecto de la evaluación oficial */}
      <Card className="mb-6 border-warning/30 bg-warning/[0.04]">
        <div className="flex items-start gap-3">
          <span className="h-9 w-9 rounded-xl bg-warning/10 text-warning flex items-center justify-center shrink-0">
            <Icon name="flask" size={17} />
          </span>
          <div className="text-[13px] leading-relaxed text-muted">
            <p className="font-medium text-ink">Herramienta experimental: no afecta la evaluación de ningún vocero</p>
            <p className="mt-1">
              Esta página no crea sesiones, no escribe en el historial de prácticas, no toca informes ni rúbricas y no
              modifica notas. El audio vive solo en la memoria del navegador durante la prueba y no se guarda en el
              servidor.
            </p>
          </div>
        </div>
      </Card>

      {/* Estado del servicio */}
      <Card className="mb-6">
        <CardHeader
          title="Servicio de transcripción (Whisper local)"
          description="Servicio independiente (FastAPI + faster-whisper). El backend lo consulta en la dirección configurada con WHISPER_URL."
          action={
            <Button variant="secondary" size="sm" icon="refresh" onClick={() => checkHealth()} disabled={checkingHealth}>
              {checkingHealth ? 'Comprobando…' : 'Comprobar'}
            </Button>
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={serviceReady ? 'success' : serviceUp ? 'warning' : 'danger'}>
            {serviceReady ? 'modelo cargado' : serviceUp ? 'servicio sin modelo' : 'no disponible'}
          </Badge>
          {forbidden && <Badge tone="danger">sin permiso para este rol</Badge>}
          {health?.ms != null && <span className="text-xs text-faint tabular-nums">{health.ms} ms</span>}
          {health?.service?.config && (
            <span className="text-xs text-muted font-mono">
              {health.service.config.model} · {health.service.config.device}/{health.service.config.compute_type} ·{' '}
              {health.service.config.language}
            </span>
          )}
        </div>
        {!serviceUp && health?.detail && (
          <p className="text-xs text-muted mt-3 flex items-start gap-1.5">
            <Icon name="info" size={13} className="mt-0.5 shrink-0" />
            <span>{health.detail}</span>
          </p>
        )}
        {health?.service?.load_error && (
          <p className="text-xs text-danger mt-2">El modelo no se pudo cargar ({health.service.load_error}).</p>
        )}
        {!speechRecognitionSupported && (
          <p className="text-xs text-muted mt-3 flex items-start gap-1.5">
            <Icon name="info" size={13} className="mt-0.5 shrink-0" />
            <span>
              Este navegador no implementa Web Speech API: podrás probar Whisper, pero no comparar con el motor del
              navegador.
            </span>
          </p>
        )}
      </Card>

      {/* 1. Guion */}
      <Card className="mb-6">
        <CardHeader
          title="1. Guion de referencia"
          description="Pega el texto que vas a leer. Se usa para calcular WER, sustituciones, omisiones e inserciones."
          action={
            <Button variant="ghost" size="sm" onClick={() => setScript(EXAMPLE_SCRIPT)}>
              Usar guion de ejemplo
            </Button>
          }
        />
        <textarea
          className="textarea min-h-[140px]"
          value={script}
          onChange={(event) => setScript(event.target.value)}
          placeholder="Escribe o pega aquí el guion que leerás en voz alta…"
        />
        <p className="text-xs text-faint mt-2">
          El guion de ejemplo es ficticio: no corresponde a ninguna organización real ni contiene datos personales.
        </p>
        <div className="mt-4 space-y-2">
          <Checkbox checked={options.lowercase} onChange={(value) => setOptions((o) => ({ ...o, lowercase: value }))}>
            Ignorar mayúsculas/minúsculas al calcular
          </Checkbox>
          <Checkbox
            checked={options.stripPunctuation}
            onChange={(value) => setOptions((o) => ({ ...o, stripPunctuation: value }))}
          >
            Ignorar puntuación al calcular
          </Checkbox>
          <Checkbox checked={options.stripAccents} onChange={(value) => setOptions((o) => ({ ...o, stripAccents: value }))}>
            Ignorar acentos al calcular
          </Checkbox>
        </div>
        <p className="text-xs text-muted mt-2">
          La normalización solo se usa para calcular: las transcripciones se muestran siempre tal cual, con sus
          muletillas y repeticiones.
        </p>
      </Card>


      {/* 2. Prueba con micrófono */}
      <Card className="mb-6">
        <CardHeader
          title="2. Prueba con micrófono (el mismo audio para todos los motores)"
          description="Lee el guion en voz alta: Speech API transcribe en vivo mientras se graba ese mismo audio para enviarlo después a los modelos Whisper locales."
        />

        {/* Selector de motor: uno de los tres, o la comparación de los tres en serie */}
        <div className="rounded-xl border border-line bg-subtle/40 px-4 py-3 mb-4">
          <div className="text-[11px] uppercase tracking-wide text-muted mb-2">Motor de transcripción</div>
          <div className="flex flex-wrap gap-2">
            {ENGINES.map((engine) => (
              <Button
                key={engine.id}
                size="sm"
                variant={engineId === engine.id ? 'accent' : 'secondary'}
                onClick={() => setEngineId(engine.id)}
                disabled={busy || recording}
              >
                {engine.short}
              </Button>
            ))}
            <Button
              size="sm"
              variant={engineId === COMPARE_ALL_ID ? 'accent' : 'secondary'}
              onClick={() => setEngineId(COMPARE_ALL_ID)}
              disabled={busy || recording}
            >
              Comparar los {comparisonIds().length}
            </Button>
          </div>
          <p className="text-xs text-muted mt-2">{describeSelection(engineId)}</p>
          {selectedEngine?.remote && (
            <p className="text-xs text-warning mt-1 flex items-start gap-1.5">
              <Icon name="info" size={13} className="mt-0.5 shrink-0" />
              <span>
                Speech API usa el servicio de voz del fabricante del navegador: el audio sale del equipo. Whisper Base
                y Whisper Small se ejecutan localmente en el servicio del laboratorio.
              </span>
            </p>
          )}
          {modelStatus && <p className="text-xs text-muted mt-1 font-mono">{modelStatus}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!recording && status !== 'processing' && (
            <Button variant="accent" icon="mic" onClick={startTest} disabled={busy || forbidden}>
              {status === 'done' ? 'Repetir prueba' : 'Iniciar prueba'}
            </Button>
          )}
          {recording && (
            <>
              <Button variant="accent" icon="check" onClick={finishTest}>
                Finalizar y comparar
              </Button>
              <Button variant="secondary" icon="trash" onClick={discardTest}>
                Descartar audio
              </Button>
            </>
          )}
          {status === 'processing' && <Button variant="secondary" disabled>Cargando…</Button>}
          {(status === 'done' || status === 'idle') && hasAudio && (
            <Button variant="ghost" icon="trash" onClick={discardTest}>
              Descartar audio
            </Button>
          )}
        </div>

        {recording && (
          <div className="mt-4 rounded-xl border border-danger/25 bg-danger/[0.04] px-4 py-3">
            <div className="flex items-center gap-2 text-[13px] text-ink">
              <span className="h-2 w-2 rounded-full bg-danger animate-pulse" />
              Grabando · <span className="tabular-nums">{elapsed.toFixed(1)} s</span>
              <span className="text-muted">· el micrófono se libera al finalizar o descartar</span>
            </div>
            <div className="mt-3 text-[13px] leading-relaxed text-muted min-h-[48px] whitespace-pre-wrap break-words">
              {wsLive || (speechRecognitionSupported ? 'Esperando voz…' : 'Sin Web Speech API en este navegador.')}
            </div>
          </div>
        )}

        {audioInfo && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-xs text-muted">
            <span>Duración: <b className="text-ink tabular-nums">{formatSeconds(audioInfo.durationSeconds)}</b>{audioInfo.durationMeasured === false ? ' (aproximada)' : ''}</span>
            <span>Tamaño: <b className="text-ink tabular-nums">{formatBytes(audioInfo.sizeBytes)}</b></span>
            <span>Formato: <b className="text-ink font-mono">{audioInfo.mimeType}</b></span>
            {audioInfo.sampleRate != null && <span>Muestreo: <b className="text-ink tabular-nums">{audioInfo.sampleRate} Hz</b></span>}
            {audioInfo.channels != null && <span>Canales: <b className="text-ink tabular-nums">{audioInfo.channels}</b></span>}
          </div>
        )}

        {notice && (
          <p className="text-xs text-warning mt-3 flex items-start gap-1.5">
            <Icon name="info" size={13} className="mt-0.5 shrink-0" />
            <span>{notice}</span>
          </p>
        )}
        {error && (
          <p className="text-xs text-danger mt-3 flex items-start gap-1.5">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </Card>

      {/* 3. Resultados */}
      {engineResults.length > 0 && (
        <>
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold text-ink">3. Resultados de la última prueba</h2>
            <p className="text-[13px] text-muted mt-0.5">
              Cada motor se compara por separado con el mismo guion de referencia. Un WER más bajo indica menos errores
              de edición, no necesariamente una transcripción mejor en todo sentido.
            </p>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <Badge tone="neutral">{comparisonSummary.total} motor(es)</Badge>
            <span>
              Correctos: <b className="text-ink tabular-nums">{comparisonSummary.ok}</b>
            </span>
            <span>
              Con error: <b className="text-ink tabular-nums">{comparisonSummary.failed}</b>
            </span>
            {comparisonSummary.fastest && (
              <span>
                Más rápido: <b className="text-ink">{comparisonSummary.fastest.engineShort}</b> (
                {formatMs(comparisonSummary.fastest.processingMs)})
              </span>
            )}
            {comparisonSummary.bestWer && (
              <span>
                Menor WER: <b className="text-ink">{comparisonSummary.bestWer.engineShort}</b> (
                {formatPercent(comparisonSummary.bestWer.wer)})
              </span>
            )}
            {!comparisonSummary.metricsAvailable && (
              <span className="text-warning">Sin guion de referencia: no se puede calcular WER ni CER</span>
            )}
          </div>
          <p className="text-xs text-faint mb-4">{comparisonSummary.note}</p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {engineResults.map((result) => (
              <EnginePanel
                key={result.engineId}
                title={result.engineLabel}
                icon={getEngine(result.engineId)?.icon || 'server'}
                subtitle={
                  result.local
                    ? 'Cómputo local en el servicio del laboratorio: el audio no sale del equipo.'
                    : 'Servicio del fabricante del navegador: el audio sale del equipo.'
                }
                result={result}
                accent={getEngine(result.engineId)?.accent}
              />
            ))}
          </div>
        </>
      )}

      {/* 4. Solo Whisper con archivo */}
      <Card className="mb-6">
        <CardHeader
          title="4. Probar con un archivo"
          description={`Sube un audio (WebM, WAV, MP3, OGG, M4A o FLAC; máximo ${MAX_FILE_MB} MB) y se transcribirá con el motor Whisper elegido arriba (Base, Small o los dos).`}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/webm"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            transcribeFile(file);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon="file" onClick={() => fileInputRef.current?.click()} disabled={busy || forbidden}>
            {fileBusy ? 'Transcribiendo…' : 'Elegir archivo de audio'}
          </Button>
        </div>
        <p className="text-xs text-muted mt-3">
          Speech API no puede transcribir archivos: solo escucha el micrófono. Por eso esta prueba usa únicamente los
          motores Whisper y no se simula un comportamiento que la API no ofrece.
        </p>
      </Card>


      {/* 5. Diferencias entre las dos transcripciones */}
      {diffOps.length > 0 && (
        <Card className="mb-6">
          <CardHeader
            title="5. Diferencias entre transcripciones"
            description="Comparación palabra por palabra de dos de las transcripciones de la última prueba, para ver dónde se separan los motores."
            action={
              <Button variant="ghost" size="sm" onClick={() => setShowDiff((v) => !v)}>
                {showDiff ? 'Ocultar' : 'Ver diferencias'}
              </Button>
            }
          />
          {showDiff && (
            <p className="text-[13px] leading-relaxed">
              {diffOps.map((op, index) => {
                if (op.type === 'equal') {
                  return (
                    <span key={index} className="text-muted">
                      {op.ref}{' '}
                    </span>
                  );
                }
                if (op.type === 'substitute') {
                  return (
                    <span key={index} className="mr-1">
                      <span className="text-danger line-through">{op.ref}</span>{' '}
                      <span className="text-warning font-medium">{op.hyp}</span>
                    </span>
                  );
                }
                if (op.type === 'delete') {
                  return (
                    <span key={index} className="text-danger line-through mr-1">
                      {op.ref}{' '}
                    </span>
                  );
                }
                return (
                  <span key={index} className="text-success font-medium mr-1">
                    +{op.hyp}{' '}
                  </span>
                );
              })}
            </p>
          )}
        </Card>
      )}

      {/* 6. Historial y exportación */}
      <Card className="mb-6">
        <CardHeader
          title="6. Historial de pruebas"
          description={`${runs.length} ejecución(es) guardadas solo en este navegador. No se guarda audio ni credenciales.`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon="download" onClick={exportJSON} disabled={!runs.length}>
                JSON
              </Button>
              <Button variant="secondary" size="sm" icon="download" onClick={exportCSV} disabled={!runs.length}>
                CSV
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                disabled={!runs.length}
                onClick={() => {
                  if (window.confirm('¿Borrar todo el historial de pruebas del laboratorio en este navegador?')) {
                    clearRuns();
                    setRuns([]);
                  }
                }}
              >
                Borrar
              </Button>
            </div>
          }
        />

        {!runs.length ? (
          <EmptyState
            icon="flask"
            title="Todavía no hay pruebas guardadas"
            description="Al finalizar una prueba se guarda un registro con el guion, las dos transcripciones, las métricas y los tiempos."
          />
        ) : (
          <ul className="divide-y divide-line">
            {runs.slice(0, 20).map((run) => {
              const ws = run.engines?.webspeech;
              const wh = run.engines?.whisper;
              const sm = run.engines?.whisper_small;
              const md = run.engines?.whisper_medium;
              return (
                <li key={run.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <span className="text-muted tabular-nums">{new Date(run.createdAt).toLocaleString('es-CL')}</span>
                  <Badge tone={run.status === 'ok' ? 'success' : 'warning'}>{run.status}</Badge>
                  <span className="text-muted">
                    WER Web Speech: <b className="text-ink tabular-nums">{ws ? formatPercent(ws.wer) : 'no medido'}</b>
                  </span>
                  <span className="text-muted">
                    WER Whisper: <b className="text-ink tabular-nums">{wh ? formatPercent(wh.wer) : 'no medido'}</b>
                  </span>
                  {sm && (
                    <span className="text-muted">
                      WER Whisper Small: <b className="text-ink tabular-nums">{formatPercent(sm.wer)}</b>
                    </span>
                  )}
                  {md && (
                    <span className="text-muted">
                      WER Whisper Medium: <b className="text-ink tabular-nums">{formatPercent(md.wer)}</b>
                    </span>
                  )}
                  <span className="text-muted">
                    Audio: <b className="text-ink tabular-nums">{formatSeconds(run.audio?.durationSeconds)}</b>
                  </span>
                  {run.warnings?.length > 0 && <span className="text-faint">{run.warnings.join(' · ')}</span>}
                  <span className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setScript(run.reference)}>
                      Usar guion
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRuns(removeRun(run.id))}
                      title="Borrar registro"
                    >
                      <Icon name="trash" size={15} />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>


      {/* Nota metodológica */}
      <Card className="bg-subtle/40">
        <CardHeader title="Cómo interpretar los resultados" />
        <ul className="text-[13px] text-muted leading-relaxed space-y-2 list-disc pl-5">
          <li>
            El <b className="text-ink">WER</b> (Word Error Rate) es (sustituciones + omisiones + inserciones) dividido
            por las palabras del guion. Un valor más bajo indica menos errores de edición.
          </li>
          <li>
            El WER <b className="text-ink">puede superar el 100 %</b> si el motor inserta más palabras de las que tiene
            el guion.
          </li>
          <li>
            Un WER bajo <b className="text-ink">no demuestra</b> que una transcripción sea mejor en todos los aspectos:
            puede perder matices (muletillas, repeticiones) que importan para evaluar a un vocero.
          </li>
          <li>
            Los <b className="text-ink">tiempos no son directamente comparables</b>: Web Speech API incluye la red del
            fabricante y la detección de fin de habla; Whisper es cómputo local (el RTF indica cuántas veces el tiempo
            de proceso cabe en la duración del audio).
          </li>
          <li>
            Las transcripciones comparadas provienen de la <b className="text-ink">misma intervención hablada</b>, pero
            cada motor segmenta y procesa a su manera: la comparación es de contenido, no de algoritmo interno.
          </li>
          <li>
            <b className="text-ink">Whisper Base y Whisper Small se ejecutan localmente</b> (el audio no sale del
            equipo). <b className="text-ink">Speech API</b> usa el servicio del fabricante del navegador: con ese motor
            el audio sí sale del equipo.
          </li>
          <li>
            El <b className="text-ink">tiempo de carga del modelo</b> se informa aparte del tiempo de transcripción: la
            primera vez que se usa Whisper Small el servicio carga el modelo (y puede descargarlo) y eso no es tiempo
            de inferencia.
          </li>
          <li>
            El <b className="text-ink">texto literal se conserva</b> tal como lo devolvió cada motor: la normalización
            (mayúsculas, puntuación, acentos) solo afecta al cálculo.
          </li>
        </ul>
      </Card>
    </>
  );
}

