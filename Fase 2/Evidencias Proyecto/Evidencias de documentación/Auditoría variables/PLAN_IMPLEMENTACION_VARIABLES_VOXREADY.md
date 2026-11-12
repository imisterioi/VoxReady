# PLAN DE IMPLEMENTACIÓN DE VARIABLES DE EVALUACIÓN — VOXREADY

**Cómo incorporar las variables faltantes aprovechando la arquitectura actual**

| | |
|---|---|
| **Documento** | `PLAN_IMPLEMENTACION_VARIABLES_VOXREADY.md` |
| **Fase** | Planificación. **No se implementa nada en esta fase y no se modifica ningún peso, esquema ni configuración.** |
| **Base** | `AUDITORIA_COMPARATIVA_VARIABLES_VOXREADY.md` (carpeta actual) |
| **Sistema de referencia** | `Fase 2/Evidencias Proyecto/Evidencias de sistema/` — commit `ec2a1788b` (2026-10-08) |
| **Fecha** | 2026-10-13 |

---

## RESUMEN EJECUTIVO (para lectores no desarrolladores)

Hoy VoxReady mide bien **dos cosas** y evalúa con criterio otras **diez**, pero de las 23 variables que el requisito define, **cuatro no existen** y **cinco** son solo "opinión posible de la IA".

**La buena noticia:** el sistema ya tiene todo lo necesario para avanzar **sin comprar ni instalar nada nuevo**:

- el micrófono ya entrega la onda de sonido completa (permite calcular volumen absoluto, tono y entonación **sin librerías nuevas**);
- la cámara ya entrega 33 puntos del cuerpo y la cara (permite postura, apertura y **frecuencia de desvíos de mirada**);
- el patrón de evaluación ya es configurable y versionado (permite definir criterios nuevos sin tocar la base de datos);
- la evaluación ya devuelve valores por criterio (permite añadir el nivel 1-5 **sin recalcular nada**).

**La mala noticia:** tres cosas hoy **bloquean** las variables más valiosas:

1. **No hay calibración real** (la pantalla dice "Calibración completada" y no mide nada). Sin línea base no se puede evaluar volumen, tono, postura ni recuperación.
2. **No hay niveles de presión**: la agresividad del entrevistador es una sola y constante. Sin niveles sucesivos, "tolerancia a la presión" y "recuperación" son inmedibles.
3. **El texto de las preguntas difíciles no se marca**: no se sabe cuál fue la pregunta adversa, así que no se puede medir "antes y después".

**El plan propuesto (resumen):**

| Fase | Qué hace | Variables que cubre | Esfuerzo estimado (1 dev) |
|---|---|---|---|
| **0** | Orden: resolver duplicación de árboles, medir umbrales reales, pruebas de las fórmulas | (transversal) | 22-39 h |
| **1** | Fortalecer lo que ya se mide (unidades, muestras insuficientes, persistencia de series) | V01, V03, V05, V06, V07, V09, V10, V11 | 26-41 h |
| **2** | Evaluación textual con criterios individuales y evidencia obligatoria | V12, V15, V16, V17, V14, V18, V13, V19 | 36-56 h |
| **3** | Análisis acústico (volumen normalizado, tono, entonación, pausas) y calibración real | V01, V02, V04, V05, V20 | 44-67 h |
| **4** | Análisis corporal ampliado (postura, gestos, contacto visual, expresión observable) | V07, V09, V10, V11, V08 | 33-51 h |
| **5** | Presión y recuperación (niveles, marcas de dificultad, tendencia) | V21, V23, V20 | 32-51 h |
| **6** | Calificación 1-5, trazabilidad, gestión de "no evaluable" y validación | (transversal) | 31-47 h |

**Totales:** MVP ≈ **99-158 h** (12-20 jornadas) · plan completo ≈ **224-352 h** (28-44 jornadas). Detalle de supuestos en §9.1.

**MVP recomendado:** Fases 0 → 1 → 6 (con una porción de Fase 2 para mensajes clave y pertinencia). Es lo que produce **confianza** en lo ya construido y deja el sistema listo para crecer. **Quedan fuera del MVP:** tono, entonación, técnicas de control, síntesis, asertividad, escucha activa, control emocional, tolerancia a la presión, recuperación y hostilidad.

**Advertencia sobre estimaciones:** son rangos con supuestos explícitos (§9). No incluyen validación con voceros reales ni el tiempo de decidir las rúbricas (que es trabajo de contenido, no de programación). Las fases 3 y 4 **no deberían aprobarse** hasta cerrar las mediciones E1-E9 del documento de auditoría.

---

## 1. PRINCIPIOS Y RESTRICCIONES DE DISEÑO

Estas reglas condicionan todas las recomendaciones y deben respetarse durante la implementación:

| # | Principio | Consecuencia práctica |
|---|---|---|
| P1 | **No cambiar los pesos actuales en esta etapa** | El plan añade criterios y niveles, pero **no** redistribuye el 25/25/30/20 |
| P2 | **Reutilizar antes que añadir** | Primero Web Audio API (ya usada), MediaPipe (ya usada) y el modelo de evaluación ya configurado; solo después evaluar librerías nuevas |
| P3 | **El navegador primero** | Audio y video se procesan localmente hoy; se mantiene así por privacidad, coste y latencia. Solo sube al servidor lo ya subido (métricas agregadas + transcripción) |
| P4 | **Nada de nuevos modelos externos si el modelo actual basta** | La IA actual es texto; pedirle más criterios textuales es más barato que añadir un modelo de audio |
| P5 | **Separación estricta medición / juicio** | Un número medido y un juicio de IA nunca se presentan igual (§5.8 de la auditoría) |
| P6 | **Todo criterio nuevo nace con evidencia** | Medición con unidad, o cita textual para el juicio de IA |
| P7 | **Sin migraciones obligatorias al principio** | Todo cabe en el JSON `Session.report`; el esquema solo cambia si se necesita consultar por variable |
| P8 | **Coste de rendimiento acotado** | El equipo ya ejecuta MediaPipe Pose + Face + reconocimiento de voz + grabación; la ampliación acústica debe reutilizar el mismo `AnalyserNode` sin añadir bucles pesados |
| P9 | **Nada se implementa sin caso de prueba** | Cada criterio nuevo con una prueba automatizada ligera (fórmula o formato) |
| P10 | **Las decisiones de rúbrica son del equipo, no del código** | El plan propone dónde tocar; qué significa "nivel 4" en claridad lo define el equipo de vocería |

---

## 2. ANÁLISIS DE VIABILIDAD TÉCNICA POR VARIABLE

Categorías usadas (las 6 pedidas): **A** algoritmo determinista · **S** procesamiento de señal de audio · **V** visión por computador · **T** IA generativa sobre texto · **H** híbrido · **I** necesita más investigación o validación.

Columnas: *Qué reutilizamos · Qué falta · Datos adicionales · Librería/técnica · ¿Local? · ¿Backend? · ¿IA externa? · Rendimiento · Dificultad · Riesgos de falsos positivos.*

### 2.1 Dimensión Voz

