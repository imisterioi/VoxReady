import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_URL, getToken } from '../lib/api';
import Icon from '../components/Icon';
import { Badge, Button, Card, cx } from '../components/ui';
import { getEngine } from '../lib/lab/engines';
import { transcribeChunk } from '../lib/lab/whisperClient';
import { startAudioRecorder, stopAndWait } from '../lib/practice/mediaCapture';
import {
  RECORDED_ENGINE_IDS,
  appendRun,
  latestByEngine,
  runEnginesOnRecording,
  toComparisonCsv,
} from '../lib/lab/comparison';

// Grabación única reutilizable (EXPERIMENTAL).
//
// Se graba UNA vez y esa misma grabación (el mismo Blob, sin recodificar) se envía a
// Whisper Base, Small y Medium, en serie. No se vuelve a pedir el micrófono para cada
// motor y no se aplica ningún filtro distinto entre ellos.
//
// Speech API NO está aquí: usa el micrófono EN VIVO y no puede procesar un archivo.
// Su comparación en vivo sigue en el laboratorio de transcripción.

const fmtSeconds = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const total = ms / 1000;
  return total < 60 ? `${total.toFixed(1)} s` : `${Math.floor(total / 60)} min ${(total % 60).toFixed(0)} s`;
};

const fmtMs = (ms) => (ms == null || !Number.isFinite(ms) ? '—' : `${Math.round(ms)} ms`);

const downloadBlob = (name, blob) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

const engineLabel = (id) => getEngine(id)?.short || id;

