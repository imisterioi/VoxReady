import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_URL, apiFetch, getToken } from '../lib/api';
import Icon from '../components/Icon';
import { Badge, Button, Card, cx } from '../components/ui';
import { startAudioRecorder, stopAndWait } from '../lib/practice/mediaCapture';
import { characterErrorRate, wordErrorRate } from '../lib/lab/wer';

// Laboratorio NVIDIA Build (EXPERIMENTAL).
// Reutiliza el mecanismo de grabación del laboratorio (lib/practice/mediaCapture) y los
// endpoints ya existentes: /api/lab/nvidia/catalog, /voice y /asr.
// No hay endpoint para Nemotron VoiceChat: no se inventa ni se simula una sesión.

const fmtMs = (ms) => (ms == null || !Number.isFinite(ms) ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const fmtSeconds = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const pct = (value) => `${(value * 100).toFixed(1)} %`;

export default function NvidiaLab() {
  const [voice, setVoice] = useState([]);
  const [asr, setAsr] = useState([]);
  const [keyConfigured, setKeyConfigured] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | recording | ready
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recorded, setRecorded] = useState(null);
  const [reference, setReference] = useState('');
  const [results, setResults] = useState([]);
  const [runningKey, setRunningKey] = useState(null);

  const busyRef = useRef(false);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const urlRef = useRef(null);

  const busy = phase === 'recording' || runningKey != null;

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [catalog, voiceData] = await Promise.all([
        apiFetch('/api/lab/nvidia/catalog'),
        apiFetch('/api/lab/nvidia/voice'),
      ]);
      setAsr(catalog.asr || []);
      setKeyConfigured(Boolean(catalog.keyConfigured));
      setVoice(voiceData.models || []);
    } catch (err) {
      setError(
        err?.status === 403
          ? 'Tu rol no permite usar el laboratorio (solo configurador maestro y administrador del sistema).'
          : err?.message || 'No se pudo consultar el catálogo de NVIDIA.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const timer = setInterval(() => setElapsedMs(performance.now() - startedAtRef.current), 200);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(
    () => () => {
      busyRef.current = false;
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      } catch {
        /* ya cerrada */
      }
      streamRef.current?.getTracks?.().forEach((track) => track.stop());
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const startRecording = async () => {
    if (busyRef.current) return;
    if (!navigator?.mediaDevices?.getUserMedia) {
      setError('Este navegador no permite grabar audio.');
      return;
    }
    busyRef.current = true;
    setError('');
    chunksRef.current = [];
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      busyRef.current = false;
      setError(`No se pudo acceder al micrófono: ${err?.message || 'permiso denegado'}.`);
      return;
    }
    streamRef.current = stream;
    try {
      const { recorder } = startAudioRecorder({ stream, onData: (data) => chunksRef.current.push(data) });
      recorderRef.current = recorder;
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      busyRef.current = false;
      setError(`No se pudo iniciar la grabación (${err?.code || err?.message || 'error'}).`);
      return;
    }
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
    await stopAndWait(recorderRef.current);
    recorderRef.current = null;
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (!chunks.length) {
      busyRef.current = false;
      setPhase('idle');
      setError('No se capturó audio.');
      return;
    }
    const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setRecorded({ blob, url, durationMs, bytes: blob.size, mime: blob.type, createdAt: Date.now() });
    setElapsedMs(durationMs);
    setPhase('ready');
    busyRef.current = false;
  };


  // Una llamada, un modelo. El audio es SIEMPRE el mismo Blob mientras no se regrabe.
  const callModel = useCallback(
    async (model) => {
      const started = performance.now();
      const at = new Date().toISOString();
      try {
        const response = await fetch(`${API_URL}/api/lab/nvidia/asr?model=${encodeURIComponent(model.key)}`, {
          method: 'POST',
          headers: {
            'Content-Type': recorded.blob.type || 'audio/webm',
            Authorization: `Bearer ${getToken() || ''}`,
          },
          body: recorded.blob,
        });
        const body = await response.json().catch(() => null);
        const ms = Math.round(performance.now() - started);
        if (!response.ok || !body?.ok) {
          return {
            id: `${Date.now()}-${model.key}`,
            key: model.key,
            label: model.label,
            ok: false,
            status: response.ok ? 'error' : `HTTP ${response.status}`,
            code: body?.code || `HTTP_${response.status}`,
            error: body?.message || `El backend respondió con estado ${response.status}.`,
            ms,
            at,
            audioMs: recorded.durationMs,
          };
        }
        return {
          id: `${Date.now()}-${model.key}`,
          key: model.key,
          label: model.label,
          ok: true,
          status: 'ok',
          text: body.text || '',
          ms: body.requestMs ?? ms,
          wallMs: ms,
          elapsedMs: body.elapsedMs ?? null,
          bytes: body.bytes ?? null,
          converted: Boolean(body.decoded?.converted),
          at,
          audioMs: recorded.durationMs,
          error: null,
        };
      } catch (err) {
        return {
          id: `${Date.now()}-${model.key}`,
          key: model.key,
          label: model.label,
          ok: false,
          status: 'red',
          code: 'NETWORK',
          error: `No se pudo contactar el backend (${err?.message || 'error de red'}).`,
          ms: Math.round(performance.now() - started),
          at,
          audioMs: recorded.durationMs,
        };
      }
    },
    [recorded],
  );

  // Serie estricta: nunca dos modelos a la vez; un fallo no detiene a los siguientes.
  const runModels = useCallback(
    async (models) => {
      if (busyRef.current || !recorded?.blob?.size || !models.length) return;
      busyRef.current = true;
      setError('');
      try {
        for (const model of models) {
          setRunningKey(model.key);
          const row = await callModel(model);
          setResults((previous) => [...previous, row]);
        }
      } finally {
        setRunningKey(null);
        busyRef.current = false;
      }
    },
    [callModel, recorded],
  );

  const callable = asr.filter((model) => model.callable);
  const [selectedKey, setSelectedKey] = useState('');
  const effectiveKey = callable.some((model) => model.key === selectedKey) ? selectedKey : callable[0]?.key || '';

  const exportJson = () => {
    const payload = {
      audio: recorded ? { mime: recorded.mime, bytes: recorded.bytes, durationMs: recorded.durationMs } : null,
      reference,
      results,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `voxready-nvidia-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-faint">
            <Link to="/laboratorio" className="hover:text-ink">Laboratorio</Link> / NVIDIA Build
          </p>
          <h1 className="text-xl font-semibold text-ink mt-1">NVIDIA Build (experimental)</h1>
          <p className="text-[13px] text-muted mt-1 max-w-2xl leading-relaxed">
            Modelos alojados: el audio se envía al endpoint de NVIDIA y no se ejecuta nada localmente. Los
            entrevistadores de voz y los motores de transcripción se evalúan por separado.
          </p>
        </div>
        <Button variant="secondary" icon="refresh" onClick={loadCatalog} disabled={loading || busy}>
          {loading ? 'Consultando…' : 'Revisar catálogo'}
        </Button>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
      {keyConfigured === false && (
        <p className="text-xs text-danger">Falta NVIDIA_API_KEY en el backend: las llamadas fallarán con NO_KEY.</p>
      )}

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold text-ink">A. Entrevistadores de voz</h2>
        <p className="text-xs text-muted mt-1">
          Estado real según el backend. Una demo o una ficha no equivalen a tener acceso a la API.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 mt-3">
          {voice.map((model) => (
            <div key={model.key} className="rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{model.label}</span>
                <Badge tone={model.availability === 'ready' ? 'success' : 'warning'}>
                  {model.availability === 'early_access' ? 'Acceso temprano' : model.availability}
                </Badge>
              </div>
              <p className="text-xs text-muted mt-1 leading-relaxed">{model.reason}</p>
              <p className="text-[11px] text-faint mt-2">
                Sin botón de ejecución: no hay endpoint al que enviar audio, así que no se puede probar en esta fase.
              </p>
            </div>
          ))}
          {!voice.length && !loading && <p className="text-xs text-faint">El backend no devolvió modelos de voz.</p>}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">B. Motores de transcripción</h2>
          <Badge tone={recorded ? 'success' : 'neutral'}>{recorded ? 'Grabación lista' : 'Sin grabación'}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {phase !== 'recording' ? (
            <Button variant="accent" icon="mic" onClick={startRecording} disabled={busy}>
              {recorded ? 'Grabar de nuevo' : 'Grabar'}
            </Button>
          ) : (
            <Button variant="secondary" icon="pause" onClick={stopRecording}>
              Detener · {fmtSeconds(elapsedMs)}
            </Button>
          )}
          {recorded && <audio src={recorded.url} controls className="h-9 max-w-[260px]" />}
          {recorded && (
            <a
              href={recorded.url}
              download={`voxready-nvidia-audio-${recorded.createdAt}.webm`}
              className="text-xs text-muted hover:text-ink underline inline-flex items-center gap-1"
            >
              <Icon name="download" size={12} /> audio original
            </a>
          )}
        </div>
        {recorded && (
          <p className="text-[11px] text-faint mt-1">
            {fmtSeconds(recorded.durationMs)} · {Math.round(recorded.bytes / 1024)} KB · {recorded.mime} · se reutiliza
            en todos los motores
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3 mt-4">
          <div>
            <span className="label">Modelo</span>
            <select
              className="input min-w-[240px]"
              value={effectiveKey}
              onChange={(event) => setSelectedKey(event.target.value)}
              disabled={busy || !callable.length}
            >
              {callable.map((model) => (
                <option key={model.key} value={model.key}>{model.label}</option>
              ))}
            </select>
          </div>
          <Button
            variant="secondary"
            icon="play"
            disabled={!recorded || busy || !effectiveKey}
            onClick={() => runModels(callable.filter((model) => model.key === effectiveKey))}
          >
            Probar modelo
          </Button>
          <Button
            variant="accent"
            icon="zap"
            disabled={!recorded || busy || !callable.length}
            onClick={() => runModels(callable)}
          >
            Comparar disponibles
          </Button>
          <Button variant="ghost" icon="download" disabled={!results.length} onClick={exportJson}>
            Exportar JSON
          </Button>
        </div>
        {runningKey && <p className="text-xs text-muted mt-2">Ejecutando {runningKey}… (en serie)</p>}

        <div className="mt-3">
          <span className="label">Texto de referencia (opcional, para WER/CER)</span>
          <textarea
            className="textarea min-h-[70px]"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Escribe lo que se leyó exactamente. Sin referencia no se calcula ninguna puntuación."
          />
        </div>


        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-faint">
                <th className="py-1.5 pr-3 font-medium">Modelo</th>
                <th className="py-1.5 pr-3 font-medium">Estado</th>
                <th className="py-1.5 pr-3 font-medium">Audio</th>
                <th className="py-1.5 pr-3 font-medium">Petición</th>
                <th className="py-1.5 pr-3 font-medium">WER / CER</th>
                <th className="py-1.5 pr-3 font-medium">Texto</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => {
                const wer = row.ok && reference.trim() ? wordErrorRate(reference, row.text) : null;
                const cer = row.ok && reference.trim() ? characterErrorRate(reference, row.text) : null;
                return (
                  <tr key={row.id} className="border-t border-line align-top">
                    <td className="py-2 pr-3 text-ink">{row.label}</td>
                    <td className={cx('py-2 pr-3', row.ok ? 'text-success' : 'text-danger')}>
                      {row.ok ? 'ok' : row.code || row.status}
                    </td>
                    <td className="py-2 pr-3 text-muted tabular-nums">{fmtSeconds(row.audioMs)}</td>
                    <td className="py-2 pr-3 text-muted tabular-nums">{fmtMs(row.ms)}</td>
                    <td className="py-2 pr-3 text-muted tabular-nums">{wer ? `${pct(wer.wer)} / ${pct(cer.cer)}` : '—'}</td>
                    <td className="py-2 pr-3 max-w-[320px]">
                      {row.ok ? (
                        <details>
                          <summary className="cursor-pointer text-muted hover:text-ink">
                            {row.text ? `${row.text.slice(0, 60)}${row.text.length > 60 ? '…' : ''}` : '(sin texto)'}
                          </summary>
                          <p className="text-ink whitespace-pre-wrap mt-1">{row.text || '(sin texto)'}</p>
                          {wer && (
                            <p className="text-[11px] text-faint mt-1">
                              sust. {wer.substitutions} · elim. {wer.deletions} · ins. {wer.insertions} ·{' '}
                              {wer.referenceWords} palabras de referencia
                            </p>
                          )}
                        </details>
                      ) : (
                        <span className="text-danger">{row.error}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!results.length && (
                <tr>
                  <td colSpan={6} className="py-3 text-faint">
                    Sin ejecuciones. Graba una vez y prueba los modelos disponibles.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-faint mt-3 leading-relaxed">
          Todos los motores reciben el mismo Blob (misma duración y contenido). WER y CER se calculan sólo si hay
          referencia, normalizando minúsculas, tildes, puntuación y espacios; el texto original se conserva sin
          cambios. Los modelos se ejecutan uno por uno.
        </p>
      </Card>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold text-ink">Estado del catálogo</h2>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-faint">
                <th className="py-1.5 pr-3 font-medium">Modelo</th>
                <th className="py-1.5 pr-3 font-medium">Disponibilidad</th>
                <th className="py-1.5 pr-3 font-medium">Español</th>
                <th className="py-1.5 pr-3 font-medium">Audio</th>
              </tr>
            </thead>
            <tbody>
              {asr.map((model) => (
                <tr key={model.key} className="border-t border-line">
                  <td className="py-1.5 pr-3 text-ink">{model.label}</td>
                  <td className="py-1.5 pr-3">
                    <Badge tone={model.callable ? 'success' : 'warning'}>{model.availability}</Badge>
                  </td>
                  <td className="py-1.5 pr-3 text-muted">{model.spanish}</td>
                  <td className="py-1.5 pr-3 text-muted">{model.audio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
