# AUDITORÍA COMPARATIVA DE VARIABLES DE EVALUACIÓN — VOXREADY

**Comparación de las 23 variables de evaluación de voceros (requisito) contra la implementación real del código**

| | |
|---|---|
| **Documento** | `AUDITORIA_COMPARATIVA_VARIABLES_VOXREADY.md` |
| **Ámbito** | Solo auditoría y verificación. **No se modificó código, esquema, configuración ni datos.** |
| **Sistema auditado** | `Fase 2/Evidencias Proyecto/Evidencias de sistema/` — commit `ec2a1788b` (2026-10-08), última versión del backend y del frontend del sistema |
| **Documentos relacionados** | `AUDITORIA_INTEGRAL_IA_VOXREADY.md` (misma carpeta raíz: `Auditoría IA`) y `PLAN_IMPLEMENTACION_VARIABLES_VOXREADY.md` (carpeta actual) |
| **Fecha de la auditoría** | 2026-10-13 |
| **Estado** | Entrega para revisión conjunta. **No se implementó ninguna mejora.** |

---

## RESUMEN EJECUTIVO (para lectores no desarrolladores)

VoxReady hoy evalúa una práctica de vocería con **dos motores distintos** que se combinan en una nota de 0 a 100:

1. **Reglas automáticas sobre números medidos por el navegador** (cámara y micrófono): velocidad al hablar, muletillas, pausas largas, variación de volumen, tiempo antes de responder, presencia en cámara, mirada a la cámara, inclinación de hombros, movimiento de cabeza y gestos de manos.
2. **Un modelo de lenguaje (IA) que lee la transcripción** y pone notas a cuatro temas de contenido: si sostiene los mensajes clave, si responde directo, si evita líneas rojas, claridad, reconocer el impacto en las personas, calidez y asumir responsabilidad.

Esos dos motores se resumen en **cuatro áreas** (Expresión, Tono de voz, Coherencia, Empatía) y la nota final es un **promedio ponderado** de las cuatro.

**El hallazgo central de esta auditoría** es que el sistema mide **muy pocas de las 23 variables** que la definición operacional exige, y las que mide lo hace de forma **parcial**:

- De las **6 variables de voz**, solo "ritmo y velocidad" está medida y evaluada de forma completa (palabras por minuto). **El tono y la entonación no se miden en absoluto**: el sistema nunca analiza la frecuencia ni el pitch de la voz.
- De las **5 variables corporales**, contacto visual, postura, gestos y estabilidad tienen alguna medición. **La expresión facial se detecta (sonrisa) pero no se califica**; solo se usa para comentar si la risa fue o no adecuada al tema.
- De las **6 variables de control del mensaje**, tres (mensajes clave, claridad, pertinencia) existen como criterio de la IA; **bridging, flagging y hooking no existen**; síntesis y consistencia narrativa no tienen criterio propio.
- De las **6 variables de presión y contexto**, solo consistencia institucional tiene criterio (mensajes clave y líneas rojas). **Asertividad, escucha activa, control emocional, tolerancia a la presión, recuperación y manejo de hostilidad no tienen medición ni criterio**: a lo sumo la IA podría opinar sobre ellas, pero nada en el sistema las pide, las mide o las guarda.

Además, hay tres limitaciones de diseño que condicionan todo lo demás:

- **No existe línea basal individual**. El sistema no mide cómo habla o se mueve esta persona en concreto; compara contra rangos fijos (por ejemplo 120–165 palabras por minuto) iguales para todos.
- **No existe presión por niveles**. El escenario elige **un** nivel de agresividad del entrevistador (baja, media, alta o extrema) y nunca cambia durante la entrevista. Por lo tanto no hay forma de comparar el desempeño "antes y después" de una pregunta difícil, que es justamente lo que exige "tolerancia a la presión" y "recuperación".
- **La "calibración" que muestra la pantalla no calibra nada**. La pantalla de preparación anuncia "Calibración corporal · Completada" tras una barra de progreso de 1 segundo que no mide ni guarda ningún dato.

**Qué sí funciona bien** (y conviene no romper al implementar): el patrón de evaluación es configurable (pesos por área, pesos por criterio, rangos ideales, exigencia), se versiona y cada informe guarda con qué versión se evaluó; las notas de voz y cuerpo son **reproducibles** (son fórmulas); la IA solo aporta juicio donde no hay medición; y la cola de revisión humana permite comparar la nota de la IA con la de un experto.

**Recomendación de prioridad** (detalle en el plan): primero **fortalecer y testear lo que ya se mide** (es lo más barato y lo más riesgoso si está mal), luego **mejorar la evaluación textual** de las variables de mensaje (requiere trabajo de prompt y de rúbrica, no de sensores), después **análisis acústico** (volumen normalizado, pitch, entonación, pausas), luego **análisis corporal** adicional, y **al final presión y recuperación**, porque exige cambiar el guion de la entrevista y guardar niveles, no solo añadir una instrucción al prompt.

**Advertencia de honestidad técnica:** esta auditoría se hizo **solo leyendo código** (no se ejecutó la aplicación, no se hicieron entrevistas reales y no se llamó a las APIs de IA). Todo lo que depende del comportamiento en vivo está marcado explícitamente como **pendiente de validar**.

---

## 1. MÉTODO, ALCANCE Y LÍMITES

### 1.1 Qué se hizo

1. Se localizó el **flujo real** desde que el vocero responde hasta que se guarda la nota: medición en el navegador → envío al backend → cálculo → IA → persistencia → informe.
2. Se leyó cada módulo que **produce, transforma o consume** métricas, y se siguió cada dato hasta su uso (o su no uso) en la puntuación final.
3. Para cada una de las 23 variables se buscó: (a) si existe una señal medida, (b) si existe un criterio de evaluación, (c) si ese criterio **participa** en el puntaje, y (d) qué parte de la definición operacional queda sin cubrir.
4. Se revisó la documentación del repositorio para detectar **contradicciones** con el código.

### 1.2 Qué NO se hizo (restricciones respetadas)

- No se modificó código, configuración, esquema Prisma ni datos. No se ejecutaron migraciones.
- No se instalaron dependencias ni se consumieron cuotas de las API de IA.
- No se alteraron sesiones ni datos existentes.
- **No se ejecutó la aplicación**: no hubo entrevistas reales, ni cámara, ni micrófono, ni llamadas a los modelos. Por eso, el comportamiento de los umbrales en condiciones reales (ruido, luz, acento, velocidad de máquina) queda **pendiente de validación**.

### 1.3 Aclaración previa: dos copias del código en el mismo repositorio

El repositorio contiene **dos árboles de código distintos** y esto afecta a cualquier conclusión:

| Árbol | Último commit relevante | Estado |
|---|---|---|
| `backend/` y `frontend/` (raíz del repo) | `581766a97` (2026-09-27) en backend; `e5b83587b` (2026-10-08) en frontend | Backend **antiguo** (sin `lib/`, sin `interviewConfig.js`, `sessions.js` de 282 líneas). Frontend con **modo demostración** (`src/demo/`, `VersionSwitch`, `DemoNotice`) |
| `Fase 2/Evidencias Proyecto/Evidencias de sistema/backend` y `/frontend` | `ec2a1788b` (2026-10-08) | Backend **vigente** (con `lib/`, `interviewConfig.js`, tests, `sessions.js` de 423 líneas). Frontend **sin** modo demostración |

**Decisión de auditoría:** se audita el árbol **`Fase 2/Evidencias Proyecto/Evidencias de sistema/`** (el más completo y el más reciente) y **todos los números de línea citados corresponden a ese árbol**. Las diferencias relevantes con la raíz se anotan donde importan (por ejemplo, el evaluador de demostración, que existe **solo** en la raíz: `frontend/src/demo/evaluator.js`).

> **Consecuencia práctica:** si el equipo despliega desde la raíz, el backend desplegado **no es** el que se audita aquí. Esto debe resolverse antes de implementar cualquier fase (ver §7 y el plan, Fase 0).

### 1.4 Sobre el origen del requisito de las 23 variables

El listado de 23 variables y sus definiciones operacionales **no está en el repositorio**. Se buscó en:

- `docs/ESPECIFICACIONES.md` y `docs/ACTUALIZACION.md`: describen **4 áreas** y sus criterios, no 23 variables.
- Los 32 archivos Office (`.docx`/`.xlsx`) del repositorio, incluidas las actas de Scrum y el DAS: **ninguno** contiene la lista de 23 variables. Las únicas coincidencias son genéricas ("mantener la fluidez de la conversación" en el DAS; "contacto visual, postura y gestos" en Visión y roles Scrum).
- Código y HTML: la única mención a terminología de técnicas de control está en el **prototipo antiguo** `frontend/public/version-antigua.html` (línea 314: `m1:"Bridging messages", m2:"Hostile questions", m3:"Body language"`; línea 372: tabla de las 4 áreas con sus pesos 25/25/30/20).

**Por lo tanto:** las 23 variables se auditan contra la **definición operacional entregada en la solicitud**, tratándola como el requisito, y se advierte que el repositorio **no** la contiene. Esto ya es un hallazgo: no hay trazabilidad entre requisito y código dentro del repositorio.

### 1.5 Escala de estados y de confianza usada en esta auditoría

Estados (los seis pedidos), con la regla de asignación **explícita** para que la clasificación sea reproducible:

| Estado | Regla aplicada |
|---|---|
| **A — Implementada y conectada** | Existe una **señal medida de forma específica y objetiva** para la variable, **existe un criterio explícito con peso**, y ese criterio **participa en el puntaje final**. Las carencias de matices se registran como brecha, sin rebajar el estado |
| **B — Parcial** | Existe alguna medición o evaluación, pero **falta el núcleo** de la definición operacional (p. ej. se mide variabilidad cuando se pide nivel absoluto; se cuentan silencios sin distinguir bloqueo; el criterio de IA no desglosa lo que la definición exige) |
| **C — Solo inferida por IA** | Nada la mide y no existe un criterio específico; como máximo la IA "podría" opinar a partir del texto, sin instrucción ni formato de salida que la obligue |
| **D — Medida pero no evaluada** | Existe un dato medido o calculado, pero **no se usa para puntuar** la variable (p. ej. se muestra en el informe, pero no entra en el puntaje) |
| **E — No implementada** | No se encontró implementación real ni instrucción, ni medición, ni criterio |
| **F — No determinable** | La evidencia disponible (solo lectura de código) no permite concluir el comportamiento real |

Confianza:

