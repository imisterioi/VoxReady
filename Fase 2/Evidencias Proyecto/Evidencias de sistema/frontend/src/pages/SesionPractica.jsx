import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useI18n } from '../lib/i18n';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Button, cx } from '../components/ui';
import { API_URL, apiFetch, getToken } from '../lib/api';
import { speak, stopSpeaking, useInterviewerVoice } from '../lib/voice';
import { createSpeechController, fallbackDelayFor } from '../lib/practice/speechController';
import { createPrewarmTrigger } from '../lib/practice/prewarm';
import { emptyProgress, applyServerProgress, isInterviewDone, progressLabel, progressPercent } from '../lib/practice/interviewProgress';
import { silenceRemainingMs } from '../lib/practice/sessionTiming';
import AudioMeter from '../lib/practice/audioMeter';
import PoseTracker from '../lib/practice/poseTracker';
import { buildBlob, startAudioRecorder, stopAll, stopAndWait, uploadBlob } from '../lib/practice/mediaCapture';
import { TRANSCRIPT_SOURCE, TRANSCRIPT_TIMEOUT_MS, normalizeTranscription, transcriptionRequest } from '../lib/practice/answerTranscription';
import { recordingReadiness } from '../lib/practice/sessionStart';
import { discardUnusedSession } from '../lib/practice/sessionGuard';
import { analyzeText } from '../lib/practice/speech';

// Entrevista simulada completa:
//  1. El entrevistador IA (API de NVIDIA) formula la pregunta y la lee en voz alta.
//  2. Mientras respondes se transcribe lo que dices y se mide tu voz (micrófono)
//     y tu cuerpo (cámara + MediaPipe).
//  3. Tras cada respuesta la IA repregunta según lo que dijiste.
//  4. Al terminar se sube la grabación y se pasa al análisis con la IA evaluadora.

