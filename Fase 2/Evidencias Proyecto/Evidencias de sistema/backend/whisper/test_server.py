"""Pruebas del servicio de transcripción (sin red y sin descargar modelos).

Se ejecutan con el runner incluido en Python:
    cd backend/whisper
    python -m unittest test_server -v

El cargador de modelos se sustituye por uno falso, así que estas pruebas no necesitan
descargar nada ni tener el modelo en la caché: comprueban la selección de modelo, la
carga perezosa, la caché (no recargar por petición), la liberación en memoria, los
códigos de error HTTP, los tiempos separados (carga vs inferencia) y la serialización
de peticiones simultáneas.
"""

from __future__ import annotations

import asyncio
import io
import json
import threading
import time
import unittest
from unittest import mock

from starlette.datastructures import UploadFile

import server
from whisper_models import ModelRegistry, ModelUnavailable, specs_from_env

try:  # PyAV es dependencia de faster-whisper, pero estas pruebas no deben exigirla
    from av.error import InvalidDataError
    from av.error import errno as av_errno
except Exception:  # noqa: BLE001
    InvalidDataError = None  # type: ignore[assignment]
    av_errno = None  # type: ignore[assignment]

WEBM = b"\x1aE\xdf\xa3" + b"0" * 64


class _Word:
    def __init__(self, word="hola", start=0.0, end=0.2):
        self.word = word
        self.start = start
        self.end = end


class _Segment:
    def __init__(self, text="hola mundo", start=0.0, end=1.0, words=None):
        self.id = 0
        self.text = text
        self.start = start
        self.end = end
        # faster-whisper solo rellena `words` si se pide word_timestamps=True
        self.words = words if words is not None else [_Word("hola", 0.0, 0.2), _Word("mundo", 0.3, 0.5)]


class _Info:
    def __init__(self, duration=1.0):
        self.duration = duration
        self.language = "es"
        self.language_probability = 0.99
        self.duration_after_vad = duration * 0.9


class _FakeModel:
    """Modelo de mentira: no descarga ni decodifica nada."""

    def __init__(self, key, *, raises=None, text="hola mundo"):
        self.key = key
        self.raises = raises
        self.text = text
        self.calls = 0
        self.kwargs_history: list[dict] = []

    def transcribe(self, path, **kwargs):
        self.calls += 1
        self.kwargs_history.append(kwargs)
        if self.raises is not None:
            raise self.raises
        return iter([_Segment(self.text)]), _Info()


class _FakeLoader:
    """Cargador que registra los modelos cargados y puede fallar a propósito."""

    def __init__(self, *, fail_keys=(), raises=None):
        self.fail_keys = set(fail_keys)
        self.raises = raises
        self.loaded: list[str] = []
        self.models: dict[str, _FakeModel] = {}

    def __call__(self, spec, model_dir, local_files_only):
        if spec.key in self.fail_keys:
            raise RuntimeError("modelo no disponible")
        self.loaded.append(spec.key)
        self.models[spec.key] = _FakeModel(spec.key, raises=self.raises)
        return self.models[spec.key]


def _registry(loader, **kwargs):
    """Registro con dos modelos (base por defecto, small adicional), como el servicio."""
    default, specs = specs_from_env({"WHISPER_MODEL": "base", "WHISPER_MODELS": "base,small"})
    return ModelRegistry(specs, default, loader=loader, **kwargs)


def _upload(payload=WEBM, filename="lab-audio.webm"):
    return UploadFile(io.BytesIO(payload), filename=filename)


