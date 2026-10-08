import { useCallback, useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { API_URL, DEMO_MODE, getToken } from '../lib/api';
import Icon from '../components/Icon';
import { Badge, Button, Card, PageHeader, cx } from '../components/ui';
import { useRive } from '@rive-app/react-canvas';
import { isNaturalVoice, speak, useInterviewerVoice, voiceLabel } from '../lib/voice';

// Endpoints de prueba disponibles en backend/index.js
const ENDPOINTS = [
  {
    id: 'health',
    title: 'Estado de la API',
    description: 'Comprueba que el servidor Express esté encendido.',
    path: '/api/health',
    icon: 'server',
  },
  {
    id: 'db',
    title: 'Conexión a PostgreSQL',
    description: 'Ejecuta SELECT NOW() a través de Prisma.',
    path: '/api/db-test',
    icon: 'database',
  },
  {
    id: 'scenarios',
    title: 'Escenarios del vocero demo',
    description: 'Lee las asignaciones pendientes de vocero@demo.com (datos del seed).',
    path: '/api/scenarios/my?email=vocero@demo.com',
    icon: 'layers',
  },
];

async function runCheck(path) {
  const start = performance.now();
  try {
    const res = await fetch(`${API_URL}${path}`);
    const body = await res.json().catch(() => null);
    return { state: res.ok ? 'ok' : 'error', status: res.status, ms: Math.round(performance.now() - start), body };
  } catch (err) {
    return { state: 'offline', status: null, ms: Math.round(performance.now() - start), body: { error: err.message } };
  }
}

const STATE_UI = {
  idle: { tone: 'neutral', label: 'Sin ejecutar' },
  loading: { tone: 'neutral', label: 'Consultando…' },
  ok: { tone: 'success', label: 'Operativo' },
  error: { tone: 'danger', label: 'Error' },
  offline: { tone: 'danger', label: 'Sin conexión' },
};

function EndpointCard({ endpoint, result, onRun }) {
  const [open, setOpen] = useState(false);
  const state = result?.state || 'idle';
  const ui = STATE_UI[state];

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <span
          className={cx(
            'h-10 w-10 rounded-xl flex items-center justify-center shrink-0',
            state === 'ok' ? 'bg-success/10 text-success' : state === 'error' || state === 'offline' ? 'bg-danger/10 text-danger' : 'bg-subtle text-muted',
          )}
        >
          <Icon name={endpoint.icon} size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink">{endpoint.title}</h3>
            <Badge tone={ui.tone}>
              {state === 'loading' && <span className="h-3 w-3 rounded-full border-2 border-line border-t-muted animate-spin" />}
              {ui.label}
            </Badge>
          </div>
          <p className="text-[13px] text-muted mt-1">{endpoint.description}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-faint font-mono">
            <span>
              <span className="text-success">GET</span> {endpoint.path}
            </span>
            {result?.status && <span>HTTP {result.status}</span>}
            {result?.ms != null && state !== 'loading' && <span>{result.ms} ms</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {result?.body && (
            <Button variant="ghost" size="icon" onClick={() => setOpen((v) => !v)} title="Ver respuesta">
              <Icon name="chevronDown" size={16} className={cx('transition-transform', open && 'rotate-180')} />
            </Button>
          )}
          <Button variant="secondary" size="sm" icon="refresh" onClick={onRun} disabled={state === 'loading'}>
            Probar
          </Button>
        </div>
      </div>
      {open && result?.body && (
        <pre className="border-t border-line bg-subtle/50 px-5 py-4 text-xs font-mono text-muted overflow-x-auto max-h-72">
          {JSON.stringify(result.body, null, 2)}
        </pre>
      )}
    </Card>
  );
}

export default function Laboratorio() {
  const [results, setResults] = useState({});

  const run = useCallback(async (endpoint) => {
    setResults((r) => ({ ...r, [endpoint.id]: { ...r[endpoint.id], state: 'loading' } }));
    const result = await runCheck(endpoint.path);
    setResults((r) => ({ ...r, [endpoint.id]: result }));
  }, []);

  const runAll = useCallback(() => ENDPOINTS.forEach(run), [run]);

  useEffect(() => {
    runAll();
  }, [runAll]);

  const okCount = ENDPOINTS.filter((e) => results[e.id]?.state === 'ok').length;
  const anyOffline = ENDPOINTS.some((e) => results[e.id]?.state === 'offline');

    // RIVE
    const { RiveComponent } = useRive({
      src: 'https://cdn.rive.app/animations/vehicles.riv',
      autoplay: true,
    });
    const [question, setQuestion] = useState(
      '¿Cómo respondería ante una situación de crisis que afecte la reputación de su organización?'
    );
    const [answer, setAnswer] = useState('');
    const [history, setHistory] = useState([]);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiInfo, setAiInfo] = useState(null);

    const [isSpeaking, setIsSpeaking] = useState(false);
    const speechRef = useRef(null);
    // Usa la voz más natural disponible (o la que el usuario elija)
    const { voices, voice, setVoiceURI } = useInterviewerVoice();
    const speakQuestion = (text = question) => {
      speechRef.current = speak(text, voice, {
        onStart: () => setIsSpeaking(true),
        onEnd: () => setIsSpeaking(false),
      });
    };

    // Pide al entrevistador IA (backend → API de NVIDIA) la siguiente pregunta.
    // Si escribiste una respuesta, la IA genera una repregunta sobre ella.
    const askAI = async () => {
      const nextHistory = history.length
        ? [...history, { role: 'vocero', text: answer }]
        : [];

      try {
        setAiLoading(true);
        setAiInfo(null);
        // El endpoint exige sesión iniciada (sin sessionId usa un escenario genérico de prueba)
        const res = await fetch(`${API_URL}/api/interviewer/next-question`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
          body: JSON.stringify({ history: nextHistory }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.mensaje || 'La IA no respondió');

        setQuestion(data.question);
        setHistory([...nextHistory, { role: 'interviewer', text: data.question }]);
        setAnswer('');
        setAiInfo({ ok: true, text: `${data.model} · ${data.ms} ms` });
        speakQuestion(data.question);
      } catch (error) {
        setAiInfo({ ok: false, text: error.message === 'Failed to fetch' ? 'No se pudo contactar al backend' : error.message });
      } finally {
        setAiLoading(false);
      }
    };

    const resetInterview = () => {
      window.speechSynthesis.cancel();
      setHistory([]);
      setAnswer('');
      setAiInfo(null);
    };
    useEffect(() => {
      return () => {
        window.speechSynthesis.cancel();
      };
    }, []);
    // RIVE

  return (
    <>
      <PageHeader
        eyebrow="Herramientas de desarrollo"
        title="Laboratorio"
        description="Pruebas técnicas del equipo: conexión con el backend y la base de datos, y análisis de pose con MediaPipe."
        actions={
          <Button variant="secondary" icon="refresh" onClick={runAll}>
            Probar todo
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
        {/* Backend */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Backend</h2>
              <p className="text-[13px] text-muted mt-0.5 font-mono">{DEMO_MODE ? 'Servidor de demostración (en el navegador)' : API_URL}</p>
            </div>
            <Badge tone={okCount === ENDPOINTS.length ? 'success' : okCount > 0 ? 'warning' : 'neutral'}>
              {okCount}/{ENDPOINTS.length} operativos
            </Badge>
          </div>

          <div className="space-y-3">
            {ENDPOINTS.map((e) => (
              <EndpointCard key={e.id} endpoint={e} result={results[e.id]} onRun={() => run(e)} />
            ))}
          </div>

          {anyOffline && (
            <div className="mt-4 rounded-xl border border-warning/30 bg-warning/5 p-4 text-[13px] text-muted leading-relaxed">
              <div className="flex items-center gap-2 font-medium text-ink mb-1">
                <Icon name="alert" size={15} className="text-warning" />
                No se pudo contactar al backend
              </div>
              Levántalo con <code className="font-mono text-xs bg-subtle px-1.5 py-0.5 rounded">cd backend && node index.js</code> y
              verifica que PostgreSQL esté corriendo.
            </div>
          )}
        </section>

        {/* Visión por computador */}
        <section>
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold text-ink">Visión por computador</h2>
            <p className="text-[13px] text-muted mt-0.5">Análisis corporal en el navegador</p>
          </div>

          <Link to="/mediapipe-test" className="group block">
            <Card className="p-0 overflow-hidden hover:shadow-lift hover:border-line-strong transition-all">
              <div className="relative aspect-[16/10] bg-gradient-to-br from-[#16263A] to-[#0B1118] flex items-center justify-center">
                {/* Esqueleto ilustrativo */}
                <svg viewBox="0 0 100 120" className="h-32 opacity-80">
                  <g stroke="#F08046" strokeWidth="1.6" strokeLinecap="round" fill="none">
                    <path d="M50 30v35M35 38h30M35 38l-8 18M65 38l8 18M42 65h16M42 65l-4 30M58 65l4 30" />
                  </g>
                  <g fill="#fff">
                    <circle cx="50" cy="20" r="7" fill="none" stroke="#fff" strokeWidth="1.6" />
                    {[[35, 38], [65, 38], [27, 56], [73, 56], [42, 65], [58, 65], [38, 95], [62, 95]].map(([x, y]) => (
                      <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" />
                    ))}
                  </g>
                </svg>
                <span className="absolute top-3 left-3 rounded-full bg-white/10 backdrop-blur px-2.5 h-6 flex items-center text-[11px] text-white/80">
                  Pose Landmarker
                </span>
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[15px] font-semibold text-ink">Prueba de MediaPipe</h3>
                  <Icon name="arrowRight" size={16} className="text-faint group-hover:text-ink group-hover:translate-x-0.5 transition-all" />
                </div>
                <p className="text-[13px] text-muted mt-1.5 leading-relaxed">
                  Detecta 33 puntos corporales, calibra 30 s el ruido por zona y exporta las muestras de movimiento en JSON.
                </p>
              </div>
            </Card>
          </Link>
        </section>
        
      </div>
      {/* RIVE */}
            <section className="mt-8">
            <div className="mb-4">
              <h2 className="text-[15px] font-semibold text-ink">
                Entrevistador virtual
              </h2>

              <p className="text-[13px] text-muted mt-0.5">
                Pregunta generada por IA (API de NVIDIA) y leída por la voz del navegador.
              </p>
            </div>

            <Card className="overflow-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6">

                {/* Avatar */}
                <div className="rounded-xl bg-subtle min-h-[400px] flex flex-col items-center justify-center">
                  <div className="w-full h-[350px]">
                    <RiveComponent />
                  </div>

                  <div className="pb-4">
                    <Badge tone={isSpeaking ? 'success' : 'neutral'}>
                      {isSpeaking ? 'Hablando...' : 'Esperando'}
                    </Badge>
                  </div>
                </div>

                {/* Pregunta */}
                <div className="flex flex-col justify-center p-4 lg:p-8">

                  <div className="text-xs text-muted mb-3">
                    Pregunta del entrevistador
                  </div>

                  <div className="rounded-xl border border-line bg-subtle/50 p-5">
                    <p className="text-[17px] leading-relaxed text-ink">
                      {question}
                    </p>
                  </div>

                  {history.length > 0 && (
                    <div className="mt-4">
                      <label className="label">Tu respuesta</label>
                      <textarea
                        className="textarea min-h-[80px]"
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        placeholder="Escribe lo que respondería el vocero (vacío = silencio) y pide la siguiente pregunta."
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 mt-5">
                    <Button
                      variant="accent"
                      icon="sparkles"
                      onClick={askAI}
                      disabled={aiLoading}
                    >
                      {aiLoading ? 'Pensando…' : history.length ? 'Siguiente pregunta IA' : 'Preguntar con IA'}
                    </Button>

                    <Button
                      variant="secondary"
                      icon="refresh"
                      onClick={() => speakQuestion()}
                    >
                      Repetir pregunta
                    </Button>

                    {history.length > 0 && (
                      <Button variant="ghost" onClick={resetInterview}>
                        Reiniciar
                      </Button>
                    )}
                  </div>

                  {voices.length > 0 && (
                    <div className="mt-5 pt-5 border-t border-line">
                      <label className="label">Voz del entrevistador</label>
                      <div className="flex gap-2">
                        <select
                          className="input flex-1 min-w-0"
                          value={voice?.voiceURI || ''}
                          onChange={(e) => setVoiceURI(e.target.value)}
                        >
                          {voices.map((v) => (
                            <option key={v.voiceURI} value={v.voiceURI}>
                              {voiceLabel(v)}
                            </option>
                          ))}
                        </select>
                        <Button variant="secondary" icon="play" onClick={() => speakQuestion()} className="shrink-0">
                          Probar
                        </Button>
                      </div>
                      {voice && !isNaturalVoice(voice) && (
                        <p className="text-xs text-muted mt-2 leading-relaxed">
                          Tu navegador no tiene voces naturales en español. En Microsoft Edge aparecen voces
                          muy humanas (por ejemplo, Catalina o Lorenzo de Chile).
                        </p>
                      )}
                    </div>
                  )}

                  {aiInfo && (
                    <p className={cx('text-xs mt-3 flex items-center gap-1.5', aiInfo.ok ? 'text-faint' : 'text-danger')}>
                      <Icon name={aiInfo.ok ? 'sparkles' : 'alert'} size={13} />
                      {aiInfo.text}
                    </p>
                  )}

                </div>

              </div>
            </Card>
          </section>
      {/* RIVE */}
    </>
  );
  

  
}