- **Alta:** la conclusión se apoya en código leído íntegro y en ausencias verificables por búsqueda exhaustiva (p. ej. "no existe ninguna referencia a pitch/FFT").
- **Media:** la conclusión depende de cómo se comporte el modelo de IA o de un cálculo cuyo resultado real no se pudo observar.
- **Baja:** dependería de ejecutar la aplicación con dispositivos reales.

---

## 2. ARQUITECTURA REAL DEL SISTEMA (flujo seguido de extremo a extremo)

### 2.1 Flujo observable

```
CheckTecnico.jsx            (cámara, micrófono, luz, "calibración", consentimiento)
        ↓ (sessionStorage: escenario + dispositivos)
SesionPractica.jsx          ── crea sesión ──►  POST /api/sessions            (routes/sessions.js)
   ├── AudioMeter (Web Audio, RMS cada 100 ms)        ─┐
   ├── PoseTracker (MediaPipe Pose + Face, 10 fps)     ├─ medición en el navegador
   ├── SpeechRecognition (Web Speech API, es-CL)       │
   └── SpeechSynthesis (voz del entrevistador)        ─┘
   ├── pregunta ──►  POST /api/sessions/:id/next-question  →  ai/interviewer.js → API NVIDIA
   └── al terminar guarda en sessionStorage: { sessionId, transcript[ ], metrics }
        ↓
Analizando.jsx              ──►  POST /api/sessions/:id/evaluate  { transcript, metrics }
        ↓                              routes/sessions.js → ai/evaluator.js
        ↓                                  ├── scoreVoice(metrics.voice, cfg)   (reglas)
        ↓                                  ├── scoreBody(metrics.body, cfg)     (reglas)
        ↓                                  └── judgeContent(...) → API NVIDIA   (Coherencia/Empatía)
        ↓                                      (se guarda en Session.report y Session.score)
InformeCoach.jsx            ◄──  GET /api/sessions/:id
        ↓
MiProgreso.jsx / Practicas.jsx / ColaEtiquetado.jsx  (histórico, panel admin, segunda opinión humana)
```

### 2.2 Módulos que producen, transforman o consumen métricas

| Módulo | Rol real | Evidencia |
|---|---|---|
| `frontend/src/lib/practice/audioMeter.js` | Mide voz: RMS, voz/silencio, latencia, pausas largas, variación de volumen | 105 líneas; `sample()` L32-48; `endAnswer()` L69-99 |
| `frontend/src/lib/practice/poseTracker.js` | Cuerpo y rostro con MediaPipe: presencia, mirada, hombros, cabeza, manos, brillo, sonrisa, ojos | 255 líneas; `analyze()` L126-191; `summary()` L221-248 |
| `frontend/src/lib/practice/speech.js` | Transcripción (Web Speech API) y conteo de muletillas por expresión regular | `createRecognizer` L9-79; `FILLER_RE` L83; `analyzeText` L85-89 |
| `frontend/src/lib/voice.js` | Voz del entrevistador (SpeechSynthesis del navegador) | `speak()` L89-110 |
| `frontend/src/pages/SesionPractica.jsx` | Orquesta todo; **arma** `metrics` y `transcript` por respuesta | `finishAnswer` L272-314; `buildMetrics` L330-356 |
| `frontend/src/pages/Analizando.jsx` | Envía `transcript` + `metrics` al backend | L38-41 |
| `backend/ai/evaluator.js` | Notas de voz y cuerpo (reglas), interroga a la IA para Coherencia/Empatía, arma el informe | 441 líneas |
| `backend/ai/interviewer.js` | Genera la siguiente pregunta y la estructura de la entrevista | 214 líneas |
| `backend/ai/interviewConfig.js` | Normaliza y limita la configuración de entrevista (agresividad, nº preguntas, repreguntas, tiempo) | 109 líneas |
| `backend/ai/patternConfig.js` | Patrón maestro: pesos por área y criterio, rangos ideales, exigencia | 81 líneas |
| `backend/routes/sessions.js` | Endpoints de sesión, evaluación, informe, video, cola de revisión, retención | 423 líneas |
| `backend/lib/metrics.js` | **Ojo: no son métricas del vocero.** Son métricas administrativas (ranking de voceros, temas, clientes) | comentario L1-13 |
| `frontend/src/components/MetricsDashboard.jsx` | Panel administrativo de uso del sistema (no evalúa al vocero) | 9 KB |
| `frontend/src/pages/InformeCoach.jsx` | Presenta el informe al vocero | 417 líneas |
| `frontend/src/pages/ColaEtiquetado.jsx` | Segunda opinión humana sobre una sesión ya evaluada | `POST /api/sessions/:id/review` |
| `frontend/src/demo/*` (**solo en la raíz**) | Simulador del sistema para la versión de demostración de Vercel (evaluador propio) | `frontend/src/demo/evaluator.js` (21 KB) |

> **Riesgo de nomenclatura (no es un defecto funcional, pero confunde auditorías):** hay **tres** usos de la palabra "métricas" (administrativas en `lib/metrics.js`, del navegador en `Session.metrics`, y criterios del patrón en `patternConfig.js`) y **dos funciones llamadas `scoreVoice`** (`evaluator.js` L43 puntúa al vocero; `voice.js` L15 elige la mejor voz de síntesis).

### 2.3 Las cuatro áreas y los pesos reales

`patternConfig.js` (L9-52) define el patrón por defecto: **Expresión 25 %, Tono de voz 25 %, Coherencia 30 %, Empatía 20 %**, y dentro de cada área los criterios con su peso (0-5; peso 0 = no se evalúa). Los pesos viven en `MasterPattern.config` (JSON) y se versionan desde `EditorRubrica.jsx` vía `routes/patterns.js`.

**Prioridad de patrón al evaluar** (`routes/sessions.js` L201-208): patrón del vocero → patrón del escenario → patrón activo. El informe guarda `pattern`, `patternVersion` y `strictness` (`evaluator.js` L423-425).

---

## 3. FÓRMULAS EXACTAS Y TRAZABILIDAD DEL DATO

Esta sección es la base de evidencia de toda la matriz: sin ella, "implementado" y "parcial" serían opiniones. Todo lo citado existe en el código de `Fase 2/Evidencias Proyecto/Evidencias de sistema/`.

### 3.1 Lo que se mide en el navegador (y cómo)

**Audio — `audioMeter.js`**

| Dato | Fórmula / regla | Línea |
|---|---|---|
| Muestreo | una muestra cada **100 ms** (`SAMPLE_MS`) | L5, L24 |
| Volumen | `rms = √(Σ v² / n)` sobre 2048 muestras de la onda en el tiempo (`getFloatTimeDomainData`) | L33-36 |
| Piso de ruido | baja rápido, sube lento: `rms < floor ? rms : floor*0.995 + rms*0.005` | L39 |
| Habla/no habla | `speaking = rms > max(0.012, noiseFloor * 3)` | L40-41 |
| Latencia | `firstVoice.t − startedAt` (ms hasta la primera muestra con voz) | L94 |
| Pausa larga | silencio **> 1500 ms** entre dos muestras con voz (`LONG_PAUSE_MS`) | L6, L79-85 |
| Variación de volumen | **coeficiente de variación** `sd(rms con voz) / mean(rms con voz)`, solo si hay **> 5** muestras con voz; si no, `null` | L87-97 |
| Duración | `última muestra − startedAt` | L92 |

> **Lo que NO se calcula:** no se lee el espectro de frecuencia (`getFloatFrequencyData` no se usa), no hay análisis espectral efectivo (se declara `fftSize = 2048` en L21 pero solo se usa el dominio del tiempo), no hay pitch, no hay F0, no hay energía por bandas, no hay jitter ni shimmer. **Consecuencia directa: tono y entonación son inmedibles con el código actual.**

**Cuerpo y rostro — `poseTracker.js`** (MediaPipe `PoseLandmarker` + `FaceLandmarker`, ~10 análisis/segundo, `FRAME_MS = 100`)

| Dato | Fórmula / regla | Línea |
|---|---|---|
| Tiempo atribuido a cada cuadro | `min(now − lastFrameAt, 500 ms)` (`MAX_FRAME_GAP_MS`) | L13, L131 |
| Persona presente | hombros izquierdo y derecho visibles (`visibility > 0.5`) | L31, L149 |
| `presence` | `cuadros con persona / cuadros totales` | L234 |
| `facingCamera` | `cuadros mirando / cuadros con persona`; "mira" si `yaw < 0.22` **y** los ojos no están desviados | L164-171, L235 |
| `yaw` | `|nariz.x − punto medio(orejas o hombros)| / ancho de hombros` | L157-164 |
| Ojos desviados | `side > 0.55` **o** `up > 0.50` **o** `down > 0.75` (blendshapes MediaPipe) | L17-19, L120-123 |
| `shoulderTilt` | media de `atan2(|Δy|, |Δx|)` de los hombros, en grados | L173-177, L236 |
| `headMovement` | media de la distancia normalizada nariz→nariz entre cuadros consecutivos | L179-189, L237 |
| `handActivity` | media de la distancia normalizada muñeca→muñeca entre cuadros consecutivos (ambas muñecas visibles) | L183-188, L238 |
| `smileSeconds` | tiempo acumulado con `(mouthSmileLeft + mouthSmileRight)/2 > 0.45` | L16, L141-143 |
| `facingSeconds` / `awaySeconds` / `analyzedSeconds` | tiempos acumulados; fuera de cuadro se suma a "away" | L140, L150-153, L166-171 |
| `lighting.average` | brillo medio ponderado (0.299R + 0.587G + 0.114B), una muestra por segundo | L146-147, L212-226 |
| Disponibilidad | si `frames < 10` → `body.available = false` | L228 |
| Tramo por pregunta | `beginSegment()` / `endSegment()` devuelven los deltas por pregunta | L195-210 |

> **Lo que NO se calcula:** orientación del torso, apertura o cruce de brazos, encorvamiento, gestos con significado (solo magnitud de movimiento), expresiones distintas de la sonrisa (ceño, tensión, microexpresiones), ni distinción entre gesto útil y gesto distractor.

**Transcripción y muletillas — `speech.js`**

| Dato | Regla | Línea |
|---|---|---|
| Transcripción | `SpeechRecognition` del navegador, `lang='es-CL'`, continuo, resultados intermedios y finales | L12-15, L20-28 |
| Reinicio | el navegador corta tras silencios; se reinicia si sigue activo | L31-39 |
| Muletillas | expresión regular `\b(e+h+|e+m+|m{2,}|este|o sea|bueno|pues|digamos|cachai|onda|como que|a ver)\b` | L83-88 |

> **Lo que NO se calcula:** repeticiones de palabras, reinicios o falsos comienzos, palabras incompletas, continuidad o "trabas", longitud de frase, densidad de ideas. Y la muletilla se cuenta **sobre el texto reconocido**: un error de reconocimiento altera el conteo.

