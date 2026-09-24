import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import PracticeSteps from '../components/PracticeSteps';
import { Badge, Button, Card, Checkbox, Field, PageHeader, Progress, cx } from '../components/ui';

export default function CheckTecnico() {
  const t = I.es.L.u3;
  const navigate = useNavigate();

  const escenario = (() => {
    try {
      return JSON.parse(sessionStorage.getItem('voxready_escenario_seleccionado'));
    } catch {
      return null;
    }
  })();

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

  const calibrationTimerRef = useRef(null);

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
    } catch (err) {
      console.error('Error al activar cámara:', err);
      setError('No se pudo acceder a la cámara. Revisa los permisos del navegador.');
    }
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
        analyser.getByteFrequencyData(dataArray);

        let total = 0;

        for (const value of dataArray) {
          total += value;
        }

        const average = total / dataArray.length;

        const level = Math.min((average / 50) * 100, 100);

        setMicrophoneLevel(level);

        microphoneAnimationRef.current = requestAnimationFrame(updateMicrophoneLevel);
      };

      updateMicrophoneLevel();

      setMicrophoneActive(true);
    } catch (error) {
      console.error('Error al activar el micrófono:', error);
      setError('No se pudo acceder al micrófono.');
    }
  };

  // -----------------------------------------
  // Iniciar calibración
  // -----------------------------------------

  const startCalibration = () => {
    if (!cameraActive) {
      setError('Primero debes activar la cámara.');
      return;
    }

    setError('');
    setCalibrating(true);
    setCalibrationProgress(0);

    const startTime = performance.now();
    const duration = 30000;

    calibrationTimerRef.current = setInterval(() => {
      const elapsed = performance.now() - startTime;

      const progress = Math.min(elapsed / duration, 1);

      setCalibrationProgress(progress);

      if (progress >= 1) {
        clearInterval(calibrationTimerRef.current);
        calibrationTimerRef.current = null;
        setCalibrating(false);
      }
    }, 100);
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
      setError('No se pudieron obtener los dispositivos.');
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

      if (calibrationTimerRef.current) {
        clearInterval(calibrationTimerRef.current);
      }

      if (microphoneAnimationRef.current) {
        cancelAnimationFrame(microphoneAnimationRef.current);
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    loadDevices();
  }, []);

  // -----------------------------------------
  // Consentimiento
  // -----------------------------------------

  const canStart = check1 && check2;
  const calibrationDone = calibrationProgress >= 1;

  const checks = [
    { label: 'Cámara', ok: cameraActive, icon: 'camera' },
    { label: 'Micrófono', ok: microphoneActive, icon: 'mic' },
    { label: 'Calibración corporal', ok: calibrationDone, icon: 'person', progress: calibrating },
    { label: 'Consentimiento', ok: canStart, icon: 'shield' },
  ];

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
        actions={escenario && <Badge tone="outline" icon="layers">{escenario.title}</Badge>}
      />

      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          <Icon name="alert" size={16} />
          {error}
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
                  <div className="text-white/80 text-sm font-medium">Cámara desactivada</div>
                  <div className="text-white/40 text-xs mt-1">Actívala para ver la vista previa</div>
                </div>
                <Button variant="secondary" size="sm" icon="camera" onClick={activateCamera}>
                  Activar cámara
                </Button>
              </div>
            )}

            {cameraActive && (
              <>
                <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur px-3 h-7 text-white text-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Cámara activa
                </div>
                {/* Guía de encuadre */}
                <div className="pointer-events-none absolute inset-8 rounded-2xl border border-dashed border-white/20" />
              </>
            )}

            {calibrating && (
              <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/70 to-transparent">
                <div className="flex justify-between text-xs text-white/80 mb-2">
                  <span>Calibrando… permanece quieto</span>
                  <span className="tabular-nums">{Math.round(calibrationProgress * 100)}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/15 overflow-hidden">
                  <div className="h-full bg-white rounded-full" style={{ width: `${calibrationProgress * 100}%` }} />
                </div>
              </div>
            )}
          </div>

          <Card>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Cámara">
                <div className="flex gap-2">
                  <select value={selectedCamera} onChange={(e) => setSelectedCamera(e.target.value)} className="input flex-1 min-w-0">
                    {cameras.length === 0 ? (
                      <option value="">No se encontraron cámaras</option>
                    ) : (
                      cameras.map((camera, index) => (
                        <option key={camera.deviceId || index} value={camera.deviceId}>
                          {camera.label || `Cámara ${index + 1}`}
                        </option>
                      ))
                    )}
                  </select>
                  <Button
                    variant={cameraActive ? 'secondary' : 'primary'}
                    size="icon"
                    onClick={activateCamera}
                    disabled={cameraActive}
                    title={cameraActive ? 'Cámara activa' : 'Activar cámara'}
                    className="h-10 w-10"
                  >
                    <Icon name={cameraActive ? 'check' : 'camera'} size={16} />
                  </Button>
                </div>
              </Field>

              <Field label="Micrófono">
                <div className="flex gap-2">
                  <select
                    value={selectedMicrophone}
                    onChange={(e) => setSelectedMicrophone(e.target.value)}
                    className="input flex-1 min-w-0"
                  >
                    {microphones.length === 0 ? (
                      <option value="">No se encontraron micrófonos</option>
                    ) : (
                      microphones.map((microphone, index) => (
                        <option key={microphone.deviceId || index} value={microphone.deviceId}>
                          {microphone.label || `Micrófono ${index + 1}`}
                        </option>
                      ))
                    )}
                  </select>
                  <Button
                    variant={microphoneActive ? 'secondary' : 'primary'}
                    size="icon"
                    onClick={activateMicrophone}
                    disabled={microphoneActive}
                    title={microphoneActive ? 'Micrófono activo' : 'Activar micrófono'}
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
                <span>Nivel del micrófono</span>
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

            {/* Calibración */}
            <div className="mt-6 pt-6 border-t border-line flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-ink">Calibración corporal</span>
                  <span className="text-xs text-muted tabular-nums">
                    {calibrating ? `${Math.round(calibrationProgress * 100)}%` : calibrationDone ? 'Completada' : 'Pendiente'}
                  </span>
                </div>
                <Progress value={calibrationProgress * 100} tone={calibrationDone ? 'success' : 'accent'} />
                <p className="text-xs text-faint mt-2">Durante la calibración permanece quieto frente a la cámara.</p>
              </div>
              <Button variant="secondary" icon="person" onClick={startCalibration} disabled={!cameraActive || calibrating}>
                {calibrating ? 'Calibrando…' : 'Iniciar calibración'}
              </Button>
            </div>
          </Card>
        </div>

        {/* ----------------------------- Consentimiento */}
        <div className="space-y-6">
          <Card>
            <div className="eyebrow mb-4">Estado</div>
            <ul className="space-y-3">
              {checks.map((c) => (
                <li key={c.label} className="flex items-center gap-3">
                  <span
                    className={cx(
                      'h-8 w-8 rounded-lg flex items-center justify-center',
                      c.ok ? 'bg-success/10 text-success' : 'bg-subtle text-faint',
                    )}
                  >
                    <Icon name={c.ok ? 'check' : c.icon} size={15} strokeWidth={c.ok ? 2.5 : 1.75} />
                  </span>
                  <span className={cx('text-sm flex-1', c.ok ? 'text-ink' : 'text-muted')}>{c.label}</span>
                  <span className="text-xs text-faint">{c.ok ? 'Listo' : c.progress ? 'En curso' : 'Pendiente'}</span>
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
                onClick={() => navigate('/vocero/sesion')}
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
