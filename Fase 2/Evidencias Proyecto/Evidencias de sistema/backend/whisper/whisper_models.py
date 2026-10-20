"""Registro de modelos de Faster-Whisper del servicio experimental de VoxReady.

Se separa de `server.py` para poder probar la selección y la carga de modelos sin
levantar el servidor y sin descargar modelos (ver `test_server.py`).

Compatibilidad hacia atrás
    `WHISPER_MODEL` sigue eligiendo el modelo POR DEFECTO y `WHISPER_DEVICE` /
    `WHISPER_COMPUTE_TYPE` siguen definiendo el dispositivo y la precisión base.

Variables de entorno
    WHISPER_MODEL=base                    modelo por defecto (compatibilidad)
    WHISPER_MODELS=base,small,medium     modelos disponibles en el servicio
    WHISPER_<CLAVE>_MODEL=small           repositorio o ruta local de ese modelo
    WHISPER_<CLAVE>_DEVICE=cuda           dispositivo solo para ese modelo
    WHISPER_<CLAVE>_COMPUTE_TYPE=float16  precisión solo para ese modelo
    WHISPER_<CLAVE>_LANGUAGE=es           idioma de ese modelo ('' = autodetectar)
    WHISPER_<CLAVE>_BEAM_SIZE=5           búsqueda de ese modelo (más alto = más preciso y más lento)
    WHISPER_<CLAVE>_VAD=true              filtro de silencios de ese modelo
    WHISPER_<CLAVE>_VAD_MIN_SILENCE_MS=500  silencio mínimo para cortar (más alto = menos cortes)
    WHISPER_<CLAVE>_VAD_SPEECH_PAD_MS=600   margen alrededor de la voz (protege inicio y final)
    WHISPER_<CLAVE>_INITIAL_PROMPT=...    contexto inicial ('' = desactivado)
    WHISPER_MODEL_DIR=/ruta               carpeta de modelos
    WHISPER_LOCAL_FILES_ONLY=false        true = no descargar nada de Internet

Nada de esto descarga modelos por sí solo: la descarga ocurre la primera vez que
`WhisperModel(...)` no encuentra el modelo ni en la caché local ni en
WHISPER_MODEL_DIR. Con `WHISPER_LOCAL_FILES_ONLY=true` en su lugar se registra un
error de carga y `/health` lo informa.
"""

from __future__ import annotations

import gc
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

TRUE_VALUES = {"1", "true", "yes", "si", "sí", "on"}


def env_flag(env: Mapping[str, str] | None, name: str, default: bool = False) -> bool:
    """Lee una variable de entorno como booleano (acepta 1/true/yes/sí/on)."""
    source = os.environ if env is None else env
    raw = source.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in TRUE_VALUES


def env_int(env: Mapping[str, str] | None, name: str, default: int) -> int:
    """Lee una variable de entorno como entero (si no es válida, usa el valor por defecto)."""
    source = os.environ if env is None else env
    try:
        return int(str(source.get(name, "")).strip())
    except (TypeError, ValueError):
        return default


def read_env(env: Mapping[str, str] | None, name: str, default: str = "") -> str:
    source = os.environ if env is None else env
    value = source.get(name)
    return default if value is None else str(value).strip()


def read_optional(env: Mapping[str, str] | None, name: str, fallback: Any) -> Any:
    """Valor de `name` si la variable ESTÁ definida (aunque sea vacía); si no, `fallback`."""
    source = os.environ if env is None else env
    if name not in source:
        return fallback
    return str(source[name]).strip()


def read_optional_int(env: Mapping[str, str] | None, name: str, fallback: int | None) -> int | None:
    """Como `read_optional` pero convirtiendo a entero (si no es válido, usa `fallback`)."""
    value = read_optional(env, name, None)
    if value is None:
        return fallback
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