// El progreso lo informa el backend (mainsAsked/mainsTotal/done); no hay total por defecto.
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
  const { d } = useI18n();
  const t = d.L.u4;
  const tb = d.L.u4b;
  const navigate = useNavigate();
  const [scenario] = useState(getSelectedScenario);
  const { voice } = useInterviewerVoice();

  // Referencias de medios y medición
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  // Pista de audio independiente (Opus): se usa para verificar el WPM en el servidor.
  const audioRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  // Motivo por el que la pista de audio no está disponible (para el diagnóstico).
  const audioErrorRef = useRef(null);
  // Evita repetir el mismo aviso en consola durante toda la práctica.
  const loggedRef = useRef(new Set());
  const audioRef = useRef(null);
  const poseRef = useRef(null);
  // Origen temporal común: instante en que arranca el grabador que produce <id>.audio.webm.
  const audioOriginRef = useRef(0);
  const answerStartRef = useRef(null);
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
  // Estado de preparación: la grabación no arranca hasta que todo esté listo.
  const mediaReadyRef = useRef(false);
  const poseReadyRef = useRef(false);
  const poseFailedRef = useRef(false);
  const recordingStartedRef = useRef(false);
  const voiceRef = useRef(voice);
  // Controlador de lectura: un único resultado por intento y temporizador gestionado.
  const speechRef = useRef(null);
  if (!speechRef.current) speechRef.current = createSpeechController({ speak });
  // Precalentamiento del entrevistador: una sola solicitud por sesión, sin bloquear la
  // preparación y sin afectar al estado si la sesión cambia o el componente se desmonta.
  const prewarmRef = useRef(null);
  if (!prewarmRef.current) {
    prewarmRef.current = createPrewarmTrigger({
      post: (sessionId) => apiFetch('/api/interviewer/prewarm', { method: 'POST', body: { sessionId } }),
      isCurrentSession: (sessionId) => sessionIdRef.current === sessionId,
    });
  }

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  // Estado visible
  const [phase, setPhaseState] = useState('loading'); // loading | speaking | listening | thinking | finishing
  const [question, setQuestion] = useState('');
  const [typed, setTypedState] = useState('');
  const [turnCount, setTurnCount] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [bodyStatus, setBodyStatus] = useState('loading'); // loading | ok | none | off
  const [silenceIn, setSilenceIn] = useState(null);
  const [error, setError] = useState('');
  const [mediaWarning, setMediaWarning] = useState('');
  const [textMode, setTextModeState] = useState(false);
  const textModeRef = useRef(false);

  // Configuración de la entrevista del escenario (preguntas, repreguntas, tiempo por respuesta).
  // La confirma el backend con cada pregunta; lo guardado en el navegador es solo el valor inicial.
  const interviewRef = useRef(scenario?.interview || null);
  const progressRef = useRef(emptyProgress(scenario?.interview || null));
  const [progress, setProgress] = useState(progressRef.current);
  const [isFollowUp, setIsFollowUp] = useState(false);
  const [answerLeft, setAnswerLeft] = useState(null); // segundos que quedan para responder (si hay límite)
  const [transcribing, setTranscribing] = useState(false); // true mientras se transcribe la respuesta

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

  // Diagnóstico de grabación: un mensaje por evento y práctica. Nunca incluye audio,
  // texto, tokens ni datos personales.
  const logMedia = (event, detail) => {
    if (loggedRef.current.size > 40) return;
    const key = `${event}|${detail ?? ''}`;
    if (loggedRef.current.has(key)) return;
    loggedRef.current.add(key);
    const line = `[grabación] ${event}${detail ? ' · ' + detail : ''}`;
    if (/(EMPTY|ERROR|MISSING|FAILED|UNSUPPORTED|NOT_STARTED|UNAVAILABLE)/.test(event)) console.error(line);
    else console.info(line);
  };

  const stopMediaTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const cleanup = useCallback(() => {
    clearInterval(timerRef.current);
    clearInterval(watchdogRef.current);
    // Silencia al entrevistador por completo (incluida una lectura aplazada): al salir de la
    // práctica o al terminar, ninguna pregunta debe seguir sonando.
    stopSpeaking();
    speechRef.current?.cancel(); // invalida callbacks y temporizador pendientes
    // Se detienen los grabadores ANTES de soltar las pistas: así no queda ningún
    // MediaRecorder activo al descartar o salir de la práctica.
    stopAll([recorderRef.current, audioRecorderRef.current]);
    recorderRef.current = null;
    audioRecorderRef.current = null;
    audioRef.current?.destroy();
    poseRef.current?.destroy();
    stopMediaTracks();
  }, [stopMediaTracks]);

  // Descarta la sesión creada cuando la práctica NO llegó a empezar (el vocero salió, recargó
  // la página o falló la preparación). Evita registros CREATED vacíos en la base; nunca toca
  // una sesión con datos ni una entrevista que se está cerrando.
  const discardUnused = useCallback(async () => {
    const discarded = await discardUnusedSession({
      sessionId: sessionIdRef.current,
      interviewStarted: recordingStartedRef.current,
      finishing: finishingRef.current,
      del: (sessionId) => apiFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' }),
    });
    if (discarded) sessionIdRef.current = null;
    return discarded;
  }, []);

  // Crear sesión en PostgreSQL (endpoint de tu compañero)
  async function createSession() {
    if (!scenario?.id) throw new Error(tb.noScenarioChosen);
    const response = await fetch(`${API_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
      body: JSON.stringify({ themeId: scenario.id }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.mensaje || tb.createFailed);
    sessionIdRef.current = data.sessionId;
  }

  // Prepara cámara, micrófono, medición y modelo de cuerpo. NO graba todavía:
  // la grabación empieza cuando el entrevistador ya tiene la primera pregunta.
  async function prepareMedia() {
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
      setMediaWarning(tb.mediaWarning);
      setTextMode(true);
      setBodyStatus('off');
      return false;
    }
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }

    // Grabación: se crea y arranca en startRecording(), cuando todo está listo.
    // (Grabar aquí incluía el tiempo de carga del entrevistador.)

    // Segunda grabación, SOLO de audio (Opus ~32 kbps): es la que se transcribe en el
    // servidor para medir el tiempo de habla. El video se sigue grabando igual que antes.
    //
    // IMPORTANTE: se usa un MediaStream con SOLO la pista de audio. Con el stream mixto
    // (cámara + micrófono), Chromium acepta el constructor pero `start()` falla con
    // NotSupportedError (reproducido en Edge 155) y el Blob quedaba vacío en silencio.
    // Se crea también en startRecording().

    // Medición de voz y cuerpo
    audioRef.current = new AudioMeter(stream);
    const pose = new PoseTracker(videoRef.current);
    poseRef.current = pose;
    // El modelo de cuerpo se carga ANTES de grabar. Si tarda demasiado o falla, la
    // práctica sigue: simplemente no se medirá el cuerpo.
    const poseOk = await Promise.race([
      pose.load().catch(() => false),
      new Promise((resolve) => setTimeout(() => resolve(false), 15000)),
    ]);
    if (poseOk) {
      pose.start();
      poseReadyRef.current = true;
    } else {
      poseFailedRef.current = true;
      setBodyStatus('off');
    }
    mediaReadyRef.current = true;
    return true;
  }

  // Crea y arranca los grabadores y el cronómetro. Solo se llama cuando la sesión,
  // la cámara/micrófono y la primera pregunta están listos.
  function startRecording() {
    if (recordingStartedRef.current) return;
    recordingStartedRef.current = true;

    const stream = streamRef.current;
    if (stream) {
      const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };
      recorder.start(1000);
      recorderRef.current = recorder;

      try {
        const { recorder: audioRecorder, mime } = startAudioRecorder({
          stream,
          onData: (data) => audioChunksRef.current.push(data),
          onError: (error) => {
            audioErrorRef.current = error?.name || 'AUDIO_RECORDER_ERROR';
            logMedia('AUDIO_RECORDER_ERROR', audioErrorRef.current);
          },
        });
        audioRecorderRef.current = audioRecorder;
        // Origen temporal: se toma justo después de arrancar el grabador de audio.
        audioOriginRef.current = performance.now();
        logMedia('AUDIO_RECORDING_STARTED', mime);
      } catch (error) {
        audioOriginRef.current = 0; // sin grabador no hay ventanas fiables
        audioErrorRef.current = error.code || 'AUDIO_RECORDER_ERROR';
        logMedia(error.code || 'AUDIO_RECORDER_ERROR', error.cause?.name || '');
      }
    }

    // El cronómetro y las métricas empiezan a contar con la grabación, no antes.
    secondsRef.current = 0;
    setSeconds(0);
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
      {
        role: 'vocero',
        text: turn.answer,
        // Marca de voz y procedencia de la transcripción: distinguen un silencio real de una
        // respuesta hablada que no se pudo transcribir.
        ...(turn.spoke === true ? { spoke: true } : {}),
        ...(turn.transcriptSource ? { transcriptSource: turn.transcriptSource } : {}),
      },
    ]);
    // El escenario lo determina el backend a partir de la sesión (no se envía el tema)
    let data;
    try {
      data = await apiFetch('/api/interviewer/next-question', {
        method: 'POST',
        body: { sessionId: sessionIdRef.current, history },
      });
    } catch (error) {
      // El backend avisa que la entrevista termino: se cierra de forma controlada, sin reintentar.
      if (isInterviewDone(error)) {
        progressRef.current = { ...progressRef.current, done: true };
        setProgress(progressRef.current);
        return null;
      }
      throw error;
    }
    // Progreso autoritativo del backend (idempotente: reintentos no duplican nada).
    const applied = applyServerProgress(progressRef.current, data);
    if (applied.changed) {
      progressRef.current = applied.progress;
      setProgress(applied.progress);
    }
    if (data.interview) interviewRef.current = data.interview;
    setIsFollowUp(data.kind === 'followup');
    return data.question;
  }

  function askQuestion(text) {
    // Cerrando la entrevista no se inicia ninguna pregunta nueva: el vocero ya está pasando
    // al análisis y el entrevistador debe quedarse en silencio.
    if (finishingRef.current) return;
    questionRef.current = text;
    poseRef.current?.beginSegment(); // el tramo incluye la pregunta: también importa cómo la escucha
    setQuestion(text);
    setTyped('');
    setPhase('speaking');
    setError('');
    // Un solo controlador por turno: cancela el temporizador y los callbacks del anterior.
    speechRef.current?.play(text, voiceRef.current, {
      fallbackMs: fallbackDelayFor(text),
      onEnd: () => {
        if (phaseRef.current === 'speaking') startListening();
      },
      onError: (reason) => {
        // Se informa y se permite continuar; no se finge que el vocero escuchó la pregunta.
        setError(
          tb.speakFailed(reason),
        );
        if (phaseRef.current === 'speaking') startListening();
      },
    });
  }

  // ------------------------------------------------------ Escuchar respuesta

  function startListening() {
    if (finishingRef.current || phaseRef.current !== 'speaking') return;
    setPhase('listening');
    listenStartRef.current = performance.now();
    // Inicio de la respuesta relativo al audio que se enviará a NVIDIA.
    answerStartRef.current = audioOriginRef.current
      ? Math.round(performance.now() - audioOriginRef.current)
      : null;
    audioRef.current?.startAnswer();

    // Control de silencios: intervención de rescate y fin de respuesta
    clearInterval(watchdogRef.current);
    watchdogRef.current = setInterval(() => {
      if (phaseRef.current !== 'listening' || !audioRef.current?.available) return;
      setMicLevel(audioRef.current.level);
      if (textModeRef.current) return; // respondiendo por escrito no hay límite de tiempo

      const now = performance.now();

      // Tiempo máximo por respuesta (si el escenario lo define)
      const maxAnswerMs = (interviewRef.current?.maxAnswerSeconds || 0) * 1000;
      if (maxAnswerMs) {
        const left = maxAnswerMs - (now - listenStartRef.current);
        setAnswerLeft(Math.max(0, Math.ceil(left / 1000)));
        if (left <= 0) return finishAnswer();
      }

      const lastVoice = audioRef.current.lastVoiceAt;
      const spoke = lastVoice > listenStartRef.current;
      const quietFor = now - (spoke ? lastVoice : listenStartRef.current);
      const remaining = silenceRemainingMs({ spoke, quietForMs: quietFor });
      setSilenceIn(quietFor > 2500 && remaining > 0 ? Math.ceil(remaining / 1000) : null);
      if (remaining <= 0) finishAnswer();
    }, 250);
  }

  // Pide al backend la transcripción de la respuesta recién terminada. Nunca lanza: si falla, el
  // turno queda como "habló sin transcripción" (no como silencio) y la evaluación final volverá a
  // transcribir el audio completo. El texto NUNCA se registra en el log técnico.
  async function transcribeAnswer({ startMs, endMs, turnIndex }) {
    if (!sessionIdRef.current) return normalizeTranscription({ ok: false });
    // Volcado del audio pendiente: `requestData()` fuerza un `dataavailable` con lo grabado desde
    // el último trozo (la cola de la respuesta aún no estaba en `audioChunksRef`).
    try {
      audioRecorderRef.current?.requestData?.();
    } catch {
      /* el navegador no lo admite: se envía lo que ya está disponible */
    }
    await new Promise((resolve) => setTimeout(resolve, 60));

    const query = `startMs=${Math.round(startMs)}&endMs=${Math.round(endMs)}&turnIndex=${turnIndex}`;
    const url = `${API_URL}/api/sessions/${sessionIdRef.current}/answer-transcript?${query}&token=${encodeURIComponent(getToken() || '')}`;
    const result = await uploadBlob({
      url,
      blob: buildBlob(audioChunksRef.current, 'audio/webm'),
      type: 'audio/webm',
      parseJson: true,
      signal:
        typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(TRANSCRIPT_TIMEOUT_MS)
          : undefined,
    });
    const transcribed = normalizeTranscription(result);
    if (transcribed.source === TRANSCRIPT_SOURCE.live) {
      logMedia('ANSWER_TRANSCRIPT_OK', `${transcribed.text.length} caracteres`);
    } else {
      logMedia(
        'ANSWER_TRANSCRIPT_UNAVAILABLE',
        result.reason === 'HTTP' ? `HTTP ${result.status}` : transcribed.code || result.reason || 'red',
      );
    }
    return transcribed;
  }

  async function finishAnswer({ endInterview = false } = {}) {
    if (phaseRef.current !== 'listening') return;
    clearInterval(watchdogRef.current);
    setSilenceIn(null);
    setAnswerLeft(null);
    setPhase('thinking');

    const typedAnswer = (typedRef.current || '').trim();
    const audio = audioRef.current?.endAnswer();
    // Fin de la respuesta relativo al MISMO origen que el audio enviado a NVIDIA.
    const endMs = audioOriginRef.current
      ? Math.round(performance.now() - audioOriginRef.current)
      : null;
    const startMs = answerStartRef.current;
    // ¿Se detectó voz? (VAD del medidor de audio). Es lo que distingue un silencio real de una
    // respuesta hablada que no se pudo transcribir.
    const spoke = Number(audio?.speakingMs ?? 0) > 0;
    // Transcripción por respuesta: el entrevistador necesita el TEXTO real antes de decidir la
    // siguiente intervención. Sin ventana utilizable o sin voz detectada no se pide nada.
    const request = transcriptionRequest({ textMode: textModeRef.current, spoke, startMs, endMs });
    let transcriptSource = textModeRef.current ? TRANSCRIPT_SOURCE.typed : null;
    if (!textModeRef.current && spoke && !request.needed) {
      // Habló pero no hay ventana de audio utilizable: no hay texto, y NO es silencio.
      transcriptSource = TRANSCRIPT_SOURCE.unavailable;
    }
    // El video del tramo se consume UNA sola vez (endSegment cierra el segmento actual).
    const video = poseRef.current?.endSegment() ?? null;
    const turnMetrics = (answerText) => {
      const analyzed = analyzeText(answerText);
      const minutes = (audio?.speakingMs || 0) / 60000;
      return {
        words: analyzed.words,
        fillers: analyzed.fillers,
        fillerWords: analyzed.fillerWords,
        wpm: minutes > 0.05 && analyzed.words ? analyzed.words / minutes : null,
        latencyMs: audio?.latencyMs ?? null,
        durationMs: audio?.durationMs ?? null,
        speakingMs: audio?.speakingMs ?? null,
        longPauses: audio?.longPauses ?? 0,
        volumeVariation: audio?.volumeVariation ?? null,
        // Mirada y risa durante esta pregunta y su respuesta (análisis de sensibilidad)
        video,
      };
    };

    const turnIndex = turnsRef.current.length;
    const turn = {
      question: questionRef.current,
      answer: typedAnswer,
      spoke,
      ...(transcriptSource ? { transcriptSource } : {}),
      startMs,
      endMs,
      metrics: turnMetrics(typedAnswer),
    };
    // El turno se registra ANTES de esperar la transcripción: así, si el vocero finaliza la
    // entrevista durante esa espera, la respuesta no se pierde (mismo comportamiento que antes).
    turnsRef.current.push(turn);
    setTurnCount(turnsRef.current.length);

    if (request.needed) {
      setTranscribing(true);
      try {
        const transcribed = await transcribeAnswer({ startMs, endMs, turnIndex });
        turn.answer = transcribed.text;
        turn.transcriptSource = transcribed.source;
        turn.metrics = turnMetrics(transcribed.text);
      } finally {
        setTranscribing(false);
      }
    }

    if (endInterview || progressRef.current.done) {
      finishInterview();
      return;
    }

    try {
      const nextQuestion = await fetchQuestion();
      if (!nextQuestion) {
        // El backend cerro la entrevista: se guarda y se navega al analisis como siempre.
        finishInterview();
        return;
      }
      askQuestion(nextQuestion);
    } catch (err) {
      setError(tb.answerFailed(err.message));
    }
  }

  function repeatQuestion() {
    if (phaseRef.current !== 'listening') return;
    audioRef.current?.pause();
    // El controlador invalida el intento anterior y su temporizador antes de volver a hablar.
    speechRef.current?.play(questionRef.current, voiceRef.current, {
      fallbackMs: fallbackDelayFor(questionRef.current),
      onEnd: () => audioRef.current?.resume(),
      onError: (reason) => {
        setError(tb.repeatFailed(reason));
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

  // Sube un archivo de la sesión. Nunca lanza: si falla, la evaluación sigue su curso
  // (la velocidad quedará "sin verificar" en lugar de inventarse).
  // Devuelve un resultado explícito para no dar por buena una subida que no ocurrió.
  async function uploadMedia(kind, blob, type) {
    const label = kind === 'audio' ? 'AUDIO' : 'VIDEO';
    if (!sessionIdRef.current) {
      logMedia(`${label}_UPLOAD_FAILED`, 'NO_SESSION');
      return { ok: false, reason: 'NO_SESSION' };
    }
    // El endpoint exige autenticación; el token va en la URL por simetría con el video.
    const url = `${API_URL}/api/sessions/${sessionIdRef.current}/${kind}?token=${encodeURIComponent(getToken() || '')}`;
    const result = await uploadBlob({ url, blob, type });

    if (result.ok) logMedia(`${label}_UPLOAD_OK`, `${result.bytes} bytes`);
    else if (result.reason === 'EMPTY') logMedia(`${label}_BLOB_EMPTY`, kind === 'audio' ? audioErrorRef.current || 'sin datos' : 'sin datos');
    else if (result.reason === 'HTTP') logMedia(`${label}_UPLOAD_FAILED`, `HTTP ${result.status}`);
    else logMedia(`${label}_UPLOAD_FAILED`, result.error || 'red');
    return result;
  }

  async function uploadRecording() {
    // El video se sube igual que antes; el audio es la evidencia del WPM.
    // Se esperan AMBAS subidas antes de pedir la evaluación.
    const video = await uploadMedia('video', buildBlob(chunksRef.current, 'video/webm'), 'video/webm');
    const audio = await uploadMedia('audio', buildBlob(audioChunksRef.current, 'audio/webm'), 'audio/webm');
    return { video, audio };
  }

  async function finishInterview() {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setPhase('finishing');
    // La voz se corta AQUÍ, antes de los `await` (detener grabadores y subir las pistas):
    // así ninguna lectura pendiente ni aplazada arranca durante la transición al análisis.
    stopSpeaking();
    speechRef.current?.cancel();

    sessionStorage.setItem(
      RESULT_KEY,
      JSON.stringify({
        sessionId: sessionIdRef.current,
        theme: scenario ? { id: scenario.id, title: scenario.title } : null,
        transcript: turnsRef.current,
        metrics: buildMetrics(),
      }),
    );

    // 1) Detener grabadores y ESPERAR al evento `stop` (el dataavailable final llega antes).
    await stopAndWait(recorderRef.current);
    await stopAndWait(audioRecorderRef.current);

    // 2) Subir (se espera a que terminen) antes de navegar a la evaluación.
    const { audio } = await uploadRecording();
    if (!audio.ok) {
      // No se simula éxito: la evaluación recibirá la sesión sin audio verificado.
      logMedia('AUDIO_NO_DISPONIBLE', audio.reason || 'desconocido');
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
        // La pantalla pudo desmontarse mientras se creaba la sesión (salida, recarga o
        // remontaje): esa sesión ya no se usará, así que se descarta en lugar de dejarla vacía.
        if (cancelled) {
          await discardUnused();
          return;
        }
        // Preparación anticipada: se lanza SIN await (no bloquea cámara, micrófono ni el
        // arranque). Si falla, el flujo continúa igual.
        prewarmRef.current?.start(sessionIdRef.current);
        // 1) Cámara, micrófono y modelo de cuerpo (sin grabar todavía).
        await prepareMedia();
        if (cancelled) return;
        // 2) Primera pregunta: el entrevistador ya está listo (la IA puede tardar).
        const first = await fetchQuestion();
        if (cancelled) return;

        // 3) Solo ahora se comprueba que todo esté listo y se empieza a grabar.
        const readiness = recordingReadiness({
          sessionId: sessionIdRef.current,
          mediaReady: mediaReadyRef.current,
          textMode: textModeRef.current,
          question: first,
          poseReady: poseReadyRef.current,
          poseFailed: poseFailedRef.current,
        });
        if (!readiness.ready) {
          throw new Error(tb.recordingFailed(readiness.missing.join(', ')));
        }
        startRecording();
        askQuestion(first);
      } catch (err) {
        console.error('Error iniciando sesión:', err);
        // Si algo falla antes de empezar, no queda ninguna grabación activa.
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
        if (audioRecorderRef.current?.state === 'recording') audioRecorderRef.current.stop();
        recorderRef.current = null;
        audioRecorderRef.current = null;
        if (!cancelled) setError(err.message || tb.startFailed);
        // Si la preparación falló antes de empezar, la sesión creada no tiene datos: se
        // descarta para no dejar un registro CREATED vacío. Si ya se estaba grabando, se
        // conserva (puede tener respuesta del vocero).
        await discardUnused();
      }
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      cleanup();
      // Salir de la pantalla sin haber empezado deja una sesión vacía: se descarta.
      discardUnused();
    };
    // Se ejecuta una sola vez al entrar a la sesión
  }, []);

  // ------------------------------------------------------ Vista

  const status = transcribing
    ? tb.transcribing
    : {
        loading: tb.preparing,
        speaking: tb.speaking,
        listening: textMode ? tb.listeningText : tb.listeningVoice,
        thinking: tb.thinking,
        finishing: tb.finishing,
      }[phase];

  // El numero de pregunta principal lo informa el backend (`progress.mainsAsked`); no se recalcula.
  const mainLabel = progressLabel({ isFollowUp, mainsAsked: progress.mainsAsked, mainsTotal: progress.mainsTotal, fallback: t.qL });

  return (
    <>
      <PracticeSteps className="!mb-4" />

      {/* La entrevista ocupa el alto de la pantalla: cámara grande a la izquierda y,
          a la derecha, el entrevistador, la pregunta y los controles */}
      <div className="rounded-[28px] bg-[#0B1118] p-3 ring-1 ring-black/5 shadow-lift grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3 lg:h-[calc(100vh-160px)] lg:min-h-[440px] lg:max-h-[760px]">
        {/* Cámara del vocero */}
        <div className="relative h-[56vw] lg:h-auto rounded-2xl overflow-hidden bg-black">
          <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover -scale-x-100" />

          {phase === 'loading' && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#1C242E] to-[#12181F]">
              <span className="h-6 w-6 rounded-full border-2 border-white/10 border-t-white/60 animate-spin" />
              <span className="text-xs text-white/50">{tb.preparingMedia}</span>
            </div>
          )}

          {phase !== 'loading' && textMode && mediaWarning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#1C242E] to-[#12181F] text-white/40">
              <Icon name="video" size={32} strokeWidth={1.25} />
              <span className="text-xs">{tb.noCameraText}</span>
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
                  {{ loading: tb.bodyLoading, ok: tb.bodyOk, none: tb.bodyNone, off: tb.bodyOff }[bodyStatus]}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Entrevistador, pregunta y controles */}
        <div className="flex flex-col gap-3 min-h-0">
          {/* Entrevistador IA */}
          <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-[#16263A] to-[#0E1824] px-4 py-3">
            <div className="relative shrink-0">
              {phase === 'speaking' && <span className="absolute inset-0 rounded-full bg-accent/30 animate-pulse-ring" />}
              <span
                className={cx(
                  'relative h-14 w-14 rounded-full flex items-center justify-center text-white shadow-2xl transition-all duration-300',
                  phase === 'speaking' ? 'bg-gradient-to-br from-accent to-brand-deep scale-105' : 'bg-gradient-to-br from-[#3A4A5E] to-[#1E2A38]',
                )}
              >
                {phase === 'thinking' || phase === 'loading' ? (
                  <span className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                ) : (
                  <Icon name="sparkles" size={24} strokeWidth={1.5} />
                )}
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                <span className={cx('h-1.5 w-1.5 rounded-full', phase === 'speaking' ? 'bg-accent-bright animate-pulse' : 'bg-white/40')} />
                {t.interviewer}
              </div>
              {scenario && <div className="text-xs text-white/40 truncate mt-0.5">{scenario.title}</div>}
            </div>
          </div>

          {/* Pregunta y respuesta */}
          <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl bg-white/[0.03] px-5 py-4 flex flex-col">
            <div className="text-[11px] uppercase tracking-[0.14em] text-white/40 mb-2">
              {phase === 'loading' ? tb.preparingShort : mainLabel}
            </div>
            <p className="font-display font-medium text-[19px] xl:text-[21px] leading-[1.3] tracking-[-0.015em] text-white">
              {question ? `“${question}”` : '…'}
            </p>

            {phase === 'listening' && !textMode && (
              <p className="mt-3 text-sm text-white/60 leading-relaxed">
                {tb.speakHint}
              </p>
            )}

            {phase === 'listening' && textMode && (
              <textarea
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={tb.answerPlaceholder}
                className="mt-3 w-full flex-1 min-h-[64px] rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 p-3 text-sm focus:outline-none focus:border-white/30"
              />
            )}

            <p className="mt-auto pt-3 text-xs text-white/40 flex items-center gap-1.5">
              {phase === 'listening' && !textMode && answerLeft != null && answerLeft <= 10 ? (
                <>
                  <Icon name="clock" size={12} /> {tb.remainingSeconds(answerLeft)}
                </>
              ) : phase === 'listening' && silenceIn ? (
                <>
                  <Icon name="clock" size={12} /> {tb.silenceDetected(silenceIn)}
                </>
              ) : (
                status
              )}
            </p>
          </div>

          {mediaWarning && !error && (
            <div className="flex items-center gap-3 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-2 text-[13px] text-amber-200">
              <Icon name="info" size={16} className="shrink-0" />
              <span className="flex-1">{mediaWarning}</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2 text-[13px] text-red-300">
              <Icon name="alert" size={16} className="shrink-0" />
              <span className="flex-1">{error}</span>
              {!scenario && (
                <Button variant="secondary" size="sm" to="/vocero/escenarios">
                  {tb.chooseScenario}
                </Button>
              )}
            </div>
          )}

          {/* Controles */}
          <div className="rounded-2xl bg-white/[0.04] p-3 space-y-3">
            <div className="flex items-center gap-3 px-1">
              <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-accent-bright transition-all duration-500" style={{ width: `${progressPercent(progress)}%` }} />
              </div>
              <span className="text-xs text-white/50 whitespace-nowrap tabular-nums">
                {tb.mainsOf(progress.mainsAsked, progress.mainsTotal ?? '—')}
              </span>
            </div>

            <Button
              variant="accent"
              size="lg"
              className="w-full"
              onClick={() => finishAnswer()}
              disabled={phase !== 'listening' || (textMode && !typed.trim())}
            >
              {phase === 'finishing' ? tb.saving : tb.finishedAnswer}
            </Button>

            <div className="flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={discardSession}
                disabled={phase === 'finishing'}
                className="h-9 px-3 rounded-xl hover:bg-red-500/10 text-white/60 hover:text-red-300 text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-40"
              >
                <Icon name="x" size={15} /> {tb.discard}
              </button>
              <button
                type="button"
                onClick={repeatQuestion}
                disabled={phase !== 'listening'}
                className="h-9 px-3 rounded-xl hover:bg-white/10 text-white/70 hover:text-white text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-40"
              >
                <Icon name="repeat" size={15} /> {t.repeat}
              </button>
              <button
                type="button"
                onClick={finishEarly}
                disabled={phase === 'finishing' || phase === 'loading' || (turnCount === 0 && phase !== 'listening')}
                className="h-9 px-3 rounded-xl hover:bg-white/10 text-white/70 hover:text-white text-[13px] font-medium transition-colors disabled:opacity-40"
              >
                {t.finish}
              </button>
            </div>
          </div>

          <p className="text-[11px] text-white/30 flex items-start gap-1.5 px-1">
            <Icon name="info" size={12} className="mt-0.5 shrink-0" /> {tb.headphones}
          </p>
        </div>
      </div>
    </>
  );
}
