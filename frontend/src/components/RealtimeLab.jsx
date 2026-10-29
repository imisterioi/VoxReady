import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_URL, apiFetch, getToken } from '../lib/api';
import Icon from '../components/Icon';
import { Badge, Button, Card, cx } from '../components/ui';
import { createChunkPipeline, latencyStats } from '../lib/lab/realtime';
import { createPcmCollector, encodeWav } from '../lib/lab/pcm';
import { REALTIME_MODELS, describeModelStatus, transcribeChunk } from '../lib/lab/whisperClient';

// Laboratorio «En tiempo real» (EXPERIMENTAL).
//
// Graba UNA sesión (cámara + micrófono) en un único WebM y, del MISMO MediaStream, toma
// muestras PCM con Web Audio y las envía a Whisper por fragmentos. El texto aparece de
// forma INCREMENTAL: faster-whisper no hace streaming nativo.
//
// No crea sesiones, no evalúa rúbricas, no genera informes y no llama a /evaluate.

const VIDEO_MIME_CANDIDATES = ['video/webm;codecs=vp8,opus', 'video/webm'];

const fmtMs = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
};

const fmtClock = (ms) => {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const initialState = () => ({
  confirmed: '',
  provisional: '',
  pending: 0,
  processed: 0,
  chunks: [],
  errors: [],
  overloaded: false,
  running: false,
});

function pickVideoMime() {
  try {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    return VIDEO_MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) || '';
  } catch {
    return '';
  }
}

function stopTracks(stream) {
  stream?.getTracks?.().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* la pista ya estaba cerrada */
    }
  });
}