@dataclass(frozen=True)
class InferenceOptions:
    """Opciones de decodificación de UN modelo.

    Permiten afinar un modelo (por ejemplo Whisper Small) sin cambiar el comportamiento de
    los demás (Whisper Base conserva sus valores). `to_dict()` es la vista pública y
    `transcribe_kwargs()` los argumentos que se le pasan a `WhisperModel.transcribe`.
    """

    language: str | None = "es"
    beam_size: int = 1
    vad_filter: bool = True
    # None = no se envía el parámetro y faster-whisper usa su valor por defecto.
    vad_min_silence_ms: int | None = None
    vad_speech_pad_ms: int | None = None
    initial_prompt: str | None = None
    # Marcas temporales POR PALABRA: solo las pide el flujo de evaluación (para medir el
    # tiempo de habla). El laboratorio no las usa, así que allí no cambia nada.
    word_timestamps: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "language": self.language or "auto",
            "beam_size": self.beam_size,
            "vad_filter": self.vad_filter,
            "vad_min_silence_ms": self.vad_min_silence_ms,
            "vad_speech_pad_ms": self.vad_speech_pad_ms,
            "initial_prompt": self.initial_prompt,
            "initial_prompt_chars": len(self.initial_prompt or ""),
            "word_timestamps": self.word_timestamps,
        }

    def transcribe_kwargs(self) -> dict[str, Any]:
        """Argumentos de `model.transcribe(...)` para este modelo."""
        kwargs: dict[str, Any] = {
            "language": self.language,
            "beam_size": self.beam_size,
            "vad_filter": self.vad_filter,
        }
        vad: dict[str, Any] = {}
        if self.vad_min_silence_ms is not None:
            vad["min_silence_duration_ms"] = self.vad_min_silence_ms
        if self.vad_speech_pad_ms is not None:
            vad["speech_pad_ms"] = self.vad_speech_pad_ms
        if vad:
            # Se envía como dict para que faster-whisper complete el resto con los valores
            # por defecto de VadOptions (y siga limitando la duración al chunk_length).
            kwargs["vad_parameters"] = vad
        if self.initial_prompt:
            kwargs["initial_prompt"] = self.initial_prompt
        # Solo se envía cuando se pide: mantiene idéntica la petición del laboratorio.
        if self.word_timestamps:
            kwargs["word_timestamps"] = True
        return kwargs


# Vocabulario habitual de VoxReady. Es corto a propósito: un `initial_prompt` largo
# aumenta el riesgo de que el modelo "repita" el contexto en vez de transcribir lo dicho.
VOXREADY_PROMPT = (
    "Vocero, comunicación de crisis, declaración institucional, mensajes clave, "
    "organización, entrevista y gestión de crisis."
)

# Valores por defecto por modelo:
#  - base : EXACTAMENTE lo que ya usaba el servicio (es, beam 1, VAD sin parámetros extra).
#  - small: es, beam 5 y VAD con más margen (500/600 ms) para no cortar palabras al
#    inicio/final. El contexto inicial (VOXREADY_PROMPT) queda DISPONIBLE pero desactivado:
#    medido en este equipo no aportó ninguna mejora (WER 0 % con y sin contexto en un corpus
#    de 8 audios, limpios y con ruido a 9 dB), cuesta ~16 % más de tiempo y, con el VAD
#    desactivado, produce texto inventado en audio sin voz («¡Suscríbete!» en 3 s de
#    silencio). Para probarlo con grabaciones reales:
#        $env:WHISPER_SMALL_INITIAL_PROMPT = "Vocero, entrevista, gestión de crisis"  # o VOXREADY_PROMPT
BASE_INFERENCE = InferenceOptions(language="es", beam_size=1, vad_filter=True)
SMALL_INFERENCE = InferenceOptions(
    language="es",
    beam_size=5,
    vad_filter=True,
    vad_min_silence_ms=500,
    vad_speech_pad_ms=600,
    initial_prompt=None,
)
#  - medium: misma decodificación que Small (español, beam 5, VAD con margen), pero el
#    modelo es ~3 veces más grande: en CPU int8 ronda 1,5 GB de RAM y tarda bastante más
#    por minuto de audio. Se carga solo cuando se pide (carga perezosa), así que no ocupa
#    memoria salvo que el laboratorio lo use.
MEDIUM_INFERENCE = InferenceOptions(
    language="es",
    beam_size=5,
    vad_filter=True,
    vad_min_silence_ms=500,
    vad_speech_pad_ms=600,
    initial_prompt=None,
)
MODEL_INFERENCE_DEFAULTS: dict[str, InferenceOptions] = {
    "base": BASE_INFERENCE,
    "small": SMALL_INFERENCE,
    "medium": MEDIUM_INFERENCE,
}
DEFAULT_INFERENCE = BASE_INFERENCE  # cualquier otro modelo hereda la configuración base


@dataclass(frozen=True)
class ModelSpec:
    """Un modelo concreto con su dispositivo, precisión y decodificación."""

    key: str  # clave pública ('base', 'small') que usa /transcribe?model=
    name: str  # repositorio de HuggingFace o ruta local
    device: str
    compute_type: str
    inference: InferenceOptions = field(default_factory=lambda: DEFAULT_INFERENCE)