| ID | Variable | Categoría | Qué reutilizamos | Qué falta desarrollar | Datos adicionales | Librería / técnica | ¿Local? | ¿Backend? | ¿IA externa? | Rendimiento | Dificultad | Riesgos de falsos positivos |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V01 | Volumen | **S + H** | `AudioMeter` ya captura la onda y calcula RMS y CV | Nivel absoluto normalizado, estabilidad en ventanas, detección de cambios abruptos, comparación con basal | **Nivel basal por sesión** y, si se quiere comparar entre personas, referencia de distancia al micrófono | Web Audio API: mismo `AnalyserNode`; normalizar por percentil (p90) del propio vocero; salto = variación > X dB en < 0,5 s | Sí | No (opcional: agregados) | No | **Bajo** (ya se recorre el búfer cada 100 ms) | **Baja** | Micrófono saturado, aire acondicionado, golpes en la mesa, distancia variable al micrófono |
| V02 | Tono | **S** | El `AnalyserNode` ya está creado y alimentado | **Todo el cálculo de F0**: detección de pitch y su estabilidad | — | `getFloatFrequencyData` para el espectro y **autocorrelación** o cepstrum sobre el búfer temporal (sin dependencias nuevas); alternativa: `AnalyserNode` + algoritmo YIN simplificado | Sí | No | No | **Medio-alto**: la autocorrelación por ventanas de 40-50 ms cada 100 ms es lo más costoso del plan acústico | **Media-alta** | Voces graves/agudas fuera de rango, ruido de fondo, voz superpuesta del entrevistador, detección de F0 errónea en consonantes |
| V03 | Ritmo y velocidad | **A** | `wpm`, `speakingMs` y la transcripción | Variación de velocidad intra-respuesta, cadencia por tramos | Marcas de tiempo por palabra (el reconocimiento entrega resultados parciales: hoy se descartan) | Mediana móvil de ppm por ventana; guardar el texto parcial con instante | Sí | No | No | **Bajo** (aritmética sobre datos ya existentes) | **Baja** | Errores de reconocimiento; pausas largas que bajan artificialmente la ppm |
| V04 | Entonación | **S** | Igual que V02 | Contorno melódico (subidas/bajadas), énfasis (energía + duración de sílaba acentuada) | Secuencia de F0 con marcas de tiempo | Extensión de V02: vector de F0 por respuesta + medidas de variabilidad (rango, pendiente, nº de inflexiones) | Sí | No | No | **Medio-alto** (comparte coste con V02: se calcula una vez) | **Alta** | Confundir entonación con volumen; falsos énfasis por ruido; requiere definir "énfasis correcto" con el equipo de vocería |
| V05 | Pausas y silencios | **H** | Conteo de silencios > 1,5 s y latencia | **Duración de cada pausa**, pausas cortas y **clasificación funcional vs bloqueo** (con señales objetivas + texto) | Instante y duración de cada silencio; qué dijo el vocero antes y después | Determinista para duración/posición; la clasificación con señales objetivas (silbido/continuidad léxica) y, si no alcanza, juicio de IA con la frase previa y posterior | Sí (duración) / IA (interpretación) | No | Sí, para la interpretación | **Bajo** | **Media** | Marcar como bloqueo una pausa legítima (el vocero piensa); el reconocimiento de voz también crea silencios falsos |
| V06 | Fluidez verbal | **A + T** | Contador de muletillas por regex y por minuto | Repeticiones, reinicios y palabras incompletas | Texto con marcas de tiempo; para reinicios hace falta el texto **intermedio** del reconocimiento (hoy se descarta el interino) | Determinista: n-gramas repetidos, detección de fragmentos (`"el pro… el proyecto"`), uso de resultados intermedios | Sí | No | Opcional (IA puede reforzar con la transcripción) | **Bajo** | **Media** | Muletillas legítimas y falsos positivos de la regex actual ("este", "bueno", "como que") |

### 2.2 Dimensión Cuerpo

| ID | Variable | Categoría | Qué reutilizamos | Qué falta desarrollar | Datos adicionales | Librería / técnica | ¿Local? | ¿Backend? | ¿IA externa? | Rendimiento | Dificultad | Riesgos de falsos positivos |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V07 | Contacto visual | **V** | `facingCamera`, `facingSeconds`/`awaySeconds` y tramos por pregunta | **Eventos de desviación** (cuántas veces y cuánto duró cada uno) y el **formato de audiencia** como parámetro del escenario | Lista de episodios de desviación con instante y duración; campo nuevo en el escenario (audiencia: cámara / público / mixto) | MediaPipe Pose+Face (ya integrado); la lógica de episodios es aritmética sobre la serie de cuadros | Sí | No | No | **Bajo** (solo agregar la serie ya calculada) | **Baja-media** | Movimiento de cabeza legítimo al pensar; gafas o luz que impiden leer los ojos; público real interpretado como desvío |
| V08 | Expresión facial | **V + T** | Detección de sonrisa y dirección de ojos (blendshapes) | Criterio y peso de la variable + evidencia; ampliar a otras expresiones observables (ceño, tensión) si se decide | Sonrisa ya existe; añadir agregados de otros blendshapes con umbrales conservadores | MediaPipe Face (ya cargado) + juicio de IA con cita | Sí (detección) | No | Sí (juicio de congruencia) | **Bajo-medio** (los blendshapes ya se leen) | **Media** | Umbrales culturales de la sonrisa; **prohibido inferir emoción interna**: el criterio debe redactarse como *congruencia observable* |
| V09 | Postura | **V** | `shoulderTilt` | Apertura (ancho de hombros normalizado), encorvamiento (hombros sobre cadera), estabilidad en ventanas y cambio tras preguntas difíciles | Landmarks de cadera (ya vienen en Pose, hoy no se usan) | MediaPipe Pose: ampliar la lista de landmarks usados (`poseTracker.js` L22-28) | Sí | No | No | **Bajo** (mismos cuadros) | **Media** | Encuadre parcial (cadera no visible), ropa holgada, postura sentado vs de pie |
| V10 | Gesticulación | **V** | `handActivity` (magnitud de movimiento de muñecas) | Amplitud, **repetición**, simetría, gestos sobre el hombro, pausas gestuales | Trayectoria de muñecas y codos por respuesta | MediaPipe Pose + series temporales simples (cambios de dirección, ciclos) | Sí | No | No | **Medio** (guardar trayectoria corta por respuesta) | **Media-alta** | Movimiento por teclado o al ajustar la cámara; distinguir gesto útil de inquietud es difícil sin intención |
| V11 | Estabilidad corporal | **V** | `headMovement` y presencia | Balanceo del torso (desplazamiento del centro de hombros), desplazamientos laterales, periodicidad | Landmarks de cadera/hombros en serie temporal | MediaPipe Pose + desviación estándar en ventanas y detección de ciclos | Sí | No | No | **Bajo-medio** | **Media** | Reajustes posturales naturales; cámara o trípode inestable |

### 2.3 Dimensión Control del mensaje

| ID | Variable | Categoría | Qué reutilizamos | Qué falta desarrollar | Datos adicionales | Librería / técnica | ¿Local? | ¿Backend? | ¿IA externa? | Rendimiento | Dificultad | Riesgos de falsos positivos |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V12 | Mensajes clave | **T** | Lista de mensajes clave + criterio ponderado existente | Desglose en **cobertura / fidelidad / pertinencia** y **cita obligatoria** por mensaje | Nada nuevo (ya está en el escenario) | Prompt + formato de salida con cita; validar que la cita **existe** en la transcripción | No | No | Sí (modelo actual) | **Bajo** | **Baja** | El modelo puede inventar la cita → la validación contra la transcripción en backend es obligatoria |
| V13 | Técnicas de control | **T + I** | Nada | Definición operacional de bridging/flagging/hooking, criterio, ejemplos etiquetados | Rúbrica escrita + ejemplos | IA con criterio explícito y cita; **requiere definición previa del equipo de vocería** | No | No | Sí | **Bajo** | **Alta** (por definición, no por código) | Confundir técnica legítima con evasión; sin ejemplos, el criterio es subjetivo |
| V14 | Síntesis | **A + T** | `durationMs` por respuesta (ya se guarda, sin uso) | Duración hablada por respuesta, densidad de ideas, redundancia y cierre | Duración en segundos y nº de palabras (ya existen) | Determinista para duración y densidad; redundancia con n-gramas; cierre con IA | Sí / IA | No | Sí | **Bajo** | **Media** | Penalizar respuestas ricas por largas; "densidad de ideas" es difícil de medir solo con texto |
| V15 | Claridad | **H** | Criterio `clarity` existente | Descriptores por nivel + evidencia + apoyos medibles (longitud de frase, tecnicismos) | Lista de tecnicismos por escenario (opcional) | IA con cita + medidas deterministas de longitud de frase y subordinadas | Sí / IA | No | Sí | **Bajo** | **Media** | Tecnicismos legítimos en escenarios técnicos; frases cortas no siempre son mejores |
| V16 | Pertinencia | **H** | Criterio `directness` existente + la conversación completa en el prompt | Nota **por pregunta**, distinción entre **control estratégico** y **evasión**, cita obligatoria | Pregunta y respuesta emparejadas (ya existen) | Prompt con salida por pregunta + validación de citas | No | No | Sí | **Bajo-medio** (la salida por pregunta ya existe) | **Media** | El modelo puede premiar la evasión elegante; hace falta definir "control estratégico" |
| V17 | Consistencia narrativa | **T** | El estándar ya menciona "no se contradice" | Criterio con peso + **comparación explícita entre respuestas** y contra mensajes clave | Transcripción completa en orden (ya existe; el evaluador la recibe entera) | IA con criterio propio y salida de contradicciones con **dos citas** | No | No | Sí | **Bajo-medio** | **Media-alta** | Falsas contradicciones por matices; exige el texto completo |

### 2.4 Dimensión Gestión del contexto y presión