class ServicioWhisperTest(unittest.TestCase):
    def setUp(self):
        self.loader = _FakeLoader()
        self.registry = _registry(self.loader)
        self._previous = server.REGISTRY
        server.REGISTRY = self.registry

    def tearDown(self):
        server.REGISTRY = self._previous

    def _transcribe(self, *, model=None, payload=WEBM, filename="lab-audio.webm", word_timestamps=False):
        # `model=None` y `word_timestamps=False` explícitos: al llamar a la función
        # directamente, sus valores por defecto son objetos Query(...) de FastAPI.
        return asyncio.run(
            server.transcribe(
                file=_upload(payload, filename),
                model=model,
                word_timestamps=word_timestamps,
            )
        )

    # ---------------------------------------------------------------- /health

    def test_health_conserva_los_campos_anteriores_y_reporta_cada_modelo(self):
        self.registry.load("base")
        data = asyncio.run(server.health())
        for field in ("status", "model_loaded", "load_ms", "loaded_at", "load_error", "config"):
            self.assertIn(field, data)
        self.assertTrue(data["model_loaded"])
        self.assertEqual(data["default_model"], "base")
        self.assertEqual(set(data["models"]), {"base", "small"})
        self.assertTrue(data["models"]["base"]["loaded"])
        self.assertFalse(data["models"]["small"]["loaded"])
        self.assertEqual(data["config"]["model"], "base")

    def test_health_sin_modelo_cargado_es_unavailable(self):
        data = asyncio.run(server.health())
        self.assertEqual(data["status"], "unavailable")
        self.assertFalse(data["model_loaded"])

    def test_health_reporta_el_tipo_de_error_de_carga_sin_exponer_el_mensaje(self):
        registry = _registry(_FakeLoader(fail_keys={"small"}))
        registry.load("base")
        with self.assertRaises(ModelUnavailable):
            registry.load("small")
        server.REGISTRY = registry
        data = asyncio.run(server.health())
        self.assertEqual(data["status"], "partial")
        self.assertEqual(data["models"]["small"]["load_error"], "RuntimeError")
        self.assertNotIn("modelo no disponible", json.dumps(data))

    # ---------------------------------------------------------------- /transcribe

    def test_sin_modelo_usa_el_por_defecto_whisper_base(self):
        data = json.loads(self._transcribe().body)
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["model_key"], "base")
        self.assertEqual(data["model"], "base")
        self.assertEqual(self.loader.loaded, ["base"])

    def test_la_respuesta_conserva_los_campos_que_ya_usaba_el_frontend(self):
        data = json.loads(self._transcribe().body)
        for field in (
            "status",
            "text",
            "segments",
            "language",
            "language_probability",
            "duration_seconds",
            "rtf",
            "elapsed_ms",
            "audio_bytes",
            "config",
        ):
            self.assertIn(field, data)
        self.assertEqual(data["config"]["language"], "es")
        self.assertEqual(data["config"]["beam_size"], server.BEAM_SIZE)

    def test_sin_word_timestamps_los_segmentos_no_incluyen_palabras(self):
        data = json.loads(self._transcribe().body)
        self.assertNotIn("words", data["segments"][0])
        self.assertFalse(data["config"]["word_timestamps"])

    def test_word_timestamps_anade_palabras_y_no_cambia_el_resto(self):
        data = json.loads(self._transcribe(model="small", word_timestamps=True).body)
        self.assertTrue(data["config"]["word_timestamps"])
        segment = data["segments"][0]
        # Los campos de siempre siguen ahí, con el mismo significado
        self.assertEqual(segment["text"], "hola mundo")
        self.assertEqual(segment["start"], 0.0)
        self.assertEqual(segment["end"], 1.0)
        self.assertEqual([w["word"] for w in segment["words"]], ["hola", "mundo"])
        self.assertEqual(segment["words"][0], {"start": 0.0, "end": 0.2, "word": "hola"})

    def test_word_timestamps_descarta_marcas_invalidas(self):
        class _Broken:
            word = "mal"
            start = "x"
            end = 1.0

        class _Inverted:
            word = "invertida"
            start = 2.0
            end = 1.0

        model = self.registry.load("small")
        model.transcribe = lambda path, **kwargs: (
            iter([_Segment(words=[_Broken(), _Inverted(), _Word("bien", 0.1, 0.4)])]),
            _Info(),
        )
        data = json.loads(self._transcribe(model="small", word_timestamps=True).body)
        self.assertEqual(data["segments"][0]["words"], [{"start": 0.1, "end": 0.4, "word": "bien"}])

    def test_whisper_small_se_carga_una_sola_vez_y_se_reutiliza(self):
        first = json.loads(self._transcribe(model="small").body)
        second = json.loads(self._transcribe(model="small").body)
        self.assertEqual(first["model_key"], "small")
        self.assertGreater(first["model_load_ms"], 0)
        self.assertEqual(second["model_load_ms"], 0)
        self.assertEqual(self.loader.loaded, ["small"])
        self.assertEqual(self.loader.models["small"].calls, 2)

    def test_el_tiempo_de_carga_no_se_mezcla_con_el_de_inferencia(self):
        data = json.loads(self._transcribe(model="small").body)
        self.assertAlmostEqual(data["total_ms"], data["model_load_ms"] + data["elapsed_ms"], delta=1.0)
        self.assertNotIn("base", self.loader.loaded)  # no carga de más el modelo por defecto

    def test_modelo_desconocido_responde_400(self):
        with self.assertRaises(server.HTTPException) as ctx:
            self._transcribe(model="grande")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("grande", ctx.exception.detail)
        self.assertEqual(self.loader.loaded, [])

    def test_modelo_no_disponible_responde_503(self):
        server.REGISTRY = _registry(_FakeLoader(fail_keys={"small"}))
        with self.assertRaises(server.HTTPException) as ctx:
            self._transcribe(model="small")
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertIn("small", ctx.exception.detail)
        self.assertIn("RuntimeError", ctx.exception.detail)

    def test_validacion_de_tamano_y_formato(self):
        with self.assertRaises(server.HTTPException) as vacio:
            self._transcribe(payload=b"")
        self.assertEqual(vacio.exception.status_code, 400)
        with self.assertRaises(server.HTTPException) as formato:
            self._transcribe(filename="lab-audio.xyz")
        self.assertEqual(formato.exception.status_code, 400)
        with mock.patch.object(server, "MAX_MB", 0.000001):
            with self.assertRaises(server.HTTPException) as grande:
                self._transcribe()
        self.assertEqual(grande.exception.status_code, 413)

    @unittest.skipIf(InvalidDataError is None, "PyAV no está instalado")
    def test_audio_ilegible_es_422_y_fallo_interno_es_500(self):
        server.REGISTRY = _registry(_FakeLoader(raises=InvalidDataError(av_errno.EINVAL, "audio roto")))
        with self.assertRaises(server.HTTPException) as decodificacion:
            self._transcribe(model="small")
        self.assertEqual(decodificacion.exception.status_code, 422)
        self.assertIn("InvalidDataError", decodificacion.exception.detail)

        server.REGISTRY = _registry(_FakeLoader(raises=TypeError("metadata_errors")))
        with self.assertRaises(server.HTTPException) as interno:
            self._transcribe(model="small")
        self.assertEqual(interno.exception.status_code, 500)
        self.assertIn("TypeError", interno.exception.detail)

    def test_con_un_solo_modelo_en_memoria_se_libera_el_anterior(self):
        loader = _FakeLoader()
        server.REGISTRY = _registry(loader, single_in_memory=True)
        self._transcribe(model="base")
        self.assertTrue(server.REGISTRY.state("base").loaded)
        self._transcribe(model="small")
        self.assertFalse(server.REGISTRY.state("base").loaded)
        self.assertTrue(server.REGISTRY.state("small").loaded)
        self.assertEqual(loader.loaded, ["base", "small"])

    def test_las_peticiones_simultaneas_se_atienden_en_serie(self):
        server.REGISTRY = _registry(_FakeLoader())
        model = server.REGISTRY.load("base")
        original = model.transcribe
        counters = {"now": 0, "max": 0}

        def slow_transcribe(path, **kwargs):
            counters["now"] += 1
            counters["max"] = max(counters["max"], counters["now"])
            time.sleep(0.05)
            counters["now"] -= 1
            return original(path, **kwargs)

        model.transcribe = slow_transcribe

        async def two_requests():
            return await asyncio.gather(
                server.transcribe(file=_upload(), model="base"),
                server.transcribe(file=_upload(), model="base"),
            )

        with mock.patch.object(server, "TRANSCRIBE_SLOTS", threading.Semaphore(1)):
            responses = asyncio.run(two_requests())

        self.assertEqual(counters["max"], 1, "las transcripciones deben ir en serie")
        self.assertEqual(len(responses), 2)

    # ---------------------------------------------------------------- precarga

    def test_preload_carga_solo_el_modelo_por_defecto(self):
        loader = _FakeLoader()
        registry = _registry(loader)
        registry.preload()
        self.assertEqual(loader.loaded, ["base"])
        self.assertEqual(registry.summary()["status"], "ok")

    def test_preload_all_carga_todos_los_modelos(self):
        loader = _FakeLoader()
        registry = _registry(loader, preload_all=True)
        registry.preload()
        self.assertEqual(loader.loaded, ["base", "small"])
        self.assertEqual(registry.summary()["status"], "ok")

    def test_preload_no_lanza_si_un_modelo_no_se_puede_cargar(self):
        registry = _registry(_FakeLoader(fail_keys={"small"}), preload_all=True)
        registry.preload()
        self.assertEqual(registry.summary()["status"], "partial")
        self.assertEqual(registry.summary()["models"]["small"]["load_error"], "RuntimeError")

    # ------------------------------------------------ opciones por modelo (Whisper Small)

    def test_whisper_small_usa_sus_propias_opciones_de_decodificacion(self):
        data = json.loads(self._transcribe(model="small").body)
        kwargs = self.loader.models["small"].kwargs_history[-1]
        self.assertEqual(kwargs["language"], "es")  # idioma español
        self.assertEqual(kwargs["beam_size"], 5)  # búsqueda más amplia
        self.assertTrue(kwargs["vad_filter"])  # se siguen filtrando silencios
        self.assertEqual(
            kwargs["vad_parameters"],
            {"min_silence_duration_ms": 500, "speech_pad_ms": 600},
        )  # margen para no cortar palabras al inicio/final
        # El contexto inicial está disponible pero desactivado por defecto (medido: sin
        # mejora de WER y con riesgo de inventar texto si se desactiva el VAD).
        self.assertNotIn("initial_prompt", kwargs)
        self.assertEqual(data["config"]["beam_size"], 5)
        self.assertEqual(data["config"]["language"], "es")
        self.assertEqual(data["config"]["initial_prompt_chars"], 0)

    def test_whisper_base_conserva_la_configuracion_de_siempre(self):
        data = json.loads(self._transcribe().body)
        kwargs = self.loader.models["base"].kwargs_history[-1]
        self.assertEqual(kwargs["language"], "es")
        self.assertEqual(kwargs["beam_size"], 1)
        self.assertTrue(kwargs["vad_filter"])
        # Base NO recibe los parámetros nuevos: su comportamiento no cambia.
        self.assertNotIn("vad_parameters", kwargs)
        self.assertNotIn("initial_prompt", kwargs)
        self.assertEqual(data["config"]["beam_size"], 1)
        self.assertEqual(data["config"]["initial_prompt_chars"], 0)
        self.assertIsNone(data["config"]["vad_speech_pad_ms"])

    def test_health_expone_las_opciones_de_cada_modelo(self):
        self.registry.load("base")
        data = asyncio.run(server.health())
        self.assertEqual(data["models"]["base"]["inference"]["beam_size"], 1)
        self.assertEqual(data["models"]["small"]["inference"]["beam_size"], 5)
        self.assertEqual(data["models"]["small"]["inference"]["vad_speech_pad_ms"], 600)
        self.assertIsNone(data["models"]["small"]["inference"]["initial_prompt"])
        self.assertIsNone(data["models"]["base"]["inference"]["initial_prompt"])

    def test_las_opciones_se_pueden_cambiar_por_entorno(self):
        default, specs = specs_from_env(
            {
                "WHISPER_MODEL": "base",
                "WHISPER_MODELS": "base,small",
                "WHISPER_SMALL_BEAM_SIZE": "3",
                "WHISPER_SMALL_INITIAL_PROMPT": "",  # vacío = desactivado
                "WHISPER_SMALL_VAD_SPEECH_PAD_MS": "900",
            }
        )
        server.REGISTRY = ModelRegistry(specs, default, loader=self.loader)
        json.loads(self._transcribe(model="small").body)
        kwargs = self.loader.models["small"].kwargs_history[-1]
        self.assertEqual(kwargs["beam_size"], 3)
        self.assertNotIn("initial_prompt", kwargs)
        self.assertEqual(kwargs["vad_parameters"], {"min_silence_duration_ms": 500, "speech_pad_ms": 900})

    def test_el_contexto_inicial_se_puede_activar_por_entorno(self):
        default, specs = specs_from_env(
            {
                "WHISPER_MODEL": "base",
                "WHISPER_MODELS": "base,small",
                "WHISPER_SMALL_INITIAL_PROMPT": "Vocero, entrevista, gestión de crisis",
            }
        )
        server.REGISTRY = ModelRegistry(specs, default, loader=self.loader)
        data = json.loads(self._transcribe(model="small").body)
        kwargs = self.loader.models["small"].kwargs_history[-1]
        self.assertEqual(kwargs["initial_prompt"], "Vocero, entrevista, gestión de crisis")
        self.assertGreater(data["config"]["initial_prompt_chars"], 0)

    def test_afinar_small_no_hereda_sus_ajustes_a_base(self):
        self._transcribe(model="small")
        self.assertEqual(self.loader.models["small"].kwargs_history[-1]["beam_size"], 5)
        self._transcribe(model="base")
        self.assertEqual(self.loader.models["base"].kwargs_history[-1]["beam_size"], 1)

    # ------------------------------------------------ cuarta alternativa (Whisper Medium)

    def _three_models(self):
        """Registro con base, small y medium (la lista por defecto del servicio)."""
        default, specs = specs_from_env({"WHISPER_MODEL": "base", "WHISPER_MODELS": "base,small,medium"})
        server.REGISTRY = ModelRegistry(specs, default, loader=self.loader)
        return server.REGISTRY

    def test_medium_se_carga_solo_cuando_se_pide(self):
        registry = self._three_models()
        self.assertEqual(registry.keys(), ["base", "small", "medium"])
        self.assertEqual(self.loader.loaded, [])  # disponible no es lo mismo que cargado
        data = json.loads(self._transcribe(model="medium").body)
        self.assertEqual(self.loader.loaded, ["medium"])  # solo se cargó el pedido
        self.assertEqual(data["model_key"], "medium")
        self.assertEqual(data["model"], "medium")
        self.assertFalse(registry.state("base").loaded)
        self.assertFalse(registry.state("small").loaded)

    def test_medium_usa_la_misma_decodificacion_optimizada_que_small(self):
        self._three_models()
        json.loads(self._transcribe(model="small").body)
        json.loads(self._transcribe(model="medium").body)
        small = self.loader.models["small"].kwargs_history[-1]
        medium = self.loader.models["medium"].kwargs_history[-1]
        self.assertEqual(medium["language"], "es")
        self.assertEqual(medium["beam_size"], 5)
        self.assertEqual(medium["vad_parameters"], {"min_silence_duration_ms": 500, "speech_pad_ms": 600})
        self.assertEqual(medium, small)  # las mejoras de Small se conservan en Medium
        self.assertNotIn("initial_prompt", medium)

    def test_health_informa_los_tres_modelos_de_whisper(self):
        registry = self._three_models()
        registry.load("base")
        data = asyncio.run(server.health())
        self.assertEqual(set(data["models"]), {"base", "small", "medium"})
        self.assertEqual(data["models"]["medium"]["inference"]["beam_size"], 5)
        self.assertFalse(data["models"]["medium"]["loaded"])  # aún no se ha usado
        self.assertEqual(data["config"]["models"], ["base", "small", "medium"])

    def test_si_medium_no_esta_disponible_las_demas_siguen_respondiendo(self):
        loader = _FakeLoader(fail_keys={"medium"})
        default, specs = specs_from_env({"WHISPER_MODEL": "base", "WHISPER_MODELS": "base,small,medium"})
        server.REGISTRY = ModelRegistry(specs, default, loader=loader)
        with self.assertRaises(server.HTTPException) as ctx:
            self._transcribe(model="medium")
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertIn("medium", ctx.exception.detail)
        # Base y Small siguen funcionando con el mismo registro del servicio.
        self.assertEqual(json.loads(self._transcribe(model="base").body)["model_key"], "base")
        self.assertEqual(json.loads(self._transcribe(model="small").body)["model_key"], "small")

    def test_un_solo_modelo_en_memoria_libera_el_anterior_tambien_con_medium(self):
        default, specs = specs_from_env({"WHISPER_MODEL": "base", "WHISPER_MODELS": "base,small,medium"})
        server.REGISTRY = ModelRegistry(specs, default, loader=self.loader, single_in_memory=True)
        self._transcribe(model="small")
        self._transcribe(model="medium")
        self.assertFalse(server.REGISTRY.state("small").loaded)
        self.assertTrue(server.REGISTRY.state("medium").loaded)
        self.assertEqual(self.loader.loaded, ["small", "medium"])

    def test_la_respuesta_informa_la_duracion_conservada_por_el_vad(self):
        data = json.loads(self._transcribe().body)
        self.assertIn("duration_after_vad", data)
        self.assertAlmostEqual(data["duration_after_vad"], data["duration_seconds"] * 0.9, delta=0.2)


if __name__ == "__main__":
    unittest.main(verbosity=2)