export default function RealtimeLab() {
  const [health, setHealth] = useState(null);
  const [checking, setChecking] = useState(false);
  const [modelKey, setModelKey] = useState('small');
  const [chunkSeconds, setChunkSeconds] = useState(6);
  const [phase, setPhase] = useState('idle'); // idle | starting | recording | stopping | done
  const [live, setLive] = useState(initialState);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [capturedMs, setCapturedMs] = useState(0);
  const [processedMs, setProcessedMs] = useState(0);
  const [serverStats, setServerStats] = useState([]);
  const [notice, setNotice] = useState(null);
  const [final, setFinal] = useState(null);
  const [results, setResults] = useState([]);

  const activeRef = useRef(false);
  const phaseRef = useRef('idle');
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const videoChunksRef = useRef([]);
  const audioGraphRef = useRef(null);
  const collectorRef = useRef(null);
  const pipelineRef = useRef(null);
  const durationsRef = useRef([]);
  const startedAtRef = useRef(0);
  const processedRef = useRef(0);
  const serverRef = useRef([]);
  const urlsRef = useRef([]);
  const sessionRef = useRef(0);

  const setPhaseSafe = useCallback((next) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const models = useMemo(() => describeModelStatus(health), [health]);
  const selected = models.find((model) => model.key === modelKey) || models[0];
  const isSmall = modelKey === 'small';
  const busy = phase === 'starting' || phase === 'recording' || phase === 'stopping';


  const loadHealth = useCallback(async (silent = false) => {
    if (!silent) setChecking(true);
    try {
      const data = await apiFetch('/api/lab/health');
      setHealth(data);
      return data;
    } catch (error) {
      setHealth({
        available: false,
        service: null,
        detail:
          error?.status === 403
            ? 'Tu rol no tiene permiso para usar el laboratorio (solo configurador maestro y administrador del sistema).'
            : error?.message || 'No se pudo consultar el backend.',
      });
      return null;
    } finally {
      if (!silent) setChecking(false);
    }
  }, []);

  useEffect(() => {
    loadHealth(true);
  }, [loadHealth]);

  // Cronómetro y audio capturado: se leen del reloj y del colector, no se estiman.
  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const timer = setInterval(() => {
      setElapsedMs(performance.now() - startedAtRef.current);
      if (collectorRef.current) setCapturedMs(collectorRef.current.capturedMs);
    }, 250);
    return () => clearInterval(timer);
  }, [phase]);

  const stopAudioGraph = useCallback((flush) => {
    const graph = audioGraphRef.current;
    audioGraphRef.current = null;
    if (!graph) return;
    try {
      if (flush) collectorRef.current?.flush();
    } catch {
      /* el resto de audio ya no se puede recuperar */
    }
    try {
      graph.processor.onaudioprocess = null;
    } catch {
      /* ya estaba desconectado */
    }
    [graph.processor, graph.source, graph.sink].forEach((node) => {
      try {
        node?.disconnect();
      } catch {
        /* nodo ya desconectado */
      }
    });
    try {
      graph.ctx.close();
    } catch {
      /* el contexto ya estaba cerrado */
    }
    collectorRef.current = null;
  }, []);

  const stopVideoRecorder = useCallback(
    () =>
      new Promise((resolve) => {
        const recorder = videoRef.current;
        videoRef.current = null;
        if (!recorder || recorder.state === 'inactive') return resolve(null);
        recorder.onstop = () => {
          const chunks = videoChunksRef.current;
          videoChunksRef.current = [];
          if (!chunks.length) return resolve(null);
          const blob = new Blob(chunks, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          urlsRef.current.push(url);
          return resolve({ url, bytes: blob.size });
        };
        try {
          recorder.stop();
        } catch {
          resolve(null);
        }
        return undefined;
      }),
    [],
  );

  const releaseAll = useCallback(() => {
    stopAudioGraph(false);
    const recorder = videoRef.current;
    videoRef.current = null;
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* grabadora ya cerrada */
    }
    videoChunksRef.current = [];
    stopTracks(streamRef.current);
    streamRef.current = null;
    activeRef.current = false;
    pipelineRef.current = null;
    collectorRef.current = null;
  }, [stopAudioGraph]);

  useEffect(
    () => () => {
      activeRef.current = false;
      releaseAll();
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = [];
    },
    [releaseAll],
  );

  const start = async () => {
    if (activeRef.current) return; // una sola sesión a la vez
    if (!navigator?.mediaDevices?.getUserMedia) {
      setNotice({ tone: 'danger', text: 'Este navegador no permite capturar micrófono y cámara.' });
      return;
    }
    if (health && health.available === false) {
      setNotice({ tone: 'danger', text: health.detail || 'El servicio de transcripción no está disponible.' });
      return;
    }
    if (selected.state === 'missing' || selected.state === 'error') {
      setNotice({ tone: 'danger', text: `${selected.label} no está disponible en el servicio (${selected.stateLabel}).` });
      return;
    }

    activeRef.current = true;
    sessionRef.current += 1;
    // Una sesión anterior con fragmentos aún en vuelo se aborta: un solo modelo a la vez.
    try {
      pipelineRef.current?.cancel();
    } catch {
      /* la sesión anterior ya estaba cerrada */
    }
    pipelineRef.current = null;
    setPhaseSafe('starting');
    setNotice(null);
    setFinal(null);
    setLive(initialState());
    setElapsedMs(0);
    setCapturedMs(0);
    setProcessedMs(0);
    setServerStats([]);
    durationsRef.current = [];
    processedRef.current = 0;
    serverRef.current = [];

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { width: 640, height: 480 },
      });
    } catch (error) {
      activeRef.current = false;
      setPhaseSafe('idle');
      setNotice({ tone: 'danger', text: `No se pudo acceder al micrófono y la cámara: ${error?.message || 'permiso denegado'}.` });
      return;
    }

    if (!activeRef.current) {
      stopTracks(stream); // se canceló mientras se pedía el permiso
      return;
    }
    streamRef.current = stream;

    // Grabación del WebM: un ÚNICO MediaRecorder continuo sobre el stream completo.
    // No se reinicia por fragmentos: eso dejaría huecos en la grabación.
    const mime = pickVideoMime();
    try {
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (event) => {
        if (event?.data?.size) videoChunksRef.current.push(event.data);
      };
      recorder.start(1000);
      videoRef.current = recorder;
    } catch (error) {
      releaseAll();
      setPhaseSafe('idle');
      setNotice({ tone: 'danger', text: `El navegador no pudo iniciar la grabación de video: ${error?.message || 'error desconocido'}.` });
      return;
    }

    // Fragmentos de audio del MISMO stream (Web Audio), sin tocar la grabación.
    const Ctx = window.AudioContext || window.webkitAudioContext;
    let graph;
    try {
      const ctx = new Ctx();
      const audioStream = new MediaStream(stream.getAudioTracks());
      const source = ctx.createMediaStreamSource(audioStream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const sink = ctx.createGain();
      sink.gain.value = 0; // el micrófono no se reproduce por los parlantes
      processor.connect(sink);
      sink.connect(ctx.destination);
      source.connect(processor);
      graph = { ctx, source, processor, sink, audioStream };
      audioGraphRef.current = graph;
    } catch (error) {
      releaseAll();
      setPhaseSafe('idle');
      setNotice({ tone: 'danger', text: `No se pudo preparar el audio: ${error?.message || 'error desconocido'}.` });
      return;
    }

    const pipeline = createChunkPipeline({
      maxQueue: 2,
      // Sin límite fijo: el presupuesto se calcula en finish() según lo que quede en cola.
      onUpdate: (state) => setLive(state),
      transcribe: async (blob, { index, signal }) => {
        const session = sessionRef.current;
        const result = await transcribeChunk({ blob, modelKey, apiUrl: API_URL, token: getToken(), signal });
        // Una respuesta tardía de una sesión ya cerrada no se contabiliza.
        if (session !== sessionRef.current) throw new Error('Respuesta de una sesión anterior descartada.');
        if (!result.ok) throw new Error(result.error);
        serverRef.current.push({
          processingMs: result.processingMs,
          proxyMs: result.proxyMs,
          clientMs: result.clientMs,
        });
        setServerStats([...serverRef.current]);
        // Solo se cuenta como «audio procesado» el que ya tiene texto.
        processedRef.current += durationsRef.current[index] ?? 0;
        setProcessedMs(processedRef.current);
        return { text: result.text };
      },
    });
    pipelineRef.current = pipeline;

    const collector = createPcmCollector({
      sampleRate: graph.ctx.sampleRate,
      chunkSeconds,
      onChunk: ({ samples, sampleRate, durationMs }) => {
        durationsRef.current.push(durationMs);
        try {
          pipeline.push(encodeWav(samples, sampleRate), { endedAt: performance.now() });
        } catch (error) {
          setNotice({ tone: 'warning', text: `Un fragmento no se pudo codificar: ${error?.message || 'error'}.` });
        }
        setCapturedMs(collector.capturedMs);
      },
    });
    collectorRef.current = collector;
    graph.processor.onaudioprocess = (event) => {
      collector.push(event.inputBuffer.getChannelData(0));
    };

    startedAtRef.current = performance.now();
    setPhaseSafe('recording');
  };

  const finish = async () => {
    if (phaseRef.current !== 'recording') return;
    setPhaseSafe('stopping');
    const stopRequestedAt = performance.now();
    const capturedAtStop = collectorRef.current?.capturedMs ?? capturedMs;
    stopAudioGraph(true); // incluye el resto de audio que no llegó al tamaño de fragmento

    const pipeline = pipelineRef.current;
    let flush;
    try {
      // Presupuesto proporcional a lo que quede en cola. Cada fragmento pendiente puede
      // tardar hasta ~4x su audio (Medium: RTF ~1 más la carga del modelo). Tope: 4 min,
      // por debajo del timeout de 300 s del proxy, para no chocar con su 504.
      const pendingAtStop = pipeline.getState().pending;
      const perChunkMs = Math.max(15000, chunkSeconds * 4000);
      const budgetMs = Math.min(240000, Math.max(30000, (pendingAtStop + 1) * perChunkMs));
      flush = await pipeline.stop({ timeoutMs: budgetMs });
    } catch {
      flush = { complete: false, pending: 0, failed: 0, status: 'failed', tailMs: null };
    }
    const video = await stopVideoRecorder();
    stopTracks(streamRef.current);
    streamRef.current = null;
    const finishedAt = performance.now();

    const snapshot = pipeline.getState();
    const stats = pipeline.stats();
    const record = {
      id: `${Date.now()}`,
      modelKey,
      at: new Date().toISOString(),
      transcript: pipeline.text(),
      status: flush.status,
      complete: flush.complete,
      pendingChunks: flush.pending,
      failedChunks: flush.failed,
      video,
      errors: snapshot.errors,
      metrics: {
        sessionMs: Math.round(finishedAt - startedAtRef.current),
        postSessionMs: Math.round(finishedAt - stopRequestedAt),
        tailMs: flush.tailMs ?? stats.tailMs,
        capturedMs: capturedAtStop,
        processedMs: processedRef.current,
        chunks: stats.chunks,
        generated: stats.generated,
        processed: stats.processed,
        failed: stats.failed,
        pending: flush.pending,
        maxQueueDepth: stats.maxQueueDepth,
        processingMs: stats.processingMs,
        latency: stats.latency,
        audioToText: stats.audioToText,
        server: serverRef.current.slice(),
      },
    };

    setElapsedMs(record.metrics.sessionMs);
    setCapturedMs(capturedAtStop);
    setFinal(record);
    setResults((prev) => [record, ...prev]);
    activeRef.current = false;
    setPhaseSafe('done');

    if (!flush.complete) {
      const parts = [];
      if (flush.pending > 0) parts.push(`${flush.pending} fragmento(s) sin procesar`);
      if (flush.failed > 0) parts.push(`${flush.failed} fragmento(s) con error`);
      setNotice({
        tone: 'warning',
        text: `La transcripción quedó ${flush.status === 'failed' ? 'FALLIDA' : 'INCOMPLETA'}: ${parts.join(' y ')}. El WebM se conserva y los motivos están abajo.`,
      });
    }
  };

  const cancel = useCallback(() => {
    const wasActive = activeRef.current;
    activeRef.current = false;
    sessionRef.current += 1;
    try {
      pipelineRef.current?.cancel();
    } catch {
      /* el pipeline ya estaba detenido */
    }
    stopAudioGraph(false); // sin flush: se descarta el resto
    const recorder = videoRef.current;
    videoRef.current = null;
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* grabadora ya cerrada */
    }
    videoChunksRef.current = [];
    stopTracks(streamRef.current);
    streamRef.current = null;
    pipelineRef.current = null;
    collectorRef.current = null;
    setLive(initialState());
    setElapsedMs(0);
    setCapturedMs(0);
    setProcessedMs(0);
    setPhaseSafe('idle');
    setNotice(
      wasActive
        ? { tone: 'neutral', text: 'Prueba cancelada: cámara, micrófono y procesamiento detenidos. Esta prueba no se guardó.' }
        : null,
    );
  }, [setPhaseSafe, stopAudioGraph]);

  const stopEverything = () => {
    if (phaseRef.current === 'recording') finish();
    else if (phaseRef.current !== 'stopping') cancel();
  };

  const download = (name, text, type = 'application/json') => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const exportJson = (record) => {
    download(`voxready-tiempo-real-${record.modelKey}-${record.id}.json`, JSON.stringify(record, null, 2));
  };

  const latency = latencyStats(live.chunks.map((chunk) => chunk.latencyMs));
  const serverAvg = (key) => {
    const values = serverStats.map((s) => s[key]).filter((v) => Number.isFinite(v));
    if (!values.length) return null;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  };
  const captured = phase === 'recording' ? capturedMs : final?.metrics?.capturedMs ?? capturedMs;
  const processed = phase === 'recording' ? processedMs : final?.metrics?.processedMs ?? processedMs;
  const delay = Math.max(0, captured - processed);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-faint">
            <Link to="/laboratorio" className="hover:text-ink">
              Laboratorio
            </Link>{' '}
            / En tiempo real
          </p>
          <h1 className="text-xl font-semibold text-ink mt-1">En tiempo real</h1>
          <p className="text-[13px] text-muted mt-1 max-w-2xl leading-relaxed">
            Una sesión, un WebM y transcripción progresiva por fragmentos con Whisper local. El texto no es
            «streaming nativo»: cada fragmento se transcribe al terminar y el retraso se muestra en pantalla.
          </p>
        </div>
        <Button variant="secondary" icon="refresh" onClick={() => loadHealth()} disabled={checking || busy}>
          {checking ? 'Consultando…' : 'Revisar servicio'}
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Badge tone={health?.available ? 'success' : health ? 'danger' : 'neutral'}>
            {health == null ? 'Consultando servicio' : health.available ? 'Servicio disponible' : 'Servicio no disponible'}
          </Badge>
          <span className="text-xs text-muted">
            Modelo por defecto: <span className="font-mono">{health?.service?.default_model || 'no informado'}</span>
          </span>
          {health?.ms != null && <span className="text-xs text-faint font-mono">{health.ms} ms</span>}
          <span className="text-xs text-faint">Un solo modelo Whisper a la vez</span>
        </div>
        {health?.detail && <p className="text-xs text-danger mt-2 leading-relaxed">{health.detail}</p>}

        <div className="grid gap-3 sm:grid-cols-3 mt-4">
          {models.map((model) => (
            <button
              key={model.key}
              type="button"
              onClick={() => setModelKey(model.key)}
              disabled={busy}
              aria-pressed={modelKey === model.key}
              className={cx(
                'text-left rounded-xl border p-3 transition-colors disabled:opacity-60',
                modelKey === model.key ? 'border-ink bg-subtle' : 'border-line hover:border-line-strong',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{model.label}</span>
                <Badge tone={model.state === 'loaded' ? 'success' : model.state === 'error' ? 'danger' : 'neutral'}>
                  {model.stateLabel}
                </Badge>
              </div>
              <p className="text-xs text-muted mt-1 leading-relaxed">{model.description}</p>
              <p className="text-[11px] text-faint mt-2 font-mono">
                {model.device || 'dispositivo no informado'} · carga {fmtMs(model.loadMs)}
              </p>
              {model.loadError && <p className="text-[11px] text-danger mt-1 font-mono">{model.loadError}</p>}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="label">Duración del fragmento</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="input w-24"
                min={2}
                max={20}
                step={1}
                value={chunkSeconds}
                disabled={busy}
                onChange={(event) => setChunkSeconds(Math.min(20, Math.max(2, Number(event.target.value) || 6)))}
              />
              <span className="text-xs text-muted">segundos de audio por petición</span>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {phase === 'recording' && (
              <span className="font-mono text-lg text-ink tabular-nums">{fmtClock(elapsedMs)}</span>
            )}
            <Button variant="accent" icon="mic" onClick={start} disabled={busy}>
              {phase === 'starting' ? 'Preparando…' : 'Iniciar sesión'}
            </Button>
            <Button variant="secondary" icon="check" onClick={finish} disabled={phase !== 'recording'}>
              {phase === 'stopping' ? 'Procesando resto…' : 'Finalizar'}
            </Button>
            <Button variant="ghost" icon="x" onClick={stopEverything} disabled={!busy}>
              Cancelar
            </Button>
          </div>
        </div>

        <p className="text-xs text-faint mt-3 leading-relaxed">
          {phase === 'idle' && 'Listo. Al iniciar se pedirá permiso de cámara y micrófono; la grabación empieza de inmediato.'}
          {phase === 'starting' && 'Preparando cámara, micrófono y audio…'}
          {phase === 'recording' && `Grabando con ${selected.label}. El texto aparece cada ~${chunkSeconds} s.`}
          {phase === 'stopping' && 'Se detuvo la captura. Procesando los fragmentos pendientes; el tiempo depende de lo que quedara en cola…'}
          {phase === 'done' && 'Sesión terminada. El WebM y el texto quedan disponibles abajo.'}
        </p>

        {!isSmall && (
          <p className="text-xs text-muted mt-2">
            Vista simplificada de {selected.label}: la versión completa (cola, estabilidad y consolidación) está en
            Whisper Small.
          </p>
        )}
        {busy && <p className="text-xs text-faint mt-2">Hay una sesión activa: no se puede iniciar otra.</p>}
        {notice && (
          <p
            className={cx(
              'text-xs mt-2 flex items-start gap-1.5',
              notice.tone === 'danger' ? 'text-danger' : notice.tone === 'warning' ? 'text-warning' : 'text-muted',
            )}
          >
            <Icon name={notice.tone === 'danger' || notice.tone === 'warning' ? 'alert' : 'info'} size={13} />
            {notice.text}
          </p>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-[15px] font-semibold text-ink">Transcripción en vivo</h2>
          <div className="flex items-center gap-2">
            {live.overloaded && <Badge tone="danger">Retraso: cola llena</Badge>}
            {live.running && <Badge tone="neutral">Procesando</Badge>}
            <Badge tone="neutral">{live.pending} pendiente(s)</Badge>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-subtle/40 p-3 min-h-[120px]">
            <p className="text-[11px] uppercase tracking-wide text-faint mb-1">Confirmado (estable)</p>
            <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
              {live.confirmed || <span className="text-faint">Todavía sin texto confirmado.</span>}
            </p>
          </div>
          <div className="rounded-xl border border-line border-dashed p-3 min-h-[120px]">
            <p className="text-[11px] uppercase tracking-wide text-faint mb-1">Provisional (puede cambiar)</p>
            <p className="text-sm text-muted leading-relaxed whitespace-pre-wrap">
              {live.provisional || <span className="text-faint">Sin fragmento en curso.</span>}
            </p>
          </div>
        </div>

        <p className="text-[11px] text-faint mt-2 leading-relaxed">
          El último fragmento se considera provisional: si el corte cae dentro de una palabra, esa palabra puede
          cambiar. Nada se marca como definitivo solo porque terminó un fragmento.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            ['Sesión', fmtClock(phase === 'recording' ? elapsedMs : final?.metrics?.sessionMs ?? elapsedMs)],
            ['Audio capturado', fmtMs(captured)],
            ['Audio con texto', fmtMs(processed)],
            ['Retraso', fmtMs(delay)],
            ...(isSmall
              ? [
                  ['Latencia media', fmtMs(latency.avg)],
                  ['Latencia máx.', fmtMs(latency.max)],
                  ['Cola media', fmtMs(latencyStats(live.chunks.map((c) => c.queueMs)).avg)],
                  ['Cola máxima', String(live.maxQueueDepth ?? 0)],
                  ['Inferencia servidor', fmtMs(serverAvg('processingMs'))],
                  ['Procesamiento acum.', fmtMs(live.processingMs)],
                  ['Fragmentos', `${live.processed ?? 0}/${live.generated ?? 0} ok`],
                  ['Fallidos', String(live.failed ?? 0)],
                  ['Pendientes', String(live.pending)],
                  ['Estado', live.running ? 'Procesando' : phase === 'recording' ? 'En espera' : 'Detenido'],
                ]
              : [
                  ['Latencia media', fmtMs(latency.avg)],
                  ['Latencia máx.', fmtMs(latency.max)],
                  ['Fragmentos', String(live.chunks.length)],
                  ['Pendientes', String(live.pending)],
                ]),
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-subtle p-2.5">
              <p className="text-[11px] text-faint">{label}</p>
              <p className="text-sm font-medium text-ink font-mono tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-faint mt-3 leading-relaxed">
          Latencia = desde que se cierra el fragmento hasta que llega su texto (reloj monotónico del navegador). Es
          objetiva para el fragmento, pero no identifica en qué palabra empezó el retraso. «Inferencia servidor» y
          «petición completa» vienen del propio backend y se muestran por separado: no se restan relojes de equipos
          distintos.
        </p>

        {live.errors.length > 0 && (
          <ul className="mt-3 space-y-1">
            {live.errors.map((error, index) => (
              <li key={`${error.index ?? 'x'}-${index}`} className="text-xs text-danger flex items-start gap-1.5">
                <Icon name="alert" size={12} />
                {error.index != null ? `Fragmento ${error.index + 1}: ` : ''}
                {error.message}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {final && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-ink">Transcripción final</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={final.complete ? 'success' : final.status === 'failed' ? 'danger' : 'warning'}>
                {final.complete ? 'Consolidada' : final.status === 'failed' ? 'Fallida' : 'Incompleta'}
              </Badge>
              <Badge tone="neutral">{REALTIME_MODELS.find((m) => m.key === final.modelKey)?.label}</Badge>
              <Button variant="secondary" size="sm" icon="download" onClick={() => exportJson(final)}>
                Exportar JSON
              </Button>
              {final.video?.url && (
                <a
                  href={final.video.url}
                  download={`voxready-tiempo-real-${final.modelKey}-${final.id}.webm`}
                  className="text-xs text-muted hover:text-ink inline-flex items-center gap-1.5 underline"
                >
                  <Icon name="download" size={13} />
                  WebM ({Math.round(final.video.bytes / 1024)} KB)
                </a>
              )}
            </div>
          </div>

          <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap mt-3">
            {final.transcript || <span className="text-faint">No se reconoció texto en esta sesión.</span>}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {[
              ['Sesión', fmtClock(final.metrics.sessionMs)],
              ['Cierre (post-sesión)', fmtMs(final.metrics.tailMs ?? final.metrics.postSessionMs)],
              ['Audio capturado', fmtMs(final.metrics.capturedMs)],
              ['Latencia media', fmtMs(final.metrics.latency.avg)],
              ['Fragmentos', `${final.metrics.processed}/${final.metrics.generated} ok`],
              ['Fallidos', String(final.metrics.failed)],
              ['Cola máxima', String(final.metrics.maxQueueDepth)],
              ['Procesamiento acum.', fmtMs(final.metrics.processingMs)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-subtle p-2.5">
                <p className="text-[11px] text-faint">{label}</p>
                <p className="text-sm font-medium text-ink font-mono">{value}</p>
              </div>
            ))}
          </div>

          {!final.complete && (
            <p className="text-xs text-danger mt-3">
              Faltan {final.pendingChunks} fragmento(s) por procesar. El texto de arriba NO incluye ese audio; el WebM
              sí lo contiene completo.
            </p>
          )}
          {final.errors.length > 0 && (
            <p className="text-xs text-danger mt-2">
              {final.errors.length} fragmento(s) con error. El resto de la transcripción se conserva.
            </p>
          )}
        </Card>
      )}

      {results.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-[15px] font-semibold text-ink">Pruebas de esta sesión de trabajo</h2>
            <span className="text-xs text-faint">
              Se conservan al cambiar de modelo; se pierden al recargar la página.
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-faint">
                  <th className="py-1.5 pr-3 font-medium">Modelo</th>
                  <th className="py-1.5 pr-3 font-medium">Hora</th>
                  <th className="py-1.5 pr-3 font-medium">Sesión</th>
                  <th className="py-1.5 pr-3 font-medium">Audio</th>
                  <th className="py-1.5 pr-3 font-medium">Latencia media</th>
                  <th className="py-1.5 pr-3 font-medium">Estado</th>
                  <th className="py-1.5 pr-3 font-medium">Texto</th>
                  <th className="py-1.5 pr-3 font-medium">WebM</th>
                </tr>
              </thead>
              <tbody>
                {results.map((record) => (
                  <tr key={record.id} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-mono text-ink">{record.modelKey}</td>
                    <td className="py-1.5 pr-3 text-muted">{new Date(record.at).toLocaleTimeString()}</td>
                    <td className="py-1.5 pr-3 text-muted tabular-nums">{fmtClock(record.metrics.sessionMs)}</td>
                    <td className="py-1.5 pr-3 text-muted tabular-nums">{fmtMs(record.metrics.capturedMs)}</td>
                    <td className="py-1.5 pr-3 text-muted tabular-nums">{fmtMs(record.metrics.latency.avg)}</td>
                    <td className={cx('py-1.5 pr-3', record.complete ? 'text-success' : record.status === 'failed' ? 'text-danger' : 'text-warning')}>
                      {record.complete ? 'Completa' : record.status === 'failed' ? 'Fallida' : 'Incompleta'}
                    </td>
                    <td className="py-1.5 pr-3 text-muted tabular-nums">{record.transcript.length} car.</td>
                    <td className="py-1.5 pr-3">
                      {record.video?.url ? (
                        <a href={record.video.url} download={`voxready-${record.id}.webm`} className="text-muted hover:text-ink underline">
                          Descargar
                        </a>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon="download"
            className="mt-3"
            onClick={() => download('voxready-tiempo-real.json', JSON.stringify(results, null, 2))}
          >
            Exportar todas
          </Button>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold text-ink">Cómo funciona y qué no se puede medir</h2>
        <ul className="text-xs text-muted mt-2 space-y-1.5 leading-relaxed list-disc pl-4">
          <li>El WebM se graba con un único MediaRecorder continuo: no se reinicia por fragmentos y no pierde audio.</li>
          <li>
            Los fragmentos de transcripción salen del mismo MediaStream por Web Audio (PCM 16 bits mono). No se usa
            <span className="font-mono"> MediaRecorder.start(timeslice)</span> para transcribir porque sus partes no son
            decodificables por separado.
          </li>
          <li>El audio se envía a 48 kHz (frecuencia nativa del AudioContext); el servicio lo remuestrea a 16 kHz.</li>
          <li>
            La latencia se mide de fragmento a texto. El instante exacto de cada palabra no se conoce: el servidor solo
            recibe el fragmento, así que el retraso por palabra es una aproximación.
          </li>
          <li>Un solo modelo Whisper a la vez: lo garantiza el servicio (WHISPER_MAX_CONCURRENCY=1) y la interfaz, que impide dos sesiones.</li>
          <li>No se llama a /evaluate, no se generan informes y no se escribe nada en la base de datos.</li>
        </ul>
      </Card>
    </div>
  );
}