| ID | Variable | Categoría | Qué reutilizamos | Qué falta desarrollar | Datos adicionales | Librería / técnica | ¿Local? | ¿Backend? | ¿IA externa? | Rendimiento | Dificultad | Riesgos de falsos positivos |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V18 | Asertividad | **T + I** | `directness` y `warmth` como señales cercanas | Criterio propio con **dos extremos** (pasividad y confrontación) y evidencia | Definición de rúbrica (pasividad / firmeza / confrontación) | IA con descriptor explícito y cita | No | No | Sí | **Bajo** | **Media-alta** (depende de la rúbrica) | Confundir firmeza con agresividad; sesgo cultural |
| V19 | Escucha activa | **A + T** | Pregunta y respuesta emparejadas; el sistema ya mide latencia | Detección de **omisiones** (¿qué parte de la pregunta quedó sin responder?), respuestas prematuras y, si se quiere, solapamiento con el entrevistador | Marca temporal del fin de la pregunta y del inicio de la respuesta (la latencia ya existe) | Prompt (omisiones) + determinista (prematuridad con `latencyMs` muy bajo) | Sí / IA | No | Sí | **Bajo** | **Media** | Una respuesta corta no es una omisión; el reconocimiento puede perder la primera palabra |
| V20 | Control emocional observable | **H** | Todas las series por respuesta ya guardadas | **Cálculo de cambios**: derivada y comparación con el inicio y con la respuesta anterior | Series por respuesta (existen) + basal (no existe) | Determinista sobre series + juicio de IA sobre texto, con redacción estricta en términos **observables** | Sí / IA | No | Sí (interpretación) | **Bajo-medio** | **Media-alta** | Atribuir emociones internas (prohibido); confundir nervios normales con pérdida de control |

| V21 | Tolerancia a la presión | **A + I** | `porPregunta`, series por respuesta, `aggressiveness` del escenario | **Niveles de presión dentro de la entrevista** (guion), marca de pregunta difícil y cálculo de tendencia/caída | Nivel de presión por turno y bandera de dificultad por turno (campos nuevos en el guion y en `transcript`) | Guion del entrevistador + estadística simple (pendiente, caída máxima, recuperación) | Sí | No | Uso indirecto del modelo actual para redactar el guion | **Bajo** (cálculo) | **Alta** (por el cambio de guion y su validación) | Comparar turnos con distinta exigencia como si fueran iguales; muestras muy cortas |
| V22 | Consistencia institucional | **T** | Mensajes clave y líneas rojas con criterio ponderado y evidencia | "Restricciones de información" como lista propia; validación de la cita contra la transcripción; jerarquía de mensajes | Lista de restricciones de información (nueva, editable en el escenario) | Prompt + validación en backend | No | No | Sí | **Bajo** | **Media** | Listas demasiado vagas producen juicios arbitrarios |
| V23 | Recuperación y hostilidad | **A + T + I** | `porPregunta` y series por respuesta | Cálculo de recuperación (tiempo y magnitud) respecto del basal y de la respuesta previa; marcado de turnos hostiles | Basal y marcas de hostilidad por turno (campos nuevos) | Estadística sobre series + IA para juzgar el manejo de la provocación con cita | Sí / IA | No | Sí | **Bajo-medio** | **Alta** | Sin basal el cálculo es engañoso; "hostilidad" mal marcada invalida el análisis |

> **Viabilidad general:** ninguna variable del plan requiere **procesamiento en backend** de audio o video ni **servicios nuevos**. La única dependencia externa es la que ya existe (el modelo de evaluación de texto). Las variables marcadas **I** (V13, V18, V21, V23) no están bloqueadas por la tecnología sino por la **definición de la rúbrica y del guion**: son decisiones del equipo de vocería, no de programación.

---

## 3. ARQUITECTURA RECOMENDADA

### 3.1 Modelo de dos capas: hechos y juicios

```
                        ┌──────────────────────────────────────────────┐
   SEÑALES DEL NAVEGADOR│  CAPA 1 · HECHOS (medidos, reproducibles)    │
   audio ─ video ─ texto│  cada hecho: valor + unidad + método + ventana│
                        └──────────────────┬───────────────────────────┘
                                           │  (mismos números de hoy + nuevos)
                        ┌──────────────────▼───────────────────────────┐
   ESCENARIO + PATRÓN   │  CAPA 2 · CRITERIOS (reglas e IA)             │
                        │  medido → fórmula; textual → IA + cita        │
                        └──────────────────┬───────────────────────────┘
                                           │  nota 0-100 por criterio
                        ┌──────────────────▼───────────────────────────┐
                        │  CAPA 3 · PUBLICACIÓN (nivel 1-5 + origen +   │
                        │  evidencia + confianza; "no evaluable" real)  │
                        └──────────────────────────────────────────────┘
```

Nada de la Capa 2 cambia en esta fase: **los pesos y las fórmulas permanecen**. La novedad es que cada criterio, además del número, devuelve **origen**, **evidencia** y **confianza**, y que la Capa 3 deriva el nivel 1-5.

### 3.2 Contrato de datos propuesto (sin migración obligatoria)

Se amplía el JSON que ya se guarda en `Session.report`, manteniendo compatibilidad hacia atrás (los informes antiguos no tienen los campos nuevos y el informe debe seguir funcionando):

```jsonc
// report.areas[] (estructura ya existente, ampliada)
{
  "key": "voice", "label": "Tono de voz", "score": 78, "weight": 25,
  "criteria": [
    {
      "key": "wpm", "label": "Velocidad al hablar",
      "weight": 3, "score": 92,
      // ---- NUEVO ----
      "origen": "medido",                  // medido | hibrido | ia
      "valor": 138, "unidad": "palabras/min",
      "referencia": "120-165",
      "confianza": "alta",
      "metodo": "transcripcion+audio",
      "evidencia": null,                    // en criterios medidos: cómo se obtuvo
      "cobertura": 1                         // fracción de respuestas con dato válido
    },
    {
      "key": "keyMessages", "label": "Sostiene los mensajes clave",
      "weight": 3, "score": 60,
      "origen": "ia", "unidad": null,
      "confianza": "media",
      "evidencia": ["'Sí, estamos trabajando en eso' (R2)"],
      "cobertura": 1
    }
  ]
}
// report.niveles (NUEVO, derivado): { "wpm": 5, "keyMessages": 4, ... }
// report.coberturaGlobal (NUEVO): 0.86  → % de peso evaluado
// report.basal (NUEVO, opcional): referencia del propio vocero si existe calibración
```

### 3.3 Reglas de implementación asociadas al contrato

1. **Validación de citas en el backend:** para cada criterio de origen `ia`, comprobar que la cita aparece (normalizada) en la transcripción. Si no aparece, el criterio se marca `evidencia_invalida` y **no puntúa** (se excluye y el área renormaliza). Esto cierra el hueco de "el modelo inventa la cita".
2. **Basal como dato opcional:** si el vocero tiene una calibración previa guardada, se compara con ella; si no, se usan los rangos del patrón y el criterio se declara de confianza `media`.
3. **Cobertura visible:** la nota global se acompaña de `coberturaGlobal`. Si baja de un umbral que decida el equipo (por ejemplo 0,6), el informe se marca **"parcial"**.
4. **Sin cambios en `Session.score`:** sigue siendo la nota global 0-100 (entero), para no romper histórico, panel administrativo ni métricas de uso.

---

## 4. MAPA PROPUESTO: DE LAS 23 VARIABLES A LOS CRITERIOS

Sin cambiar los pesos actuales. "Ubicación" indica dónde viviría cada variable dentro de la estructura ya existente (4 áreas y sus criterios); "Acción" indica si se reutiliza un criterio, se amplía o se crea.