export default function RecordedComparison() {
  const [phase, setPhase] = useState('idle'); // idle | recording | ready | running
  const [recorded, setRecorded] = useState(null); // { blob, url, durationMs, bytes, mime }
  const [elapsedMs, setElapsedMs] = useState(0);
  const [history, setHistory] = useState([]);
  const [runningId, setRunningId] = useState(null);
  const [selectedEngine, setSelectedEngine] = useState('whisper-small');
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [notice, setNotice] = useState(null);

  const busyRef = useRef(false);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const audioRef = useRef(null);
  const urlRef = useRef(null);

  const busy = phase === 'recording' || phase === 'running';

  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const timer = setInterval(() => setElapsedMs(performance.now() - startedAtRef.current), 200);
    return () => clearInterval(timer);
  }, [phase]);

  // Al salir de la página: micrófono, grabadora y URL del audio liberados.
  useEffect(
    () => () => {
      busyRef.current = false;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* ya estaba detenida */
      }
      streamRef.current?.getTracks?.().forEach((track) => track.stop());
      streamRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  const rows = useMemo(
    () => (showAllRuns ? [...history].reverse() : latestByEngine(history)),
    [history, showAllRuns],
  );
  const errors = history.filter((row) => row.status === 'error');
  const hasAudio = Boolean(recorded?.blob?.size);


  const startRecording = async () => {
    if (busyRef.current) return;
    if (!navigator?.mediaDevices?.getUserMedia) {
      setNotice({ tone: 'danger', text: 'Este navegador no permite grabar audio.' });
      return;
    }
    busyRef.current = true;
    setNotice(null);
    chunksRef.current = [];

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      busyRef.current = false;
      setNotice({ tone: 'danger', text: `No se pudo acceder al micrófono: ${error?.message || 'permiso denegado'}.` });
      return;
    }

    streamRef.current = stream;
    try {
      const { recorder } = startAudioRecorder({
        stream,
        onData: (data) => chunksRef.current.push(data),
        onError: (error) =>
          setNotice({ tone: 'danger', text: `La grabación se interrumpió: ${error?.message || 'error del grabador'}.` }),
      });
      recorderRef.current = recorder;
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      busyRef.current = false;
      setNotice({
        tone: 'danger',
        text: `No se pudo iniciar la grabación de audio (${error?.code || error?.message || 'error'}).`,
      });
      return;
    }

    // La grabación anterior se descarta al empezar otra: los audios no se mezclan.
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setRecorded(null);
    startedAtRef.current = performance.now();
    setElapsedMs(0);
    setPhase('recording');
  };

  const stopRecording = async () => {
    if (phase !== 'recording') return;
    const durationMs = Math.round(performance.now() - startedAtRef.current);
    const recorder = recorderRef.current;
    await stopAndWait(recorder);
    recorderRef.current = null;
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;

    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (!chunks.length) {
      busyRef.current = false;
      setPhase('idle');
      setNotice({ tone: 'danger', text: 'No se capturó audio: revisa el micrófono e inténtalo otra vez.' });
      return;
    }

    const type = chunks[0]?.type || 'audio/webm';
    const blob = new Blob(chunks, { type });
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setRecorded({ blob, url, durationMs, bytes: blob.size, mime: type, createdAt: Date.now() });
    setElapsedMs(durationMs);
    setPhase('ready');
    busyRef.current = false;
    setNotice(null);
  };

  const discardRecording = () => {
    if (busyRef.current) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setRecorded(null);
    setElapsedMs(0);
    setPhase('idle');
    setNotice(null);
  };


  // Ejecuta los motores EN SERIE sobre la MISMA grabación. Nunca dos a la vez.
  const runEngines = useCallback(
    async (engineIds) => {
      if (busyRef.current || !recorded?.blob?.size) return;
      busyRef.current = true;
      setPhase('running');
      setNotice(null);
      const runId = `${Date.now()}`;

      try {
        const result = await runEnginesOnRecording({
          engineIds,
          blob: recorded.blob,
          audioMs: recorded.durationMs,
          runId,
          transcribe: (blob, modelKey) =>
            transcribeChunk({ blob, modelKey, apiUrl: API_URL, token: getToken(), timeoutMs: 295000 }),
          onUpdate: ({ runningEngineId }) => setRunningId(runningEngineId),
        });

        setHistory((previous) => appendRun(previous, runId, result));
        const failed = result.filter((row) => row.status === 'error');
        if (failed.length) {
          setNotice({
            tone: 'warning',
            text: `${failed.length} motor(es) fallaron: ${failed.map((row) => row.engine).join(', ')}. La grabación se conserva y puedes reintentar.`,
          });
        }
      } catch (error) {
        setNotice({ tone: 'danger', text: error?.message || 'No se pudo ejecutar la comparación.' });
      } finally {
        setRunningId(null);
        busyRef.current = false;
        setPhase('ready');
      }
    },
    [recorded],
  );

  const exportJson = () => {
    const payload = {
      recordedAt: new Date().toISOString(),
      audio: recorded ? { bytes: recorded.bytes, mime: recorded.mime, durationMs: recorded.durationMs } : null,
      runs: history,
    };
    downloadBlob(
      `voxready-comparacion-${Date.now()}.json`,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    );
  };

  const exportCsv = () => {
    downloadBlob(
      `voxready-comparacion-${Date.now()}.csv`,
      new Blob([toComparisonCsv(showAllRuns ? [...history].reverse() : rows)], { type: 'text/csv;charset=utf-8' }),
    );
  };

  const statusTone = (status) => (status === 'ok' ? 'success' : status === 'error' ? 'danger' : 'neutral');


  const togglePlay = () => {
    const element = audioRef.current;
    if (!element) return;
    if (element.paused) {
      element.play().catch(() => setNotice({ tone: 'danger', text: 'El navegador no pudo reproducir esta grabación.' }));
    } else {
      element.pause();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-faint">
          <Link to="/laboratorio" className="hover:text-ink">
            Laboratorio
          </Link>{' '}
          / Grabación y comparación
        </p>
        <h1 className="text-xl font-semibold text-ink mt-1">Grabación y comparación</h1>
        <p className="text-[13px] text-muted mt-1 max-w-2xl leading-relaxed">
          Graba tu voz una sola vez y envía <strong className="text-ink">esa misma grabación</strong> a Whisper Base,
          Small y Medium, en serie. No se vuelve a pedir el micrófono y el audio no se recodifica entre motores.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">1. Graba una vez</h2>
          <Badge tone={phase === 'recording' ? 'danger' : recorded ? 'success' : 'neutral'}>
            {phase === 'recording' ? `Grabando · ${fmtSeconds(elapsedMs)}` : recorded ? 'Grabación lista' : 'Sin grabación'}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {phase !== 'recording' ? (
            <Button variant="accent" icon="mic" onClick={startRecording} disabled={busy}>
              {recorded ? 'Grabar de nuevo' : 'Grabar'}
            </Button>
          ) : (
            <Button variant="secondary" icon="pause" onClick={stopRecording}>
              Detener grabación
            </Button>
          )}
          {recorded && phase !== 'recording' && (
            <Button variant="ghost" icon="trash" onClick={discardRecording} disabled={busy}>
              Descartar audio
            </Button>
          )}
          <span className="text-xs text-faint">
            {phase === 'recording'
              ? 'Habla con calma; pulsa Detener al terminar.'
              : 'Se conserva hasta que grabes otra vez o la descartes.'}
          </span>
        </div>

        {recorded && (
          <div className="mt-4 rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-3">
              <audio ref={audioRef} src={recorded.url} controls className="w-full max-w-md" />
              <Button size="sm" variant="secondary" icon="play" onClick={togglePlay}>
                Reproducir / pausar
              </Button>
            </div>
            <p className="text-xs text-muted mt-2">
              Duración {fmtSeconds(recorded.durationMs)} · {Math.round(recorded.bytes / 1024)} KB ·{' '}
              <span className="font-mono">{recorded.mime}</span>
            </p>
            <a
              href={recorded.url}
              download={`voxready-grabacion-${recorded.createdAt}.webm`}
              className="text-xs text-muted hover:text-ink underline inline-flex items-center gap-1 mt-1"
            >
              <Icon name="download" size={12} />
              Descargar audio original
            </a>
          </div>
        )}
      </Card>


      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">2. Ejecuta los motores sobre esa grabación</h2>
          <Badge tone={runningId ? 'accent' : 'neutral'}>
            {runningId ? `Ejecutando ${engineLabel(runningId)}…` : hasAudio ? 'Listo' : 'Graba primero'}
          </Badge>
        </div>

        <div className="flex flex-wrap items-end gap-3 mt-3">
          <div>
            <span className="label">Motor</span>
            <select
              className="input min-w-[200px]"
              value={selectedEngine}
              disabled={busy || !hasAudio}
              onChange={(event) => setSelectedEngine(event.target.value)}
            >
              {RECORDED_ENGINE_IDS.map((id) => (
                <option key={id} value={id}>
                  {engineLabel(id)}
                </option>
              ))}
            </select>
          </div>
          <Button variant="secondary" icon="play" disabled={!hasAudio || busy} onClick={() => runEngines([selectedEngine])}>
            Ejecutar motor
          </Button>
          <Button
            variant="accent"
            icon="zap"
            disabled={!hasAudio || busy}
            onClick={() => runEngines(RECORDED_ENGINE_IDS)}
          >
            Comparar los 3 motores
          </Button>
          {errors.length > 0 && (
            <Button
              variant="ghost"
              icon="refresh"
              disabled={!hasAudio || busy}
              onClick={() => runEngines([...new Set(errors.map((row) => row.engineId))])}
            >
              Reintentar los que fallaron
            </Button>
          )}
        </div>

        <p className="text-[11px] text-faint mt-2 leading-relaxed">
          Los motores se ejecutan uno después de otro y reciben el mismo Blob: igual contenido, igual duración, sin
          recodificar. Si uno falla, los demás continúan.
        </p>

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

        <div className="mt-3 rounded-xl bg-subtle p-3">
          <p className="text-xs text-muted leading-relaxed">
            <strong className="text-ink">Speech API no aparece aquí.</strong> Su implementación en VoxReady escucha el
            micrófono en vivo y no puede procesar un archivo grabado. Comparar una ejecución en vivo con una
            transcripción de archivo no sería una prueba equivalente; su comparación en vivo está en{' '}
            <Link to="/laboratorio/transcripcion" className="underline hover:text-ink">
              Laboratorio de transcripción
            </Link>
            .
          </p>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-[15px] font-semibold text-ink">Resultados</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted flex items-center gap-1.5">
              <input type="checkbox" checked={showAllRuns} onChange={(event) => setShowAllRuns(event.target.checked)} />
              Ver todas las ejecuciones
            </label>
            <Button size="sm" variant="secondary" icon="download" onClick={exportJson} disabled={!history.length}>
              JSON
            </Button>
            <Button size="sm" variant="secondary" icon="download" onClick={exportCsv} disabled={!history.length}>
              CSV
            </Button>
          </div>
        </div>

        {!rows.length ? (
          <p className="text-sm text-faint">
            Todavía no hay ejecuciones. Graba, pulsa «Comparar los 3 motores» y aquí aparecerá la tabla.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-faint">
                  <th className="py-1.5 pr-3 font-medium">Motor</th>
                  <th className="py-1.5 pr-3 font-medium">Estado</th>
                  <th className="py-1.5 pr-3 font-medium">Audio</th>
                  <th className="py-1.5 pr-3 font-medium">Carga</th>
                  <th className="py-1.5 pr-3 font-medium">Procesam.</th>
                  <th className="py-1.5 pr-3 font-medium">Total</th>
                  <th className="py-1.5 pr-3 font-medium">RTF</th>
                  <th className="py-1.5 pr-3 font-medium">Texto</th>
                  <th className="py-1.5 font-medium"> </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.runId}-${row.engineId}`} className="border-t border-line align-top">
                    <td className="py-2 pr-3">
                      <span className="text-ink font-medium">{row.engine}</span>
                      <span className="block text-[11px] text-faint font-mono">{row.modelKey}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-muted tabular-nums">{fmtSeconds(row.audioMs)}</td>
                    <td className="py-2 pr-3 text-muted tabular-nums">{fmtMs(row.loadMs)}</td>
                    <td className="py-2 pr-3 text-muted tabular-nums">{fmtMs(row.processingMs)}</td>
                    <td className="py-2 pr-3 text-muted tabular-nums">{fmtMs(row.totalMs)}</td>
                    <td className="py-2 pr-3 text-muted tabular-nums">{row.rtf == null ? '—' : row.rtf.toFixed(3)}</td>
                    <td className="py-2 pr-3 max-w-[280px]">
                      {row.status === 'ok' ? (
                        <details>
                          <summary className="cursor-pointer text-muted hover:text-ink">
                            {row.text ? `${row.text.slice(0, 60)}${row.text.length > 60 ? '…' : ''}` : '(sin texto)'}
                          </summary>
                          <p className="text-ink whitespace-pre-wrap mt-1">{row.text || '(sin texto)'}</p>
                        </details>
                      ) : (
                        <span className="text-danger">{row.error}</span>
                      )}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-[11px] text-muted hover:text-ink underline disabled:opacity-40"
                        disabled={busy || !hasAudio}
                        onClick={() => runEngines([row.engineId])}
                      >
                        Reintentar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-faint mt-3 leading-relaxed">
          RTF = tiempo de procesamiento del servicio ÷ duración del audio. No se declara un motor «más preciso» por ser
          más rápido o devolver más texto: sin una transcripción de referencia validada, solo se muestran las
          diferencias de texto. Cada ejecución se conserva; activa «Ver todas las ejecuciones» para comparar dos
          pasadas del mismo motor.
        </p>
      </Card>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold text-ink">Qué se envía y qué se mide</h2>
        <ul className="text-xs text-muted mt-2 space-y-1.5 leading-relaxed list-disc pl-4">
          <li>
            Se envía el <strong className="text-ink">Blob original</strong> de la grabación (WebM/Opus del navegador),
            sin recodificar ni concatenar cabeceras: los tres motores reciben los mismos bytes.
          </li>
          <li>Duración mostrada: la medida en el navegador entre inicio y detención. El servicio informa su propia duración por ejecución.</li>
          <li>Carga del modelo y procesamiento vienen del servicio; se muestran por separado y no se suman a ciegas.</li>
          <li>Un modelo Whisper a la vez: las ejecuciones son secuenciales y la interfaz bloquea el inicio de otra mientras corre.</li>
          <li>El audio vive solo en memoria de esta página; no se guarda en la base de datos ni en el servidor.</li>
        </ul>
      </Card>
    </div>
  );
}