### 3.2 Cómo se agrega por sesión — `SesionPractica.jsx`, `buildMetrics()` (L330-356)

```
speakingMin        = Σ speakingMs / 60000
words              = Σ words (de la transcripción)
wpm                = words / speakingMin      ← palabras POR MINUTO HABLADO (no por minuto de sesión)
fillersPerMin      = Σ fillers / speakingMin
longPauses         = Σ longPauses ;  longPausesPerAnswer = longPauses / nº de respuestas
volumeVariation    = media de los coeficientes de variación por respuesta (sin ponderar por duración)
avgLatencyMs       = media de las latencias por respuesta
voice.available    = audioMeter disponible AND speakingMin > 0.05
body               = resumen global de PoseTracker (toda la entrevista)
lighting.average   = brillo medio
durationSeconds    = reloj de la sesión
```

**Trazabilidad crítica:** `wpm`, `fillersPerMin` y toda la Coherencia dependen de la **transcripción**, que es externa (Web Speech API). Si la transcripción falla, o si el vocero escribe (modo texto), `wpm` queda `null` y el criterio de velocidad no puntúa.

---

### 3.3 Cómo se puntúa — `evaluator.js`

**Función base** (`rangeScore`, L28-33): 100 puntos dentro del rango ideal y caída **lineal** fuera de él.

```
rangeScore(v, idealMin, idealMax, zeroBelow, zeroAbove):
  si v está en [idealMin, idealMax]      → 100
  si v < idealMin                        → clamp( (v − zeroBelow) / (idealMin − zeroBelow) × 100 )
  si v > idealMax                        → clamp( (zeroAbove − v) / (zeroAbove − idealMax) × 100 )
  clamp por defecto entre 0 y 100
```

**Promedio ponderado** (`average`, L35-39): se descartan los ítems con `score == null` **o** `weight == 0`; el total de pesos se renormaliza con los ítems que quedan. Si no queda ninguno, el resultado es `null`.

**Tono de voz** (`scoreVoice`, L43-91) — criterios, valores por defecto y "cero":

| Criterio | Peso | Rango ideal | Puntaje 0 en | Fórmula del puntaje |
|---|---|---|---|---|
| Velocidad (`wpm`) | 3 | 120–165 | 60 y 231 | `rangeScore(wpm, 120, 165, 60, 231)` |
| Muletillas (`fillers`) | 3 | ≤ 2 por minuto | — | `clamp(100 − max(0, fillersPerMin − 2) × 12)` |
| Pausas largas (`pauses`) | 2 | ≤ 1 por respuesta | — | `clamp(100 − max(0, longPausesPerAnswer − 1) × 20)` |
| Variación de volumen (`variation`) | 1 | 0.35–0.90 (CV) | 0.105 y 1.53 | `rangeScore(CV, 0.35, 0.90, 0.105, 1.53)` |
| Tiempo antes de responder (`latency`) | 1 | 0.3–2.5 s | 0 y 7.5 s | `rangeScore(ms, 300, 2500, 0, 7500)` |

**Expresión** (`scoreBody`, L95-110):

| Criterio | Peso | Rango ideal | Cero en | Fórmula |
|---|---|---|---|---|
| Presencia (`presence`) | 2 | ≥ 90 % | 27 % y 200 % | `rangeScore(presence, 0.90, 1, 0.27, 2)` |
| Mirada a la cámara (`facing`) | 3 | ≥ 75 % | 18.75 % y 200 % | `rangeScore(facingCamera, 0.75, 1, 0.1875, 2)` |
| Postura – hombros (`posture`) | 2 | 0–4° | 0 y 16° | `rangeScore(shoulderTilt, 0, 4, 0, 16)` |
| Estabilidad de cabeza (`head`) | 2 | 0.001–0.006 | 0 y 0.02 | `rangeScore(headMovement, 0.001, 0.006, 0, 0.02)` |
| Gestos con las manos (`hands`) | 1 | 0.002–0.012 | 0 y 0.035 | `rangeScore(handActivity, 0.002, 0.012, 0, 0.035)` |

**Coherencia y Empatía** (`scoreFromCriteria`, L270-283): el modelo devuelve un número 0-100 por criterio; el área es el promedio ponderado de **los criterios que el modelo efectivamente devolvió**. Criterios y pesos por defecto (`patternConfig.js` L33-51):

- **Coherencia:** `keyMessages` (Sostiene los mensajes clave, **3**), `directness` (Responde directo, sin evadir, **2**), `redLines` (Evita las líneas rojas, **3**), `clarity` (Claridad y estructura, **1**).
- **Empatía:** `impact` (Reconoce el impacto en las personas, **3**), `warmth` (Calidez y tono humano, **2**), `responsibility` (Asume responsabilidad, **2**).

**Empatía corregida por la mirada** (L388-393):

```
visualShare = empathy.visualWeight / 100                     (por defecto 0.20 → 20 %)
facing      = rangeScore(body.facingCamera, 0.75, 1, 0.1875, 2)   ← solo si hay cámara
empatía     = contenido × (1 − visualShare) + facing × visualShare
              (si falta `facing`, queda el contenido puro)
```

**Nota global** (L395-417): promedio ponderado de las cuatro áreas con pesos 25/25/30/20; las áreas sin medición (`score == null`) **no se penalizan**: su peso se reparte entre las demás.

> **Advertencia de interpretación:** como el peso de un área no medida se reparte, **una práctica sin cámara puede obtener una nota global igual o mejor** que una con cámara, porque la nota se calcula sobre menos áreas. Es un comportamiento intencional y documentado (`docs/ESPECIFICACIONES.md` L111) y el informe muestra "no medido", pero es una fuente de comparaciones injustas entre voceros si la nota global se usa para ranking.

**Ninguna de estas fórmulas está cubierta por pruebas automatizadas.** `backend/tests/` (4 archivos) prueba configuración de entrevista, texto del prompt del entrevistador, análisis de sensibilidad, presencia, jobs, métricas administrativas y borrado de tenant; **no** prueba `rangeScore`, `scoreVoice`, `scoreBody`, `scoreFromCriteria` ni `evaluateSession` (búsqueda negativa verificada sobre `tests/*.test.js`). Además `npm test` está sin implementar (`backend/package.json`: `"test": "echo \"Error: no test specified\" && exit 1"`); las pruebas se corren a mano con `node tests/<archivo>.test.js`.

### 3.4 Qué se guarda y qué se muestra

| Elemento | Dónde queda | Contenido |
|---|---|---|
| `Session.score` | PostgreSQL | Puntaje global 0-100 (entero) |
| `Session.report` | PostgreSQL (JSON) | `global`, `areas[]` (con `details` por criterio), `weights`, `pattern`/`patternVersion`, `strictness`, `resumen`, `cita`, `fortalezas`, `mejoras`, `mensajesClave[]`, `lineasRojas[]`, `porPregunta[]`, `sensibilidad`, `interview`, `measured`, `ai{evaluator,ms}`, `generatedAt` |
| `Session.transcript` | PostgreSQL (JSON) | Tal como lo envió el navegador: `[{question, answer, metrics{words,fillers,wpm,latencyMs,durationMs,speakingMs,longPauses,volumeVariation,video{...}}}]` |
| `Session.metrics` | PostgreSQL (JSON) | `voice`, `body`, `lighting`, `durationSeconds` **enviados por el cliente**, sin recálculo ni validación en el backend |
| `Session.review` | PostgreSQL (JSON) | Notas del experto por área (0-100), comentario, autor, fecha y `agreement` (diferencia absoluta IA vs experto) |

**El informe muestra** (`InformeCoach.jsx`): anillo con la nota global, las 4 áreas con sus criterios y puntajes, fortalezas, mejoras, mensajes clave cubiertos, líneas rojas cruzadas con la frase citada, análisis de sensibilidad (tiempos de mirada, risa y coherencia de la risa), entrevista turno por turno con las métricas de cada respuesta, y los pesos usados (L407-414).

> **Nota sobre el uso del informe:** el informe se organiza por las **4 áreas**; las 23 variables del requisito **no aparecen** como tales en ninguna pantalla ni en ningún campo persistido.

---

## 4. MATRIZ COMPARATIVA DE LAS 23 VARIABLES

Cómo leer las columnas:

- **¿Llega a la evaluación?** = el dato se usa efectivamente en el cálculo (no basta con que se muestre).
- **¿Afecta la puntuación?** = su criterio tiene peso > 0 y el puntaje entra en el promedio del área (y el área en la nota global).
- **Estado** y **Confianza** según §1.5.
- Todos los archivos citados pertenecen a `Fase 2/Evidencias Proyecto/Evidencias de sistema/`.

### 4.1 Uso de la voz (V01–V06)

