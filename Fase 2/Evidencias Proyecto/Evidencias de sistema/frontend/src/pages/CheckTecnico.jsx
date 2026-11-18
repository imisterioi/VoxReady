import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Badge, Button, Card, Checkbox, Field, PageHeader, Progress, cx } from '../components/ui';
import { ScenarioBriefModal } from '../components/ScenarioBrief';
import PoseTracker from '../lib/practice/poseTracker';
import { CALIBRATION_MS } from '../lib/practice/calibration';
import { FINISH_REASONS, createCalibrationRun } from '../lib/practice/calibrationRun';
import { TRACKER_STATES, createTrackerPreload } from '../lib/practice/trackerPreload';

// Los medidores visuales (nivel de micrófono e iluminación) se publican ~10 veces por segundo aunque
// sus bucles vayan a la frecuencia de refresco: así la pantalla no se re-renderiza en cada cuadro.
// La calibración no depende de esto: mide el audio y la imagen por su cuenta.
const UI_PUBLISH_MS = 100;

// Marca de tiempo para los medidores. Vive fuera del componente a propósito: los bucles de animación
// son los únicos que la usan y así la regla de pureza de React no marca una llamada impura dentro del
// componente (lo que impediría optimizarlo).
const frameNow = () => performance.now();

// El escenario (contexto, mensajes clave y líneas rojas) se muestra en una
// ventana emergente al entrar; se puede volver a abrir con "Ver escenario".
export default function CheckTecnico() {
  const { d, lang, setPracticeLock } = useI18n();
  const t = d.L.u3;
  const tb = d.L.u3b;
  const navigate = useNavigate();
  const [briefOpen, setBriefOpen] = useState(true);

  const escenario = (() => {
    try {
      return JSON.parse(sessionStorage.getItem('voxready_escenario_seleccionado'));
    } catch {
      return null;
    }
  })();

  // El idioma queda BLOQUEADO desde que se entra en la preparación: se fija con el idioma del
  // escenario elegido (el idioma activo con el que se seleccionó). Se libera al salir del flujo de
  // práctica (lo hace la cabecera) o cuando el informe queda listo.
  useEffect(() => {
    setPracticeLock({ language: lang });
  }, [lang, setPracticeLock]);

  // -----------------------------------------
  // Estados
  // -----------------------------------------

  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);

  const [cameraActive, setCameraActive] = useState(false);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [brightness, setBrightness] = useState(0);

  const [error, setError] = useState('');

  const [cameras, setCameras] = useState([]);
  const [microphones, setMicrophones] = useState([]);

  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedMicrophone, setSelectedMicrophone] = useState('');

  // -----------------------------------------
  // Referencias
  // -----------------------------------------

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioStreamRef = useRef(null);

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const microphoneSourceRef = useRef(null);
  const microphoneAnimationRef = useRef(null);

  // Ciclo de vida protegido de la calibración (intervalo + watchdog + cierre idempotente).
  const calibrationRunRef = useRef(null);
  // Marca de la última publicación de los medidores visuales (ver UI_PUBLISH_MS).
  const micPublishAtRef = useRef(0);
  const brightnessPublishAtRef = useRef(0);

  const brightnessCanvasRef = useRef(null);
  const brightnessAnimationRef = useRef(null);

  const micBufferRef = useRef(null);
  const [calibrationOutcome, setCalibrationOutcome] = useState(null);
  // La calibración terminó sin completar la ventana normal (watchdog, error o cancelación): la
  // pantalla lo explica y NUNCA se aprueba por ello (los criterios siguen en `calibration.js`).
  const [calibrationInterrupted, setCalibrationInterrupted] = useState(false);
  // Estado de preparación del medidor de postura (previo a la calibración): idle | loading | ready | failed.
  const [trackerStatus, setTrackerStatus] = useState(TRACKER_STATES.idle);

  // Precarga del medidor de postura (C1): una instancia por pantalla, una carga por elemento <video>.
  // Se crea con un inicializador perezoso de estado (no se leen refs durante el render) y publica su
  // estado para explicar la preparación y bloquear el botón mientras MediaPipe se inicializa.
  const [preload] = useState(() =>
    createTrackerPreload({
      createTracker: (video) => new PoseTracker(video),
      onState: (state) => setTrackerStatus(state),
    }),
  );

  // -----------------------------------------
  // Activar cámara
  // -----------------------------------------

  const activateCamera = async () => {
    try {
      setError('');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: selectedCamera ? { exact: selectedCamera } : undefined,
          width: 1280,
          height: 720,
        },
        audio: false,
      });

      streamRef.current = stream;

      await loadDevices();

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraActive(true);

      if (brightnessAnimationRef.current) {
        cancelAnimationFrame(brightnessAnimationRef.current);
      }

      brightnessAnimationRef.current =
        requestAnimationFrame(measureBrightness);
    } catch (err) {
      console.error('Error al activar cámara:', err);
      setError(tb.errCamera);
    }
  };

  // checkear iluminacion
  const measureBrightness = () => {
    const video = videoRef.current;

    if (!video || video.readyState < 2) {
      brightnessAnimationRef.current =
        requestAnimationFrame(measureBrightness);
      return;
    }

    // El bucle pide cuadros a la frecuencia de refresco, pero el medidor solo trabaja y publica
    // ~10 veces por segundo: así no se re-renderiza la pantalla en cada cuadro. La calibración no
    // pierde precisión por esto (mide el audio y la imagen por su cuenta).
    const nowMs = frameNow();
    const publishing = nowMs - brightnessPublishAtRef.current >= UI_PUBLISH_MS;
    if (publishing) brightnessPublishAtRef.current = nowMs;

    if (!brightnessCanvasRef.current) {
      brightnessCanvasRef.current = document.createElement('canvas');
      brightnessCanvasRef.current.width = 64;
      brightnessCanvasRef.current.height = 36;
    }

    const canvas = brightnessCanvasRef.current;
    const context = canvas.getContext('2d', {
      willReadFrequently: true,
    });

    if (context && publishing) {
      context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const imageData = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

      const pixels = imageData.data;

      let totalBrightness = 0;
      const pixelCount = pixels.length / 4;

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];

        // Luminosidad percibida
        const pixelBrightness =
          0.299 * r +
          0.587 * g +
          0.114 * b;

        totalBrightness += pixelBrightness;
      }

      setBrightness(totalBrightness / pixelCount);
    }

    // Sin contexto el bucle sigue vivo (antes se cortaba y la iluminación quedaba congelada).
    brightnessAnimationRef.current =
      requestAnimationFrame(measureBrightness);
  };

  // -----------------------------------------
  // Activar micrófono
  // -----------------------------------------

  const activateMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedMicrophone ? { exact: selectedMicrophone } : undefined,
        },
        video: false,
      });

      audioStreamRef.current = stream;
      await loadDevices();

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();

      analyser.fftSize = 256;

      const microphoneSource = audioContext.createMediaStreamSource(stream);

      microphoneSource.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      microphoneSourceRef.current = microphoneSource;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMicrophoneLevel = () => {
        // Igual que la iluminación: el bucle va a la frecuencia de refresco, pero el nivel se
        // publica ~10 veces por segundo (el medidor de la entrevista es otro y no se toca).
        const nowMs = frameNow();
        if (nowMs - micPublishAtRef.current >= UI_PUBLISH_MS) {
          micPublishAtRef.current = nowMs;
          analyser.getByteFrequencyData(dataArray);

          let total = 0;

          for (const value of dataArray) {
            total += value;
          }

          const average = total / dataArray.length;

          const level = Math.min((average / 50) * 100, 100);

          setMicrophoneLevel(level);
        }

        microphoneAnimationRef.current = requestAnimationFrame(updateMicrophoneLevel);
      };

      updateMicrophoneLevel();

      setMicrophoneActive(true);
    } catch (error) {
      console.error('Error al activar el micrófono:', error);
      setError(tb.errMic);
    }
  };

  // -----------------------------------------
  // Iniciar calibración
  // -----------------------------------------

  // Calibración real (≈10 s): durante la ventana se recogen muestras del micrófono (RMS), de la
  // imagen de la cámara y de la presencia (MediaPipe, el mismo mecanismo que usa la entrevista), y al
  // terminar se clasifican en un resultado sencillo. No es un temporizador: mide de verdad.
  //
  // El ciclo de vida (temporizadores, watchdog y cierre único) vive en `lib/practice/calibrationRun`:
  // aquí solo se conecta con la pantalla. Así la calibración SIEMPRE termina —con el resultado real—
  // aunque una medición falle, y ninguna excepción puede dejar la pantalla en «Calibrando…».

  // Una muestra: lo que se pueda medir ahora mismo.
  //  - Audio: si el contexto está suspendido se intenta reanudar; si no se puede leer, el nivel queda
  //    `null` y el resultado dirá «no disponible» (nunca se aprueba con el micrófono sin medir).
  //  - Imagen y presencia: igual que antes (la presencia solo se juzga si el modelo está cargado).
  const readCalibrationSample = () => {
    let micLevel = null;
    const analyser = analyserRef.current;
    const context = audioContextRef.current;
    if (context && context.state === 'suspended') {
      // La política del navegador puede suspenderlo (pestaña en segundo plano): se intenta reanudar
      // sin bloquear; si no se puede, la calibración sigue midiendo el resto.
      Promise.resolve(context.resume?.()).catch(() => {});
    }
    if (analyser && (!context || context.state !== 'closed')) {
      try {
        if (!micBufferRef.current || micBufferRef.current.length !== analyser.fftSize) {
          micBufferRef.current = new Float32Array(analyser.fftSize);
        }
        analyser.getFloatTimeDomainData(micBufferRef.current);
        let sum = 0;
        for (const value of micBufferRef.current) sum += value * value;
        micLevel = Math.sqrt(sum / micBufferRef.current.length);
      } catch (error) {
        // Este ciclo no se pudo medir: se registra y se sigue (el resultado no se inventa).
        console.warn('No se pudo medir el audio de la calibración:', error);
        micLevel = null;
      }
    }

    const video = videoRef.current;
    const hasImage = Boolean(video && video.readyState >= 2 && video.videoWidth > 0);
    const tracker = preload.current();
    const person = tracker?.ready ? Boolean(tracker.personNow) : null;
    return { micLevel, hasImage, person };
  };

  // Cierre ÚNICO de la calibración: lo llama la ejecución protegida al completar los 10 s, al vencer
  // el watchdog, ante un error de medición o cuando el vocero cancela.
  const handleCalibrationFinished = ({ result, reason, errorCount }) => {
    // Detiene la medición de postura (el tracker queda preparado para la siguiente calibración).
    preload.stop();
    setCalibrating(false);
    if (reason === FINISH_REASONS.cancelled) {
      // Cancelación: no hay resultado que mostrar y se puede empezar de cero.
      setCalibrationProgress(0);
      setCalibrationOutcome(null);
      setCalibrationInterrupted(false);
      return;
    }
    setCalibrationOutcome(result);
    if (reason === FINISH_REASONS.completed) {
      // Ventana completa: el progreso llega al 100 %. Si hubo fallos de medición, se explica igual.
      setCalibrationProgress(1);
      setCalibrationInterrupted(errorCount > 0);
    } else {
      // Cierre sin la ventana completa: el progreso queda en lo realmente medido (nunca se finge un
      // 100 %) y la pantalla explica que no se completó.
      setCalibrationInterrupted(true);
    }
  };

  // Cierre manual (botón «Cancelar»): usa el mismo camino protegido, así no queda nada en marcha.
  const finishCalibration = (reason = FINISH_REASONS.interrupted) => {
    const run = calibrationRunRef.current;
    if (run && !run.isFinished()) {
      run.finish(reason);
      return;
    }
    // Sin ejecución activa no hay nada que cerrar, pero el estado nunca debe quedar en «calibrando».
    setCalibrating(false);
  };

  const startCalibration = () => {
    if (!cameraActive) {
      setError(tb.errCameraFirst);
      return;
    }
    if (!microphoneActive) {
      setError(tb.errMicFirst);
      return;
    }
    if (trackerStatus === TRACKER_STATES.loading) {
      // Defensa: con el medidor preparándose el botón ya está deshabilitado, pero el estado debe
      // quedar claro también si se llega por aquí sin poder pulsarlo.
      setError(tb.trackerPreparing);
      return;
    }

    // Si quedara una ejecución anterior viva, se cierra antes de abrir la nueva (cierre idempotente).
    finishCalibration(FINISH_REASONS.cancelled);

    setError('');
    setCalibrating(true);
    setCalibrationProgress(0);
    setCalibrationOutcome(null);
    setCalibrationInterrupted(false);

    // El medidor de postura YA está preparado (precarga al activar la cámara): aquí no se crea ni se
    // carga nada. `beginRun` lo deja sin datos de la ejecución anterior; si no hay medidor (falló la
    // carga), la calibración sigue midiendo micrófono y cámara según los criterios de siempre.
    preload.beginRun();

    // Ejecución protegida: intervalo + watchdog + cierre idempotente. El resultado se publica en
    // `handleCalibrationFinished` pase lo que pase (completar, error, watchdog o cancelación).
    const run = createCalibrationRun({
      sample: readCalibrationSample,
      onSample: ({ progress }) => setCalibrationProgress(progress),
      onFinish: handleCalibrationFinished,
    });
    calibrationRunRef.current = run;
    run.start();
  };

  // -----------------------------------------
  // Escoger cámara y micrófono
  // -----------------------------------------

  const loadDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      const cameraDevices = devices.filter((device) => device.kind === 'videoinput');
      const microphoneDevices = devices.filter((device) => device.kind === 'audioinput');

      setCameras(cameraDevices);
      setMicrophones(microphoneDevices);

      if (cameraDevices.length > 0 && !selectedCamera) {
        setSelectedCamera(cameraDevices[0].deviceId);
      }

      if (microphoneDevices.length > 0 && !selectedMicrophone) {
        setSelectedMicrophone(microphoneDevices[0].deviceId);
      }
    } catch (error) {
      console.error('Error obteniendo dispositivos:', error);
      setError(tb.errDevices);
    }
  };

  // -----------------------------------------
  // Limpieza al abandonar la página
  // -----------------------------------------

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      // La calibración en curso se cierra EN SILENCIO (sin tocar estado de una pantalla que se va):
      // limpia intervalo y watchdog y marca la ejecución como cerrada.
      calibrationRunRef.current?.dispose();
      calibrationRunRef.current = null;

      if (microphoneAnimationRef.current) {
        cancelAnimationFrame(microphoneAnimationRef.current);
      }

      if (brightnessAnimationRef.current) {
        cancelAnimationFrame(brightnessAnimationRef.current);
        brightnessAnimationRef.current = null;
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
      }

      // El medidor de postura se cierra aquí: si la carga quedó a medias, sus recursos (grafos de
      // MediaPipe) se liberan cuando termine, sin quedarse abiertos tras abandonar la pantalla.
      preload.dispose();
    };
  }, [preload]);

  useEffect(() => {
    loadDevices();
  }, []);

  // C1: prepara MediaPipe en cuanto la cámara entrega imagen, para que el clic «Iniciar calibración»
  // no cargue nada. Se pide SIN rostro (la calibración sólo necesita la presencia corporal) y sin
  // bloquear la interfaz: mientras carga, el botón queda deshabilitado y se explica el estado.
  useEffect(() => {
    if (!cameraActive) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    let cancelled = false;
    const prepare = () => {
      if (cancelled) return;
      preload.ensure(video, { face: false });
    };

    // El <video> debe poder entregar cuadros (readyState ≥ 2); si aún no, se espera al primer cuadro.
    if (video.readyState >= 2) {
      prepare();
      return () => {
        cancelled = true;
      };
    }
    video.addEventListener('loadeddata', prepare, { once: true });
    return () => {
      cancelled = true;
      video.removeEventListener('loadeddata', prepare);
    };
  }, [cameraActive, preload]);

  // -----------------------------------------
  // Niveles de iluminación
  // -----------------------------------------

  const getBrightnessStatus = () => {
    if (brightness < 45) {
      return { label: tb.lightBad, level: 1, tone: 'danger', bar: 'bg-danger' };
    }

    if (brightness < 100) {
      return { label: tb.lightGood, level: 2, tone: 'success', bar: 'bg-success' };
    }

    return { label: tb.lightExcellent, level: 3, tone: 'success', bar: 'bg-success' };
  };

  const brightnessStatus = getBrightnessStatus();

  const lightingOk = cameraActive && brightness >= 45;

  // -----------------------------------------
  // Requisitos para comenzar
  // -----------------------------------------

  const consentOk = check1 && check2;
  const calibrationDone = calibrationProgress >= 1;
  // Resultado real de la calibración: solo se exige que no haya problemas que impidan practicar
  // (sin señal de micrófono o cámara sin imagen). Volumen bajo y encuadre mejorable solo avisan.
  const calibrationOk = Boolean(calibrationOutcome?.canStart);

  const MIC_LABELS = {
    ok: tb.calibMicOk,
    low: tb.calibMicLow,
    silent: tb.calibMicSilent,
    unavailable: tb.calibMicNone,
  };
  const CAMERA_LABELS = { ok: tb.calibCamOk, 'no-image': tb.calibCamNoImage, framing: tb.calibCamFraming };
  const calibrationMicLabel = calibrationOutcome ? MIC_LABELS[calibrationOutcome.mic.status] : '';
  const calibrationCameraLabel = calibrationOutcome ? CAMERA_LABELS[calibrationOutcome.camera.status] : '';
  const calibrationHints = calibrationOutcome
    ? [
        calibrationOutcome.mic.status === 'low' && tb.calibHintLow,
        calibrationOutcome.mic.status === 'silent' && tb.calibHintSilent,
        calibrationOutcome.mic.status === 'unavailable' && tb.calibHintMicUnavailable,
        calibrationOutcome.camera.status === 'no-image' && tb.calibHintNoImage,
        calibrationOutcome.camera.status === 'framing' && tb.calibHintFraming,
        calibrationOutcome.mic.noise === 'high' && tb.calibHintNoise,
      ].filter(Boolean)
    : [];

  const canStart =
    consentOk &&
    cameraActive &&
    microphoneActive &&
    lightingOk &&
    calibrationDone &&
    calibrationOk;

  const checks = [
    { label: tb.checkCamera, ok: cameraActive, icon: 'camera' },
    { label: tb.checkMic, ok: microphoneActive, icon: 'mic' },
    { label: tb.checkLighting, ok: lightingOk, icon: 'sun', warn: cameraActive && !lightingOk },
    {
      label: tb.checkCalibration,
      ok: calibrationDone && calibrationOk,
      icon: 'person',
      progress: calibrating,
      warn: (calibrationDone && !calibrationOk) || calibrationInterrupted,
    },
    { label: tb.checkConsent, ok: consentOk, icon: 'shield' },
  ];
  const doneCount = checks.filter((c) => c.ok).length;

  // -----------------------------------------
  // Render
  // -----------------------------------------

  return (
    <>
      <PracticeSteps />
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <>
            {escenario && (
              <Button variant="secondary" size="sm" icon="file" onClick={() => setBriefOpen(true)}>
                {tb.viewScenario}
              </Button>
            )}
            {escenario && <Badge tone="outline" icon="layers">{escenario.title}</Badge>}
          </>
        }
      />

      <ScenarioBriefModal scenario={escenario} open={briefOpen} onClose={() => setBriefOpen(false)} />

      {!escenario && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-ink">
          <Icon name="info" size={16} className="text-warning" />
          <span className="flex-1">{tb.noScenario}</span>
          <Button size="sm" variant="secondary" to="/vocero/escenarios">{tb.chooseScenario}</Button>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          <div className="flex items-center gap-3">
            <Icon name="alert" size={16} />
            {error}
          </div>
          {/* Sin permisos no hay nada que medir: se explica cómo habilitarlos. */}
          {(error === tb.errCamera || error === tb.errMic) && (
            <p className="text-xs text-muted mt-1 pl-7">{tb.permissionHint}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6">
        {/* ----------------------------- Cámara y hardware */}
        <div className="space-y-6">
          <div className="relative aspect-video rounded-2xl overflow-hidden bg-[#0B1118] ring-1 ring-line">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={cx('absolute inset-0 w-full h-full object-cover -scale-x-100', cameraActive ? 'block' : 'hidden')}
            />

            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-4">
                <span className="h-14 w-14 rounded-full bg-white/5 flex items-center justify-center text-white/60">
                  <Icon name="camera" size={24} />
                </span>
                <div>
                  <div className="text-white/80 text-sm font-medium">{tb.cameraOff}</div>
                  <div className="text-white/40 text-xs mt-1">{tb.cameraOffHint}</div>
                </div>
                <Button variant="secondary" size="sm" icon="camera" onClick={activateCamera}>
                  {tb.activateCamera}
                </Button>
              </div>
            )}

            {cameraActive && (
              <>
                <div className="absolute top-3 left-3 flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur px-3 h-7 text-white text-xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {tb.cameraActive}
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur px-3 h-7 text-white text-xs">
                    <Icon name="sun" size={12} className={lightingOk ? 'text-emerald-400' : 'text-red-400'} />
                    {tb.light(brightnessStatus.label.toLowerCase())}
                  </div>
                </div>
                {/* Guía de encuadre */}
                <div className="pointer-events-none absolute inset-8 rounded-2xl border border-dashed border-white/20" />
              </>
            )}


          </div>

          <Card>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label={tb.fieldCamera}>
                <div className="flex gap-2">
                  <select value={selectedCamera} onChange={(e) => setSelectedCamera(e.target.value)} className="input flex-1 min-w-0">
                    {cameras.length === 0 ? (
                      <option value="">{tb.noCameras}</option>
                    ) : (
                      cameras.map((camera, index) => (
                        <option key={camera.deviceId || index} value={camera.deviceId}>
                          {camera.label || tb.cameraN(index + 1)}
                        </option>
                      ))
                    )}
                  </select>
                  <Button
                    variant={cameraActive ? 'secondary' : 'primary'}
                    size="icon"
                    onClick={activateCamera}
                    disabled={cameraActive}
                    title={cameraActive ? tb.cameraActive : tb.activateCamera}
                    className="h-10 w-10"
                  >
                    <Icon name={cameraActive ? 'check' : 'camera'} size={16} />
                  </Button>
                </div>
              </Field>

              <Field label={tb.fieldMic}>
                <div className="flex gap-2">
                  <select
                    value={selectedMicrophone}
                    onChange={(e) => setSelectedMicrophone(e.target.value)}
                    className="input flex-1 min-w-0"
                  >
                    {microphones.length === 0 ? (
                      <option value="">{tb.noMics}</option>
                    ) : (
                      microphones.map((microphone, index) => (
                        <option key={microphone.deviceId || index} value={microphone.deviceId}>
                          {microphone.label || tb.micN(index + 1)}
                        </option>
                      ))
                    )}
                  </select>
                  <Button
                    variant={microphoneActive ? 'secondary' : 'primary'}
                    size="icon"
                    onClick={activateMicrophone}
                    disabled={microphoneActive}
                    title={microphoneActive ? tb.micActive : tb.activateMic}
                    className="h-10 w-10"
                  >
                    <Icon name={microphoneActive ? 'check' : 'mic'} size={16} />
                  </Button>
                </div>
              </Field>
            </div>

            {/* Nivel del micrófono */}
            <div className="mt-6">
              <div className="flex justify-between text-xs text-muted mb-2">
                <span>{tb.micLevel}</span>
                <span className="tabular-nums">{microphoneActive ? `${Math.round(microphoneLevel)}%` : '—'}</span>
              </div>
              <div className="flex items-end gap-[3px] h-8">
                {Array.from({ length: 40 }).map((_, i) => {
                  const on = microphoneActive && (i / 40) * 100 < microphoneLevel;
                  return (
                    <span
                      key={i}
                      className={cx('flex-1 rounded-sm transition-colors duration-75', on ? (i > 32 ? 'bg-accent' : 'bg-success') : 'bg-subtle')}
                      style={{ height: `${30 + (i % 5) * 14}%` }}
                    />
                  );
                })}
              </div>
            </div>
            {/* Iluminación */}
            <div className="mt-6">
              <div className="flex items-center justify-between text-xs text-muted mb-2">
                <span>{tb.lighting}</span>
                {cameraActive ? (
                  <Badge tone={brightnessStatus.tone}>{brightnessStatus.label}</Badge>
                ) : (
                  <span>—</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[1, 2, 3].map((level) => (
                  <span
                    key={level}
                    className={cx(
                      'h-1.5 rounded-full transition-colors duration-300',
                      cameraActive && brightnessStatus.level >= level ? brightnessStatus.bar : 'bg-subtle',
                    )}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 text-[11px] text-faint mt-1.5">
                <span>{tb.lightBad}</span>
                <span className="text-center">{tb.lightGood}</span>
                <span className="text-right">{tb.lightExcellent}</span>
              </div>
              {cameraActive && !lightingOk && (
                <p className="flex items-start gap-1.5 text-xs text-danger mt-3 leading-relaxed">
                  <Icon name="sun" size={13} className="mt-0.5" />
                  {tb.darkWarning}
                </p>
              )}
            </div>

            {/* Calibración real del equipo (micrófono + cámara, ≈10 s) */}
            <div className="mt-6 pt-6 border-t border-line">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-ink">{tb.calibration}</span>
                    <span className="text-xs text-muted tabular-nums">
                      {calibrating
                        ? tb.calibProgress(Math.ceil((1 - calibrationProgress) * (CALIBRATION_MS / 1000)))
                        : calibrationDone
                          ? tb.completed
                          : tb.pending}
                    </span>
                  </div>
                  <Progress value={calibrationProgress * 100} tone={calibrationDone && calibrationOk ? 'success' : 'accent'} />
                  <p className="text-xs text-faint mt-2">{calibrating ? tb.calibHintStay : tb.calibrationHint}</p>
                  {/* Estado del medidor de postura (precarga C1), antes de calibrar. */}
                  {!calibrating && trackerStatus !== TRACKER_STATES.idle && (
                    <p
                      className={cx(
                        'text-xs mt-1',
                        trackerStatus === TRACKER_STATES.failed ? 'text-danger' : 'text-muted',
                      )}
                    >
                      {trackerStatus === TRACKER_STATES.loading
                        ? tb.trackerPreparing
                        : trackerStatus === TRACKER_STATES.failed
                          ? tb.trackerFailed
                          : tb.trackerReady}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    icon="person"
                    onClick={startCalibration}
                    disabled={
                      !cameraActive ||
                      !microphoneActive ||
                      calibrating ||
                      trackerStatus === TRACKER_STATES.loading
                    }
                  >
                    {calibrating ? tb.calibrating : calibrationDone ? tb.recalibrate : tb.startCalibration}
                  </Button>
                  {/* Salida segura: cierra la medición con el mismo camino protegido. */}
                  {calibrating && (
                    <Button variant="ghost" size="sm" onClick={() => finishCalibration(FINISH_REASONS.cancelled)}>
                      {t.cancel}
                    </Button>
                  )}
                </div>
              </div>

              {/* Qué requisito falta para poder calibrar (la razón, no solo el botón deshabilitado) */}
              {!calibrating && (!cameraActive || !microphoneActive) && (
                <p className="text-xs text-danger mt-2">{!cameraActive ? tb.errCameraFirst : tb.errMicFirst}</p>
              )}

              {/* Resultado: qué se midió y qué debe corregir el vocero (si hace falta) */}
              {calibrationOutcome && !calibrating && (
                <div
                  className={cx(
                    'mt-4 rounded-xl border px-4 py-3',
                    calibrationOk ? 'border-success/30 bg-success/5' : 'border-danger/30 bg-danger/5',
                  )}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-ink">
                    <Icon
                      name={calibrationOk ? 'check' : 'alert'}
                      size={15}
                      strokeWidth={calibrationOk ? 2.5 : 1.75}
                      className={calibrationOk ? 'text-success' : 'text-danger'}
                    />
                    {calibrationOk ? tb.calibReady : tb.calibReview}
                  </div>
                  <div className="mt-2 space-y-1 text-[13px]">
                    <div className="text-muted">{tb.calibrationResult}</div>
                    <div className={cx(calibrationOutcome.mic.status === 'ok' ? 'text-muted' : 'text-danger')}>{calibrationMicLabel}</div>
                    <div className={cx(calibrationOutcome.camera.status === 'ok' ? 'text-muted' : 'text-danger')}>{calibrationCameraLabel}</div>
                    {calibrationHints.map((hint) => (
                      <div key={hint} className="text-danger">
                        {hint}
                      </div>
                    ))}
                    {/* Cierre sin la ventana completa (watchdog, error o cancelación): se explica. */}
                    {calibrationInterrupted && <div className="text-danger">{tb.calibInterrupted}</div>}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ----------------------------- Consentimiento */}
        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <span className="eyebrow">{tb.status}</span>
              <span className="text-xs text-muted tabular-nums">
                {tb.statusOf(doneCount, checks.length)}
              </span>
            </div>
            <ul className="space-y-3">
              {checks.map((c) => (
                <li key={c.label} className="flex items-center gap-3">
                  <span
                    className={cx(
                      'h-8 w-8 rounded-lg flex items-center justify-center',
                      c.ok ? 'bg-success/10 text-success' : c.warn ? 'bg-danger/10 text-danger' : 'bg-subtle text-faint',
                    )}
                  >
                    <Icon name={c.ok ? 'check' : c.icon} size={15} strokeWidth={c.ok ? 2.5 : 1.75} />
                  </span>
                  <span className={cx('text-sm flex-1', c.ok ? 'text-ink' : 'text-muted')}>{c.label}</span>
                  <span className={cx('text-xs', c.warn ? 'text-danger' : 'text-faint')}>
                    {c.ok ? tb.ready : c.warn ? tb.insufficient : c.progress ? tb.inProgress : tb.pending}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <Icon name="shield" size={16} className="text-muted" />
              <h3 className="text-[15px] font-semibold text-ink">{t.consentL}</h3>
            </div>
            <p className="text-[13px] text-muted leading-relaxed rounded-xl bg-subtle/70 p-4 mb-5">{t.legal}</p>

            <div className="space-y-4">
              <Checkbox checked={check1} onChange={setCheck1}>{t.chk1}</Checkbox>
              <Checkbox checked={check2} onChange={setCheck2}>{t.chk2}</Checkbox>
            </div>

            <div className="mt-6 pt-6 border-t border-line">
              <Button
                variant="accent"
                size="lg"
                className="w-full"
                iconRight="arrowRight"
                onClick={() => {
                  sessionStorage.setItem(
                    'voxready_dispositivos',
                    JSON.stringify({
                      cameraId: selectedCamera,
                      microphoneId: selectedMicrophone,
                    })
                  );

                  navigate('/vocero/sesion');
                }}
                disabled={!canStart}
              >
                {t.beginBtn}
              </Button>
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-faint">{!canStart && t.sesLang}</span>
                <Button variant="ghost" size="sm" onClick={() => navigate('/vocero/escenarios')}>
                  {t.cancel}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
