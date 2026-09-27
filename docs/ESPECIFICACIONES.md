# VoxReady — Especificaciones, decisiones y trabajo realizado

Documento de referencia del estado actual del proyecto: qué hace, cómo está construido y por qué se tomó cada decisión.

---

## 1. Qué es VoxReady

Plataforma web SaaS **multi-organización** para entrenar voceros en comunicación de crisis:

1. El vocero elige un escenario y lee su contexto, mensajes clave y líneas rojas.
2. Prepara su cámara, micrófono, luz y calibración, y da su consentimiento de grabación.
3. Un **entrevistador IA** le hace preguntas en voz alta y **repregunta según lo que responde**.
4. Mientras habla, se mide **cómo lo dice** (voz y cuerpo) y **qué dice** (transcripción).
5. Una **IA evaluadora** genera un **informe tipo coach** con puntaje por área, fortalezas, mejoras, mensajes clave cubiertos, líneas rojas cruzadas y comentario por pregunta.

Patrocinador: Alloxentric. Equipo: Bastián González, Javiera Mateluna, Benjamín Vásquez.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 3, React Router, framer-motion, react-hot-toast |
| Backend | Node.js, Express 5 |
| Base de datos | PostgreSQL + Prisma 7 (con adaptador `pg`) |
| IA (texto) | API de NVIDIA (build.nvidia.com), compatible con OpenAI |
| Análisis corporal | MediaPipe Pose Landmarker (en el navegador) |
| Transcripción | Web Speech API del navegador (Chrome/Edge) |
| Voz del entrevistador | Síntesis de voz del navegador (`speechSynthesis`), con voces "Natural" en Edge |
| Audio | Web Audio API (volumen, pausas, latencia) |
| Grabación | MediaRecorder (WebM), guardada en `backend/uploads/sessions` |

---

## 3. Roles y jerarquía

| Rol | Clave interna | Qué puede hacer |
|---|---|---|
| **Administrador del sistema** (staff VoxReady) | `SYSTEM` | Ver el estado del sistema; crear organizaciones con su primer admin; crear admins, configuradores y otros admins del sistema; suspender o reactivar cuentas y organizaciones |
| **Configurador maestro** (staff VoxReady) | `MASTER` | Definir los patrones de evaluación, elegir el activo, asignar excepciones por escenario o vocero; revisar evaluaciones (segunda opinión) |
| **Administrador del cliente** | `ADMIN` | Crear y editar escenarios y asignarlos; crear y suspender voceros de su organización; ver prácticas, informes y videos; configurar la retención |
| **Vocero** | `VOCERO` | Practicar escenarios, ver sus informes, su progreso y las microlecciones |

**Decisión:** la jerarquía de creación responde a la duda "¿Quién administra a los clientes?". VoxReady da de alta clientes y staff, y cada cliente gestiona a su propia gente. Además, cada rol solo puede entrar a su sección, y el backend valida los permisos en cada endpoint.

---

## 4. Funcionalidades y dónde están

### Vocero

| Pantalla | Ruta | Descripción |
|---|---|---|
| Inicio | `/vocero` | Estadísticas reales, escenarios asignados (primero los no practicados), lecciones según el área débil, último informe |
| Escenarios | `/vocero/escenarios` | Escenarios asignados o disponibles para todos, con filtro y búsqueda |
| Preparación | `/vocero/preparar` | **Ventana emergente** con el escenario; cámara, micrófono, **iluminación**, calibración y consentimiento (todo obligatorio para empezar) |
| Entrevista | `/vocero/sesion` | Entrevistador IA con voz, transcripción en vivo, medición, grabación; 5 preguntas; manejo de silencios |
| Análisis | `/vocero/analizando` | Envía la entrevista a la IA evaluadora |
| Informe | `/vocero/informe` | Informe completo, grabación, lecciones recomendadas, corrección del experto si existe |
| Mi progreso | `/vocero/progreso` | Gráfico de tendencia por área, historial y recomendaciones |
| Microlecciones | `/vocero/leccion` | 6 lecciones con video de YouTube, claves y ejemplo antes/después |

### Administrador del cliente

| Pantalla | Ruta | Descripción |
|---|---|---|
| Panel | `/admin` | Estadísticas, últimas prácticas y escenarios de la organización |
| Voceros | `/admin/voceros` | Crear voceros (con contraseña inicial y público interno) y suspenderlos |
| Prácticas | `/admin/practicas` | Todas las prácticas de sus voceros, filtrables, con informe y video |
| Escenarios | `/admin/tema` | Crear y editar: datos, **a quién se asigna (todos o voceros específicos)**, mensajes clave, líneas rojas, óptica y público interno |
| Retención | `/admin/retencion` | Guardar video + métricas o solo métricas; plazo en días |