| ID | Dimensión | Variable | Requisito operacional | Implementación actual | Fuente de datos | Método actual | ¿Llega a la evaluación? | ¿Afecta la puntuación? | Estado | Brecha concreta | Evidencia | Confianza |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V01 | Voz | Volumen | Intensidad y estabilidad; cambios abruptos; comparación con nivel basal y con el canal | Mide `rms` cada 100 ms y calcula el **coeficiente de variación** de las muestras con voz; no mide nivel absoluto ni cambios abruptos; no hay nivel basal por persona ni compensación por dispositivo/canal | Audio (micrófono) | Procesamiento de señal (RMS en el dominio del tiempo) + regla determinista | Sí, como criterio `variation` | **Sí** — peso 1 de 10 en Tono de voz ⇒ ≈2,5 puntos sobre el global (área 25 %) | **B** | Falta el núcleo: "intensidad" (nivel) y "estabilidad frente a un basal" no existen; no hay detección de cambios abruptos; la CV se promedia sin ponderar por duración | `audioMeter.js` L33-36 (RMS), L87-97 (CV, requiere > 5 muestras con voz); `evaluator.js` L73-80 (criterio y rango 0.35–0.90); `SesionPractica.jsx` L336-347 (promedio simple de CV) | Alta |
| V02 | Voz | Tono | Registro vocal, estabilidad, cambios relevantes, comparación con el rango habitual individual | **Nada.** No se analiza frecuencia: no hay pitch, F0, ni autocorrelación | — (ninguna; el espectro no se usa) | Ninguno | No | **No** | **E** | Todo. Requiere análisis espectral (que hoy no existe) y una referencia individual | `audioMeter.js` L21-36: se usa solo `getFloatTimeDomainData`; búsqueda negativa de `getFloatFrequencyData`/`pitch`/`F0` en todo el frontend | Alta |
| V03 | Voz | Ritmo y velocidad | Palabras por minuto, variación de velocidad, pausas; referencia inicial ≈130–150 ppm, configurable por escenario y persona | Calcula `wpm = Σ palabras / minutos hablados`, lo puntúa con rango ideal configurable (por defecto 120–165) y peso 3 (el mayor del área) | Transcripción (nº de palabras) + tiempos de voz del micrófono | Algoritmo determinista + regla con rango ideal | Sí | **Sí** — peso 3 de 10 en Tono de voz ⇒ ≈7,5 puntos del global | **A** | No mide **variación** de velocidad dentro de la respuesta ni la cadencia por tramos; `wpm` depende de la calidad del reconocimiento de voz; el rango es configurable por patrón (incluido un patrón por vocero), lo que cubre "configurable por escenario y persona" solo si alguien lo configura | `SesionPractica.jsx` L283, L342; `evaluator.js` L47-48, L56; `patternConfig.js` L15; `routes/patterns.js` L72-91 (crear versiones del patrón); `routes/sessions.js` L202-207 (patrón por vocero) | Alta |
| V04 | Voz | Entonación | Variaciones de pitch, énfasis y patrones melódicos | **Nada.** El informe muestra "Variación de volumen (no monótono)", que es **amplitud**, no entonación: es un error frecuente confundir una con otra | — | Ninguno | No | **No** | **E** | Todo. Requiere F0 y contorno melódico (que hoy no se calcula) | `evaluator.js` L74-80 (`variation` = CV de volumen); ausencia de cualquier análisis de frecuencia en `audioMeter.js` | Alta |
| V05 | Voz | Pausas y silencios | Distinguir pausas funcionales de silencios por bloqueo | Cuenta "pausas largas" (silencio > 1,5 s **entre** dos muestras con voz) y las puntúa por respuesta (tolerancia 1, peso 2). Durante la repetición de la pregunta la medición se **pausa** correctamente | Audio (micrófono) | Detección de silencio con umbral adaptativo al ruido + regla con tolerancia | Parcialmente: se cuenta el fenómeno, no se interpreta | **Sí** — peso 2 de 10 en Tono de voz ⇒ ≈5 puntos del global | **B** | Falta el núcleo: **no distingue pausa funcional de bloqueo**; no mide duración de cada silencio (solo cuenta), ni pausas cortas, ni silencios al inicio. La latencia (tiempo hasta empezar) se mide aparte y se puntúa | `audioMeter.js` L6, L78-85; `evaluator.js` L65-72; `SesionPractica.jsx` L296; exclusión de la repetición: `audioMeter.js` L59-66 y `SesionPractica.jsx` L316-326 | Alta |
| V06 | Voz | Fluidez verbal | Muletillas, repeticiones, reinicios, palabras incompletas, continuidad | Cuenta muletillas con una expresión regular y calcula muletillas por minuto (tolerancia 2/min, peso 3) | Transcripción (texto reconocido) | Algoritmo determinista (regex) + regla con tolerancia; el informe además pide a la IA un comentario por respuesta | Sí, como `fillersPerMin` | **Sí** — peso 3 de 10 en Tono de voz ⇒ ≈7,5 puntos del global | **B** | Solo cubre 1 de los 5 componentes: **no hay repeticiones, reinicios, palabras incompletas ni continuidad**. Además la regex produce **falsos positivos**: "este" como demostrativo y "bueno" como adjetivo se cuentan como muletilla | `speech.js` L83-88; `evaluator.js` L57-64; `SesionPractica.jsx` L343 | Alta (cálculo) / Media (tasa real de falsos positivos, requiere prueba en vivo) |

**Resumen de la dimensión Voz:** 1 de 6 en estado A (V03), 3 en B (V01, V05, V06), 2 sin implementar (V02, V04).

---

### 4.2 Lenguaje corporal (V07–V11)

| ID | Dimensión | Variable | Requisito operacional | Implementación actual | Fuente de datos | Método actual | ¿Llega a la evaluación? | ¿Afecta la puntuación? | Estado | Brecha concreta | Evidencia | Confianza |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V07 | Cuerpo | Contacto visual | Frecuencia y duración de desviaciones, considerando el formato de la audiencia | Calcula el % de tiempo mirando a la cámara combinando orientación de cabeza (`yaw < 0.22`) y dirección de ojos (blendshapes), y guarda segundos mirando / mirando a otro lado, global y **por pregunta** | Video (MediaPipe Pose + Face) | Visión por computador + regla con rango ideal (≥ 75 %) y peso 3; aporta además 20 % de la nota de Empatía | Sí | **Sí** — peso 3 de 12 en Expresión **y** 20 % de Empatía ⇒ ≈9,6 puntos del global (25 % de Expresión + 20 % de Empatía × 20 %) | **A** | No cuenta **eventos** de desviación ni su duración individual (solo tiempo acumulado); no considera el formato de audiencia (p. ej. mirar a un público distribuido); "fuera de cuadro" se suma a "mirando a otro lado", lo que mezcla ausencia con desvío; el rostro sin detectar anula el filtro de ojos | `poseTracker.js` L157-171 (yaw + ojos), L195-210 (tramos), L235-243; `evaluator.js` L104 y L388-393 (mirada dentro de Empatía); `InformeCoach.jsx` L275-292 (mostrado) | Alta |
| V08 | Cuerpo | Expresión facial | Congruencia observable entre expresión, contenido y contexto, **sin inferir estados internos** | Detecta **sonrisa/risa** (`(mouthSmileLeft+mouthSmileRight)/2 > 0.45`) y acumula segundos; la IA juzga la "consistencia de la risa" con lo que se estaba diciendo; eso **se muestra** en el informe | Video (MediaPipe Face, blendshapes) | Visión por computador + juicio de IA, **sin peso en ninguna área** | Sí, al informe (no a la nota) | **No** — no existe criterio de expresión facial en el patrón ni en el prompt de áreas | **D** | La única expresión detectable es la sonrisa; no hay ceño, tensión, mirada sostenida ni microexpresiones; la congruencia se evalúa **solo cuando la risa supera 1 segundo** y solo para la risa; no entra en la puntuación, así que "expresión facial" no puede mejorar ni empeorar la nota | `poseTracker.js` L16, L141-143, L244; `evaluator.js` L114-119 (`MIN_SMILE_SECONDS = 1`), L123-163 (`buildSensitivity`), L255-259 y L433; `patternConfig.js` L23-31 (no hay criterio facial); `InformeCoach.jsx` L270-300 | Alta |
| V09 | Cuerpo | Postura | Estabilidad, apertura, rigidez, encorvamiento y cambios ante preguntas difíciles | Mide la **inclinación media de los hombros** en grados y la puntúa (ideal 0–4°, peso 2) | Video (MediaPipe Pose: hombros) | Visión por computador + rango ideal lineal | Sí | **Sí** — peso 2 de 12 en Expresión ⇒ ≈4,2 puntos del global | **B** | Un solo indicador (ángulo de hombros) como sustituto de toda la postura: no hay apertura, rigidez, encorvamiento ni **cambios ante preguntas difíciles**; tampoco distingue postura de pie/sentado ni encuadre de la cámara | `poseTracker.js` L173-177, L236; `evaluator.js` L105; `patternConfig.js` L27; límites de landmarks usados: `poseTracker.js` L22-28 (no se usan caderas) | Alta |
| V10 | Cuerpo | Gesticulación | Utilidad, apertura, repetición y carácter distractor de los gestos | Mide la **magnitud** de movimiento de las muñecas entre cuadros y la puntúa dentro de un rango (0.002–0.012, peso 1) | Video (MediaPipe Pose: muñecas) | Visión por computador + rango ideal lineal | Sí | **Sí** — peso 1 de 12 en Expresión ⇒ ≈2,1 puntos del global; **si no se ven las muñecas el criterio no se puntúa y su peso se reparte** | **B** | Mide cantidad de movimiento, no **utilidad, apertura, repetición ni distractor**; no hay seguimiento de la forma del gesto ni de su relación con lo que se dice; piernas y antebrazos no se consideran | `poseTracker.js` L183-188, L238; `evaluator.js` L107, L35-39 (`average` descarta pesos/valores nulos); `patternConfig.js` L29 | Alta |
| V11 | Cuerpo | Estabilidad corporal | Balanceos, movimientos repetitivos y cambios respecto de la postura basal | Mide el **movimiento medio de la cabeza** (`headMovement`) entre cuadros y lo puntúa (0.001–0.006, peso 2); la presencia en cámara se puntúa aparte (peso 2) | Video (MediaPipe Pose: nariz) | Visión por computador + rango ideal lineal | Sí | **Sí** — peso 2 de 12 en Expresión ⇒ ≈4,2 puntos del global | **B** | Solo cubre movimiento de cabeza; **no mide balanceos del torso, desplazamientos laterales ni periodicidad** (movimientos repetitivos); no hay **postura basal** de referencia, por lo que "cambios respecto del basal" es inmedible | `poseTracker.js` L179-189, L237; `evaluator.js` L106; `patternConfig.js` L28; no se usan landmarks de cadera/torso (`poseTracker.js` L22-28) | Alta |

**Resumen de la dimensión Cuerpo:** 1 de 5 en estado A (V07), 3 en B (V09, V10, V11), 1 en D (V08).

---

### 4.3 Control del mensaje (V12–V17)