| ID | Variable | Ubicación propuesta | Tipo de criterio | Acción concreta | Fase |
|---|---|---|---|---|---|
| V01 | Volumen | Tono de voz | Medido | Ampliar `variation` (renombrar "Volumen: nivel y estabilidad") + nuevo `volumeJumps` (cambios abruptos) | 3 |
| V02 | Tono | Tono de voz | Medido (señal) | **Nuevo** `pitchStability` (F0 y su estabilidad) | 3 |
| V03 | Ritmo y velocidad | Tono de voz | Medido | Reutilizar `wpm` + **nuevo** `wpmVariation` (variación intra-respuesta) | 1 |
| V04 | Entonación | Tono de voz | Medido (señal) | **Nuevo** `intonation` (contorno melódico) | 3 |
| V05 | Pausas y silencios | Tono de voz | Híbrido | Ampliar `pauses` (duración, posición) + nuevo `pauseType` (funcional/bloqueo) | 1 y 3 |
| V06 | Fluidez verbal | Tono de voz | Medido + IA | Ampliar `fillers` (regex corregida) + **nuevo** `disfluency` (repeticiones, reinicios, incompletas) | 1 |
| V07 | Contacto visual | Expresión | Medido | Ampliar `facing` (episodios de desviación) + parámetro de formato de audiencia | 1 y 4 |
| V08 | Expresión facial | Expresión | Híbrido | **Nuevo** `facialCongruence` (congruencia observable + cita), hoy solo en sensibilidad | 4 |
| V09 | Postura | Expresión | Medido | Ampliar `posture` (apertura, encorvamiento, estabilidad) con landmarks de cadera | 4 |
| V10 | Gesticulación | Expresión | Medido | Ampliar `hands` (amplitud, repetición, simetría) | 4 |
| V11 | Estabilidad corporal | Expresión | Medido | Ampliar `head` + **nuevo** `bodySway` (balanceo del torso) | 4 |
| V12 | Mensajes clave | Coherencia | IA con evidencia | Ampliar `keyMessages` → cobertura / fidelidad / pertinencia + cita obligatoria | 2 |
| V13 | Técnicas de control | Coherencia | IA (requiere rúbrica) | **Nuevo** `messageControl` (bridging/flagging/hooking) | Fuera del MVP |
| V14 | Síntesis | Coherencia | Híbrido | **Nuevo** `synthesis` (duración medida + redundancia + cierre con IA) | 2 |
| V15 | Claridad | Coherencia | Híbrido | Ampliar `clarity` con descriptores por nivel + apoyos medibles | 2 |
| V16 | Pertinencia | Coherencia | Híbrido | Ampliar `directness` (por pregunta + control estratégico vs evasión) | 2 |
| V17 | Consistencia narrativa | Coherencia | IA | **Nuevo** `narrativeConsistency` (comparación entre respuestas, con dos citas) | 2 |
| V18 | Asertividad | Coherencia | IA (requiere rúbrica) | **Nuevo** `assertiveness` (dos extremos) | 2 (opcional) |
| V19 | Escucha activa | Coherencia | Híbrido | **Nuevo** `activeListening` (omisiones con IA + prematuridad medida) | 2 |
| V20 | Control emocional observable | Tono de voz + Expresión | Medido + IA | **Nuevo** `observableStability` (cambios respecto del inicio y del turno anterior) | 5 |
| V21 | Tolerancia a la presión | (requiere decisión de pesos) | Medido | **Nuevo** `pressureTolerance` a partir de niveles de presión por turno | 5 |
| V22 | Consistencia institucional | Coherencia | IA con evidencia | Ampliar `redLines` + **nuevo** `infoRestrictions` | 2 |
| V23 | Recuperación y hostilidad | (requiere decisión de pesos) | Medido + IA | **Nuevo** `recovery` (medido) + `hostilityHandling` (IA con cita) | Fuera del MVP |

> **Nota sobre V20, V21 y V23:** estas tres variables no encajan limpiamente en las 4 áreas actuales. La recomendación es **no crear áreas nuevas todavía** (eso obligaría a repartir el 100 % de los pesos) y publicarlas primero como **información adicional del informe** con su nivel 1-5 y su origen, decidiendo su peso más adelante, cuando existan datos que justifiquen el reparto.

---

## 5. PLAN POR FASES

Cada fase incluye: variables cubiertas · dependencias · archivos a modificar · cambios de datos · pruebas requeridas · riesgos · criterios de aceptación · dificultad · estimación. **Las estimaciones están al final (§9) con sus supuestos.**

---

### FASE 0 — Orden y verdad del terreno *(prerrequisito de todo)*

**Variables cubiertas:** ninguna directamente; desbloquea a todas.

**Objetivo:** que el equipo sepa **qué código es el sistema**, cuáles son los valores reales de las métricas y que las fórmulas actuales queden protegidas.

**Trabajos:**

| # | Tarea | Detalle |
|---|---|---|
| 0.1 | Decidir el árbol canónico | ¿raíz o `Evidencias de sistema`? Unificar o declarar cuál se despliega; documentarlo en `docs/` |
| 0.2 | Pruebas de las fórmulas actuales | Pruebas unitarias de `rangeScore`, `scoreVoice`, `scoreBody`, `scoreFromCriteria` y del promedio global (incluidos los casos de datos nulos) |
| 0.3 | Mediciones reales (E1-E4, E9 de la auditoría) | 10-15 prácticas piloto, exportar `Session.metrics`, calcular distribución real de `wpm`, `fillersPerMin`, `longPauses`, `volumeVariation`, `facingCamera`, `shoulderTilt`, `headMovement`, `handActivity` |
| 0.4 | Varianza del juicio de IA (E5) | Misma transcripción × 5 con los 3 modelos; desviación por criterio |
| 0.5 | Corregir etiquetas engañosas | "Calibración corporal", "baja confianza", "entrena los modelos" (solo texto y nombres: mínimo cambio de código) |

**Dependencias:** ninguna. **Dependientes:** todas las fases.

**Archivos afectados:** `backend/tests/*` (nuevas pruebas), `frontend/src/pages/CheckTecnico.jsx` (texto), `frontend/src/data/dictionary.js` (textos), `docs/` (decisión de árbol canónico).

**Cambios de datos/esquema:** ninguno.

**Pruebas requeridas:** las 4 suites nuevas de fórmulas corren en verde; informe de distribución de métricas reales; informe de dispersión de la IA.

**Riesgos:** (a) descubrir que los umbrales actuales producen notas sesgadas y que hay que revisarlos **antes** de construir encima; (b) que el árbol "bueno" no sea el desplegado.

**Criterios de aceptación:**
1. Existe un documento de una página que declara el árbol canónico y la forma de desplegarlo.
2. `node tests/*.test.js` cubre las 5 fórmulas y falla si se altera un peso o un rango.
3. Hay un informe con percentiles reales (p10/p50/p90) de las 8 métricas clave.
4. Hay un informe de dispersión del juicio de IA en 3 criterios al menos.
5. Los textos de la interfaz ya no afirman capacidades inexistentes.

**Dificultad:** **Media** (sobre todo por la parte de datos reales, no por el código).

---

### FASE 1 — Fortalecer las mediciones existentes

**Variables cubiertas:** V01 (parte medida), V03, V05 (parte medida), V06, V07 (parte medida), V09, V10, V11.

**Objetivo:** que ningún criterio puntúe con datos insuficientes o mal interpretados, y que las series necesarias queden **guardadas** para las fases 3-5.

**Trabajos:**

| # | Tarea | Detalle |
|---|---|---|
| 1.1 | Mínimos de validez por criterio | Exigir nº mínimo de muestras/segundos por criterio (p. ej. `handActivity` con ≥ 30 cuadros con muñecas visibles; `wpm` con ≥ 20 palabras y ≥ 20 s de voz). Si no se cumple → "no evaluable" (no 0) |
| 1.2 | Corregir la regex de muletillas | Reducir falsos positivos: exigir contexto, excluir "este/esta" como demostrativo cuando sigue un sustantivo; permitir lista configurable por patrón |
| 1.3 | Persistir series por pregunta | Guardar en `transcript[].metrics` la duración de cada pausa (no solo el conteo) y las muestras agregadas por ventana (p. ej. cada 5 s: wpm, RMS medio, muletillas) — **no** las muestras crudas de 100 ms |
| 1.4 | Episodios de desviación de mirada | Añadir a `poseTracker` la lista de episodios (inicio, duración) y su agregado por pregunta |
| 1.5 | `cobertura` por criterio | Calcular y guardar la fracción de respuestas con dato válido |
| 1.6 | Exponer en el informe el "no evaluable" | Mostrar explícitamente el motivo (sin cámara, sin micrófono, pocas muestras, modo texto) |
| 1.7 | Corregir `longPauses: 0` engañoso | Enviar `null` cuando no hay medición de audio, en lugar de `0` |

**Dependencias:** Fase 0 (para saber los mínimos con datos reales).

**Archivos afectados:** `frontend/src/lib/practice/audioMeter.js` (series), `frontend/src/lib/practice/poseTracker.js` (episodios), `frontend/src/lib/practice/speech.js` (regex), `frontend/src/pages/SesionPractica.jsx` (`buildMetrics`, `finishAnswer`), `backend/ai/evaluator.js` (mínimos y cobertura), `backend/ai/patternConfig.js` (mínimos configurables), `frontend/src/pages/InformeCoach.jsx` (motivo de no evaluable), `backend/tests/*` (pruebas).

