import { useEffect, useRef, useState } from "react";

import {
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils,
} from "@mediapipe/tasks-vision";
import toast from "react-hot-toast";
import Icon from "../components/Icon";
import { Button, Card, PageHeader, Progress } from "../components/ui";

function MediaPipeTest() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const CALIBRATION_DURATION = 30000;

  const poseLandmarkerRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Landmarks anteriores para calcular movimiento
  const previousLandmarksRef = useRef(null);

  // Landmarks anteriores utilizados exclusivamente para suavizar
  const smoothedLandmarksRef = useRef(null);
  const smoothingFactorsRef = useRef({
    head: 0,
    shoulders: 0,
    arms: 0,
    hands: 0,
    torso: 0,
    hips: 0,
    legs: 0,
    knees: 0,
    feet: 0,
  });

  const noiseThresholdsRef = useRef({
    head: 0,
    shoulders: 0,
    arms: 0,
    hands: 0,
    torso: 0,
    hips: 0,
    legs: 0,
    knees: 0,
    feet: 0,
  });

  // Información de calibración
  const calibrationRef = useRef({
    active: false,
    startTime: null,
    samples: [],
  });

  const INITIAL_SMOOTHING = 0.10;

  const analysisSamplesRef = useRef([]);
  const sessionStartTimeRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [error, setError] = useState(null);

  const [calibrating, setCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationResult, setCalibrationResult] = useState(null);

  // Partes del cuerpo que vamos a analizar inicialmente
  const BODY_PARTS = {
    head: [
      0,  // nose
      1, 2, 3,  // left eye
      4, 5, 6,  // right eye
      7, 8,      // ears
      9, 10,     // mouth
    ],

    shoulders: [
      11, 12,
    ],

    arms: [
      13, 14,
    ],

    hands: [
      15, 16,   // wrists
      17, 18,   // pinkies
      19, 20,   // index
      21, 22,   // thumbs
    ],

    torso: [
      11, 12,   // shoulders
      23, 24,   // hips
    ],

    hips: [
      23, 24,
    ],

    legs: [
      25, 26,   // knees
      27, 28,   // ankles
    ],

    knees: [
      25, 26,
    ],

    feet: [
      27, 28,   // ankles
      29, 30,   // heels
      31, 32,   // foot index
    ],
  };

  // --------------------------------------------------
  // 1. Cargar MediaPipe
  // --------------------------------------------------

  useEffect(() => {
    const initializeMediaPipe = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
        );

        const poseLandmarker =
          await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",

              delegate: "GPU",
            },

            runningMode: "VIDEO",

            numPoses: 1,

            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });

        poseLandmarkerRef.current = poseLandmarker;

        setLoading(false);

        console.log("MediaPipe cargado correctamente");
      } catch (err) {
        console.error("Error inicializando MediaPipe:", err);

        setError("No se pudo cargar MediaPipe.");
        setLoading(false);
      }
    };

    initializeMediaPipe();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      if (poseLandmarkerRef.current) {
        poseLandmarkerRef.current.close();
      }
    };
  }, []);

  // --------------------------------------------------
  // 2. Iniciar cámara
  // --------------------------------------------------
  
  const startCamera = async () => {
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: 1280,
          height: 720,
        },
        audio: false,
      });

      const video = videoRef.current;

      if (!video) {
        return;
      }

      video.srcObject = stream;

      await video.play();

      setCameraStarted(true);

      analysisSamplesRef.current = [];
      sessionStartTimeRef.current = performance.now();

      // Reiniciamos información anterior
      previousLandmarksRef.current = null;
      smoothedLandmarksRef.current = null;

      // Iniciamos calibración
      calibrationRef.current = {
        active: true,
        startTime: performance.now(),
        samples: [],
      };

      smoothingFactorsRef.current = {
      head: INITIAL_SMOOTHING,
      shoulders: INITIAL_SMOOTHING,
      arms: INITIAL_SMOOTHING,
      hands: INITIAL_SMOOTHING,
      torso: INITIAL_SMOOTHING,
      hips: INITIAL_SMOOTHING,
      legs: INITIAL_SMOOTHING,
      knees: INITIAL_SMOOTHING,
      feet: INITIAL_SMOOTHING,
      };
      noiseThresholdsRef.current = {
        head: 0,
        shoulders: 0,
        arms: 0,
        hands: 0,
        torso:0,
        hips:0,
        legs:0,
        knees:0,
        feet:0,
        };

      setCalibrating(true);
      setCalibrationProgress(0);
      setCalibrationResult(null);

      detectPose();
    } catch (err) {
      console.error("Error accediendo a la cámara:", err);

      setError(
        "No se pudo acceder a la cámara. Revisa los permisos del navegador."
      );
    }
  };

  // --------------------------------------------------
  // 3. Calcular movimiento de un landmark
  // --------------------------------------------------

  const calculateMovement = (current, previous) => {
    if (!current || !previous) {
      return 0;
    }

    const dx = current.x - previous.x;
    const dy = current.y - previous.y;

    return Math.sqrt(dx * dx + dy * dy);
  };

  // --------------------------------------------------
  // 4. Calcular movimiento por parte del cuerpo
  // --------------------------------------------------

  const calculateBodyMovement = (
    currentLandmarks,
    previousLandmarks
  ) => {
    const result = {};

    for (const [part, indices] of Object.entries(BODY_PARTS)) {
      let totalMovement = 0;

      for (const index of indices) {
        totalMovement += calculateMovement(
          currentLandmarks[index],
          previousLandmarks[index]
        );
      }

      result[part] =
        totalMovement / indices.length;
    }

    return result;
  };

  // --------------------------------------------------
  // 5. Suavizar landmarks
  // --------------------------------------------------


    const getBodyPartForLandmark = (index) => {
    for (const [part, indices] of Object.entries(BODY_PARTS)) {
        if (indices.includes(index)) {
        return part;
        }
    }

    return null;
    };

    const smoothLandmarks = (currentLandmarks) => {
    const previousLandmarks = smoothedLandmarksRef.current;

    if (!previousLandmarks) {
        smoothedLandmarksRef.current = currentLandmarks;
        return currentLandmarks;
    }

    const smoothed = currentLandmarks.map((current, index) => {
        const previous = previousLandmarks[index];

        const bodyPart = getBodyPartForLandmark(index);

        const smoothingFactor =
        smoothingFactorsRef.current[bodyPart] ??
        INITIAL_SMOOTHING;

        return {
        ...current,

        x:
            previous.x * smoothingFactor +
            current.x * (1 - smoothingFactor),

        y:
            previous.y * smoothingFactor +
            current.y * (1 - smoothingFactor),

        z:
            previous.z * smoothingFactor +
            current.z * (1 - smoothingFactor),

        visibility: current.visibility,
        };
    });

    smoothedLandmarksRef.current = smoothed;

    return smoothed;
    };

  // --------------------------------------------------
  // 6. Finalizar calibración
  // --------------------------------------------------

    const finishCalibration = () => {
    const samples = calibrationRef.current.samples;

    if (samples.length === 0) {
      return;
    }

    const totals = {};

    for (const part of Object.keys(BODY_PARTS)) {
      totals[part] = 0;
    }

    for (const sample of samples) {
      for (const part of Object.keys(BODY_PARTS)) {
        totals[part] += sample[part] ?? 0;
      }
    }

    const averages = {};

    for (const part of Object.keys(BODY_PARTS)) {
      averages[part] = totals[part] / samples.length;
    }

    const NOISE_MARGIN = 2;

    const noiseThresholds = {};

    for (const part of Object.keys(BODY_PARTS)) {
      noiseThresholds[part] =
        averages[part] * NOISE_MARGIN;
    }

    noiseThresholdsRef.current = noiseThresholds;

    calibrationRef.current.active = false;

    setCalibrating(false);
    setCalibrationProgress(1);

    setCalibrationResult({
      averages,
      noiseThresholds,
    });

    console.log("Calibración completada");
    console.log("Movimiento promedio:", averages);
    console.log("Umbrales de ruido:", noiseThresholds);
  };

  // --------------------------------------------------
  // 7. Analizar cada frame
  // --------------------------------------------------

  const detectPose = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const poseLandmarker = poseLandmarkerRef.current;

    if (!video || !canvas || !poseLandmarker) {
      animationFrameRef.current =
        requestAnimationFrame(detectPose);

      return;
    }

    if (video.readyState < 2) {
      animationFrameRef.current =
        requestAnimationFrame(detectPose);

      return;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    // Ajustamos el canvas al tamaño real del vídeo
    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    const timestamp = performance.now();

    const result =
      poseLandmarker.detectForVideo(
        video,
        timestamp
      );

    // ------------------------------------------------
    // Procesamiento de landmarks
    // ------------------------------------------------

    if (
      result.landmarks &&
      result.landmarks.length > 0
    ) {
      const landmarks = result.landmarks[0];

      // -------------------------------
      // Calibración
      // -------------------------------

      const previous = previousLandmarksRef.current;

        if (previous) {
        const movement =
            calculateBodyMovement(
            landmarks,
            previous
            );
        const elapsedTime = (performance.now() - sessionStartTimeRef.current) / 1000;

        analysisSamplesRef.current.push({
          time: elapsedTime,
          ...movement,
        });

        if (calibrationRef.current.active) {
            calibrationRef.current.samples.push(movement);
        } else {
            const significantMovement = {};

            for (const part of Object.keys(movement)) {
            significantMovement[part] =
                movement[part] > noiseThresholdsRef.current[part];
            }

            if (Math.random() < 0.01) {
            console.log(
                "Movimiento:",
                movement,
                "Significativo:",
                significantMovement
            );
            }
        }
        }

        previousLandmarksRef.current = landmarks;

      // -------------------------------
      // Progreso de calibración
      // -------------------------------

      if (
        calibrationRef.current.active
      ) {
        const elapsed =
          performance.now() -
          calibrationRef.current.startTime;

        const progress = Math.min(
          elapsed / CALIBRATION_DURATION,
          1
        );

        setCalibrationProgress(
          progress
        );

        if (progress >= 1) {
          finishCalibration();
        }
      }
    }

    // ------------------------------------------------
    // Dibujar landmarks suavizados
    // ------------------------------------------------

    const drawingUtils =
      new DrawingUtils(ctx);

    if (result.landmarks) {
      for (const landmarks of result.landmarks) {
        const smoothedLandmarks =
          smoothLandmarks(landmarks);

        drawingUtils.drawLandmarks(
          smoothedLandmarks,
          {
            radius: 4,
            color: "#F08046",
            fillColor: "#ffffff",
          }
        );

        drawingUtils.drawConnectors(
          smoothedLandmarks,
          PoseLandmarker.POSE_CONNECTIONS,
          { color: "rgba(255, 255, 255, 0.7)", lineWidth: 2 }
        );
      }
    }

    animationFrameRef.current =
      requestAnimationFrame(detectPose);
  };


  const generateAnalysisJSON = () => {
    const data = {
      duration: sessionStartTimeRef.current
        ? (performance.now() - sessionStartTimeRef.current) / 1000
        : 0,

      samples: analysisSamplesRef.current,
    };

    const json = JSON.stringify(data, null, 2);

    console.log(json);

    // Descarga el JSON para poder revisarlo fuera de la consola
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mediapipe-analisis-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);

    toast.success(`JSON generado (${data.samples.length} muestras)`);

    return json;
  };

  // --------------------------------------------------
  // 8. Interfaz
  // --------------------------------------------------

  const status = error
    ? { label: "Error", tone: "danger" }
    : loading
      ? { label: "Cargando modelo…", tone: "neutral" }
      : calibrating
        ? { label: "Calibrando", tone: "warning" }
        : cameraStarted
          ? { label: "Analizando", tone: "success" }
          : { label: "Listo", tone: "neutral" };

  return (
    <>
      <Button variant="ghost" size="sm" icon="arrowLeft" to="/laboratorio" className="-ml-3 mb-8">
        Laboratorio
      </Button>

      <PageHeader
        eyebrow="Laboratorio · Visión por computador"
        title="MediaPipe Pose"
        description="Detección de 33 puntos corporales en tiempo real. Los primeros 30 segundos calibran el ruido de movimiento de cada zona del cuerpo."
        actions={
          <>
            <Button variant="secondary" icon="download" onClick={generateAnalysisJSON} disabled={!cameraStarted}>
              Generar JSON
            </Button>
            {!cameraStarted && (
              <Button icon="camera" onClick={startCamera} disabled={loading}>
                Iniciar cámara
              </Button>
            )}
          </>
        }
      />

      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          <Icon name="alert" size={16} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
        {/* Video + landmarks */}
        <div className="relative aspect-video rounded-2xl overflow-hidden bg-[#0B1118] ring-1 ring-line">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-contain"
          />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain" />

          {!cameraStarted && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              {loading ? (
                <>
                  <span className="h-8 w-8 rounded-full border-2 border-white/10 border-t-white/70 animate-spin" />
                  <span className="text-sm text-white/60">Cargando MediaPipe…</span>
                </>
              ) : (
                <>
                  <span className="h-14 w-14 rounded-full bg-white/5 flex items-center justify-center text-white/60">
                    <Icon name="person" size={26} />
                  </span>
                  <span className="text-sm text-white/70">Colócate de cuerpo completo frente a la cámara</span>
                  <Button variant="secondary" size="sm" icon="camera" onClick={startCamera}>
                    Iniciar cámara
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="absolute top-3 left-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur px-3 h-7 text-xs text-white">
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status.tone]}`} />
              {status.label}
            </span>
          </div>
        </div>

        {/* Panel lateral */}
        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[15px] font-semibold text-ink">Calibración</h3>
              <span className="text-xs text-muted tabular-nums">
                {Math.round(calibrationProgress * 100)}%
              </span>
            </div>
            <Progress value={calibrationProgress * 100} tone={calibrationResult ? "success" : "accent"} />
            <p className="text-[13px] text-muted mt-3 leading-relaxed">
              {calibrationResult
                ? "Calibración completada. Los movimientos sobre el umbral se consideran significativos."
                : calibrating
                  ? `Mantente quieto durante ${CALIBRATION_DURATION / 1000} segundos.`
                  : "Se inicia automáticamente al encender la cámara."}
            </p>
          </Card>

          <Card padded={false} className="overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 px-5 py-3 border-b border-line text-xs text-muted">
              <span>Zona</span>
              <span className="text-right">Promedio</span>
              <span className="text-right">Umbral</span>
            </div>
            <div className="divide-y divide-line">
              {Object.keys(BODY_PARTS).map((part) => (
                <div key={part} className="grid grid-cols-[1fr_auto_auto] gap-x-6 px-5 py-2.5 text-[13px]">
                  <span className="text-ink">{PART_LABELS[part]}</span>
                  <span className="text-right font-mono text-xs text-muted tabular-nums">
                    {calibrationResult ? calibrationResult.averages[part].toFixed(5) : "—"}
                  </span>
                  <span className="text-right font-mono text-xs text-ink tabular-nums">
                    {calibrationResult ? calibrationResult.noiseThresholds[part].toFixed(5) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

const STATUS_DOT = {
  danger: "bg-red-400",
  neutral: "bg-white/60",
  warning: "bg-amber-400",
  success: "bg-emerald-400",
};

const PART_LABELS = {
  head: "Cabeza",
  shoulders: "Hombros",
  arms: "Brazos",
  hands: "Manos",
  torso: "Torso",
  hips: "Caderas",
  legs: "Piernas",
  knees: "Rodillas",
  feet: "Pies",
};

export default MediaPipeTest;