| ID | Dimensión | Variable | Requisito operacional | Implementación actual | Fuente de datos | Método actual | ¿Llega a la evaluación? | ¿Afecta la puntuación? | Estado | Brecha concreta | Evidencia | Confianza |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V12 | Control del mensaje | Alineación con mensajes clave | Cobertura, fidelidad y pertinencia de los mensajes corporativos | El prompt del evaluador recibe la lista de mensajes clave del escenario y pide una nota 0-100 para el criterio "Sostiene los mensajes clave" (peso 3) más una lista `mensajesClave[{mensaje, cubierto}]`; el informe muestra "X de Y sostenidos" | Escenario (`Theme.keyMessages`) + transcripción | IA generativa sobre texto, con criterio ponderado | Sí | **Sí** — peso 3 de 9 en Coherencia ⇒ **10 puntos** del global (30 % × 3/9) | **B** | Solo mide **cobertura** (sí/no por mensaje), y lo hace la IA sin exigir la frase que lo respalda: **no hay fidelidad** (decir algo parecido o deformado) ni **pertinencia** (decirlo cuando correspondía); el detalle no distingue si el mensaje se sostuvo bajo presión | `evaluator.js` L182, L225-226, L253; `patternConfig.js` L34-40; `interviewer.js` L42-52 (el entrevistador también recibe los mensajes clave); `InformeCoach.jsx` L318-333 | Alta |
| V13 | Control del mensaje | Técnicas de control (bridging, flagging, hooking) | Uso de técnicas de control del mensaje | **Nada.** No existe ninguna mención de estas técnicas en el sistema auditado. La única aparición en todo el repositorio es el **prototipo antiguo** `version-antigua.html` | — | Ninguno | No | **No** | **E** | Todo. Además el sistema incentiva lo contrario: el criterio `directness` penaliza la evasión y el entrevistador recibe instrucciones para buscar la línea roja | Búsqueda negativa en `backend/**` y `frontend/src/**`; aparición en `frontend/public/version-antigua.html` L314 y L372; `patternConfig.js` L36-37 | Alta |
| V14 | Control del mensaje | Capacidad de síntesis | Duración, redundancia, ideas principales y cierre | **Nada específico.** No hay criterio de síntesis ni medición de duración de la respuesta, ni de densidad de ideas, ni de cierre | — | Ninguno | No | **No** | **E** | Todo. Existe un solapamiento parcial con el criterio `clarity` ("Claridad y estructura", asignado a V15), pero no mide ninguna de las cuatro dimensiones de la definición | `patternConfig.js` L33-40 (criterios de Coherencia); no hay criterio ni campo de duración por respuesta (`SesionPractica.jsx` L288-299 guarda `durationMs` **sin usarlo** en ninguna nota) | Alta |
| V15 | Control del mensaje | Claridad del mensaje | Comprensión, tecnicismos, frases complejas, necesidad de explicación | Criterio `clarity` ("Claridad y estructura") con peso 1, calificado por la IA de 0 a 100 a partir de la transcripción | Transcripción | IA generativa sobre texto, sin medición | Sí | **Sí pero marginal** — peso 1 de 9 en Coherencia ⇒ **3,3 puntos** del global | **B** | No hay ninguna medición: no se detectan tecnicismos, longitud de frase, subordinadas, ni necesidad de repetir; para "estructura" el prompt no entrega ninguna pauta (no define qué es una respuesta estructurada) | `patternConfig.js` L39; `evaluator.js` L174-179 (`criteriaText`) y L244-245 | Alta |
| V16 | Control del mensaje | Pertinencia de respuesta | Respuesta al núcleo de la pregunta, distinguiendo control estratégico de evasión | Criterio `directness` ("Responde directo, sin evadir") con peso 2, calificado por la IA; además la IA entrega un `puntaje` y un `comentario` **por pregunta** | Transcripción (preguntas + respuestas) | IA generativa sobre texto, con criterio ponderado | Sí | **Sí** — peso 2 de 9 en Coherencia ⇒ **6,7 puntos** del global | **B** | No distingue **control estratégico** (desviar deliberadamente hacia el mensaje propio) de **evasión**; el criterio es único para toda la entrevista (aunque existe puntaje por pregunta, es un puntaje global por turno, no una nota de pertinencia); no compara con el núcleo exacto de la pregunta | `patternConfig.js` L37; `evaluator.js` L255 (`porPregunta`), L185-196 (se envía la conversación completa) | Alta |
| V17 | Control del mensaje | Consistencia narrativa | Contradicciones internas, con respuestas anteriores y con la información institucional | El **estándar** que recibe la IA menciona "no se contradice" (`coherence.descriptor`) y la persona "ALTA" del entrevistador declara que "señala contradicciones", pero **no existe criterio con peso** ni comparación explícita entre respuestas | Transcripción + descriptores del patrón | Solo IA, sin criterio ni formato de salida específico | Parcialmente (podría aparecer en el `comentario` por pregunta o en "mejoras") | **No** por sí misma: no hay criterio propio; puede influir de forma indirecta y no auditable en `directness`/`clarity` | **C** | Sin criterio no hay trazabilidad: no se sabe si el modelo evaluó contradicciones, y no hay comparación sistemática respuesta-contra-respuesta ni contra el mensaje institucional (que solo existe como mensajes clave y líneas rojas, sin cuerpo documental) | `patternConfig.js` L34; `evaluator.js` L236-238 (solo dos descriptores declarados: Coherencia y Empatía), L255-259 (salida esperada: no hay campo de contradicciones); `interviewConfig.js` L24 | Media |

**Resumen de la dimensión Control del mensaje:** 0 en A, 3 en B (V12, V15, V16), 1 en C (V17), 2 sin implementar (V13, V14).

---

### 4.4 Gestión del contexto y presión (V18–V23)

| ID | Dimensión | Variable | Requisito operacional | Implementación actual | Fuente de datos | Método actual | ¿Llega a la evaluación? | ¿Afecta la puntuación? | Estado | Brecha concreta | Evidencia | Confianza |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V18 | Presión | Asertividad | Firmeza, respeto y claridad, evitando pasividad y confrontación | **Nada específico.** Ningún criterio menciona firmeza, respeto ni confrontación. El entrevistador puede llegar a "EXTREMA" (hostil), pero **el comportamiento del vocero frente a eso no se evalúa** | Frases sueltas del vocero podrían aparecer en `cita`/`mejoras`, sin criterio | Solo IA, sin instrucción que la obligue | No | **No** | **C** | Todo. La definición exige dos extremos (pasividad y confrontación) y eso requiere criterio propio; hoy el vocero podría ser sumiso o agresivo y ninguna nota lo distinguiría de forma trazable | `patternConfig.js` L33-51 (ningún criterio de asertividad); `evaluator.js` L236-259 (salida esperada: 7 criterios, ninguno de asertividad); `interviewConfig.js` L28-34 (EXTREMA describe al entrevistador, no al vocero) | Alta |
| V19 | Presión | Escucha activa | Comprensión de la pregunta, omisiones, interrupciones y respuestas prematuras | **Nada medido.** No se detecta si el vocero interrumpe (de hecho el micrófono se pausa mientras el entrevistador habla), ni si responde antes de que la pregunta termine, ni si deja partes sin contestar | — | Ninguno | No | **No** | **C** | Todo. Los temporizadores existentes (`NO_ANSWER_MS` = 12 s sin hablar; `END_SILENCE_MS` = 6 s de silencio) controlan el **turno de conversación**, no miden escucha; la omisión solo podría inferirse de `directness`, que es un criterio global distinto. **No confundir "control del turno" con "escucha activa"** | `SesionPractica.jsx` L22-23, L246-269 (watchdog de turnos); `speech.js` no mide solapamiento; `audioMeter.js` L59-66 (pausa la medición mientras habla el entrevistador) | Alta |
| V20 | Presión | Control emocional observable | Cambios de voz, fluidez, postura y estructura ante presión, **sin afirmar que se detectan emociones internas** | Existen las señales que la definición pide observar (volumen, muletillas, postura, mirada, por pregunta) **pero no se calcula ninguna variación ni se evalúa la variable**; el prompt solo indica considerar el nivel de presión declarado del escenario | Audio + video + transcripción (los datos existen, por respuesta) | Datos presentes, sin lógica de comparación | No (no se agregan ni se envían como variable) | **No** | **C** | Falta la *comparación*: se guardan medias globales y deltas por pregunta, pero nadie calcula "cómo cambió mi voz/fluidez/postura respecto de mi propio inicio ni respecto de la pregunta anterior". Nada en el prompt pide distinguir cambios observables de estados internos | `SesionPractica.jsx` L288-299 (deltas por respuesta guardados); `poseTracker.js` L195-210 (`endSegment`); `evaluator.js` L224 (única mención a presión) y L200-213 (las métricas se envían **agregadas**, no por tramo) | Alta |

| V21 | Presión | Tolerancia a la presión | Comparación del desempeño entre **niveles sucesivos** de presión | El escenario define **un solo** nivel de agresividad (BAJA/MEDIA/ALTA/EXTREMA), constante durante toda la entrevista; el prompt lo declara como "Nivel de presión del entrevistador" y pide tenerlo en cuenta, sin ningún instrumento de comparación | Escenario (`Theme.interviewConfig.aggressiveness`) | Solo instrucción en el prompt, sin medición ni niveles | No como comparación | **No** | **C** | **No hay presión por niveles**: el guion no cambia la presión y no se registra en qué momento hubo una pregunta difícil (la agresividad es constante; las repreguntas no son "más presión", son otro turno). En los términos de la definición operacional es, por tanto, **no implementada**: no existe ningún cálculo de tendencia, caída o recuperación. Sí existe materia prima sin explotar: puntaje por pregunta y métricas por respuesta | `interviewConfig.js` L10-44 y L97-107 (una sola agresividad, sin escalada); `evaluator.js` L186, L224; `SesionPractica.jsx` L288-299; `evaluator.js` L255 (`porPregunta` con puntaje) | Alta |
| V22 | Presión | Consistencia institucional | Respeto de mensajes corporativos, líneas rojas y restricciones de información | El prompt recibe mensajes clave y líneas rojas del escenario, con dos criterios ponderados (peso 3 cada uno) y una salida `lineasRojas[{linea, cruzada, evidencia}]` que **cita la frase del vocero** cuando afirma que la cruzó | Escenario (`Theme.keyMessages`, `Theme.redLines`) + transcripción | IA generativa sobre texto, con criterios ponderados y evidencia textual | Sí | **Sí** — 3/9 de Coherencia (mensajes clave) **+** 3/9 (líneas rojas) ⇒ **20 puntos** del global | **B** | No existe **base institucional** más allá de dos listas de texto libre: ni documentos, ni "restricciones de información" (qué se puede divulgar), ni jerarquía de mensajes. La evidencia textual solo se pide para las líneas rojas, no para los mensajes clave, y la escribe el propio modelo sin validarse contra la transcripción | `evaluator.js` L182-183, L225-228, L254; `patternConfig.js` L36-38; `routes/themes.js` (edición de mensajes y líneas rojas); `InformeCoach.jsx` L336-354 | Alta |
| V23 | Presión | Recuperación y manejo de hostilidad | Tiempo y magnitud de recuperación respecto del basal tras una situación difícil; respuesta ante provocaciones manteniendo respeto y control | Existe una métrica que permitiría parte del análisis (puntaje y métricas **por pregunta**, en orden) pero **no se calcula** nada de recuperación. Para hostilidad, el sistema solo tiene la persona "EXTREMA" del entrevistador; **no se evalúa la respuesta del vocero** a esa hostilidad | `porPregunta` (puntaje por turno) + métricas por respuesta | Métrica existente, **sin uso** para esta variable | No | **No** | **D** (métrica sin usar); la mitad "manejo de hostilidad" está en **E** | No hay línea basal, así que "recuperación respecto del basal" es **inmedible hoy**; no se marca qué preguntas fueron provocadoras ni se registra la reacción inmediata posterior. La hostilidad declarada del entrevistador no se traduce en ninguna evaluación del vocero | `evaluator.js` L255-259 (`porPregunta`), L433; `interviewConfig.js` L28-34; ausencia de cualquier cálculo de tendencia o recuperación en `evaluator.js` | Media-alta |