**Cambios de datos/esquema:** **ninguno obligatorio** (todo entra en los JSON ya existentes `Session.transcript` y `Session.metrics`). Opcional: documentar la versión del formato de métricas (`metrics.version = 2`) para distinguir informes antiguos.

**Pruebas requeridas:** unitarias de los mínimos; prueba de que una sesión de 3 s produce "no evaluable" y no 0; prueba de la regex con 20 frases trampa; prueba de que los episodios de mirada suman el tiempo de desvío ya calculado.

**Riesgos:** (a) endurecer de más y que muchas prácticas queden "no evaluables" (mitigar: medir primero con datos reales de Fase 0); (b) más datos guardados → informes más pesados (mitigar: agregados, no crudos).

**Criterios de aceptación:**
1. Ningún criterio puntúa por debajo de su mínimo de muestras; en ese caso aparece "no evaluable" con motivo.
2. Los falsos positivos de muletillas bajan de forma medible (antes/después sobre un corpus fijo de 20 frases).
3. Cada respuesta guarda la lista de pausas con su duración.
4. Cada respuesta guarda el nº y la duración de los episodios de desviación de mirada.
5. Los informes antiguos siguen abriéndose sin errores.

**Dificultad:** **Media-baja** (es ampliar lo existente).

---

### FASE 2 — Mejorar la evaluación textual

**Variables cubiertas:** V12, V14, V15, V16, V17, V22 y, si el equipo lo aprueba, V18 y V19.

**Objetivo:** dejar de tener **un número sin justificación** para el contenido: cada criterio textual con definición, descriptores por nivel y **cita obligatoria** verificada.

**Trabajos:**

| # | Tarea | Detalle |
|---|---|---|
| 2.1 | Escribir la rúbrica por niveles | Para cada criterio textual: qué es nivel 1, 3 y 5 (los intermedios se interpolan). **Trabajo del equipo de vocería**, no de programación |
| 2.2 | Ampliar el contrato de salida del evaluador | Pedir por criterio: `score` + `evidencia` (cita ≤ 25 palabras) + `razon` (una frase). Mantener `response_format: json_object` |
| 2.3 | Validar las citas en backend | Comprobar que la cita existe en la transcripción (normalizada); si no, `evidencia_invalida` y el criterio no puntúa |
| 2.4 | Mensajes clave por partes | Separar cobertura / fidelidad / pertinencia (V12) como subcriterios con peso interno |
| 2.5 | Pertinencia por pregunta | Devolver por pregunta: `{respuesta_directa, control_estrategico, evidencia}` (V16 y V19) |
| 2.6 | Consistencia narrativa | Criterio nuevo que exige **dos citas** (contradicción) o "sin contradicciones" explícito (V17) |
| 2.7 | Síntesis | Duración medida + redundancia (n-gramas) + cierre con IA (V14) |
| 2.8 | Restricciones de información | Lista nueva editable en el escenario (V22) |
| 2.9 | Mostrar la justificación | El informe muestra por criterio: nivel, origen, razón y cita (Capa 3) |

**Dependencias:** Fase 0. Para mostrar niveles, Fase 6. Puede ejecutarse en paralelo con Fase 1.

**Archivos afectados:** `backend/ai/evaluator.js` (prompt, `criteriaText`, `scoreFromCriteria`, validación de citas), `backend/ai/patternConfig.js` (descriptores por nivel), `backend/routes/themes.js` (restricciones de información), `backend/prisma/schema.prisma` (**solo si** se guardan como campo propio; alternativa: dentro de `Theme.interviewConfig`), `frontend/src/pages/EditorRubrica.jsx`, `frontend/src/pages/InformeCoach.jsx`, `backend/tests/*`.

**Cambios de datos/esquema:** los descriptores por nivel caben en `MasterPattern.config` (JSON) → **sin migración**. Un campo nuevo de "restricciones de información" requiere una migración pequeña, salvo que se reutilice `Theme.interviewConfig`.

**Pruebas requeridas:** validación de citas (real, inventada, parcial); formato del JSON con descriptores; criterio sin evidencia no puntúa y el peso se renormaliza; informes antiguos siguen abriéndose.

**Riesgos:** (a) una rúbrica sin ejemplos produce notas inconsistentes; (b) exigir citas literales puede **bajar** notas de forma artificial; (c) más criterios → más tokens y más riesgo de JSON incompleto (mitigar con límite de criterios por área).

**Criterios de aceptación:**
1. Cada criterio textual del informe muestra nivel, origen, razón y cita.
2. El 100 % de las citas mostradas existen literalmente en la transcripción.
3. Un criterio sin evidencia válida aparece "sin evidencia" y **no** aporta nota.
4. Existen descriptores escritos para los 5 niveles en los criterios aprobados.
5. La dispersión del juicio de IA (E5) se documenta con la rúbrica nueva.

**Dificultad:** **Media** en código, **alta** en definición de rúbrica.

---

### FASE 3 — Ampliar el análisis acústico

**Variables cubiertas:** V01, V02, V04, V05 (clasificación), V20 (parte de voz).

**Objetivo:** incorporar lo que hoy es **invisible**: nivel de volumen real, tono (pitch), entonación y pausas con forma.

**Trabajos:**

| # | Tarea | Detalle |
|---|---|---|
| 3.1 | Extracción de F0 | Sobre el mismo `AnalyserNode`: ventanas de 40-50 ms, autocorrelación (o YIN simplificado) sobre `getFloatTimeDomainData`; descartar ventanas sin voz |
| 3.2 | Métricas de tono | Mediana de F0, rango (p10-p90), desviación y nº de saltos sobre umbral (estabilidad del registro) |
| 3.3 | Métricas de entonación | Contorno por respuesta: pendiente media, nº de inflexiones y sentido del cierre |
| 3.4 | Volumen absoluto normalizado | Percentil 90 de RMS propio, estabilidad en ventanas de 5 s y detección de cambios abruptos (> X dB en < 0,5 s) |
| 3.5 | Pausas con forma | Duración individual, posición relativa (inicio/medio/fin) y clasificación funcional vs bloqueo (híbrido con IA) |
| 3.6 | **Calibración real mínima** | 20-30 s de lectura guiada al inicio para fijar basal de volumen, F0 y ppm; guardar en `Session.metrics.basal` |
| 3.7 | Criterios y rangos | Añadir los criterios al patrón con rangos **basados en los datos de Fase 0**, no en intuición |

**Dependencias:** Fase 0 (rangos reales) y Fase 1 (persistencia de series). **Bloquea a:** Fase 5 (basal).

**Archivos afectados:** `frontend/src/lib/practice/audioMeter.js` (núcleo del cambio), `frontend/src/pages/SesionPractica.jsx` (calibración y agregación), `frontend/src/pages/CheckTecnico.jsx` (calibración real), `backend/ai/evaluator.js` (criterios medidos nuevos), `backend/ai/patternConfig.js` (rangos y pesos nuevos — **decisión del equipo**), `frontend/src/pages/InformeCoach.jsx`, `backend/tests/*`.

**Cambios de datos/esquema:** ninguno (todo en JSON). Se recomienda versionar el formato de métricas.

**Pruebas requeridas:** tono sintético de frecuencia conocida para validar la detección de F0; pruebas con silencio y con ruido; guardado y recuperación del basal; sin calibración, el criterio queda de confianza `media`.

**Riesgos:** (a) **el mayor del plan**: la detección de F0 en el navegador puede ser imprecisa con voz superpuesta o ruido → mitigar con puerta de voz y pruebas con señales conocidas; (b) coste de CPU en equipos modestos (E9) → medir por ventanas de 100 ms, no por cuadro de audio; (c) los rangos de tono dependen mucho de la persona → mitigar con basal propio.

**Criterios de aceptación:**
1. Un tono sintético de frecuencia conocida se detecta con error < 5 %.
2. No se calculan métricas de pitch sobre ventanas sin voz.
3. La calibración guarda el basal y el informe lo declara como referencia usada.
4. El coste de CPU medido en el equipo objetivo no supera +15 % respecto de hoy.
5. Los nuevos criterios tienen rango justificado con los datos de Fase 0 (documentado).

**Dificultad:** **Alta** (señal) / **media** (integración).

---

### FASE 4 — Mejorar el análisis corporal

**Variables cubiertas:** V07, V08, V09, V10, V11.

**Objetivo:** pasar de "cuánto se movió" a **"cómo se movió"**, sin atribuir emociones.

**Trabajos:**

