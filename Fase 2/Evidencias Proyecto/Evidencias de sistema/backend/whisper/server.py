"""Servicio experimental de transcripción con Faster-Whisper (VoxReady).

Es un servicio INDEPENDIENTE del backend Node: se levanta aparte y el backend lo
consulta a través de `POST /api/lab/transcribe` (ver `backend/routes/lab.js`).

Endpoints
    GET  /health                 -> estado del servicio y de CADA modelo
    POST /transcribe?model=base  -> transcripción de un audio (modelo opcional)

Modelos (el laboratorio usa uno u otro sobre el MISMO audio):
    base   -> Whisper Base   (rápido; comportamiento original del laboratorio)
    small  -> Whisper Small  (más preciso que Base; decodificación optimizada)
    medium -> Whisper Medium (el más preciso de los tres; el más lento y pesado en CPU)
La lista se configura con WHISPER_MODELS y el modelo por defecto con WHISPER_MODEL.
Todos se ejecutan LOCALMENTE: el audio no sale del equipo. Los modelos distintos del
predeterminado se cargan de forma perezosa (solo al usarlos), así que no ocupan memoria
por el simple hecho de estar disponibles.

Configuración por variables de entorno (todas opcionales):
    WHISPER_MODEL=base            modelo por defecto (compatibilidad)
    WHISPER_MODELS=base,small     modelos disponibles en el servicio
    WHISPER_DEVICE=cpu            cpu | cuda
    WHISPER_COMPUTE_TYPE=int8     int8 | int8_float16 | float16 | float32
    WHISPER_SMALL_DEVICE=cuda     dispositivo/precisión de UN modelo concreto
    WHISPER_SMALL_COMPUTE_TYPE=float16    (y así con cada clave)
    WHISPER_PRELOAD_ALL=false     true = cargar todos al arrancar (descarga una sola vez)
    WHISPER_SINGLE_MODEL_IN_MEMORY=false  true = liberar el anterior antes de cargar otro
    WHISPER_MAX_CONCURRENCY=1     transcripciones simultáneas (1 = en serie)
    WHISPER_LANGUAGE=es           idioma forzado ('' = autodetección)
    WHISPER_BEAM_SIZE=1           1 = más rápido; 5 = algo más preciso
    WHISPER_VAD=true              filtro de actividad de voz
    WHISPER_MODEL_DIR=            carpeta de modelos (por defecto, caché de HuggingFace)
    WHISPER_LOCAL_FILES_ONLY=false  true = no descargar (modo sin Internet)
    WHISPER_HOST=127.0.0.1        interfaz de escucha (0.0.0.0 dentro de Docker)
    WHISPER_PORT=8001
    WHISPER_MAX_MB=25             tamaño máximo del archivo subido
    WHISPER_MAX_AUDIO_SECONDS=600 duración máxima aceptada

El servicio NO necesita red para transcribir, pero la primera vez que se usa un
modelo se descarga de HuggingFace (Small ~460 MB). Si ya está en la caché local (o en
WHISPER_MODEL_DIR) se puede usar WHISPER_LOCAL_FILES_ONLY=true; en ese caso, si falta,
/health informa el error y /transcribe responde 503.

Arranque (con las dependencias de requirements.txt instaladas):
    python -m uvicorn server:app --host 127.0.0.1 --port 8001   (desde backend/whisper)
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import replace
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse

from whisper_models import (
    InferenceOptions,
    ModelRegistry,
    ModelUnavailable,
    env_flag,
    env_int,
    specs_from_env,
)

# ---------------------------------------------------------------- Configuración

# Archivo .env opcional junto a este script (ver .env.example). Se ignora sin ruido si
# no existe o si `python-dotenv` no está instalado: el servicio funciona igual con las
# variables de entorno del sistema.
try:
    from pathlib import Path

    from dotenv import load_dotenv

    load_dotenv(Path(__file__).with_name(".env"))
except Exception:  # noqa: BLE001 - es una comodidad, no un requisito
    pass


LANGUAGE = os.getenv("WHISPER_LANGUAGE", "es") or None
BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "1"))
USE_VAD = env_flag(None, "WHISPER_VAD", True)
MODEL_DIR = os.getenv("WHISPER_MODEL_DIR") or None
LOCAL_FILES_ONLY = env_flag(None, "WHISPER_LOCAL_FILES_ONLY", False)
MAX_MB = float(os.getenv("WHISPER_MAX_MB", "25"))
MAX_AUDIO_SECONDS = float(os.getenv("WHISPER_MAX_AUDIO_SECONDS", "600"))
# Transcripciones simultáneas (1 = en serie): con 1 no se compite por el mismo modelo
# ni se satura la CPU/GPU. Súbelo solo si sabes que la máquina lo soporta.
MAX_CONCURRENCY = max(1, env_int(None, "WHISPER_MAX_CONCURRENCY", 1))

# Extensiones aceptadas (el contenido real lo valida el decodificador)
ALLOWED_SUFFIXES = {".webm", ".wav", ".mp3", ".m4a", ".ogg", ".oga", ".opus", ".flac", ".mp4", ".aac"}

# Modelos del servicio. WHISPER_MODEL sigue eligiendo el modelo por defecto (el que se
# usa cuando la petición no indica ?model=), así que el laboratorio actual no cambia.
DEFAULT_MODEL_KEY, MODEL_SPECS = specs_from_env()

REGISTRY = ModelRegistry(
    MODEL_SPECS,
    DEFAULT_MODEL_KEY,
    model_dir=MODEL_DIR,
    local_files_only=LOCAL_FILES_ONLY,
    single_in_memory=env_flag(None, "WHISPER_SINGLE_MODEL_IN_MEMORY", False),
    preload_all=env_flag(None, "WHISPER_PRELOAD_ALL", False),
)

# Huecos de inferencia: se adquieren DENTRO del hilo de trabajo, así no bloquean el
# bucle de eventos y, aun así, las transcripciones se atienden en serie.
TRANSCRIBE_SLOTS = threading.Semaphore(MAX_CONCURRENCY)


def _serialize_words(segment: Any) -> list[dict[str, Any]]:
    """Marcas temporales por palabra (solo cuando se piden).

    Se descartan las que no son medibles (tiempo no numérico, invertido o texto vacío):
    el consumidor no debe recibir basura que luego haya que sanear otra vez.
    """
    words: list[dict[str, Any]] = []
    for word in getattr(segment, "words", None) or []:
        try:
            start = round(float(word.start), 3)
            end = round(float(word.end), 3)
        except (TypeError, ValueError):
            continue
        text = (getattr(word, "word", "") or "").strip()
        if not text or start < 0 or end <= start:
            continue
        words.append({"start": start, "end": end, "word": text})
    return words


def _run_transcription(
    model: Any,
    tmp_path: str,
    options: InferenceOptions,
) -> tuple[list[dict[str, Any]], Any]:
    """Inferencia (bloqueante) que se ejecuta en un hilo aparte.

    Faster-Whisper devuelve un generador: el cómputo real ocurre al recorrerlo, por eso
    todo esto va dentro del hilo (no solo la llamada a `transcribe`).
    Las opciones de decodificación son las del MODELO elegido (idioma, beam_size, VAD y
    contexto inicial propios), así se puede afinar Small sin cambiar Base.
    """
    with TRANSCRIBE_SLOTS:
        segments_iter, info = model.transcribe(tmp_path, **options.transcribe_kwargs())
        segments: list[dict[str, Any]] = []
        for segment in segments_iter:
            item = {
                "id": getattr(segment, "id", None),
                "start": round(float(getattr(segment, "start", 0.0)), 2),
                "end": round(float(getattr(segment, "end", 0.0)), 2),
                "text": (getattr(segment, "text", "") or "").strip(),
            }
            # El laboratorio NO pide palabras: su respuesta sigue siendo idéntica.
            if options.word_timestamps:
                item["words"] = _serialize_words(segment)
            segments.append(item)
    return segments, info


@asynccontextmanager
async def lifespan(_: FastAPI):
    # El modelo por defecto se carga al arrancar (no en cada petición). Si falla, el
    # servicio sigue en pie y /health explica el motivo: así el laboratorio puede
    # informarlo. Con WHISPER_PRELOAD_ALL=true se cargan TODOS al arrancar (así la
    # descarga de 'small' ocurre una sola vez y fuera de una petición).
    await asyncio.to_thread(REGISTRY.preload)
    yield
    REGISTRY.unload_all()


app = FastAPI(title="VoxReady - Whisper experimental", version="0.2.0", lifespan=lifespan)


def _config_snapshot(key: str | None = None) -> dict[str, Any]:
    """Configuración efectiva del modelo indicado (por defecto, el del servicio)."""
    wanted = str(key or "").strip().lower() or REGISTRY.default_key
    state = REGISTRY.state(wanted) or REGISTRY.state(REGISTRY.default_key)
    spec = state.spec if state else None
    # Valores EFECTIVOS del modelo (por modelo → global). Se conservan las claves que ya
    # usaba el frontend (`language`, `beam_size`, `vad_filter`) y se añaden las nuevas.
    inference = (
        spec.inference
        if spec
        else InferenceOptions(language=LANGUAGE, beam_size=BEAM_SIZE, vad_filter=USE_VAD)
    )
    options = inference.to_dict()
    return {
        "model_key": spec.key if spec else None,
        "model": spec.name if spec else None,
        "device": spec.device if spec else None,
        "compute_type": spec.compute_type if spec else None,
        "language": options["language"],
        "beam_size": options["beam_size"],
        "vad_filter": options["vad_filter"],
        "vad_min_silence_ms": options["vad_min_silence_ms"],
        "vad_speech_pad_ms": options["vad_speech_pad_ms"],
        "initial_prompt_chars": options["initial_prompt_chars"],
        # Capacidad del servicio: las marcas por palabra se solicitan por petición con
        # ?word_timestamps=true. `word_timestamps` refleja si el modelo las trae por defecto.
        "word_timestamps_supported": True,
        "word_timestamps": options["word_timestamps"],
        "model_dir": MODEL_DIR,
        "local_files_only": LOCAL_FILES_ONLY,
        "max_mb": MAX_MB,
        "max_audio_seconds": MAX_AUDIO_SECONDS,
        "max_concurrency": MAX_CONCURRENCY,
        "default_model": REGISTRY.default_key,
        "models": REGISTRY.keys(),
        "single_model_in_memory": REGISTRY.single_in_memory,
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    """Estado del servicio.

    Se conservan los campos de siempre (`status`, `model_loaded`, `load_ms`,
    `loaded_at`, `load_error`, `config`) referidos al modelo POR DEFECTO y se añaden
    `default_model` y `models`, con el estado de cada modelo.
    `models[clave].loaded=false` significa que ese modelo aún no puede transcribir.
    """
    return {**REGISTRY.summary(), "config": _config_snapshot()}

@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model: str | None = Query(default=None, description="Clave del modelo; por defecto, el configurado"),
    word_timestamps: bool = Query(
        default=False,
        description="Incluye marcas temporales por palabra (lo usa la evaluación de WPM)",
    ),
) -> JSONResponse:
    """Transcribe un audio y devuelve texto, segmentos y tiempos.

    `?model=` es opcional: sin él se usa el modelo por defecto (compatibilidad con el
    laboratorio de Whisper Base). `?word_timestamps=true` añade `words` a cada segmento;
    sin ese parámetro la respuesta es exactamente la de siempre.
    """
    try:
        model_key = REGISTRY.resolve_key(model)
    except ModelUnavailable as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Modelo no disponible en el servicio: '{exc.key}'. "
                f"Usa uno de: {', '.join(REGISTRY.keys())}."
            ),
        ) from exc

    # Carga perezosa: si ese modelo aún no está cargado (p. ej. 'small' la primera vez)
    # se carga AQUÍ, en un hilo aparte, y se mide por separado del tiempo de inferencia.
    state = REGISTRY.state(model_key)
    # Opciones de decodificación de ESE modelo (cada uno tiene las suyas: Base conserva
    # las de siempre y Small usa las ajustadas para precisión en español).
    options = (
        state.spec.inference
        if state
        else InferenceOptions(language=LANGUAGE, beam_size=BEAM_SIZE, vad_filter=USE_VAD)
    )
    # Las palabras se piden por petición: el resto del comportamiento del modelo no cambia.
    if word_timestamps and not options.word_timestamps:
        options = replace(options, word_timestamps=True)
    already_loaded = bool(state and state.loaded)
    load_started = time.perf_counter()
    try:
        model_instance = await asyncio.to_thread(REGISTRY.load, model_key)
    except ModelUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                f"El modelo '{exc.key}' no está disponible en el servicio de transcripción"
                f" ({exc.error_type or 'error de carga'}). Revisa /health y la consola del servicio."
            ),
        ) from exc
    model_load_ms = 0.0 if already_loaded else round((time.perf_counter() - load_started) * 1000, 1)

    name = (file.filename or "audio").strip()
    suffix = os.path.splitext(name)[1].lower()
    if suffix and suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail=f"Formato no admitido: {suffix}")

    limit_bytes = int(MAX_MB * 1024 * 1024)
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    if len(payload) > limit_bytes:
        raise HTTPException(status_code=413, detail=f"El archivo supera el límite de {MAX_MB} MB.")

    tmp_path = None
    # `started` se toma DESPUÉS de la carga del modelo: `elapsed_ms` es solo inferencia.
    started = time.perf_counter()
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix or ".webm") as tmp:
            tmp.write(payload)
            tmp_path = tmp.name

        try:
            segments, info = await asyncio.to_thread(_run_transcription, model_instance, tmp_path, options)
        except Exception as exc:  # noqa: BLE001 - se clasifica antes de responder
            error_type = type(exc).__name__
            print(f"[whisper] Fallo al transcribir ({model_key}): {error_type}: {exc}")

            # Un fallo del decodificador (PyAV/ffmpeg) apunta al audio. Cualquier otra
            # excepción es un fallo INTERNO del servicio y no debe presentarse como
            # "audio ilegible": así se diagnosticó mal la incompatibilidad PyAV 19 /
            # faster-whisper 1.2.1 (TypeError por `metadata_errors`, issue #1589).
            try:
                from av.error import FFmpegError  # import diferido, igual que faster_whisper

                decode_error = isinstance(exc, (FFmpegError, ValueError, RuntimeError))
            except Exception:  # noqa: BLE001 - sin PyAV no puede haber errores de PyAV
                decode_error = isinstance(exc, (ValueError, RuntimeError))

            if decode_error:
                raise HTTPException(
                    status_code=422,
                    detail=f"No se pudo decodificar el audio (¿formato no soportado o archivo dañado?). [{error_type}]",
                ) from exc
            raise HTTPException(
                status_code=500,
                detail=f"Error interno del servicio de transcripción al procesar el audio. [{error_type}]",
            ) from exc

        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        duration = float(getattr(info, "duration", 0.0) or 0.0)
        if duration <= 0:
            duration = segments[-1]["end"] if segments else 0.0
        if duration > MAX_AUDIO_SECONDS:
            raise HTTPException(
                status_code=413,
                detail=f"El audio dura más de {MAX_AUDIO_SECONDS} s; acórtalo para la prueba.",
            )

        text = " ".join(s["text"] for s in segments).strip()
        if state:
            state.requests += 1
        return JSONResponse(
            {
                "status": "ok",
                "text": text,
                "segments": segments,
                "model_key": model_key,
                "model": state.spec.name if state else None,
                "language": getattr(info, "language", LANGUAGE or "auto"),
                "language_probability": round(float(getattr(info, "language_probability", 0.0) or 0.0), 3),
                "duration_seconds": round(duration, 3),
                # Cuánta duración conservó el filtro de voz: si es muy inferior a
                # `duration_seconds`, el VAD recortó audio (por eso se ajusta con margen).
                "duration_after_vad": round(float(getattr(info, "duration_after_vad", 0.0) or 0.0), 3),
                # RTF = tiempo de proceso / duración del audio (< 1 = más rápido que tiempo real)
                "rtf": round(elapsed_ms / 1000 / duration, 3) if duration > 0 else None,
                # `elapsed_ms` es SOLO inferencia; la carga del modelo se informa aparte:
                # así no se confunde el arranque del modelo con el tiempo de transcripción.
                "elapsed_ms": elapsed_ms,
                "model_load_ms": model_load_ms,
                "total_ms": round(model_load_ms + elapsed_ms, 1),
                "audio_bytes": len(payload),
                "config": {**_config_snapshot(model_key), "word_timestamps": options.word_timestamps},
            }
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("WHISPER_HOST", "127.0.0.1"),
        port=int(os.getenv("WHISPER_PORT", "8001")),
    )