**Resumen de la dimensión Presión:** 0 en A, 1 en B (V22), 4 en C (V18, V19, V20, V21), 1 en D con la mitad sin implementar (V23).

### 4.5 Conteo global de estados

| Estado | Variables | Nº | Significado práctico |
|---|---|---|---|
| **A — Implementada y conectada** | V03 (ritmo y velocidad), V07 (contacto visual) | **2** | Medición objetiva + criterio con peso + participación en la nota |
| **B — Parcial** | V01, V05, V06, V09, V10, V11, V12, V15, V16, V22 | **10** | Hay medición o criterio, pero falta el núcleo de la definición |
| **C — Solo inferida por IA** | V17, V18, V19, V20, V21 | **5** | No hay medición ni criterio: solo la posibilidad de que el modelo opine |
| **D — Medida pero no evaluada** | V08, V23 | **2** | El dato existe y se muestra, pero no puntúa |
| **E — No implementada** | V02, V04, V13, V14 | **4** | Ni medición, ni criterio, ni instrucción |
| **F — No determinable** | — | **0** | Ninguna variable quedó sin poder clasificarse |

**Lectura del cuadro:** el sistema cubre **2 de 23** variables de forma completa, **10** de forma parcial, **5** solo como posibilidad de juicio de IA, **2** como dato mostrado sin puntuar y **4** no existen. Las 4 ausentes por completo (V02 tono, V04 entonación, V13 técnicas de control, V14 síntesis) son precisamente las que exigirían **tecnología que hoy no está en el proyecto** (análisis espectral) o **trabajo de rúbrica que hoy no está escrito**.

> **Advertencia sobre el alcance del estado A:** incluso las dos variables en estado A dependen de mediciones que **no se validaron con personas reales** en esta auditoría (encuadre de cámara, umbral de `yaw`, exactitud del reconocimiento de voz). "A" significa **"está conectada y participa en la nota"**, no "está validada empíricamente".

---

## 5. AUDITORÍA DE LAS PUNTUACIONES

### 5.1 ¿El sistema usa la escala de cinco niveles (Deficiente → Sobresaliente)?

**No.** Búsqueda de los términos de la escala (`Deficiente`, `Sobresaliente`, `Sólido`, `Adecuado`, "nivel 1", "escala") en todo el repositorio: **cero resultados** en código y configuración. Lo que existe es:

| Escala existente | Dónde | Detalle |
|---|---|---|
| **0-100** por criterio, por área y global | `evaluator.js`, `Session.score`, informe | Puntajes enteros; el global se redondea |
| **0-5** de **peso** por criterio | `patternConfig.js` | Es un peso, **no** un nivel de desempeño (confusión frecuente) |
| **Colores por umbral** | `InformeCoach.jsx` L252 | `≥ 70` color normal, `≥ 40` advertencia, `< 40` peligro. Es el único etiquetado cercano a niveles |
| **`empathyLevel`** (String) | `MasterPattern` / `ScenarioRubric` | **No contiene niveles de empatía**: `routes/patterns.js` L86 guarda ahí el valor de `strictness` (`flexible|normal|exigente`). Es una columna heredada y semánticamente engañosa |
| **"Nivel alto / medio / bajo"** | `dictionary.js` L160 (`descL: 'Descriptores por nivel'`) | Texto de interfaz **sin uso**: la clave `descL` solo aparece en su propia definición, y `EditorRubrica.jsx` solo ofrece una descripción única por área |
| **Nivel de agresividad** (BAJA/MEDIA/ALTA/EXTREMA) | `interviewConfig.js` | Es presión del entrevistador, **no** nivel de desempeño del vocero |

### 5.2 ¿Cada variable tiene criterios explícitos para distinguir los cinco niveles?

**No.** Ninguna variable tiene descriptores por nivel. Cada criterio tiene **una sola etiqueta** ("Claridad y estructura", "Sostiene los mensajes clave"…) y el modelo debe devolver **un número 0-100**; no se le explica qué significa un 40 frente a un 80, ni se pide justificación por nivel. Las únicas reglas explícitas son las de los criterios **medidos**, y son rangos continuos, no niveles:

- "100 dentro del rango ideal, caída lineal hacia 0 fuera de él" (`rangeScore`).
- Tolerancias: muletillas ≤ 2/min (cada una extra resta 12 puntos), pausas ≤ 1 por respuesta (cada una extra resta 20).

> **Consecuencia:** dos voceros con la misma nota en "Claridad" pueden haber sido juzgados con criterios mentales distintos del modelo. Sin descriptores por nivel, la nota no es comparable entre sesiones ni entre voceros.

### 5.3 ¿Las notas las genera la IA o las calcula el código?

**Ambas**, con reparto exacto 50/50:

| Origen | Criterios | Peso en la nota global |
|---|---|---|
| **Código determinista** (fórmulas sobre métricas) | 5 de voz + 5 de cuerpo | **25** (Expresión) **+ 25** (Tono de voz) = **50** |
| **IA generativa** (juicio sobre la transcripción) | 4 de Coherencia + 3 de Empatía | **30** (Coherencia) **+ 20** (Empatía, de los cuales el 20 % es mirada medida) = **50** |

Es decir: **la mitad de la nota es una fórmula reproducible y la otra mitad es el juicio de un modelo de lenguaje** (temperatura 0.3, salida JSON forzada con `response_format: json_object`).

### 5.4 ¿Se validan los rangos?

| Qué se valida | Estado | Evidencia |
|---|---|---|
| Puntajes del modelo acotados a 0-100 | **Sí** | `evaluator.js` L270-281 (`clamp` por criterio) |
| Puntajes de las reglas acotados a 0-100 | **Sí** | `clamp` dentro de `rangeScore` (L23, L28-33) |
| Suma de pesos de áreas = 100 % | **Sí** | `routes/patterns.js` → `validateConfig` |
| Al menos un criterio con peso > 0 por área | **Sí** | mismo `validateConfig` |
| Notas del experto acotadas a 0-100 | **Sí** | `routes/sessions.js` L364-368 |
| Configuración de entrevista dentro de límites (1-12 preguntas, 0-3 repreguntas, ≤ 30 turnos…) | **Sí** | `interviewConfig.js` L46-78 |
| **Las métricas que envía el cliente** (`transcript`, `metrics`) | **NO** | `routes/sessions.js` L239-242 solo comprueba que `transcript` sea un arreglo no vacío: cualquier número puede llegar (p. ej. `wpm` o `facingCamera` inflados) y de ahí sale hasta el 50 % de la nota |
| Mínimo de datos para puntuar | **Parcialmente** | `body.available` exige ≥ 10 cuadros y `voice.available` exige > 0.05 min de voz, pero **una respuesta de tres segundos ya produce `wpm`** |
| Que el JSON de la IA traiga todos los criterios | **Parcialmente** | `callEvaluator` exige `coherencia` y `empatia` no nulos (L320); los criterios internos que falten **se omiten del promedio** (renormalización silenciosa) |

### 5.5 ¿Se genera una justificación por variable?

- **Por área (4):** sí, hay `resumen`, `cita`, `fortalezas` y `mejoras` (máximo 4 ítems cada uno), y cada criterio medido muestra **valor + unidad + puntaje**.
- **Por criterio:** **no.** No hay texto que explique por qué "Evita las líneas rojas" obtuvo 60 y no 85.
- **Por pregunta:** sí, `porPregunta[{pregunta, puntaje, comentario}]`, con **un solo puntaje por turno** (no por variable) y un comentario de una frase.
- **Por variable de las 23:** no aplica: las variables no existen como entidades en el modelo de datos.

### 5.6 ¿Hay criterios para datos insuficientes? ¿Se distingue "dato ausente" de "mal desempeño"?

**Parcialmente, con un riesgo concreto:**

- El informe **sí** distingue: muestra `/100` cuando hay nota y `no medido` cuando no la hay (`InformeCoach.jsx` L240-241), y la cola de revisión marca "Área sin medir" (`routes/sessions.js` L329).
- Pero en la **nota global la ausencia no existe**: el peso del área no medida se reparte entre las demás (`average`, L35-39). Por tanto **una sesión sin voz ni cámara que solo tenga texto puede obtener una nota global alta**, indistinguible de una nota obtenida con todo medido. Es un problema de **comparabilidad**, no un error de cálculo.
- En los datos por respuesta hay una trampa sutil: si el audio no está disponible, `longPauses` se guarda como `0` (`SesionPractica.jsx` L296) y `volumeVariation` como `null`; ese `0` "se ve perfecto" en el informe aunque signifique "no se midió". Solo el `voice.available` global evita que puntúe.

### 5.7 Agrupación por dimensión, pesos y nota global (resumen exacto)

```
CRITERIOS MEDIDOS                                    CRITERIOS DE IA
voz     : wpm 3, fillers 3, pauses 2,                coherencia: keyMessages 3, directness 2,
          variation 1, latency 1        (Σ = 10)                 redLines 3, clarity 1     (Σ = 9)
cuerpo  : presence 2, facing 3, posture 2,           empatía   : impact 3, warmth 2,
          head 2, hands 1               (Σ = 10)                 responsibility 2          (Σ = 7)

notaÁrea = Σ(peso × puntaje) / Σ(peso de los criterios que tienen puntaje)   ← renormaliza
empatía  = contenido × 0,80 + facing × 0,20                                  ← la mirada pesa 20 %
global   = Σ(pesoÁrea × notaÁrea) / Σ(peso de las áreas que tienen nota)
           pesos de área: expresión 25, tono 25, coherencia 30, empatía 20   (deben sumar 100)
```

Nada de esto ha sido modificado por esta auditoría: **los pesos actuales siguen intactos**.

### 5.8 Arquitectura propuesta para calificar las 23 variables en una escala común 1-5

**Principio rector (obligatorio para no engañar al lector):** la escala 1-5 es una **capa de presentación y trazabilidad** sobre la nota 0-100 que ya existe. No convierte una inferencia en una medición.

**Regla de oro:** cada variable se publica con **tres piezas separadas y distinguibles visualmente**:

```
[ VALOR MEDIDO ]  → número + unidad + referencia (solo si existe medición objetiva)
                    Ej.: "138 palabras/min (referencia 120-165)"
[ NIVEL 1-5 ]     → derivado de la nota 0-100 con bandas documentadas
[ EVIDENCIA ]     → qué se midió y con qué, o la cita textual si el juicio es de IA
```