| # | Tarea | Detalle |
|---|---|---|
| 4.1 | Postura ampliada | Usar landmarks de cadera: apertura (ancho de hombros normalizado), encorvamiento (proyección vertical hombro-cadera), estabilidad en ventanas de 10 s |
| 4.2 | Gesto con forma | Amplitud, repetición (ciclos), simetría y gestos sobre la línea del hombro |
| 4.3 | Estabilidad del torso | Desplazamiento del centro de hombros (balanceo) y detección de periodicidad |
| 4.4 | Episodios de mirada | Añadir la **frecuencia** de desviaciones y su distribución por respuesta (complementa Fase 1) |
| 4.5 | Formato de audiencia | Parámetro nuevo en el escenario (cámara / público / mixto) que ajusta el criterio de mirada |
| 4.6 | Expresión facial observable | Criterio de **congruencia** (sonrisa/ceño respecto del contenido) con cita, sin inferir estados internos |
| 4.7 | Criterios y rangos | Nuevos criterios en el patrón con rangos de Fase 0 |

**Dependencias:** Fase 0 y Fase 1 (series y episodios).

**Archivos afectados:** `frontend/src/lib/practice/poseTracker.js` (núcleo), `frontend/src/pages/SesionPractica.jsx` (parámetro de audiencia), `backend/routes/themes.js` + `backend/ai/interviewConfig.js` (campo de formato de audiencia), `backend/ai/evaluator.js`, `backend/ai/patternConfig.js`, `frontend/src/pages/EditorTema.jsx` (editar audiencia), `frontend/src/pages/InformeCoach.jsx`, `backend/tests/*`.

**Cambios de datos/esquema:** ninguno obligatorio si "formato de audiencia" se guarda dentro de `Theme.interviewConfig` (JSON que ya existe).

**Pruebas requeridas:** pruebas con video de referencia conocido (postura derecha / inclinada), presencia de cadera mínima, y verificación de que la "congruencia facial" nunca emite juicios de estado interno (revisión de textos generados).

**Riesgos:** (a) más landmarks = más falsos positivos por oclusiones; (b) el criterio facial puede derivar en "detección de emociones" (prohibido por la definición) → mitigar con redacción estricta y revisión; (c) encuadre variable del usuario.

**Criterios de aceptación:**
1. La postura se describe con al menos 3 medidas (apertura, encorvamiento, estabilidad) y no solo con la inclinación de hombros.
2. El informe indica cuántas veces y cuánto tiempo se desvió la mirada, ajustado al formato de audiencia del escenario.
3. El 100 % de los textos del criterio facial están redactados en términos observables (revisión por muestreo).
4. Los rangos nuevos están justificados con datos de Fase 0.

**Dificultad:** **Media-alta**.

---

### FASE 5 — Evaluación de presión y recuperación

**Variables cubiertas:** V21, V23, V20.

**Objetivo:** crear las **condiciones** que hoy no existen: niveles de presión dentro de la entrevista, marca de pregunta difícil y cálculo de tendencia respecto del propio vocero.

**Trabajos:**

| # | Tarea | Detalle |
|---|---|---|
| 5.1 | Guion con niveles de presión | Extender la configuración del escenario para definir **bloques** de presión (p. ej. turnos 1-2 cordial, 3-4 incisivo, 5-6 hostil) en lugar de una única agresividad. **Opcional** y compatible con los escenarios actuales |
| 5.2 | Marca por turno | Guardar en cada turno del `transcript`: `{presion, dificil}` |
| 5.3 | Instrucción al entrevistador | El prompt del entrevistador recibe el nivel del turno actual (el mecanismo ya existe: `AGGRESSIVENESS` + `turnPlan`) |
| 5.4 | Cálculo de tendencia | Sobre `porPregunta` y las series por respuesta: pendiente, caída máxima respecto de la primera respuesta y cambio en el turno siguiente a un turno difícil |
| 5.5 | Recuperación | Tiempo (en turnos) y magnitud (en puntos y en métricas) para volver al nivel propio previo al turno difícil |
| 5.6 | Manejo de hostilidad | Criterio de IA con cita sobre la respuesta a los turnos hostiles (respeto, control, no escalada) |
| 5.7 | Publicación | Publicar V20, V21 y V23 **como información del informe** (con nivel 1-5 y origen) **antes** de darles peso |

**Dependencias:** Fase 1 (series) y, para comparar con basal, Fase 3 (calibración). Es la fase con más dependencias de **decisión** (hay que aprobar el cambio de guion).

**Archivos afectados:** `backend/ai/interviewConfig.js` (bloques de presión y compatibilidad), `backend/ai/interviewer.js` (instrucción por turno), `frontend/src/components/InterviewConfig.jsx` + `frontend/src/pages/EditorTema.jsx` (editar bloques), `frontend/src/pages/SesionPractica.jsx` (marcar turnos), `backend/ai/evaluator.js` (tendencia y criterios), `backend/ai/patternConfig.js` (rangos), `frontend/src/pages/InformeCoach.jsx` (evolución), `backend/tests/*`.

**Cambios de datos/esquema:** ninguno obligatorio (los bloques caben en `Theme.interviewConfig`; las marcas, en `transcript`). **No** se propone tabla nueva.

**Pruebas requeridas:** compatibilidad total con escenarios antiguos (una sola agresividad); verificación de que el nivel del turno llega al prompt; prueba del cálculo de tendencia con una serie sintética; prueba de que sin turnos difíciles la variable queda "no evaluable" (no 0).

**Riesgos:** (a) un guion mal calibrado produce entrevistas incoherentes → mitigar dejando el modo actual como comportamiento por defecto; (b) el cálculo de tendencia con 5 turnos es estadísticamente débil → publicar como **orientación**, no como nota firme; (c) "tolerancia a la presión" puede leerse como juicio psicológico → mitigar con lenguaje observable.

**Criterios de aceptación:**
1. Un escenario sin bloques de presión se comporta exactamente igual que hoy.
2. Cada turno queda marcado con su nivel de presión y si fue difícil.
3. El informe muestra la evolución por turno y, si aplica, el tiempo de recuperación.
4. Con menos de 2 turnos difíciles, la variable se declara "no evaluable".
5. Los textos describen cambios observables (nunca estados internos).

**Dificultad:** **Alta**.

---

### FASE 6 — Calificación, trazabilidad y validación

**Variables cubiertas:** las 23 (capa transversal de publicación).

**Objetivo:** que cualquiera pueda leer el informe y saber **qué se midió, qué se juzgó, con qué evidencia y con cuánta confianza**, sin confundir una cosa con otra.

**Trabajos:**

| # | Tarea | Detalle |
|---|---|---|
| 6.1 | Derivar el nivel 1-5 | Bandas únicas para las 23 variables (§5.8 de la auditoría), aplicadas sobre la nota 0-100 ya existente |
| 6.2 | Origen y confianza visibles | Etiqueta obligatoria `medido` / `medido+IA` / `juicio del evaluador (IA)` y confianza alta/media/baja |
| 6.3 | "No evaluable" de primera clase | Estado propio, con motivo, nunca mostrado como nivel 1 |
| 6.4 | Cobertura de la nota global | Mostrar sobre qué porcentaje del peso se calculó; marcar el informe como "parcial" bajo el umbral acordado |
| 6.5 | Vistas del informe | Vista **por variable** (23) y vista por área (la actual). La primera responde al requisito |
| 6.6 | Trazabilidad requisito → código | Tabla en `docs/` con las 23 variables, su criterio, su fuente y su estado |
| 6.7 | Validación con casos | Batería: sin cámara, sin micrófono, respuesta vacía, respuesta de 3 s, sesión incompleta, cita inválida, área sin medir |
| 6.8 | Fórmulas bajo prueba | Ampliar la suite de Fase 0 con los criterios nuevos |

**Dependencias:** todas las anteriores. Si una variable no está lista, aparece "no evaluable" (no bloquea la entrega).

**Archivos afectados:** `frontend/src/pages/InformeCoach.jsx` (vistas), `frontend/src/components/ui.jsx` (componente de nivel), `backend/ai/evaluator.js` (campos nuevos del reporte), `backend/tests/*`, `docs/` (trazabilidad).

**Cambios de datos/esquema:** ninguno obligatorio (todo en `Session.report`). **Opcional**, solo para consultar por variable en SQL o hacer analítica: tabla `SessionVariableScore` (`sessionId`, `variableKey`, `score`, `nivel`, `origen`, `confianza`, `cobertura`). Sería la única migración del plan y **no** es necesaria para cumplir el requisito.

