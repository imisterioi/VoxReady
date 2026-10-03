import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import I from '../data/dictionary';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Button, cx } from '../components/ui';
import { API_URL, apiFetch, getCurrentUser } from '../lib/api';
import { speak, useInterviewerVoice } from '../lib/voice';
import AudioMeter from '../lib/practice/audioMeter';
import PoseTracker from '../lib/practice/poseTracker';
import { analyzeText, createRecognizer, speechRecognitionSupported } from '../lib/practice/speech';

// Entrevista simulada completa:
//  1. El entrevistador IA (API de NVIDIA) formula la pregunta y la lee en voz alta.
//  2. Mientras respondes se transcribe lo que dices y se mide tu voz (micrófono)
//     y tu cuerpo (cámara + MediaPipe).
//  3. Tras cada respuesta la IA repregunta según lo que dijiste.
//  4. Al terminar se sube la grabación y se pasa al análisis con la IA evaluadora.

const TOTAL_QUESTIONS = 5;
const NO_ANSWER_MS = 12000; // sin hablar tras la pregunta → el entrevistador interviene
const END_SILENCE_MS = 6000; // silencio después de hablar → se da por terminada la respuesta
export const RESULT_KEY = 'voxready_practice_result';

function getSelectedScenario() {
  try {
    return JSON.parse(sessionStorage.getItem('voxready_escenario_seleccionado'));
  } catch {
    return null;
  }
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function SesionPractica() {
  const t = I.es.L.u4;
  const navigate = useNavigate();
  const [scenario] = useState(getSelectedScenario);
  const { voice } = useInterviewerVoice();

  // Referencias de medios y medición
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);
  const poseRef = useRef(null);
  const recognizerRef = useRef(null);
  const sessionIdRef = useRef(null);
  const timerRef = useRef(null);
  const watchdogRef = useRef(null);
  const listenStartRef = useRef(0);
  const turnsRef = useRef([]);
  const questionRef = useRef('');
  const typedRef = useRef('');
  const secondsRef = useRef(0);
  const phaseRef = useRef('loading');
  const finishingRef = useRef(false);
  const voiceRef = useRef(voice);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  // Estado visible
  const [phase, setPhaseState] = useState('loading'); // loading | speaking | listening | thinking | finishing
  const [question, setQuestion] = useState('');
  const [answerLive, setAnswerLive] = useState({ finalText: '', interim: '' });
  const [typed, setTypedState] = useState('');
  const [turnCount, setTurnCount] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [bodyStatus, setBodyStatus] = useState('loading'); // loading | ok | none | off
  const [silenceIn, setSilenceIn] = useState(null);
  const [error, setError] = useState('');
  const [mediaWarning, setMediaWarning] = useState('');
  const [textMode, setTextModeState] = useState(!speechRecognitionSupported);
  const textModeRef = useRef(!speechRecognitionSupported);

  const setPhase = (p) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  const setTextMode = (value) => {
    textModeRef.current = value;
    setTextModeState(value);
  };

  const setTyped = (value) => {
    typedRef.current = value;
    setTypedState(value);
  };

  // ------------------------------------------------------------ Medios

  const stopMediaTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const cleanup = useCallback(() => {
    clearInterval(timerRef.current);
    clearInterval(watchdogRef.current);
    window.speechSynthesis?.cancel();
    recognizerRef.current?.stop();
    audioRef.current?.destroy();
    poseRef.current?.destroy();
    stopMediaTracks();
  }, [stopMediaTracks]);

  // Crear sesión en PostgreSQL (endpoint de tu compañero)
  async function createSession() {
    if (!scenario?.id) throw new Error('Primero elige un escenario.');
    const response = await fetch(`${API_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: getCurrentUser()?.email, themeId: scenario.id }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.mensaje || 'No se pudo crear la sesión.');
    sessionIdRef.current = data.sessionId;
  }

  async function startMedia() {
    const devices = JSON.parse(sessionStorage.getItem('voxready_dispositivos') || '{}');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: devices.cameraId ? { exact: devices.cameraId } : undefined, width: 1280, height: 720 },
        audio: { deviceId: devices.microphoneId ? { exact: devices.microphoneId } : undefined, echoCancellation: true },
      });
    } catch (err) {
      // Sin cámara/micrófono: la entrevista sigue por escrito (sin medir voz ni cuerpo)
      console.warn('Sin acceso a cámara/micrófono:', err);
      setMediaWarning('No se pudo acceder a la cámara o al micrófono. Puedes continuar respondiendo por escrito; no se medirán voz ni cuerpo.');
      setTextMode(true);
      setBodyStatus('off');
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1000);
      return;
    }
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }

    // Grabación (se sube al terminar)
    const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunksRef.current.push(e.data);
    };
    recorder.start(1000);
    recorderRef.current = recorder;

    // Medición de voz y cuerpo
    audioRef.current = new AudioMeter(stream);
    const pose = new PoseTracker(videoRef.current);
    poseRef.current = pose;
    pose.load().then((ok) => {
      if (!ok) return setBodyStatus('off');
      pose.start();
    });

    timerRef.current = setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
      if (poseRef.current?.ready) setBodyStatus(poseRef.current.personNow ? 'ok' : 'none');
    }, 1000);
  }

  // ------------------------------------------------------ Entrevistador

  async function fetchQuestion() {
    const history = turnsRef.current.flatMap((turn) => [
      { role: 'interviewer', text: turn.question },
      { role: 'vocero', text: turn.answer },
    ]);
    const data = await apiFetch('/api/interviewer/next-question', {
      method: 'POST',
      body: { themeId: scenario?.id, history },
      auth: false,
    });
    return data.question;
  }

  function askQuestion(text) {
    questionRef.current = text;
    setQuestion(text);
    setAnswerLive({ finalText: '', interim: '' });
    setTyped('');
    setPhase('speaking');
    // Respaldo: algunos navegadores no avisan cuando termina la voz
    const fallback = setTimeout(() => startListening(), text.split(/\s+/).length * 450 + 3000);
    speak(text, voiceRef.current, {
      onEnd: () => {
        clearTimeout(fallback);
        startListening();
      },
    });
  }

  // ------------------------------------------------------ Escuchar respuesta

  function startListening() {
    if (finishingRef.current || phaseRef.current !== 'speaking') return;
    setPhase('listening');
    listenStartRef.current = performance.now();
    audioRef.current?.startAnswer();

    if (!textModeRef.current) {
      recognizerRef.current = createRecognizer({
        onUpdate: (live) => setAnswerLive(live),
        onError: (e) => {
          if (e === 'not-allowed') setError('El navegador bloqueó el reconocimiento de voz.');
        },
      });
      recognizerRef.current?.start();
    }

    // Control de silencios: intervención de rescate y fin de respuesta
    clearInterval(watchdogRef.current);
    watchdogRef.current = setInterval(() => {
      if (phaseRef.current !== 'listening' || !audioRef.current?.available) return;
      setMicLevel(audioRef.current.level);
      if (textModeRef.current) return; // respondiendo por escrito no hay límite de tiempo

      const now = performance.now();
      const lastVoice = audioRef.current.lastVoiceAt;
      const spoke = lastVoice > listenStartRef.current;
      const quietFor = now - (spoke ? lastVoice : listenStartRef.current);
      const remaining = (spoke ? END_SILENCE_MS : NO_ANSWER_MS) - quietFor;
      setSilenceIn(quietFor > 2500 && remaining > 0 ? Math.ceil(remaining / 1000) : null);
      if (remaining <= 0) finishAnswer();
    }, 250);
  }

  async function finishAnswer({ endInterview = false } = {}) {
    if (phaseRef.current !== 'listening') return;
    clearInterval(watchdogRef.current);
    setSilenceIn(null);
    setPhase('thinking');

    const spoken = recognizerRef.current?.stop() || '';
    const answer = (spoken || typedRef.current).trim();
    const audio = audioRef.current?.endAnswer();
    const text = analyzeText(answer);
    const minutes = (audio?.speakingMs || 0) / 60000;

    turnsRef.current.push({
      question: questionRef.current,
      answer,
      metrics: {
        words: text.words,
        fillers: text.fillers,
        fillerWords: text.fillerWords,
        wpm: minutes > 0.05 && text.words ? text.words / minutes : null,
        latencyMs: audio?.latencyMs ?? null,
        durationMs: audio?.durationMs ?? null,
        speakingMs: audio?.speakingMs ?? null,
        longPauses: audio?.longPauses ?? 0,
        volumeVariation: audio?.volumeVariation ?? null,
      },
    });
    setTurnCount(turnsRef.current.length);

    if (endInterview || turnsRef.current.length >= TOTAL_QUESTIONS) {
      finishInterview();
      return;
    }

    try {
      askQuestion(await fetchQuestion());
    } catch (err) {
      setError(`${err.message} Puedes finalizar la entrevista y analizar lo respondido.`);
    }
  }

  function repeatQuestion() {
    if (phaseRef.current !== 'listening') return;
    recognizerRef.current?.pause();
    audioRef.current?.pause();
    speak(questionRef.current, voiceRef.current, {
      onEnd: () => {
        recognizerRef.current?.resume();
        audioRef.current?.resume();
      },
    });
  }

  // ------------------------------------------------------ Finalizar

  function buildMetrics() {
    const turns = turnsRef.current;
    const sum = (key) => turns.reduce((acc, turn) => acc + (turn.metrics[key] || 0), 0);
    const speakingMin = sum('speakingMs') / 60000;
    const words = sum('words');
    const latencies = turns.map((turn) => turn.metrics.latencyMs).filter((v) => v != null);
    const variations = turns.map((turn) => turn.metrics.volumeVariation).filter((v) => v != null);
    const pose = poseRef.current?.summary() || { body: { available: false }, lighting: { average: null } };

    return {
      voice: {
        available: Boolean(audioRef.current?.available) && speakingMin > 0.05,
        wpm: speakingMin > 0 ? words / speakingMin : null,
        fillersPerMin: speakingMin > 0 ? sum('fillers') / speakingMin : null,
        fillerWords: [...new Set(turns.flatMap((turn) => turn.metrics.fillerWords))],
        longPauses: sum('longPauses'),
        longPausesPerAnswer: turns.length ? sum('longPauses') / turns.length : null,
        volumeVariation: variations.length ? variations.reduce((a, b) => a + b, 0) / variations.length : null,
        avgLatencyMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
        speakingSeconds: Math.round(speakingMin * 60),
        transcription: textModeRef.current ? 'texto' : 'voz',
      },
      body: pose.body,
      lighting: pose.lighting,
      durationSeconds: secondsRef.current,
    };
  }

  async function uploadRecording() {
    const blob = new Blob(chunksRef.current, { type: 'video/webm' });
    if (!blob.size || !sessionIdRef.current) return;
    await fetch(`${API_URL}/api/sessions/${sessionIdRef.current}/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'video/webm' },
      body: blob,
    });
  }

  async function finishInterview() {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setPhase('finishing');
    window.speechSynthesis?.cancel();

    sessionStorage.setItem(
      RESULT_KEY,
      JSON.stringify({
        sessionId: sessionIdRef.current,
        theme: scenario ? { id: scenario.id, title: scenario.title } : null,
        transcript: turnsRef.current,
        metrics: buildMetrics(),
      }),
    );

    // Detener la grabación y subirla (si falla, igual se analiza la sesión)
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
    }
    try {
      await uploadRecording();
    } catch (err) {
      console.warn('No se pudo subir la grabación:', err);
    }

    cleanup();
    navigate('/vocero/analizando');
  }

  // Terminar antes: se cierra la respuesta en curso y se analiza lo respondido
  function finishEarly() {
    if (phaseRef.current === 'listening') finishAnswer({ endInterview: true });
    else if (turnsRef.current.length) finishInterview();
  }

  async function discardSession() {
    finishingRef.current = true;
    cleanup();
    if (sessionIdRef.current) {
      try {
        await apiFetch(`/api/sessions/${sessionIdRef.current}`, { method: 'DELETE' });
      } catch (err) {
        console.warn('No se pudo eliminar la sesión:', err);
      }
    }
    navigate('/vocero/escenarios');
  }

  // ------------------------------------------------------ Inicio

  useEffect(() => {
    let cancelled = false;

    // Se difiere un instante para que el doble montaje de React (modo desarrollo) no cree dos sesiones
    const startTimer = setTimeout(async () => {
      try {
        await createSession();
        if (cancelled) return;
        await startMedia();
        if (cancelled) return;
        const first = await fetchQuestion();
        if (cancelled) return;
        askQuestion(first);
      } catch (err) {
        console.error('Error iniciando sesión:', err);
        if (!cancelled) setError(err.message || 'No se pudo iniciar la sesión.');
      }
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      cleanup();
    };
    // Se ejecuta una sola vez al entrar a la sesión
  }, []);

  // ------------------------------------------------------ Vista

  const status = {
    loading: 'Preparando la entrevista…',
    speaking: 'El entrevistador está hablando',
    listening: textMode ? 'Escribe tu respuesta y presiona “Terminé de responder”' : 'Te escucho… responde con naturalidad',
    thinking: 'El entrevistador está pensando la siguiente pregunta…',
    finishing: 'Guardando tu entrevista…',
  }[phase];

  const liveText = [answerLive.finalText, answerLive.interim].filter(Boolean).join(' ');
  const currentNumber = Math.min(turnCount + (phase === 'thinking' || phase === 'finishing' ? 0 : 1), TOTAL_QUESTIONS);

  return (
    <>
      <PracticeSteps />

      <div className="rounded-[28px] bg-[#0B1118] p-3 md:p-4 ring-1 ring-black/5 shadow-lift">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Entrevistador IA */}
          <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-gradient-to-br from-[#16263A] to-[#0E1824] flex items-center justify-center">
            <div className="relative">
              {phase === 'speaking' && <span className="absolute inset-0 rounded-full bg-accent/30 animate-pulse-ring" />}
              <span
                className={cx(
                  'relative h-24 w-24 rounded-full flex items-center justify-center text-white shadow-2xl transition-all duration-300',
                  phase === 'speaking' ? 'bg-gradient-to-br from-accent to-brand-deep scale-105' : 'bg-gradient-to-br from-[#3A4A5E] to-[#1E2A38]',
                )}
              >
                {phase === 'thinking' || phase === 'loading' ? (
                  <span className="h-8 w-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                ) : (
                  <Icon name="sparkles" size={34} strokeWidth={1.5} />
                )}
              </span>
            </div>

            <div className="absolute top-4 left-4 flex items-center gap-2 rounded-full bg-white/10 backdrop-blur px-3 h-7 text-white/90 text-xs">
              <span className={cx('h-1.5 w-1.5 rounded-full', phase === 'speaking' ? 'bg-accent-bright animate-pulse' : 'bg-white/40')} />
              {t.interviewer}
            </div>
            {scenario && <div className="absolute bottom-4 inset-x-4 text-center text-[11px] text-white/40 truncate">{scenario.title}</div>}
          </div>

          {/* Cámara del vocero */}
          <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-black">
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover -scale-x-100" />

            {phase === 'loading' && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#1C242E] to-[#12181F]">
                <span className="h-6 w-6 rounded-full border-2 border-white/10 border-t-white/60 animate-spin" />
                <span className="text-xs text-white/50">Preparando cámara, micrófono y entrevistador…</span>
              </div>
            )}

            {phase !== 'loading' && textMode && mediaWarning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#1C242E] to-[#12181F] text-white/40">
                <Icon name="video" size={32} strokeWidth={1.25} />
                <span className="text-xs">Sin cámara · modo texto</span>
              </div>
            )}

            {phase !== 'loading' && (
              <>
                <div className="absolute top-4 right-4 flex items-center gap-2 rounded-full bg-black/60 backdrop-blur px-3 h-7 text-white text-xs tabular-nums">
                  <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  REC {formatTime(seconds)}
                </div>
                <div className="absolute bottom-4 left-4 flex items-center gap-2">
                  {/* Nivel del micrófono */}
                  <div className="flex items-end gap-[2px] h-7 rounded-full bg-black/60 backdrop-blur px-3 py-2">
                    {[0.15, 0.3, 0.45, 0.6, 0.75].map((th) => (
                      <span
                        key={th}
                        className={cx('w-1 rounded-full transition-colors', phase === 'listening' && micLevel > th * 0.5 ? 'bg-emerald-400' : 'bg-white/25')}
                        style={{ height: `${30 + th * 90}%` }}
                      />
                    ))}
                  </div>
                  {/* Detección corporal */}
                  <div className="flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur px-3 h-7 text-white text-xs">
                    <Icon
                      name="person"
                      size={12}
                      className={bodyStatus === 'ok' ? 'text-emerald-400' : bodyStatus === 'none' ? 'text-amber-400' : 'text-white/40'}
                    />
                    {{ loading: 'Cargando análisis…', ok: 'Cuerpo detectado', none: 'No te veo', off: 'Sin análisis corporal' }[bodyStatus]}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Pregunta y respuesta en vivo */}
        <div className="px-4 md:px-8 pt-8 pb-6 text-center min-h-[180px]">
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/40 mb-4">
            {phase === 'loading' ? 'Preparando' : `${t.qL} · ${currentNumber} de ${TOTAL_QUESTIONS}`}
          </div>
          <p className="font-display font-medium text-[22px] md:text-[28px] leading-[1.35] tracking-[-0.015em] text-white max-w-3xl mx-auto">
            {question ? `“${question}”` : '…'}
          </p>

          {phase === 'listening' && !textMode && (
            <p className="mt-5 text-sm text-white/60 max-w-2xl mx-auto leading-relaxed min-h-[1.5rem]">
              {liveText || <span className="text-white/30">Tu respuesta aparecerá aquí mientras hablas…</span>}
            </p>
          )}

          {phase === 'listening' && textMode && (
            <div className="mt-5 max-w-2xl mx-auto">
              <textarea
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={
                  speechRecognitionSupported
                    ? 'Escribe aquí tu respuesta.'
                    : 'Tu navegador no permite transcribir la voz. Escribe aquí tu respuesta (Chrome o Edge sí lo permiten).'
                }
                className="w-full min-h-[90px] rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 p-3 text-sm focus:outline-none focus:border-white/30"
              />
            </div>
          )}

          <p className="mt-4 text-xs text-white/40 flex items-center justify-center gap-1.5">
            {phase === 'listening' && silenceIn ? (
              <>
                <Icon name="clock" size={12} /> Silencio detectado · continuamos en {silenceIn}s
              </>
            ) : (
              status
            )}
          </p>
        </div>

        {mediaWarning && !error && (
          <div className="mx-1 mb-4 flex items-center gap-3 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-200">
            <Icon name="info" size={16} className="shrink-0" />
            <span className="flex-1">{mediaWarning}</span>
          </div>
        )}

        {error && (
          <div className="mx-1 mb-4 flex items-center gap-3 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">
            <Icon name="alert" size={16} className="shrink-0" />
            <span className="flex-1">{error}</span>
            {!scenario && (
              <Button variant="secondary" size="sm" to="/vocero/escenarios">
                Elegir escenario
              </Button>
            )}
          </div>
        )}

        {/* Controles */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 rounded-2xl bg-white/[0.04] p-3 md:p-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={discardSession}
              disabled={phase === 'finishing'}
              className="h-11 px-4 rounded-xl hover:bg-red-500/10 text-white/60 hover:text-red-300 text-sm font-medium inline-flex items-center gap-2 transition-colors disabled:opacity-40"
            >
              <Icon name="x" size={16} /> Descartar
            </button>
            <button
              type="button"
              onClick={repeatQuestion}
              disabled={phase !== 'listening'}
              className="h-11 px-4 rounded-xl hover:bg-white/10 text-white/70 hover:text-white text-sm font-medium inline-flex items-center gap-2 transition-colors disabled:opacity-40"
            >
              <Icon name="repeat" size={16} /> {t.repeat}
            </button>
          </div>

          <div className="flex items-center gap-3 md:flex-1 md:max-w-xs md:mx-auto">
            <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-accent-bright transition-all duration-500" style={{ width: `${(turnCount / TOTAL_QUESTIONS) * 100}%` }} />
            </div>
            <span className="text-xs text-white/50 whitespace-nowrap tabular-nums">
              {turnCount} de {TOTAL_QUESTIONS} respondidas
            </span>
          </div>

          <div className="flex items-center gap-2 md:ml-auto">
            <button
              type="button"
              onClick={finishEarly}
              disabled={phase === 'finishing' || phase === 'loading' || (turnCount === 0 && phase !== 'listening')}
              className="h-11 px-4 rounded-xl hover:bg-white/10 text-white/70 hover:text-white text-sm font-medium transition-colors disabled:opacity-40"
            >
              {t.finish}
            </button>
            <Button
              variant="accent"
              size="lg"
              onClick={() => finishAnswer()}
              disabled={phase !== 'listening' || (textMode && !typed.trim())}
            >
              {phase === 'finishing' ? 'Guardando…' : 'Terminé de responder'}
            </Button>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-faint mt-6 flex items-center justify-center gap-1.5">
        <Icon name="info" size={13} /> Usa audífonos para que el micrófono no capte la voz del entrevistador. {t.hint}
      </p>
    </>
  );
}
