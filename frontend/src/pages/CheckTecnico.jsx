import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';

export default function CheckTecnico() {
  const d = I.es;
  const t = d.L.u3;
  const navigate = useNavigate();

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

  const [selectedCamera, setSelectedCamera] = useState("");
  const [selectedMicrophone, setSelectedMicrophone] = useState("");

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
          deviceId: selectedCamera
            ? { exact: selectedCamera }
            : undefined,
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
      setError(
        'No se pudo acceder a la cámara. Revisa los permisos del navegador.'
      );
    }
  };

  // -----------------------------------------
  // Activar micrófono
  // -----------------------------------------

  const activateMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedMicrophone
            ? { exact: selectedMicrophone }
            : undefined,
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

        microphoneAnimationRef.current =
          requestAnimationFrame(updateMicrophoneLevel);
      };

      updateMicrophoneLevel();

      setMicrophoneActive(true);
    } catch (error) {
      console.error("Error al activar el micrófono:", error);
      setError("No se pudo acceder al micrófono.");
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
  // Escoger camara y microfono
  // -----------------------------------------

  const loadDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      const cameraDevices = devices.filter(
        (device) => device.kind === "videoinput"
      );

      const microphoneDevices = devices.filter(
        (device) => device.kind === "audioinput"
      );

      setCameras(cameraDevices);
      setMicrophones(microphoneDevices);

      if (cameraDevices.length > 0 && !selectedCamera) {
        setSelectedCamera(cameraDevices[0].deviceId);
      }

      if (microphoneDevices.length > 0 && !selectedMicrophone) {
        setSelectedMicrophone(microphoneDevices[0].deviceId);
      }
    } catch (error) {
      console.error("Error obteniendo dispositivos:", error);
      setError("No se pudieron obtener los dispositivos.");
    }
  };

  // -----------------------------------------
  // Limpieza al abandonar la página
  // -----------------------------------------

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
      }

      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
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

  // -----------------------------------------
  // Consentimiento
  // -----------------------------------------

  const canStart = check1 && check2;

  // -----------------------------------------
  // Render
  // -----------------------------------------

  useEffect(() => {
    loadDevices();
  }, []);

  return (
    <div className="animate-fade-in pb-10">

      <div className="text-xs text-[var(--muted)] mb-1">
        {t.crumbs}
      </div>

      <h2 className="text-2xl font-bold mb-1 text-[var(--ink)]">
        {t.title}
      </h2>

      <p className="text-sm text-[var(--muted)] mb-6">
        {t.sub}
      </p>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-300 bg-red-50 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-[var(--panel)] border border-[var(--line2)] rounded-lg overflow-hidden shadow-sm">

        {/* Barra superior */}
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--chrome2)] border-b border-[var(--line)]">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--line)]"></span>

          <div className="flex-1 ml-2 bg-[var(--panel)] border border-[var(--line)] rounded-[5px] text-[11px] text-[var(--muted)] px-3 py-1">
            app.voxready.io/sesion/preparar
          </div>
        </div>

        <div className="p-5 md:p-6">

          <div className="flex flex-col md:flex-row gap-6">

            {/* ----------------------------------------- */}
            {/* Cámara y hardware */}
            {/* ----------------------------------------- */}

            <div className="flex-1 border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5">

              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">
                {t.camL}
              </div>

              {/* Previsualización de cámara */}
              <div className="relative border border-[var(--line2)] rounded-lg min-h-[200px] bg-[#323b43] flex items-center justify-center overflow-hidden mb-4 shadow-inner">

                {!cameraActive && (
                  <span className="text-[13px] text-[#cdd4da]">
                    Cámara desactivada
                  </span>
                )}

                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${
                    cameraActive ? 'block' : 'hidden'
                  }`}
                />

                {cameraActive && (
                  <div className="absolute top-2 right-2.5 flex items-center gap-1.5 bg-black/40 px-2.5 py-1 rounded-md text-white text-[11px]">
                    <span className="w-2 h-2 rounded-full bg-[#3b6d11]"></span>
                    Cámara activa
                  </div>
                )}

              </div>

              {/* Botones */}
              <div className="flex flex-wrap gap-2 mb-5">

                <button
                  onClick={activateCamera}
                  disabled={cameraActive}
                  className={`px-4 py-2 text-xs font-semibold rounded-md border transition-all ${
                    cameraActive
                      ? 'bg-[var(--panel)] border-[var(--line2)] text-[var(--muted)] cursor-not-allowed'
                      : 'bg-[var(--accent2)] border-[var(--accent2)] text-white hover:brightness-105'
                  }`}
                >
                  {cameraActive ? 'Cámara activa' : 'Activar cámara'}
                </button>

                <button
                  onClick={activateMicrophone}
                  disabled={microphoneActive}
                  className={`px-4 py-2 text-xs font-semibold rounded-md border transition-all ${
                    microphoneActive
                      ? 'bg-[var(--panel)] border-[var(--line2)] text-[var(--muted)] cursor-not-allowed'
                      : 'bg-[var(--accent2)] border-[var(--accent2)] text-white hover:brightness-105'
                  }`}
                >
                  {microphoneActive
                    ? 'Micrófono activo'
                    : 'Activar micrófono'}
                </button>
                {microphoneActive && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span>Nivel del micrófono</span>
                      <span>{Math.round(microphoneLevel)}%</span>
                    </div>

                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full transition-all duration-75"
                        style={{ width: `${microphoneLevel}%` }}
                      />
                    </div>
                  </div>
                )}

              </div>

              <div className="mb-3">
              <label className="block text-sm font-medium mb-1">
                Cámara
              </label>

              <select
                value={selectedCamera}
                onChange={(e) => setSelectedCamera(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              >
                {cameras.length === 0 ? (
                  <option value="">No se encontraron cámaras</option>
                ) : (
                  cameras.map((camera, index) => (
                    <option key={camera.deviceId} value={camera.deviceId}>
                      {camera.label || `Cámara ${index + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="mb-3">
            <label className="block text-sm font-medium mb-1">
              Micrófono
            </label>

            <select
              value={selectedMicrophone}
              onChange={(e) => setSelectedMicrophone(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            >
              {microphones.length === 0 ? (
                <option value="">No se encontraron micrófonos</option>
              ) : (
                microphones.map((microphone, index) => (
                  <option
                    key={microphone.deviceId}
                    value={microphone.deviceId}
                  >
                    {microphone.label || `Micrófono ${index + 1}`}
                  </option>
                ))
              )}
            </select>
          </div>

              {/* Calibración */}
              <div className="border-t border-[var(--line)] pt-4">

                <div className="flex justify-between text-xs mb-2">
                  <span>Calibración corporal</span>

                  <span className="text-[var(--muted)]">
                    {calibrating
                      ? `${Math.round(calibrationProgress * 100)}%`
                      : calibrationProgress >= 1
                        ? 'Completada'
                        : 'Pendiente'}
                  </span>
                </div>

                <div className="h-2.5 rounded-[5px] bg-[var(--barfill)] overflow-hidden mb-3">
                  <div
                    className="h-full bg-[var(--accent2)] rounded-r-[5px] transition-all"
                    style={{
                      width: `${calibrationProgress * 100}%`,
                    }}
                  />
                </div>

                <button
                  onClick={startCalibration}
                  disabled={!cameraActive || calibrating}
                  className={`px-4 py-2 text-xs font-semibold rounded-md border transition-all ${
                    !cameraActive || calibrating
                      ? 'bg-[var(--panel)] border-[var(--line2)] text-[var(--muted)] cursor-not-allowed'
                      : 'bg-[var(--accent2)] border-[var(--accent2)] text-white hover:brightness-105'
                  }`}
                >
                  {calibrating
                    ? 'Calibrando...'
                    : 'Iniciar calibración'}
                </button>

                <p className="text-[11px] text-[var(--muted)] mt-2">
                  Durante la calibración permanece quieto frente a la cámara.
                </p>

              </div>

            </div>

            {/* ----------------------------------------- */}
            {/* Consentimiento */}
            {/* ----------------------------------------- */}

            <div className="flex-1 border border-[var(--line)] rounded-lg bg-[var(--panel)] p-5 flex flex-col">

              <div className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-bold mb-3">
                {t.consentL}
              </div>

              <div className="border border-[var(--line)] rounded-md bg-[var(--panel)] min-h-[110px] p-4 text-xs text-[var(--muted)] mb-5">
                {t.legal}
              </div>

              <label className="flex items-start gap-2.5 mb-3 cursor-pointer group">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 accent-[var(--accent2)] shrink-0 cursor-pointer"
                  checked={check1}
                  onChange={(e) => setCheck1(e.target.checked)}
                />

                <span className="text-xs group-hover:text-[var(--accent)] transition-colors">
                  {t.chk1}
                </span>
              </label>

              <label className="flex items-start gap-2.5 mb-5 cursor-pointer group">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 accent-[var(--accent2)] shrink-0 cursor-pointer"
                  checked={check2}
                  onChange={(e) => setCheck2(e.target.checked)}
                />

                <span className="text-xs group-hover:text-[var(--accent)] transition-colors">
                  {t.chk2}
                </span>
              </label>

              <div className="mt-auto">

                <div className="flex gap-3 mb-2">

                  <button
                    onClick={() => navigate('/vocero/sesion')}
                    disabled={!canStart}
                    className={`px-4 py-2 text-xs font-semibold rounded-md transition-all border ${
                      canStart
                        ? 'bg-[var(--accent2)] border-[var(--accent2)] text-white hover:brightness-105 cursor-pointer'
                        : 'bg-[var(--panel)] border-[var(--line2)] text-[var(--ink)] opacity-40 cursor-not-allowed'
                    }`}
                  >
                    {t.beginBtn}
                  </button>

                  <button
                    onClick={() => navigate('/vocero/escenarios')}
                    className="px-4 py-2 text-xs font-semibold rounded-md border border-transparent bg-transparent text-[var(--ink)] hover:bg-[var(--soft)] transition-colors"
                  >
                    {t.cancel}
                  </button>

                </div>

                <div className="text-[11px] text-[var(--muted)]">
                  {t.sesLang}
                </div>

              </div>

            </div>

          </div>

          <div className="mt-6 bg-[var(--note)] border border-[var(--noteline)] rounded-lg p-4 text-xs text-[var(--notetext)] leading-relaxed">
            <b className="font-bold">{d.noteUX}</b> {t.note}
          </div>

        </div>
      </div>
    </div>
  );
}