**Pruebas requeridas:** batería de 6.7 automatizada donde sea posible; informes antiguos se muestran con "nivel no disponible" en lugar de fallar; el nivel derivado coincide con las bandas en 20 valores límite (19/20, 39/40, 59/60, 79/80).

**Riesgos:** (a) exceso de información → mitigar con jerarquía visual y una sola etiqueta de origen por variable; (b) que un nivel 5 de una variable de IA se lea como "medición objetiva" → mitigar con la etiqueta de origen y un texto breve explicativo.

**Criterios de aceptación:**
1. Las 23 variables aparecen con nivel, origen, evidencia y confianza (o "no evaluable" con motivo).
2. Ninguna variable de origen `ia` muestra unidades.
3. La vista por área actual sigue funcionando sin cambios.
4. La nota global muestra su cobertura.
5. Los informes anteriores siguen abriéndose correctamente.

**Dificultad:** **Media** (presentación y derivación); **baja** si no se añade la tabla opcional.

---

## 6. ORDEN DE PRIORIDAD Y MVP

### 6.1 Criterios de priorización usados

Se ordenó por **valor para la evaluación del vocero**, **viabilidad técnica**, **reutilización de lo existente**, **riesgo de interpretación incorrecta**, **coste** y **dependencias entre variables**. Ningún trabajo se priorizó por ser fácil.

| Prioridad | Trabajo | Por qué | Reutilización | Coste | Riesgo de mala interpretación |
|---|---|---|---|---|---|
| **1** | **Fase 0**: árbol canónico, pruebas de fórmulas y datos reales | Sin esto, cualquier inversión se apoya en supuestos no verificados; además protege la mitad objetiva de la nota | Total (no cambia el producto) | Bajo-medio | **Bajo** (reduce riesgo) |
| **2** | **Fase 1**: mínimos de validez, series, muletillas, episodios de mirada | Convierte "parcial" en "confiable", habilita fases 3-5 y corrige dos defectos reales (regex de muletillas y `longPauses: 0`) | Alta (amplía lo existente) | Bajo-medio | **Bajo** |
| **3** | **Fase 6**: escala 1-5, origen, evidencia, "no evaluable", cobertura | Responde directamente al requisito de calificación; no depende de tecnología nueva | Alta (capa de presentación) | Bajo | **Medio** (que la IA parezca medición si se etiqueta mal) |
| **4** | **Fase 2**: evaluación textual con evidencia | Alto valor para el vocero (mensajes clave, pertinencia, síntesis) sin tecnología nueva | Alta (prompt y patrón) | Medio | **Medio** (las citas literales pueden bajar notas) |
| **5** | **Fase 3**: análisis acústico + calibración real | Desbloquea 4 variables y el basal de casi todas, pero es la de **mayor incertidumbre técnica** | Media (mismo `AnalyserNode`) | Medio-alto | **Alto** (un pitch mal calculado produce conclusiones falsas) |
| **6** | **Fase 4**: análisis corporal ampliado | Mejora variables ya cubiertas; valor marginal frente al coste | Alta (MediaPipe ya integrado) | Medio | **Medio** (el criterio facial puede derivar en emociones) |
| **7** | **Fase 5**: presión y recuperación | Alto valor conceptual, pero **exige cambiar el guion** y solo tiene sentido con basal ya construido | Baja (cambia el producto) | Alto | **Alto** (juicio psicológico mal comunicado) |
| **8** | **V13 (técnicas de control) y V23 (hostilidad)** | Dependen de rúbrica y de Fase 5 | Baja | Alto | **Alto** |

### 6.2 MVP propuesto

**MVP = Fase 0 + Fase 1 + Fase 6, más dos tareas escogidas de Fase 2:** mensajes clave con evidencia verificada (V12) y pertinencia por pregunta (V16).

**Qué obtiene el equipo con el MVP:**

1. Un sistema **verificado**: fórmulas bajo prueba y umbrales ajustados con datos reales.
2. Un informe que **no engaña**: "no evaluable" cuando falta medición, cobertura declarada, y nivel 1-5 con etiqueta de origen y confianza.
3. Dos variables de contenido evaluadas **con cita textual verificada** en el backend.
4. Las **23 variables listadas y clasificadas** en el informe, con las no implementadas marcadas como "no evaluable / pendiente": esto ya cumple el requisito de trazabilidad.

**Variables cubiertas por el MVP:** V01, V03, V05, V06, V07, V09, V10, V11 (fortalecidas), V12 y V16 (mejoradas con evidencia), y las 23 **publicadas** con su estado.

**Variables FUERA del MVP:**

| Fuera | Motivo |
|---|---|
| V02 Tono, V04 Entonación | Requieren análisis espectral (Fase 3), con incertidumbre técnica y de validación |
| V08 Expresión facial | Requiere rúbrica de congruencia observable y revisión ética (Fase 4) |
| V13 Técnicas de control | Requiere definición previa del equipo; sin ella el criterio es subjetivo |
| V14 Síntesis | Requiere definir "densidad de ideas"; valor medio, coste medio |
| V17 Consistencia narrativa | Requiere rúbrica y umbral de contradicción; alto riesgo de falso positivo |
| V18 Asertividad, V19 Escucha activa | Requieren rúbrica de extremos (pasividad/confrontación; omisión) |
| V20 Control emocional observable | Requiere basal (Fase 3) para que el cálculo de cambios tenga referencia |
| V21 Tolerancia a la presión, V23 Recuperación y hostilidad | Requieren cambiar el guion de la entrevista (Fase 5) y disponer de basal |

---

## 7. CRITERIOS DE ACEPTACIÓN GLOBALES

Aplican a cualquier fase antes de considerarla terminada:

| # | Criterio | Cómo se comprueba |
|---|---|---|
| G1 | **Ninguna inferencia se presenta como medición** | Revisión de la interfaz: cada valor con unidad tiene método de medición; cada juicio de IA tiene etiqueta de origen y cita |
| G2 | **Nada puntúa sin evidencia** | Un criterio sin dato o sin cita válida queda "no evaluable" y no aporta nota |
| G3 | **Toda cita mostrada existe en la transcripción** | Validación automática en el backend (prueba con cita inventada) |
| G4 | **Sin retrocesos** | Los informes y sesiones anteriores se abren sin error |
| G5 | **Los pesos siguen sumando 100** | `validateConfig` sigue bloqueando configuraciones inválidas |
| G6 | **Cada criterio nuevo tiene prueba** | Suite en verde en `backend/tests/` |
| G7 | **Rendimiento acotado** | Medición de CPU en el equipo objetivo dentro del umbral acordado (+15 % máximo por fase) |
| G8 | **Nada destructivo** | Las nuevas métricas no alteran datos existentes ni disparan borrados |
| G9 | **Documentado** | Cada criterio nuevo queda en la tabla de trazabilidad requisito → código |
| G10 | **Explicable al vocero** | Un vocero no técnico puede explicar por qué obtuvo su nivel, leyendo la evidencia |

---

## 8. RIESGOS CONSOLIDADOS

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | Implementar sobre el árbol equivocado (dos copias) | Alta | Alto | Fase 0.1 antes de cualquier código |
| R2 | Los umbrales actuales producen notas sesgadas (p. ej. postura siempre baja) | Media | Alto | Fase 0.3 con datos reales antes de añadir criterios |
| R3 | Detección de F0 imprecisa en el navegador | Media-alta | Alto | Pruebas con tono sintético; puerta de voz; basal propio; publicar con confianza `media` |
| R4 | Rendimiento en equipos modestos al sumar análisis acústico | Media | Medio | Medir por ventanas; umbral de +15 % de CPU por fase; degradación elegante (si el equipo no puede, el criterio queda "no evaluable") |
| R5 | El criterio facial se interpreta como detección de emociones | Media | Alto (ético/reputacional) | Redacción estricta en términos observables; revisión por muestreo; sin inferencias internas |
| R6 | Exigir citas literales reduce las notas de forma artificial | Media-alta | Medio | Documentar el cambio de escala; recalibrar umbrales del patrón después del cambio |
| R7 | Varianza del juicio de IA entre sesiones | Alta (medida desconocida) | Medio-alto | Fase 0.4; rúbrica por niveles; evidencia obligatoria; considerar fijar un modelo principal y desactivar la carrera (decisión del equipo) |
| R8 | Guion de presión mal calibrado produce entrevistas incoherentes | Media | Medio | Modo actual como comportamiento por defecto; bloques opcionales; pruebas de compatibilidad |
| R9 | Que la escala 1-5 se lea como "medición" en variables de IA | Media | Medio | Etiqueta de origen obligatoria, sin unidades, con cita |
| R10 | Más criterios → JSON incompleto del modelo | Media | Medio | Límite de criterios; validación de la respuesta; reintento/fallback ya existente |
| R11 | Los datos guardados crecen y ralentizan informes | Baja-media | Bajo-medio | Agregados por ventana, nunca crudos de 100 ms |
| R12 | Cambios en el contrato de `Session.report` rompen informes antiguos | Baja | Medio | Campos opcionales; el informe tolera ausencias; prueba con informe antiguo |

