"""Pruebas del evaluador (eval_whisper.py): métricas y lectura de configuraciones.

    cd backend/whisper
    python -m unittest test_eval_whisper -v

No cargan modelos ni usan red: comprueban el cálculo de WER/CER (con la MISMA
normalización que el laboratorio del frontend) y el análisis de argumentos, para que las
cifras que produce el evaluador sean fiables.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import eval_whisper as ev
from whisper_models import BASE_INFERENCE, MEDIUM_INFERENCE, SMALL_INFERENCE, VOXREADY_PROMPT, ModelSpec

SPEC_BASE = ModelSpec(key="base", name="base", device="cpu", compute_type="int8", inference=BASE_INFERENCE)
SPEC_SMALL = ModelSpec(key="small", name="small", device="cpu", compute_type="int8", inference=SMALL_INFERENCE)
SPEC_MEDIUM = ModelSpec(key="medium", name="medium", device="cpu", compute_type="int8", inference=MEDIUM_INFERENCE)


class MetricasTest(unittest.TestCase):
    def test_normalizacion_igual_que_el_laboratorio(self):
        self.assertEqual(ev.normalize("Hola,   mundo.\n\n¿Qué tal?"), "hola mundo qué tal")
        self.assertEqual(ev.normalize("Sé que sí"), "sé que sí")  # los acentos se conservan

    def test_tokens_y_caracteres(self):
        self.assertEqual(ev.tokens("El vocero habla"), ["el", "vocero", "habla"])
        self.assertEqual(ev.tokens("   "), [])
        self.assertEqual(ev.characters("ab c"), ["a", "b", "c"])

    def test_wer_una_omision_sobre_cuatro_palabras(self):
        report = ev.word_error_rate("el vocero habla claro", "el vocero habla")
        self.assertEqual(report["deletions"], 1)
        self.assertEqual(report["substitutions"], 0)
        self.assertEqual(report["insertions"], 0)
        self.assertAlmostEqual(report["wer"], 0.25)

    def test_wer_una_sustitucion(self):
        report = ev.word_error_rate("el vocero habla claro", "el vocero habla oscuro")
        self.assertEqual(report["substitutions"], 1)
        self.assertAlmostEqual(report["wer"], 0.25)

    def test_wer_una_insercion(self):
        report = ev.word_error_rate("el vocero habla", "el vocero eh habla")
        self.assertEqual(report["insertions"], 1)
        self.assertAlmostEqual(report["wer"], 1 / 3)

    def test_wer_ignora_puntuacion_y_mayusculas_pero_no_acentos(self):
        # Mismo texto con acentos correctos: cero errores.
        self.assertAlmostEqual(ev.word_error_rate("Buenos días, señores.", "buenos días señores")["wer"], 0.0)
        # Sin acentos: dos sustituciones sobre tres palabras (los acentos cuentan).
        self.assertAlmostEqual(ev.word_error_rate("Buenos días, señores.", "buenos dias senores")["wer"], 2 / 3)

    def test_cer(self):
        self.assertEqual(ev.character_error_rate("hola", "hola")["cer"], 0.0)
        self.assertAlmostEqual(ev.character_error_rate("hola", "hol")["cer"], 0.25)

    def test_sin_referencia_no_hay_metrica(self):
        self.assertIsNone(ev.word_error_rate("", "algo")["wer"])
        self.assertIsNone(ev.character_error_rate("", "algo")["cer"])

    def test_bordes(self):
        self.assertEqual(ev.edges("uno dos tres"), "uno dos tres")
        self.assertEqual(
            ev.edges("uno dos tres cuatro cinco seis siete ocho nueve diez"),
            "uno dos tres cuatro … siete ocho nueve diez",
        )


class ConfiguracionesTest(unittest.TestCase):
    def test_split_config(self):
        name, model_key, overrides = ev.split_config("small-b5,model=small,beam=5,prompt=0")
        self.assertEqual(name, "small-b5")
        self.assertEqual(model_key, "small")
        self.assertEqual(overrides, {"beam": "5", "prompt": "0"})

    def test_split_config_sin_modelo_usa_el_nombre(self):
        name, model_key, overrides = ev.split_config("base")
        self.assertEqual((name, model_key, overrides), ("base", "base", {}))

    def test_split_config_invalido(self):
        with self.assertRaises(SystemExit):
            ev.split_config("small,beam")

    def test_sin_sobrescrituras_usa_los_valores_del_modelo(self):
        options = ev.options_for(SPEC_SMALL)
        self.assertEqual(options.beam_size, 5)  # valor del modelo small
        self.assertEqual(options.vad_speech_pad_ms, 600)
        self.assertIsNone(options.initial_prompt)  # el contexto viene desactivado
        base = ev.options_for(SPEC_BASE)
        self.assertEqual(base.beam_size, 1)  # base no cambia
        self.assertIsNone(base.initial_prompt)

    def test_sobrescrituras(self):
        options = ev.options_for(SPEC_SMALL, {"beam": "1", "prompt": "0", "vad": "0", "vad_pad": "900", "language": ""})
        self.assertEqual(options.beam_size, 1)
        self.assertIsNone(options.initial_prompt)
        self.assertFalse(options.vad_filter)
        self.assertEqual(options.vad_speech_pad_ms, 900)
        self.assertIsNone(options.language)  # vacío = autodetectar

    def test_contexto_inicial_segun_la_opcion(self):
        self.assertIsNone(ev.options_for(SPEC_SMALL).initial_prompt)
        self.assertIsNone(ev.options_for(SPEC_SMALL, {"prompt": "0"}).initial_prompt)
        self.assertEqual(ev.options_for(SPEC_SMALL, {"prompt": "voxready"}).initial_prompt, VOXREADY_PROMPT)
        self.assertEqual(
            ev.options_for(SPEC_SMALL, {"prompt": "Vocero y gestión de crisis"}).initial_prompt,
            "Vocero y gestión de crisis",
        )

    def test_medium_se_evalua_con_la_misma_decodificacion_que_small(self):
        small = ev.options_for(SPEC_SMALL)
        medium = ev.options_for(SPEC_MEDIUM)
        self.assertEqual(medium.to_dict(), small.to_dict())
        self.assertEqual(medium.beam_size, 5)
        self.assertEqual(medium.vad_speech_pad_ms, 600)
        self.assertIn("vad_parameters", medium.transcribe_kwargs())
        # Y se puede evaluar con beam 1 para comparar el coste
        assert_beam1 = ev.options_for(SPEC_MEDIUM, {"beam": "1"})
        self.assertEqual(assert_beam1.beam_size, 1)
        self.assertEqual(assert_beam1.vad_min_silence_ms, 500)

    def test_kwargs_para_transcribe(self):
        kwargs = ev.options_for(SPEC_SMALL).transcribe_kwargs()
        self.assertEqual(kwargs["beam_size"], 5)
        self.assertEqual(kwargs["language"], "es")
        self.assertIn("vad_parameters", kwargs)
        self.assertNotIn("initial_prompt", kwargs)  # desactivado por defecto
        con_contexto = ev.options_for(SPEC_SMALL, {"prompt": "voxready"}).transcribe_kwargs()
        self.assertEqual(con_contexto["initial_prompt"], VOXREADY_PROMPT)


class MuestrasTest(unittest.TestCase):
    def test_lectura_de_referencias(self):
        with tempfile.TemporaryDirectory() as carpeta:
            folder = Path(carpeta)
            (folder / "a.wav").write_bytes(b"RIFF")
            (folder / "referencias.tsv").write_text("a.wav\tHola mundo\n", encoding="utf-8")
            samples = ev.load_samples(folder)
            self.assertEqual(len(samples), 1)
            self.assertEqual(samples[0]["reference"], "Hola mundo")
            self.assertEqual(samples[0]["audio"].name, "a.wav")

    def test_referencia_vacia_es_valida(self):
        # Un audio sin voz (silencio) se evalúa con referencia vacía: no hay WER que calcular.
        with tempfile.TemporaryDirectory() as carpeta:
            folder = Path(carpeta)
            (folder / "s.wav").write_bytes(b"RIFF")
            (folder / "referencias.tsv").write_text("s.wav\t\n", encoding="utf-8")
            samples = ev.load_samples(folder)
            self.assertEqual(samples[0]["reference"], "")
            self.assertIsNone(ev.word_error_rate(samples[0]["reference"], "algo")["wer"])

    def test_falta_el_audio(self):
        with tempfile.TemporaryDirectory() as carpeta:
            folder = Path(carpeta)
            (folder / "referencias.tsv").write_text("no-existe.wav\tHola\n", encoding="utf-8")
            with self.assertRaises(SystemExit):
                ev.load_samples(folder)

    def test_falta_el_archivo_de_referencias(self):
        with tempfile.TemporaryDirectory() as carpeta:
            with self.assertRaises(SystemExit):
                ev.load_samples(Path(carpeta))


if __name__ == "__main__":
    unittest.main(verbosity=2)