### Configurador maestro

| Pantalla | Ruta | Descripción |
|---|---|---|
| Panel | `/maestro` | Patrón activo, distribución de puntajes, pendientes de revisión, acuerdo IA-humano |
| Rúbrica | `/maestro/rubrica` | Editor de patrones, versiones, excepciones por escenario y por vocero |
| Etiquetado | `/maestro/etiquetado` | Cola priorizada de prácticas reales; el experto corrige puntajes y comenta |

### Administrador del sistema

| Pantalla | Ruta | Descripción |
|---|---|---|
| Resumen | `/sistema` | Estado en vivo de los servicios, métricas globales, sesiones por día, actividad reciente |
| Organizaciones | `/sistema/organizaciones` | Crear organizaciones con su primer admin; suspender o reactivar |
| Usuarios | `/sistema/usuarios` | Todas las cuentas; crear staff y admins; suspender |

### Otros

- **Laboratorio** (`/laboratorio`): pruebas técnicas de la API, la base de datos, MediaPipe y el entrevistador con voz.
- **Login real** con contraseña y perfiles de demostración.

---

## 5. Cómo se evalúa una práctica

### 5.1 Qué se mide

| Área | Fuente | Criterios (configurables) |
|---|---|---|
| **Expresión** | Cámara + MediaPipe | Presencia en cámara, mirada a la cámara, postura (hombros), estabilidad de la cabeza, gestos con las manos |
| **Tono de voz** | Micrófono + transcripción | Palabras por minuto, muletillas por minuto, pausas largas, variación de volumen, tiempo antes de responder |
| **Coherencia** | IA evaluadora | Sostiene los mensajes clave, responde directo, evita líneas rojas, claridad |
| **Empatía** | IA evaluadora + mirada | Reconoce el impacto en las personas, calidez, asume responsabilidad; un % configurable viene de mirar a la cámara |

- Expresión y tono se calculan con **reglas transparentes**: 100 puntos dentro del rango ideal, bajando de forma lineal fuera de él.
- Coherencia y empatía las califica la IA **criterio por criterio**, guiada por las descripciones del patrón.
- Si un área no se pudo medir (sin cámara o micrófono), su peso se reparte entre las demás.

### 5.2 Patrones de evaluación (HU-13, 14, 15 y 18)

Un **patrón** define:
- el peso de cada área en el puntaje global (debe sumar 100 %);
- el peso de cada criterio dentro de su área (de 0 a 5; con 0 el criterio no se evalúa);
- los rangos ideales, por ejemplo 120–165 palabras por minuto o 75 % de mirada a la cámara;
- la exigencia de la IA (flexible, normal o exigente) y las descripciones que la guían.

Cada vez que se guarda, se crea una **versión nueva**. Solo una versión está **activa** y la elige el configurador.

**Prioridad al evaluar:**

1. **Patrón exclusivo del vocero**, por ejemplo un vocero con dificultades del habla al que se le da más peso a lo visual (tomado de las notas de "Dudas y comentarios").
2. **Patrón exclusivo del escenario**, para un escenario de una organización concreta.
3. **Patrón activo.**

Cada informe guarda con qué patrón se evaluó, así que no cambia si después se modifica el patrón.

### 5.3 Segunda opinión (HU-16 y 17)

- La cola de etiquetado prioriza, en este orden:
  1. prácticas con líneas rojas cruzadas,
  2. puntajes límite (entre 45 y 65),
  3. áreas sin medir,
  4. muestreo aleatorio.
- El experto corrige los puntajes y comenta. La corrección aparece en el informe del vocero.
- La métrica **acuerdo IA-humano** es el porcentaje de áreas en que la IA y el experto difieren en 10 puntos o menos.

---

## 6. Inteligencia artificial

| Uso | Modelos (API de NVIDIA) | Estrategia |
|---|---|---|
| **Entrevistador** | DeepSeek v4.1 Flash, Gemma 4 31B, Kimi K3, Nemotron 3 Super | Se consultan **en paralelo**; se usa la primera respuesta válida y se cancelan las demás. Responde en unos 2 segundos |
| **Evaluador** | Kimi K3, Nemotron 3 Super, Gemma 4 31B | En paralelo, con salida JSON obligatoria (`response_format`); tarda entre 10 y 40 segundos |

- El entrevistador conoce el contexto, los mensajes clave y las líneas rojas del escenario. A veces intenta provocar que el vocero cruce una línea roja.
- Se descarta cualquier respuesta que no sea una pregunta en español, porque algunos modelos devuelven su razonamiento en inglés.
- Al arrancar, el backend "precalienta" los modelos, porque en el plan gratuito se "duermen" si nadie los usa.
- La API key vive solo en el backend (`backend/.env.local`) y nunca llega al navegador.