---

## 9. ESTIMACIONES DE ESFUERZO

### 9.1 Supuestos explícitos (sin ellos las cifras no significan nada)

1. **Un desarrollador** que ya conoce el código (frontend React + backend Express/Prisma), dedicado en bloques de medio día.
2. **No se instalan dependencias nuevas** para las fases 1, 2, 5 y 6. Para las fases 3 y 4 se asume que se implementa con **Web Audio API y MediaPipe ya presentes**; si finalmente se decide usar una librería de audio externa, hay que sumar entre 4 y 12 h de integración y el coste de mantenerla.
3. **No incluye**: rediseño visual completo, traducción, trabajo de redacción de rúbricas (es del equipo de vocería), ni validación con voceros reales (es tiempo de operación, no de desarrollo).
4. **Incluye**: pruebas automatizadas ligeras por fase y una revisión manual de la interfaz.
5. **El rango** refleja incertidumbre real: el límite inferior supone que lo existente funciona como se lee en el código; el superior, que hay que corregir defectos encontrados al medir con datos reales (escenario probable según R2 y R3).
6. **No incluye** migraciones de producción, coordinación con clientes, ni el tiempo de operación de las prácticas piloto (que puede duplicar el calendario aunque no las horas de desarrollo).
7. Las estimaciones de **Fase 3 y Fase 4 deben considerarse provisionales** hasta cerrar las mediciones E1-E9 de la auditoría.

### 9.2 Estimación por fase

| Fase | Tareas de desarrollo | Estimación (horas de 1 dev) | Dificultad | ¿Se puede ejecutar en paralelo? |
|---|---|---|---|---|
| **0 — Orden y verdad del terreno** | pruebas de fórmulas (6-10), decisión y documento de árbol (2-4), análisis de datos reales (8-16), varianza de IA (4-6), textos (2-3) | **22-39 h** | Media | No: bloquea al resto. Solo 0.3/0.4 pueden solaparse con 0.1 |
| **1 — Fortalecer mediciones** | mínimos, regex, series, episodios, cobertura, informe y pruebas | **26-41 h** | Media-baja | Sí, con Fase 2 |
| **2 — Evaluación textual** | contrato de salida, validación de citas, mensajes clave, pertinencia, consistencia, síntesis, restricciones, vista y pruebas | **36-56 h** (sin contar la redacción de rúbricas) | Media (código) / Alta (rúbrica) | Sí, con Fase 1 |
| **3 — Análisis acústico** | F0, tono, entonación, volumen, pausas, calibración, criterios y pruebas | **44-67 h** | Alta | Sí, con Fase 4 (distintos archivos base) |
| **4 — Análisis corporal** | postura, gesto, torso, episodios, audiencia, facial, criterios y pruebas | **33-51 h** | Media-alta | Sí, con Fase 3 |
| **5 — Presión y recuperación** | guion, marcas, prompt por turno, tendencia, recuperación, hostilidad, publicación y pruebas | **32-51 h** | Alta | Solo después de 1 y 3 |
| **6 — Calificación y trazabilidad** | niveles, origen/confianza, "no evaluable", cobertura, vistas, trazabilidad, batería y pruebas | **31-47 h** | Media | Sí, en paralelo a 2-5 (publica lo que exista) |

**Totales:**

- **MVP (0 + 1 + 6 + V12/V16 de Fase 2):** aproximadamente **99-158 h** (≈ 12-20 jornadas de 8 h).
- **Plan completo:** aproximadamente **224-352 h** (≈ 28-44 jornadas de 8 h).
- **Recomendación de calendario:** no comprometer fechas de las fases 3 a 5 antes de conocer los resultados de la Fase 0. La incertidumbre del rango superior proviene, sobre todo, de la detección de pitch (R3) y de los umbrales reales (R2).

**Qué depende de validar la implementación actual (y por tanto puede mover estas cifras):** E1-E4 y E9 (§9 de la auditoría). Si los umbrales actuales resultan inadecuados, la Fase 1 puede crecer hasta un 50 % por recalibración de rangos y reanálisis de datos históricos.

---

## 10. ANEXOS

### 10.1 Cómo ejecutar hoy las pruebas existentes (estado actual)

```
cd "Fase 2/Evidencias Proyecto/Evidencias de sistema/backend"
node tests/interview.test.js      # configuración de entrevista, prompt, sensibilidad, presencia, jobs
node tests/metrics.test.js        # métricas administrativas (crea y limpia fixtures)
node tests/metrics-roles.test.js  # alcance por rol
node tests/ui-labels.test.js      # etiquetas de interfaz
```

Notas verificadas: `npm test` **no** está implementado (`package.json`); las pruebas requieren `DATABASE_URL` y `.env.local`; no cubren ninguna fórmula de puntuación del vocero.

### 10.2 Decisiones que debe tomar el equipo antes de la Fase 1

| # | Decisión | Quién | Impacta a |
|---|---|---|---|
| D1 | ¿Cuál es el árbol canónico del sistema? | Equipo técnico | Todo |
| D2 | Qué significa nivel 1/3/5 en cada criterio textual | Vocería + negocio | Fase 2 y 6 |
| D3 | ¿Se acepta que un criterio sin evidencia **no** puntúe (bajando notas)? | Negocio | Fases 2 y 6 |
| D4 | Umbral de cobertura bajo el cual el informe se marca "parcial" | Negocio | Fase 6 |
| D5 | ¿Se mantiene la carrera de 3 modelos o se fija uno principal para reducir varianza? | Técnico | Fases 0 y 2 |
| D6 | ¿Se aprueba el guion con niveles de presión? | Vocería | Fase 5 |
| D7 | ¿Se autoriza la redacción de criterios de "congruencia facial" en términos observables? | Vocería + ética/legal | Fase 4 |
| D8 | ¿Se añade la tabla `SessionVariableScore` o se mantiene todo en JSON? | Técnico | Fase 6 |

### 10.3 Verificación de esta entrega

| Comprobación | Resultado |
|---|---|
| El plan no propone cambiar pesos ni esquema en esta fase | ✔ Todos los cambios de peso quedan como "decisión del equipo" en fases posteriores |
| Cada variable de la auditoría aparece al menos una vez | ✔ §2 (viabilidad), §4 (mapa) y §5 (fases) |
| Cada fase declara dependencias, archivos, datos, pruebas, riesgos, aceptación, dificultad y horas | ✔ §5 y §9 |
| Estimaciones con supuestos y sin falsa precisión | ✔ Rangos amplios y §9.1 explícito |
| Prioridad no basada en facilidad | ✔ §6.1 justifica el orden, incluyendo por qué "tolerancia a la presión" va al final |
| MVP identificado con lo que queda fuera | ✔ §6.2 |
| Sin modificar nada del sistema | ✔ Solo lectura; únicamente se crean documentos nuevos |

### 10.4 Trazabilidad documental

| Documento | Ruta |
|---|---|
| Auditoría comparativa (matriz de 23 variables) | `Fase 2/Evidencias Proyecto/Evidencias de documentación/Auditoría variables/AUDITORIA_COMPARATIVA_VARIABLES_VOXREADY.md` (+ `.docx`) |
| Este plan | `Fase 2/Evidencias Proyecto/Evidencias de documentación/Auditoría variables/PLAN_IMPLEMENTACION_VARIABLES_VOXREADY.md` (+ `.docx`) |
| Auditoría integral de IA (previa, complementaria) | `Fase 2/Evidencias Proyecto/Evidencias de documentación/Auditoría IA/AUDITORIA_INTEGRAL_IA_VOXREADY.md` (+ `.docx`) |
| Especificaciones del sistema | `docs/ESPECIFICACIONES.md` |
| Código auditado | `Fase 2/Evidencias Proyecto/Evidencias de sistema/` (commit `ec2a1788b`) |

---

*Fin del documento. Este plan es una recomendación: no se ha implementado ninguna de las mejoras descritas y no se ha modificado código, configuración, esquema ni datos.*













