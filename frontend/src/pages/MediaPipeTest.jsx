import { useEffect, useRef, useState } from "react";

import {
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

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
    });
  
   const noiseThresholdsRef = useRef({
    head: 0,
    shoulders: 0,
    arms: 0,
    hands: 0,
    });

  // Información de calibración
  const calibrationRef = useRef({
    active: false,
    startTime: null,
    samples: [],
  });

  const INITIAL_SMOOTHING = 0.10;

  

  const [loading, setLoading] = useState(true);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [error, setError] = useState(null);

  const [calibrating, setCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationResult, setCalibrationResult] = useState(null);

  // Partes del cuerpo que vamos a analizar inicialmente
  const BODY_PARTS = {
    head: [0],
    shoulders: [11, 12],
    arms: [13, 14],
    hands: [15, 16],
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
      };
      noiseThresholdsRef.current = {
        head: 0,
        shoulders: 0,
        arms: 0,
        hands: 0,
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

    const totals = {
        head: 0,
        shoulders: 0,
        arms: 0,
        hands: 0,
    };

    for (const sample of samples) {
        totals.head += sample.head;
        totals.shoulders += sample.shoulders;
        totals.arms += sample.arms;
        totals.hands += sample.hands;
    }

    const averages = {
        head: totals.head / samples.length,
        shoulders:
        totals.shoulders / samples.length,
        arms: totals.arms / samples.length,
        hands: totals.hands / samples.length,
    };

    // Margen para evitar considerar como movimiento
    // pequeñas variaciones similares a las observadas
    // durante la calibración.
    const NOISE_MARGIN = 2;

    const noiseThresholds = {
        head: averages.head * NOISE_MARGIN,
        shoulders:
        averages.shoulders * NOISE_MARGIN,
        arms: averages.arms * NOISE_MARGIN,
        hands: averages.hands * NOISE_MARGIN,
    };

    noiseThresholdsRef.current =
        noiseThresholds;

    calibrationRef.current.active = false;

    setCalibrating(false);
    setCalibrationProgress(1);

    setCalibrationResult({
        averages,
        noiseThresholds,
    });

    console.log(
        "Calibración completada"
    );

    console.log(
        "Movimiento promedio:",
        averages
    );

    console.log(
        "Umbrales de ruido:",
        noiseThresholds
    );
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

      const previous =
        previousLandmarksRef.current;

        if (previous) {
        const movement =
            calculateBodyMovement(
            landmarks,
            previous
            );

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
          }
        );

        drawingUtils.drawConnectors(
          smoothedLandmarks,
          PoseLandmarker.POSE_CONNECTIONS
        );
      }
    }

    animationFrameRef.current =
      requestAnimationFrame(detectPose);
  };

  // --------------------------------------------------
  // 8. Interfaz
  // --------------------------------------------------
  
  return (
    <div>
      <h1>MediaPipe Pose Test</h1>

      {loading && (
        <p>Cargando MediaPipe...</p>
      )}

      {error && (
        <p>{error}</p>
      )}

      {!cameraStarted && !loading && (
        <button onClick={startCamera}>
          Iniciar cámara
        </button>
      )}

      {calibrating && (
        <div>
          <h2>Calibrando...</h2>

          <p>
            Mantente quieto durante{" "}
            {CALIBRATION_DURATION / 1000} segundos.
          </p>

          <p>
            Progreso:{" "}
            {Math.round(
              calibrationProgress * 100
            )}
            %
          </p>
        </div>
      )}

      {calibrationResult && (
        <div>
            <h2>Calibración completada</h2>

            <h3>Movimiento promedio</h3>

            <p>
            Cabeza:{" "}
            {calibrationResult.averages.head.toFixed(5)}
            </p>

            <p>
            Hombros:{" "}
            {calibrationResult.averages.shoulders.toFixed(5)}
            </p>

            <p>
            Brazos:{" "}
            {calibrationResult.averages.arms.toFixed(5)}
            </p>

            <p>
            Manos:{" "}
            {calibrationResult.averages.hands.toFixed(5)}
            </p>

            <h3>Umbral de ruido</h3>

            <p>
            Cabeza:{" "}
            {calibrationResult.noiseThresholds.head.toFixed(5)}
            </p>

            <p>
            Hombros:{" "}
            {calibrationResult.noiseThresholds.shoulders.toFixed(5)}
            </p>

            <p>
            Brazos:{" "}
            {calibrationResult.noiseThresholds.arms.toFixed(5)}
            </p>

            <p>
            Manos:{" "}
            {calibrationResult.noiseThresholds.hands.toFixed(5)}
            </p>
        </div>
        )}

      <div
        style={{
          position: "relative",
          width: "640px",
          maxWidth: "100%",
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            display: "block",
          }}
        />

        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
          }}
        />
      </div>
    </div>
  );
}

export default MediaPipeTest;