@dataclass
class ModelState:
    """Estado en memoria de un modelo (se carga como máximo una vez por proceso)."""

    spec: ModelSpec
    model: Any = None
    loaded: bool = False
    loading: bool = False
    error: str | None = None
    loaded_at: float | None = None
    load_ms: float | None = None
    requests: int = 0
    loads: int = 0

    def public(self) -> dict[str, Any]:
        """Vista apta para /health: no incluye el objeto del modelo ni rutas."""
        return {
            "key": self.spec.key,
            "model": self.spec.name,
            "device": self.spec.device,
            "compute_type": self.spec.compute_type,
            "loaded": self.loaded,
            "loading": self.loading,
            "load_ms": self.load_ms,
            "loaded_at": self.loaded_at,
            "load_error": self.error,
            "requests": self.requests,
            # Decodificación efectiva de este modelo (idioma, beam, VAD, contexto inicial).
            "inference": self.spec.inference.to_dict(),
        }


class ModelUnavailable(Exception):
    """El modelo pedido no existe (`unknown`) o no se pudo cargar (`load_failed`)."""

    def __init__(self, kind: str, key: str, error_type: str | None = None):
        self.kind = kind
        self.key = key
        self.error_type = error_type
        super().__init__(f"{kind}:{key}:{error_type or ''}")


def parse_model_keys(raw: str | None, default_key: str) -> list[str]:
    """Claves de modelo sin repetir y conservando el orden; el por defecto va primero."""
    keys: list[str] = []
    for chunk in str(raw or "").split(","):
        key = chunk.strip().lower()
        if key and key not in keys:
            keys.append(key)
    fallback = (default_key or "base").strip().lower()
    if fallback not in keys:
        keys.insert(0, fallback)
    return keys


def inference_from_env(
    env: Mapping[str, str] | None,
    key: str,
    defaults: InferenceOptions,
) -> InferenceOptions:
    """Opciones de decodificación de un modelo: por modelo → global → valor por defecto.

    `WHISPER_BEAM_SIZE` (global) sigue funcionando y `WHISPER_SMALL_BEAM_SIZE` permite
    afinar solo Whisper Small. Una variable definida pero vacía desactiva ese valor
    (por ejemplo `WHISPER_SMALL_INITIAL_PROMPT=` quita el contexto inicial).
    """
    prefix = f"WHISPER_{key.upper()}_"
    language = read_optional(
        env,
        f"{prefix}LANGUAGE",
        read_optional(env, "WHISPER_LANGUAGE", defaults.language or ""),
    )
    return InferenceOptions(
        language=language or None,
        beam_size=env_int(env, f"{prefix}BEAM_SIZE", env_int(env, "WHISPER_BEAM_SIZE", defaults.beam_size)),
        vad_filter=env_flag(env, f"{prefix}VAD", env_flag(env, "WHISPER_VAD", defaults.vad_filter)),
        vad_min_silence_ms=read_optional_int(env, f"{prefix}VAD_MIN_SILENCE_MS", defaults.vad_min_silence_ms),
        vad_speech_pad_ms=read_optional_int(env, f"{prefix}VAD_SPEECH_PAD_MS", defaults.vad_speech_pad_ms),
        initial_prompt=read_optional(
            env,
            f"{prefix}INITIAL_PROMPT",
            read_optional(env, "WHISPER_INITIAL_PROMPT", defaults.initial_prompt or ""),
        )
        or None,
    )


def specs_from_env(env: Mapping[str, str] | None = None) -> tuple[str, list[ModelSpec]]:
    """(clave por defecto, modelos disponibles) a partir del entorno."""
    default_key = (read_env(env, "WHISPER_MODEL", "base") or "base").lower()
    keys = parse_model_keys(read_env(env, "WHISPER_MODELS", f"{default_key},small,medium"), default_key)
    base_device = read_env(env, "WHISPER_DEVICE", "cpu") or "cpu"
    base_compute = read_env(env, "WHISPER_COMPUTE_TYPE", "int8") or "int8"

    specs: list[ModelSpec] = []
    for key in keys:
        prefix = f"WHISPER_{key.upper()}_"
        specs.append(
            ModelSpec(
                key=key,
                name=read_env(env, f"{prefix}MODEL", key) or key,
                device=read_env(env, f"{prefix}DEVICE", base_device) or base_device,
                compute_type=read_env(env, f"{prefix}COMPUTE_TYPE", base_compute) or base_compute,
                inference=inference_from_env(
                    env,
                    key,
                    MODEL_INFERENCE_DEFAULTS.get(key, DEFAULT_INFERENCE),
                ),
            )
        )
    return default_key, specs