---

## 7. Modelo de datos (tablas nuevas y cambios)

| Tabla | Cambios |
|---|---|
| `Tenant` | `sector`, `status`, `retentionMode`, `retentionDays` |
| `User` | `passwordHash`, `status`, `area`, `createdAt`, `lastLoginAt`; `tenantId` opcional (el staff no pertenece a una organización) |
| `Theme` (de Specols) | `optic`, `publics`, `redLines`, `availableToAllVoceros`, nombre único por organización |
| `Session` | `transcript`, `metrics`, `report`, `score`, `completedAt`, `review` (JSON) |
| `MasterPattern` (HU-13) | `name`, `config` (JSON con criterios, rangos y descripciones) |
| `PatternOverride` *(nueva)* | Patrón exclusivo por escenario |
| `VoceroPatternOverride` *(nueva)* | Patrón exclusivo por vocero |

Migraciones nuevas:
- `usuarios_y_resultados_de_sesion`
- `patrones_configurables_y_revision`
- `patron_por_vocero`

---

## 8. API (endpoints principales)

| Método y ruta | Rol | Uso |
|---|---|---|
| `POST /api/auth/login` · `GET /api/auth/me` | — / cualquiera | Login y sesión |
| `GET/POST /api/tenants` · `PATCH /api/tenants/:id` | Sistema | Organizaciones |
| `GET/POST /api/users` · `PATCH /api/users/:id` | Sistema, Admin | Usuarios (el admin solo gestiona sus voceros) |
| `GET /api/system/overview` | Sistema | Resumen del sistema |
| `GET /api/scenarios/my` | Vocero | Escenarios asignados |
| `POST /api/themes` · `GET/PUT /api/themes/:id` | Admin | Escenarios y asignaciones |
| `GET/PUT /api/tenant/settings` · `GET /api/admin/overview` | Admin | Retención y resumen |
| `POST /api/interviewer/next-question` | — | Siguiente pregunta del entrevistador IA |
| `POST /api/sessions` · `POST /api/sessions/:id/video` | Vocero | Crear sesión y subir grabación (de Specols) |
| `POST /api/sessions/:id/evaluate` | Vocero | Evaluación con IA (idempotente) |
| `GET /api/sessions` · `GET /api/sessions/:id` · `GET /api/sessions/:id/video` | Según rol | Historial, informe y video |
| `GET /api/practices` | Admin, Maestro, Sistema | Prácticas de la organización o de todas |
| `GET /api/review-queue` · `POST /api/sessions/:id/review` | Maestro | Cola y revisión experta |
| `GET/POST /api/patterns` · `POST /api/patterns/:id/activate` | Maestro | Patrones y versiones |
| `PUT/DELETE /api/pattern-overrides/:themeId` · `.../vocero/:userId` | Maestro | Excepciones |
| `GET /api/master/overview` | Maestro | Panel maestro |

---

## 9. Decisiones tomadas y por qué

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| Rediseño completo del frontend con sistema de diseño propio (colores del logo, modo claro/oscuro) | Mantener el wireframe entregado | El prototipo recibido era un wireframe; se buscaba una interfaz de calidad profesional |
| **API de NVIDIA** para la IA | Azure OpenAI (DAS original) o un LLM propio | Gratuita, recomendada por Alloxentric, compatible con OpenAI. Crear un LLM propio no era viable (ver "Dudas y comentarios") |
| **Varios modelos en paralelo** | Un solo modelo (DeepSeek) | En el plan gratuito DeepSeek casi nunca respondía y la disponibilidad cambia minuto a minuto |
| Dos IAs separadas (entrevistador y evaluador) | Una sola IA | El entrevistador debe ser rápido; el evaluador necesita más razonamiento y salida JSON |
| Transcripción con el navegador | Whisper (en `backend/whisper`) | Funciona sin servidor extra ni costo. Whisper queda como alternativa, sobre todo por privacidad |
| MediaPipe en el navegador | Analizar el video en el servidor | Sin costo de servidor, medición en tiempo real, el video no sale del equipo para medirse |
| Puntajes de voz y cuerpo con reglas; contenido con IA | Todo con IA | Las métricas numéricas son objetivas y explicables; la IA aporta juicio sobre el contenido |
| Patrones versionados con excepciones (escenario y vocero) | Una rúbrica única | Lo piden HU-13 a 18 y las notas de "Dudas y comentarios" (peso distinto según escenario o persona) |
| Autenticación propia (scrypt + token firmado HMAC) | Librerías externas (bcrypt, JWT) | Sin dependencias nuevas; suficiente para el MVP |
| Contexto del escenario en **ventana emergente** | Contexto arriba de la preparación | Se probaron ambas opciones y el equipo eligió la ventana emergente |
| Lecciones con videos públicos de YouTube | Producir videos propios | Contenido de calidad inmediato; se usa `youtube-nocookie` por privacidad |
| Retención aplicada por el backend (cada 6 h y al generar el informe) | Solo guardar la preferencia | HU-24, 25 y 26 exigen el borrado automático |
| Claves en `backend/.env.local` (ignorado por git) | Ponerlas en `.env` | `.env` está versionado en el repo; la key habría quedado pública |
| Docker postergado | Configurarlo sin probar | El PC de desarrollo no tiene Docker; se deja para una siguiente etapa |