**Bandas propuestas (una sola tabla, igual para las 23 variables; no cambia ningún peso):**

| Nivel | Rango interno 0-100 | Etiqueta | Se muestra como |
|---|---|---|---|
| 5 | 80-100 | Sobresaliente | Nivel 5 · medición "138 ppm" |
| 4 | 60-79 | Sólido | Nivel 4 |
| 3 | 40-59 | Adecuado | Nivel 3 |
| 2 | 20-39 | Bajo | Nivel 2 |
| 1 | 0-19 | Deficiente | Nivel 1 |
| **NE** | sin dato | **No evaluable** | "No evaluable (falta medición)" — **nunca** se muestra como nivel 1 |

**Las cinco salvaguardas que evitan presentar inferencias como mediciones:**

1. **Etiqueta de origen obligatoria** por variable: `medido`, `medido+IA` (híbrido) o `juicio del evaluador (IA)`. El vocero debe verla junto al nivel.
2. **Prohibido mostrar unidades en las variables juzgadas por IA**: "Claridad: nivel 4 (juicio del evaluador)" ✔; "Claridad: 4/5 medido" ✘.
3. **Evidencia obligatoria para el juicio de IA**: cada criterio juzgado debe devolver una **cita textual** de la respuesta (mínimo 1, máximo 25 palabras). Si no hay cita, el criterio queda **"sin evidencia"** y se excluye del promedio (hoy esto no se pide, ver §4.3).
4. **"No evaluable" es un estado de primera clase**: si falta la medición, el informe lo dice y **el nivel no se inventa**. La nota global debe declarar su **cobertura** ("calculada sobre 60 % de los criterios").
5. **Confianza explícita** por variable: `alta` (medición estable), `media` (medición sensible a condiciones o juicio de IA con cita), `baja` (juicio sin cita o muestra insuficiente).

**Estado de datos propuesto (sin tocar el esquema en esta fase):** los tres valores por variable (`valor`, `nivel`, `origen`, `confianza`, `evidencia`) pueden guardarse **dentro del JSON `Session.report`** que ya existe (por ejemplo `report.areas[].criteria[]` ampliado), sin migración. Solo si se quiere consultar por variable en SQL haría falta una tabla nueva (ver plan, Fase 6).

**Por qué NO se debe simplemente "pedirle a la IA que puntúe las 23 variables de 1 a 5":** porque (a) sin descriptores por nivel las notas no serían comparables (§5.2), (b) sin evidencia textual obligatoria no serían auditables, y (c) mezclaría en un mismo número variables medidas (que hoy son reproducibles) con juicios, perdiendo la única parte objetiva del sistema.

---

## 6. CASOS ESPECIALES VERIFICADOS UNO POR UNO

| # | Verificación | Resultado | Hallazgo concreto y evidencia | Impacto en la viabilidad de las variables |
|---|---|---|---|---|
| 1 | ¿Las métricas se comparan con una **línea basal individual**? | **No** | Los rangos son fijos por patrón (120-165 ppm, 75 % de mirada…). No existe ningún cálculo que compare al vocero consigo mismo | Bloquea V01, V02 (comparación con el rango habitual), V20 y V23 (recuperación respecto del basal) |
| 2 | ¿Existe **calibración al comienzo**? | **No** | `CheckTecnico.jsx` L232-258: el botón "Iniciar calibración" solo anima una barra de progreso durante **1000 ms**; no mide voz, ni postura, ni ruido, y **no guarda nada**. La pantalla muestra "Calibración corporal · Completada" (L349-362, L582-589). Sí se guardan los IDs de cámara/micrófono y el consentimiento (`sessionStorage` L643) | Es la limitación raíz de todas las variables basadas en comparación. Además es un **riesgo de expectativa**: el usuario cree que el sistema lo calibró |
| 3 | ¿Hay **información temporal suficiente** para medir cambios ante presión? | **Parcialmente** | Por respuesta se guardan `wpm`, muletillas, latencia, pausas, CV de volumen y deltas de mirada/risa (`SesionPractica.jsx` L285-301), y la IA devuelve un puntaje por turno (`porPregunta`). **Pero** no se guardan las series crudas (las muestras de `audioMeter` se descartan al cerrar cada respuesta), no hay marca de tiempo por turno y no existe etiqueta de "pregunta difícil" | Suficiente para una **curva gruesa por turno** (V21, V23) si se acepta la imprecisión; **insuficiente** para analizar la reacción inmediata (segundos) tras una provocación |
| 4 | ¿Los escenarios aplican **distintos niveles de presión**? | **No** | `interviewConfig.js` L10-44: un único `aggressiveness` por escenario; `turnPlan` (L97-107) alterna pregunta/repregunta pero **nunca cambia la presión** | Bloquea V21 en su definición literal (niveles sucesivos) y debilita V23 |
| 5 | ¿Se identifica **qué preguntas fueron difíciles y cuándo**? | **No** | No hay ninguna marca de dificultad, tensión ni provocación en `transcript` ni en el informe. `porPregunta` devuelve puntaje y comentario, no dificultad | Bloquea el análisis de tolerancia a la presión y recuperación: no se puede segmentar antes/después de un evento difícil |
| 6 | ¿Se **vincula cada respuesta con su pregunta**? | **Sí** | `SesionPractica.jsx` L285-287 guarda `{question, answer, metrics}` y el informe los muestra emparejados (`InformeCoach.jsx` L358-404) | Habilita V12, V16, V17 y cualquier análisis por pregunta |
| 7 | ¿Se pueden **comparar respuestas consecutivas**? | **Los datos sí, el código no** | El arreglo está ordenado y tiene métricas y puntajes por turno, pero ningún módulo compara turnos entre sí | Habilita V17, V20, V21 y V23: es el activo más desaprovechado del sistema |
| 8 | ¿**Mensajes clave y líneas rojas** están disponibles en la evaluación? | **Sí** | Evaluador: `evaluator.js` L182-183, L225-228. Entrevistador: `interviewer.js` L42-52, incluso se le instruye tentar la línea roja según la agresividad | Habilita V12 y V22; el límite es que son dos listas de texto libre, sin base documental |
| 9 | ¿El sistema conoce **información institucional fiable** para detectar contradicciones? | **No** | Lo único "institucional" son `Theme.keyMessages`, `Theme.redLines`, `Theme.optic`, `Theme.context` (`schema.prisma` L77-101). No hay documentos, manuales ni histórico de declaraciones | Bloquea V17 y la parte "restricciones de información" de V22 |
| 10 | ¿Hay información para distinguir **pausa deliberada de bloqueo**? | **No** | Solo se cuenta cuántos silencios superan 1,5 s (`audioMeter.js` L78-85). No hay contexto (¿venía de una pregunta difícil?), ni análisis del texto, ni comparación con la velocidad previa | Bloquea V05 en el estado A y complica V20 |

| 11 | ¿Se distingue **mirar fuera de cámara** de **mirar a un público distribuido**? | **No** | `yaw < 0.22` y "fuera de cuadro suma a away" (`poseTracker.js` L164-171, L150-153). No existe ningún campo de formato de audiencia en `Theme` ni en la configuración de entrevista | Bloquea V07 en su definición completa: una entrevista presencial con público repartido sería penalizada |
| 12 | ¿Se pueden evaluar **gestos y expresiones** o solo movimiento corporal? | **Solo movimiento y sonrisa** | Se mide magnitud de movimiento de muñecas y cabeza e inclinación de hombros; del rostro solo se leen sonrisa y dirección de ojos (`poseTracker.js` L112-124, L179-189) | V08 queda en D; V10 en B (sin forma ni intención del gesto) |
| 13 | ¿Una **transcripción errónea** puede provocar una puntuación injusta? | **Sí, y en proporción alta** | Todo el cálculo de `wpm`, `fillersPerMin` y los 7 criterios de IA nace de la transcripción (`SesionPractica.jsx` L282, L342-344; `evaluator.js` L188-196). El reconocimiento es del navegador, sin corrección ni verificación de confianza | Afecta a V03, V06, V12, V15, V16 y V17: hasta **50 puntos** de la nota global dependen de un texto no verificado |
| 14 | ¿Se evalúan las **sesiones incompletas**? | **Sí, sin ninguna advertencia** | "Terminé antes" cierra la entrevista y se evalúa (`SesionPractica.jsx` L403-407); `/evaluate` solo exige que `transcript` tenga al menos 1 turno (`routes/sessions.js` L240-242). El informe no indica que quedó incompleta | Distorsiona todas las variables: una entrevista de 1 pregunta produce un informe con la misma apariencia que una de 5 |
| 15 | ¿**Repetir una evaluación** puede dar resultados diferentes? | **Depende del caso** | Misma sesión: **no**, se devuelve el informe guardado (`routes/sessions.js` L234-237). Nueva sesión, misma persona y escenario: **sí**, porque el juicio de contenido lo produce un modelo con temperatura 0.3 y gana el primero de **3 modelos** que responda (`evaluator.js` L328-356: podría contestar `kimi-k3`, `nemotron` o `gemma`). Las áreas medidas, en cambio, son reproducibles | La **variabilidad de la mitad "IA"** (50 puntos) es un riesgo de equidad entre sesiones; se desconoce su magnitud real (**pendiente de validar**) |
| 16 | ¿El informe **explica las razones** de las puntuaciones? | **Parcialmente** | Hay resumen, cita, fortalezas y mejoras por sesión, comentario por pregunta y valor+unidad en cada criterio medido. **No hay** justificación por criterio calificado por IA ni explicación del número exacto de un criterio medido (`InformeCoach.jsx` L163-195, L230-260) | Sin justificación por criterio no se puede auditar ni discutir una nota con el vocero; es requisito para la escala 1-5 propuesta |
| 17 | ¿Existe **revisión humana** para resultados dudosos? | **Sí, con etiquetas engañosas** | `GET /api/review-queue` prioriza por: línea roja cruzada, puntaje entre 45-65, área sin medir y muestreo (`routes/sessions.js` L325-331). La corrección se guarda en `Session.review` con `agreement` IA vs experto. **Pero** la interfaz dice "Revisa casos de **baja confianza**" y "Cada corrección **calibra y entrena los modelos**" (`dictionary.js` L164-165) cuando **no existe ningún cálculo de confianza ni entrenamiento** | La revisión humana es real y valiosa (mide el acuerdo IA-humano), pero hoy no retroalimenta al sistema ni se declara como "sin reentrenamiento" |

---

## 7. LIMITACIONES GLOBALES Y PREGUNTAS ABIERTAS

