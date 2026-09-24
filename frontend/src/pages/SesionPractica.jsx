import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import I from '../data/dictionary';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Button } from '../components/ui';

const API_URL = 'http://localhost:3000';
const TEST_USER_EMAIL = 'vocero@demo.com';

export default function SesionPractica() {
  const t = I.es.L.u4;
  const navigate = useNavigate();

  const videoRef = useRef(null);

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  const sessionIdRef = useRef(null);
  const timerRef = useRef(null);

  const finishRequestedRef = useRef(false);
  const discardRequestedRef = useRef(false);

  const [sessionId, setSessionId] = useState(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState('');

  /*
   * Obtener escenario seleccionado.
   */
  function getSelectedScenario() {
    const stored = sessionStorage.getItem(
      'voxready_escenario_seleccionado'
    );

    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored);
    } catch (error) {
      console.error('Error leyendo escenario:', error);
      return null;
    }
  }

  /*
   * Crear sesión en PostgreSQL.
   */
  async function createSession() {
    const scenario = getSelectedScenario();

    if (!scenario?.id) {
      throw new Error('No se encontró el escenario seleccionado.');
    }

    const response = await fetch(`${API_URL}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: TEST_USER_EMAIL,
        themeId: scenario.id
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.mensaje || 'No se pudo crear la sesión.'
      );
    }

    sessionIdRef.current = data.sessionId;
    setSessionId(data.sessionId);

    return data.sessionId;
  }

  /*
   * Elegir un formato compatible con el navegador.
   */
  function getRecorderOptions() {
    const formats = [
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];

    for (const mimeType of formats) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        return { mimeType };
      }
    }

    return {};
  }

  /*
   * Comenzar cámara + micrófono + grabación.
   */
  async function startRecording() {
    const dispositivos = JSON.parse(
      sessionStorage.getItem('voxready_dispositivos') || '{}'
    );

    const cameraId = dispositivos.cameraId;
    const microphoneId = dispositivos.microphoneId;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: cameraId ? { exact: cameraId } : undefined,
        width: 1280,
        height: 720,
      },
      audio: {
        deviceId: microphoneId ? { exact: microphoneId } : undefined,
      },
    });

    streamRef.current = stream;

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }

    const options = getRecorderOptions();

    const recorder = new MediaRecorder(
      stream,
      options
    );

    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = async () => {
      clearInterval(timerRef.current);
      setRecording(false);

      /*
       * Si el usuario descartó la sesión,
       * no hacemos ningún upload.
       */
      if (discardRequestedRef.current) {
        chunksRef.current = [];
        return;
      }

      /*
       * Si terminó normalmente, subimos el Blob.
       */
      if (finishRequestedRef.current) {
        try {
          await uploadRecording();
        } catch (error) {
          console.error('Error subiendo grabación:', error);

          setFinishing(false);
          setError(
            error.message ||
            'No se pudo guardar la grabación.'
          );
        }
      }
    };

    recorder.start();

    setRecording(true);
    setSeconds(0);

    timerRef.current = setInterval(() => {
      setSeconds((previous) => previous + 1);
    }, 1000);
  }

  /*
   * Subir la grabación completa al backend.
   */
  async function uploadRecording() {
    const sessionId = sessionIdRef.current;

    if (!sessionId) {
      throw new Error('No existe un ID de sesión.');
    }

    const blob = new Blob(
      chunksRef.current,
      {
        type: 'video/webm'
      }
    );

    if (blob.size === 0) {
      throw new Error('La grabación está vacía.');
    }

    const response = await fetch(
      `${API_URL}/api/sessions/${sessionId}/video`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'video/webm'
        },
        body: blob
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.mensaje || 'No se pudo guardar el video.'
      );
    }

    stopMediaTracks();

    navigate('/vocero/analizando');
  }

  /*
   * Finalizar sesión normalmente.
   */
  function finishSession() {
    if (
      !recorderRef.current ||
      recorderRef.current.state === 'inactive'
    ) {
      return;
    }

    setFinishing(true);

    finishRequestedRef.current = true;
    discardRequestedRef.current = false;

    recorderRef.current.stop();
  }

  /*
   * Detener y descartar.
   */
  async function discardSession() {
    discardRequestedRef.current = true;
    finishRequestedRef.current = false;

    clearInterval(timerRef.current);

    if (
      recorderRef.current &&
      recorderRef.current.state !== 'inactive'
    ) {
      recorderRef.current.stop();
    }

    stopMediaTracks();

    chunksRef.current = [];

    const currentSessionId = sessionIdRef.current;

    if (currentSessionId) {
      try {
        await fetch(
          `${API_URL}/api/sessions/${currentSessionId}`,
          {
            method: 'DELETE'
          }
        );
      } catch (error) {
        console.error(
          'No se pudo eliminar la sesión:',
          error
        );
      }
    }

    navigate('/vocero/escenarios');
  }

  /*
   * Detener cámara y micrófono.
   */
  function stopMediaTracks() {
    if (streamRef.current) {
      streamRef.current
        .getTracks()
        .forEach((track) => track.stop());

      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  /*
   * Formatear tiempo.
   */
  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const secondsPart = totalSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(
      secondsPart
    ).padStart(2, '0')}`;
  }

  /*
   * Crear sesión y comenzar grabación.
   */
  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        setLoading(true);
        setError('');

        await createSession();

        if (cancelled) {
          return;
        }

        await startRecording();

      } catch (error) {
        console.error(
          'Error iniciando sesión:',
          error
        );

        setError(
          error.message ||
          'No se pudo iniciar la sesión.'
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;

      clearInterval(timerRef.current);

      stopMediaTracks();
    };
  }, []);

  return (
    <>
      <PracticeSteps />

      <div className="rounded-[28px] bg-[#0B1118] p-3 md:p-4 ring-1 ring-black/5 shadow-lift">

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

          {/* Entrevistador IA */}
          <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-gradient-to-br from-[#16263A] to-[#0E1824] flex items-center justify-center">

            <div className="relative">
              <span className="absolute inset-0 rounded-full bg-[#E0662A]/30 animate-pulse-ring" />

              <span className="relative h-24 w-24 rounded-full bg-gradient-to-br from-[#F08046] to-[#B84A18] flex items-center justify-center text-white shadow-2xl">
                <Icon
                  name="sparkles"
                  size={34}
                  strokeWidth={1.5}
                />
              </span>
            </div>

            <div className="absolute top-4 left-4 flex items-center gap-2 rounded-full bg-white/10 backdrop-blur px-3 h-7 text-white/90 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-[#F08046]" />
              {t.interviewer}
            </div>

            <div className="absolute bottom-5 inset-x-0 flex items-end justify-center gap-1 h-6">
              {[40, 70, 100, 60, 85, 45, 90, 55, 75, 35, 65].map(
                (height, index) => (
                  <span
                    key={index}
                    className="w-1 rounded-full bg-white/30"
                    style={{ height: `${height}%` }}
                  />
                )
              )}
            </div>

          </div>

          {/* Cámara del usuario */}
          <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-black">

            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />

            {!recording && !loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <span className="text-white/70 text-sm">
                  Cámara detenida
                </span>
              </div>
            )}

            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <span className="text-white/70 text-sm">
                  Preparando sesión...
                </span>
              </div>
            )}

            {recording && (
              <div className="absolute top-4 right-4 flex items-center gap-2 rounded-full bg-black/60 backdrop-blur px-3 h-7 text-white text-xs tabular-nums">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                REC {formatTime(seconds)}
              </div>
            )}

          </div>
        </div>

        {/* Subtítulo */}
        <div className="px-4 md:px-8 pt-8 pb-6 text-center">
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/40 mb-4">
            {t.qL}
          </div>

          <p className="font-display font-medium text-[22px] md:text-[28px] leading-[1.35] tracking-[-0.015em] text-white max-w-3xl mx-auto">
            “{t.qEx}”
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-4 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Controles */}
        <div className="flex flex-col md:flex-row md:items-center gap-4 rounded-2xl bg-white/[0.04] p-3 md:p-4">

          <div className="flex items-center gap-2">

            <button
              type="button"
              onClick={discardSession}
              disabled={finishing}
              className="h-11 px-4 rounded-xl hover:bg-red-500/10 text-white/70 hover:text-red-300 text-sm font-medium inline-flex items-center gap-2 transition-colors disabled:opacity-40"
            >
              <Icon
                name="x"
                size={16}
              />
              Detener y descartar
            </button>

          </div>

          <div className="flex items-center gap-3 md:flex-1 md:max-w-xs md:mx-auto">

            <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full w-[38%] rounded-full bg-[#F08046]" />
            </div>

            <span className="text-xs text-white/50 whitespace-nowrap tabular-nums">
              {t.qn}
            </span>

          </div>

          <Button
            variant="accent"
            size="lg"
            onClick={finishSession}
            disabled={
              loading ||
              finishing ||
              !recording
            }
            className="md:ml-auto"
          >
            {finishing ? 'Guardando...' : t.finish}
          </Button>

        </div>

      </div>

      <p className="text-center text-xs text-faint mt-6 flex items-center justify-center gap-1.5">
        <Icon
          name="info"
          size={13}
        />
        {t.hint}
      </p>
    </>
  );
}