---

## 10. Historias de usuario cubiertas

| HU | Estado | Dónde |
|---|---|---|
| HU-01 Seleccionar escenario | ✅ | Escenarios |
| HU-02 Consentimiento | ✅ | Preparación |
| HU-03 Comprobar cámara, micrófono e iluminación | ✅ | Preparación (de Specols, integrado al diseño) |
| HU-04 Entrevista con IA | ✅ | Entrevista (voz + pregunta generada por IA) |
| HU-05 Preguntas y repreguntas | ✅ | La IA repregunta según la respuesta; intervención ante silencio |
| HU-06 Informe al finalizar | ✅ | Análisis → Informe |
| HU-07 Evaluación en las 4 áreas | ✅ | Informe |
| HU-08 Observaciones y recomendaciones | ✅ | Informe (fortalezas, mejoras, comentario por pregunta) |
| HU-09 Progreso en el tiempo | ✅ | Mi progreso |
| HU-10 Recomendaciones según debilidades | ✅ | Lecciones sugeridas por área débil |
| HU-11 Repetir escenario | ✅ | Botón "Repetir escenario" en el informe |
| HU-12 Microlecciones | ✅ | 6 lecciones con video |
| HU-13 Patrón maestro | ✅ | Rúbrica (base de Specols, ampliado) |
| HU-14 y 15 Rúbricas y criterios | ✅ | Criterios, pesos y rangos por área |
| HU-16 Revisar baja confianza o puntajes límite | ✅ | Cola de etiquetado priorizada |
| HU-17 Etiquetado experto | ✅ | Corrección y comentario del experto |
| HU-18 Estándar común | ✅ | Patrón activo único, con excepciones controladas |
| HU-19 a 23 Temas, contexto, mensajes, líneas rojas, óptica y público | ✅ | Editor de escenario (base de Specols, ampliado) |
| HU-24 a 26 Retención y borrado automático | ✅ | Retención + borrado de videos en el backend |

---

## 11. Limitaciones conocidas y trabajo pendiente

- **Docker:** pendiente. Hay `Dockerfile` para el frontend y Whisper, pero falta el del backend y un `docker-compose`.
- **Privacidad de la transcripción:** en Chrome y Edge el audio se envía a Google o Microsoft para transcribirlo. Conviene mencionarlo en el consentimiento o migrar a Whisper.
- **IA gratuita:** puede saturarse; el sistema reintenta con varios modelos, pero no es un servicio garantizado.
- **Muletillas:** el reconocimiento del navegador suele omitir "eh" o "mmm", así que el conteo sale algo bajo.
- **Endpoints anteriores sin token:** algunos endpoints de la primera etapa (`/api/sessions`, `/api/themes`, `/api/master-pattern`, `/api/scenarios/my`) identifican al usuario por correo en vez de token. Conviene migrarlos a autenticación.
- **Sin cambio ni recuperación de contraseña**; tampoco hay botón para eliminar escenarios.
- **Calendario de "Mi progreso":** solo muestra un recordatorio local; no se guarda.
- **Repositorio:** `backend/node_modules` está versionado en git, y conviene sacarlo. Además se usan npm y pnpm a la vez (Vercel usa pnpm), así que hay que mantener ambos lockfiles o elegir uno.

---

## 12. Historial de cambios principales

| Commit | Contenido |
|---|---|
| `97ae8df` | Rediseño completo del frontend y sección Laboratorio |
| `ecdfc1f` | Iluminación y sesión adaptadas al nuevo diseño |
| `044f73c` | Rol administrador del sistema y gestión de usuarios (versión solo frontend) |
| `9d38480` | Arreglo del despliegue en Vercel (lockfile de pnpm) |
| `7d8ce6d` | Entrevistador IA con NVIDIA y voz natural |
| *(este push)* | Usuarios y login reales, escenario integral con medición e informe IA, patrones configurables con excepciones, asignación de escenarios, retención real, prácticas del admin, revisión experta, microlecciones con video, documentación |