def default_loader(spec: ModelSpec, model_dir: str | None, local_files_only: bool) -> Any:
    """Carga real con faster-whisper (import diferido: /health responde aunque falte)."""
    from faster_whisper import WhisperModel

    kwargs: dict[str, Any] = {
        "device": spec.device,
        "compute_type": spec.compute_type,
        "local_files_only": local_files_only,
    }
    if model_dir:
        kwargs["download_root"] = model_dir
    return WhisperModel(spec.name, **kwargs)


class ModelRegistry:
    """Mantiene los modelos configurados y los carga bajo demanda, uno a la vez.

    - Un modelo se carga UNA vez y se reutiliza: no se recarga por petición.
    - La carga está serializada con un `threading.Lock`, así que dos peticiones
      simultáneas del mismo modelo no lo cargan dos veces.
    - Con `single_in_memory=True` se libera el modelo anterior antes de cargar otro:
      nunca hay dos modelos en la GPU al mismo tiempo (16 GB de RAM / GTX 1050 Ti).
    """

    def __init__(
        self,
        specs: list[ModelSpec],
        default_key: str,
        *,
        loader: Callable[[ModelSpec, str | None, bool], Any] = default_loader,
        model_dir: str | None = None,
        local_files_only: bool = False,
        single_in_memory: bool = False,
        preload_all: bool = False,
    ):
        if not specs:
            raise ValueError("Debe haber al menos un modelo configurado.")
        self.states: dict[str, ModelState] = {spec.key: ModelState(spec=spec) for spec in specs}
        self.default_key = default_key if default_key in self.states else next(iter(self.states))
        self.loader = loader
        self.model_dir = model_dir
        self.local_files_only = local_files_only
        self.single_in_memory = single_in_memory
        self.preload_all = preload_all
        self._lock = threading.RLock()

    # ------------------------------------------------------------ consultas

    def keys(self) -> list[str]:
        return list(self.states)

    def state(self, key: str) -> ModelState | None:
        return self.states.get(key)

    def public(self) -> dict[str, Any]:
        return {key: state.public() for key, state in self.states.items()}

    def resolve_key(self, key: str | None) -> str:
        """Clave solicitada (o la por defecto si no se indica). Lanza si no existe."""
        wanted = str(key or "").strip().lower()
        if not wanted:
            return self.default_key
        if wanted not in self.states:
            raise ModelUnavailable("unknown", wanted)
        return wanted

    def summary(self) -> dict[str, Any]:
        """Estado global + por modelo, conservando los campos que ya usa el frontend."""
        default = self.states[self.default_key]
        if not default.loaded:
            status = "unavailable"
        elif any(state.error for state in self.states.values()):
            status = "partial"
        else:
            status = "ok"
        return {
            "status": status,
            "model_loaded": default.loaded,  # compatibilidad: modelo por defecto
            "load_ms": default.load_ms,
            "loaded_at": default.loaded_at,
            "load_error": default.error,
            "default_model": self.default_key,
            "models": self.public(),
        }

    # ------------------------------------------------------------ carga

    def _release(self, state: ModelState) -> None:
        state.model = None
        state.loaded = False
        state.loaded_at = None
        state.load_ms = None
        gc.collect()

    def load(self, key: str) -> Any:
        """Devuelve el modelo cargado, cargándolo si hace falta. Lanza ModelUnavailable."""
        state = self.states.get(key)
        if state is None:
            raise ModelUnavailable("unknown", key)

        with self._lock:
            if state.loaded and state.model is not None:
                return state.model

            if self.single_in_memory:
                for other_key, other in self.states.items():
                    if other_key != key and other.model is not None:
                        self._release(other)

            state.loading = True
            started = time.perf_counter()
            try:
                model = self.loader(state.spec, self.model_dir, self.local_files_only)
            except Exception as exc:  # noqa: BLE001 - se reporta solo el TIPO
                state.loading = False
                state.model = None
                state.loaded = False
                state.error = type(exc).__name__
                raise ModelUnavailable("load_failed", key, type(exc).__name__) from exc

            state.model = model
            state.loaded = True
            state.error = None
            state.loading = False
            state.loaded_at = time.time()
            state.load_ms = round((time.perf_counter() - started) * 1000, 1)
            state.loads += 1
            return model

    def preload(self) -> list[str]:
        """Carga al arranque (nunca lanza: cada fallo queda en el estado del modelo)."""
        targets = self.keys() if self.preload_all else [self.default_key]
        for key in targets:
            try:
                self.load(key)
            except ModelUnavailable as exc:
                print(
                    f"[whisper] No se pudo cargar el modelo '{exc.key}': "
                    f"{exc.error_type or 'error de carga'}"
                )
        return targets

    def unload_all(self) -> None:
        with self._lock:
            for state in self.states.values():
                if state.model is not None:
                    self._release(state)