### 7.1 Limitaciones estructurales (afectan a varias variables)

| # | Limitación | Por qué importa |
|---|---|---|
| L1 | **No hay línea basal ni calibración real** | Todas las variables comparativas (V01, V02, V11, V20, V21, V23) quedan sin referencia individual |
| L2 | **La mitad de la nota la produce un modelo de lenguaje**, con 3 modelos posibles y temperatura 0.3 | Comparabilidad entre sesiones y equidad entre voceros |
| L3 | **La transcripción es la única fuente del contenido** y no se verifica | Un error de reconocimiento penaliza velocidad, muletillas, claridad, pertinencia y mensajes clave |
| L4 | **Las métricas llegan del cliente sin validación** | Cualquiera con conocimientos puede inflar hasta 50 puntos de la nota (documentado en la auditoría integral previa; sigue vigente en `routes/sessions.js` L239-242) |
| L5 | **Las 23 variables no existen como entidades** en el modelo de datos | No hay trazabilidad requisito → código → informe; cualquier avance exige crearlas explícitamente |
| L6 | **Dos árboles de código** (raíz y `Evidencias de sistema`) | Riesgo de implementar sobre una copia y desplegar la otra |
| L7 | **Sin pruebas de las fórmulas de puntuación** | Cualquier cambio en `rangeScore`/pesos podría alterar notas sin que ninguna prueba lo detecte |
| L8 | **Sin registros de ejemplo para esta auditoría** | No se pudo comprobar en datos reales qué valores producen las métricas (¿es realista un CV de volumen de 0,35-0,90? ¿se alcanza el 90 % de presencia?) |

### 7.2 Preguntas abiertas (requieren ejecución, no lectura de código)

1. **¿Los umbrales son realistas?** 120-165 ppm, 4° de inclinación de hombros, `handActivity` 0.002-0.012, `yaw` 0.22. Sin entrevistas reales no se puede saber si un vocero normal obtiene 100 o 20 en postura y gestos.
2. **¿La variación de volumen (CV) discriminado?** El rango ideal 0.35-0.90 podría no corresponder a la variabilidad real medida por el navegador.
3. **¿Cuánta varianza introduce el juicio de IA?** Evaluar la misma transcripción N veces (mismo modelo y con modelos distintos) para medir la dispersión. **No se hizo** por restricción de cuotas.
4. **¿MediaPipe Face está disponible en los equipos objetivo?** Si falla, se pierde el filtro de ojos (mira más permisivo) y la risa (V08), sin avisar al usuario más allá de un `console.warn`.
5. **¿El modo texto se usa mucho?** Si el vocero escribe, `wpm` y muletillas quedan sin sentido, pero el informe seguiría mostrando las áreas de voz como "no medido" (correcto) sin explicar por qué.
6. **¿Existen datos históricos con los que medir el acuerdo IA-experto?** Existe el campo `review.agreement`, pero se desconoce si hay revisiones registradas.
7. **¿Qué se considera "entrevista completa"?** No hay criterio de mínimo (turnos, segundos, palabras) para emitir un informe comparable.

---

## 8. CONTRADICCIONES ENTRE EL CÓDIGO Y LA DOCUMENTACIÓN / INTERFAZ

| # | Afirmación documental o de interfaz | Realidad en el código | Evidencia |
|---|---|---|---|
| C1 | "Revisa casos de **baja confianza**" (cola de etiquetado) | No existe ninguna medida de confianza. Los motivos reales de la cola son: línea roja cruzada, puntaje límite (45-65), área sin medir y muestreo aleatorio | `dictionary.js` L164-165 y L167-170 (motivos simulados en el diccionario) vs `routes/sessions.js` L325-331 |
| C2 | "Cada corrección **calibra y entrena los modelos**" | La revisión humana solo se **guarda** en `Session.review`. No hay reentrenamiento, ni ajuste de pesos, ni uso posterior de esa nota | `routes/sessions.js` L357-385; no existe ningún job de entrenamiento |
| C3 | Pantalla "**Calibración corporal · Completada**" | Solo es una barra de progreso de 1 segundo; no mide ni guarda nada | `CheckTecnico.jsx` L232-258, L349-362, L582-589 |
| C4 | `docs/ESPECIFICACIONES.md` describe 4 áreas y criterios | Correcto, pero **no menciona** las 23 variables del requisito: no hay documento en el repositorio que describa el modelo de evaluación completa que se pide implementar | `docs/ESPECIFICACIONES.md` L98-129 |
| C5 | `empathyLevel` sugiere "nivel de empatía" | Almacena el valor de `strictness` (`flexible/normal/exigente`) | `routes/patterns.js` L86; `schema.prisma` L168 y L207 |
| C6 | Diccionario: "**Descriptores por nivel** · Nivel alto / medio / bajo" | Texto sin uso; no existe ningún descriptor por nivel en la interfaz ni en los datos | `dictionary.js` L160; `EditorRubrica.jsx` L119-126 (una sola descripción por área) |
| C7 | `version-antigua.html` presenta "Bridging messages", "Hostile questions", "Eye contact, posture, gesture" como ejes del producto | En el sistema actual no hay ninguna evaluación de técnicas de control ni de hostilidad; el prototipo anticipa capacidades que **no** se implementaron | `frontend/public/version-antigua.html` L314, L372 |
| C8 | El nombre "Tono de voz" (área) | No mide tono: mide velocidad, muletillas, pausas, variación de **volumen** y latencia. El tono (pitch) no se mide | `patternConfig.js` L15-19; `evaluator.js` L56-88; `audioMeter.js` L33-36 |
| C9 | "Variación de volumen (no monótono)" insinúa entonación | El CV de amplitud no es entonación | igual que C8 |
| C10 | `frontend/src/demo/evaluator.js` (solo en la raíz) evalúa de forma simulada | Quien audite o pruebe el sistema desde la raíz podría confundir el evaluador de demostración con el real | comparación de árboles (§1.3); `frontend/src/demo/evaluator.js` |

---

## 9. CONCLUSIONES QUE REQUIEREN PRUEBAS EN EJECUCIÓN

Ninguna de estas afirmaciones puede cerrarse leyendo código. Se listan para que el equipo las valide antes de decidir inversiones:

| # | Qué validar | Cómo | Afecta a |
|---|---|---|---|
| E1 | Rango real de `wpm`, `fillersPerMin`, `longPausesPerAnswer`, `volumeVariation` en voceros reales | 10-15 prácticas piloto, exportar `Session.metrics` y comparar con los rangos del patrón | V01, V03, V05, V06 |
| E2 | Sensibilidad de `facingCamera` al encuadre, la luz y la distancia | Pruebas con 3 encuadres y 2 niveles de luz | V07, V09, V11 |
| E3 | Estabilidad de `shoulderTilt`, `headMovement`, `handActivity` (¿reproducen el mismo valor en dos tomas iguales?) | Repetir la misma intervención 3 veces | V09, V10, V11 |
| E4 | ¿Se activa `faceAvailable` de forma fiable? (sonrisa y dirección de ojos) | Registrar `faceAvailable` en las prácticas piloto | V07, V08 |
| E5 | Varianza del juicio de IA | Enviar la misma transcripción 5 veces (y con los 3 modelos configurados) y medir la dispersión de cada criterio | V12, V15, V16, V17, V22 y la mitad de la nota |
| E6 | Tasa de error del reconocimiento de voz con acento chileno y vocabulario técnico | Comparar transcripción automática contra transcripción manual en 5 respuestas | V03, V06 y todos los criterios de IA |
| E7 | Falsos positivos de muletillas | Revisar manualmente las palabras marcadas en 10 respuestas | V06 |
| E8 | Comportamiento con sesiones cortas (1-2 respuestas) | Provocar un cierre anticipado y revisar el informe | Todas (comparabilidad) |
| E9 | Rendimiento en equipos modestos (MediaPipe Pose + Face a 10 fps + reconocimiento de voz + grabación) | Medir el uso de CPU en el equipo objetivo | V07-V11 y viabilidad de nuevas métricas |
| E10 | Comportamiento con micrófono con cancelación de ruido y con audífonos | Pruebas A/B | V01, V05, V06 |

---

## 10. REVISIÓN FINAL (lista de comprobación de la entrega)

| Comprobación solicitada | Resultado |
|---|---|
| Aparecen las **23 variables** | ✔ V01-V23, cada una con definición, evidencia, estado, brecha y confianza |
| Cada estado tiene **evidencia** | ✔ Toda fila cita archivo y línea del árbol auditado |
| **Contradicciones** entre código y documentación | ✔ §8 (10 casos, incluidos "calibración", "baja confianza" y "entrena los modelos") |
| No se confundió **medición** con **evaluación** | ✔ Columnas separadas "¿Llega a la evaluación?" y "¿Afecta la puntuación?"; V08 y V23 quedan en D precisamente por esto |
| No se confundió **instrucción de prompt** con **garantía técnica** | ✔ V21 (presión) y V17 (contradicciones) quedan en C, señalando que la mención en el prompt no constituye medición |
| Conclusiones que **requieren pruebas** | ✔ §9 (E1-E10) y §7.2 |
| **No se modificó** código, configuración ni datos | ✔ Solo lectura. Verificado con `git status`: sin cambios en código; únicamente se añaden los documentos nuevos |

**Comprobaciones adicionales de trazabilidad hechas al cerrar:** recuento de V01-V23 (23 filas), recuento de estados (2 A · 10 B · 5 C · 2 D · 4 E · 0 F), y verificación de que ninguna fila usa "implementado" para un dato que solo se muestra.

---

## 11. ENTREGABLES DE ESTA FASE

| Documento | Contenido |
|---|---|
| `AUDITORIA_COMPARATIVA_VARIABLES_VOXREADY.md` (este documento) y su versión `.docx` | Inventario, evidencia, matriz de las 23 variables, auditoría de puntuaciones, casos especiales, contradicciones, limitaciones y preguntas abiertas |
| `PLAN_IMPLEMENTACION_VARIABLES_VOXREADY.md` y su versión `.docx` | Viabilidad técnica por variable, arquitectura recomendada, prioridades, fases con estimaciones, criterios de aceptación y MVP |

**Siguiente paso propuesto:** revisar juntos estos dos documentos y decidir (a) si se resuelve primero la duplicación de árboles de código, (b) qué variables entran en el MVP y (c) en qué orden se ejecutan las fases. **En esta fase no se implementa nada.**

---

*Fin del documento. Todas las rutas de archivo citadas son relativas a `Fase 2/Evidencias Proyecto/Evidencias de sistema/`, el árbol vigente del sistema (commit `ec2a1788b`).*















