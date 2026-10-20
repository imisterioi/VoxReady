"""Evalúa la precisión de los modelos de transcripción con las MISMAS opciones que usa el
servicio (`whisper_models.InferenceOptions`) y calcula WER y CER contra las referencias.

Se ejecuta con el Python del sistema, sin dependencias nuevas:

    cd backend\\whisper
    python eval_whisper.py --muestras %TEMP%\\vw_muestras ^
        --config base,model=base ^
        --config small-b1,model=small,beam=1,prompt=0 ^
        --config small-b5,model=small,beam=5,prompt=0 ^
        --config small-b5-ctx,model=small,beam=5,prompt=1 ^
        --salida %TEMP%\\eval_whisper.json

Cada `--config` es `nombre,clave=valor,...` con estas claves (todas opcionales):
    model=small            clave del modelo (base | small | …)
    beam=5                 beam_size
    language=es            idioma (vacío = autodetectar)
    vad=1                  filtro de voz (0 = desactivado, para comparar)
    vad_silence=500        min_silence_duration_ms del VAD
    vad_pad=600            speech_pad_ms del VAD
    prompt=1               usa el contexto inicial del modelo (0 = sin contexto)
    device=cpu             cpu | cuda
    compute_type=int8      precisión

Las referencias se leen de `referencias.tsv` (archivo<TAB>texto) dentro de la carpeta de
muestras; ese texto es la verdad de referencia y NO se inventa aquí. Para muestras de voz
humana, escribe tu propia `referencias.tsv` con la transcripción revisada a mano.

El texto sintético (TTS) sirve para comparar configuraciones entre sí; sus valores absolutos
de WER no representan el rendimiento con voz humana real.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import re
import sys
import time
from pathlib import Path

# Salida en UTF-8: las tildes y las comillas del guion no deben romper la impresión en Windows.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from whisper_models import (
    VOXREADY_PROMPT,
    InferenceOptions,
    ModelSpec,
    default_loader,
    env_flag,
    specs_from_env,
)

# ---------------------------------------------------------------- normalización y métricas


def normalize(text: str) -> str:
    """Misma normalización que el laboratorio del frontend: minúsculas, sin puntuación ni
    símbolos, espacios colapsados y acentos CONSERVADOS (quitarlos ocultaría errores)."""
    out = str(text or "")
    out = re.sub(r"[^\w\s]|_", " ", out, flags=re.UNICODE)  # quita puntuación y símbolos
    out = out.lower()
    out = re.sub(r"\s+", " ", out)
    return out.strip()


def tokens(text: str) -> list[str]:
    normalized = normalize(text)
    return normalized.split(" ") if normalized else []


def characters(text: str) -> list[str]:
    return list(normalize(text).replace(" ", ""))


def edit_ops(reference: list, hypothesis: list) -> tuple[int, int, int, int]:
    """(distancia, sustituciones, omisiones, inserciones) con empates → sustitución."""
    n, m = len(reference), len(hypothesis)
    dp = [[(0, 0, 0, 0)] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = (i, 0, i, 0)
    for j in range(1, m + 1):
        dp[0][j] = (j, 0, 0, j)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if reference[i - 1] == hypothesis[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
                continue
            sub = dp[i - 1][j - 1]
            dele = dp[i - 1][j]
            ins = dp[i][j - 1]
            candidates = [
                (sub[0] + 1, sub[1] + 1, sub[2], sub[3]),
                (dele[0] + 1, dele[1], dele[2] + 1, dele[3]),
                (ins[0] + 1, ins[1], ins[2], ins[3] + 1),
            ]
            dp[i][j] = min(candidates, key=lambda item: item[0])
    return dp[n][m]


def word_error_rate(reference: str, hypothesis: str) -> dict:
    ref, hyp = tokens(reference), tokens(hypothesis)
    distance, substitutions, deletions, insertions = edit_ops(ref, hyp)
    return {
        "wer": (distance / len(ref)) if ref else None,
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
        "reference_words": len(ref),
        "hypothesis_words": len(hyp),
    }


def character_error_rate(reference: str, hypothesis: str) -> dict:
    ref, hyp = characters(reference), characters(hypothesis)
    distance, substitutions, deletions, insertions = edit_ops(ref, hyp)
    return {
        "cer": (distance / len(ref)) if ref else None,
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
        "reference_chars": len(ref),
    }


# ---------------------------------------------------------------- memoria del proceso

class _ProcessMemoryCounters(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.c_ulong),
        ("PageFaultCount", ctypes.c_ulong),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def working_set_mb(peak: bool = False) -> float | None:
    """Memoria del proceso en MB (Windows). Devuelve None si no se puede medir."""
    if os.name != "nt":
        return None
    try:
        # Los tipos hay que declararlos explícitamente: sin ellos ctypes pasa el HANDLE como
        # entero de 32 bits y la llamada falla en Windows de 64 bits.
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.GetCurrentProcess.restype = ctypes.c_void_p
        psapi.GetProcessMemoryInfo.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(_ProcessMemoryCounters),
            ctypes.c_ulong,
        ]
        psapi.GetProcessMemoryInfo.restype = ctypes.c_int

        counters = _ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(_ProcessMemoryCounters)
        handle = kernel32.GetCurrentProcess()
        if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            return None
        value = counters.PeakWorkingSetSize if peak else counters.WorkingSetSize
        return round(value / (1024 * 1024), 1)
    except Exception:  # noqa: BLE001 - la memoria es informativa, no un requisito
        return None


# ---------------------------------------------------------------- configuraciones y muestras

def load_samples(folder: Path, limit: int = 0) -> list[dict]:
    """Lee `referencias.tsv` (archivo<TAB>texto) y comprueba que el audio exista."""
    references = folder / "referencias.tsv"
    if not references.exists():
        raise SystemExit(f"No se encontró {references} (usa generar_audio_referencia.ps1)")
    samples: list[dict] = []
    for line in references.read_text(encoding="utf-8-sig").splitlines():
        # Solo se quita el salto de línea: una referencia vacía (audio sin voz) es válida y
        # termina en tabulador, que `.strip()` eliminaría junto con el separador.
        line = line.rstrip("\r\n")
        if not line.strip():
            continue
        parts = re.split(r"\t|\\t", line, maxsplit=1)
        if len(parts) != 2:
            raise SystemExit(f"Línea de referencia sin formato 'archivo<TAB>texto': {line!r}")
        audio = folder / parts[0].strip()
        if not audio.exists():
            raise SystemExit(f"Falta el audio {audio}")
        samples.append({"audio": audio, "reference": parts[1].strip()})
    return samples[:limit] if limit else samples


def split_config(raw: str) -> tuple[str, str, dict]:
    """`nombre,model=small,beam=5` → (nombre, clave de modelo, sobrescrituras)."""
    parts = [item for item in raw.split(",") if item.strip()]
    name = parts[0].strip()
    overrides: dict[str, str] = {}
    for item in parts[1:]:
        if "=" not in item:
            raise SystemExit(f"Opción inválida en --config '{raw}': {item!r} (usa clave=valor)")
        key, value = item.split("=", 1)
        overrides[key.strip().lower()] = value.strip()
    return name, overrides.pop("model", name), overrides


def _flag(value: str, default: bool = True) -> bool:
    if value is None:
        return default
    return value.strip().lower() not in ("0", "false", "no", "off", "")


def _initial_prompt(base: InferenceOptions, value: str | None) -> str | None:
    """Contexto inicial según el valor de la opción `prompt`.

    - `None`         → el del modelo (por defecto: ninguno).
    - `0/false/no`   → desactivado.
    - `1/true/yes`   → el del modelo.
    - `voxready`     → el vocabulario de VoxReady (VOXREADY_PROMPT).
    - otro texto     → ese texto tal cual (no puede llevar comas: separan las opciones).
    """
    if value is None:
        return base.initial_prompt
    texto = value.strip()
    clave = texto.lower()
    if clave in ("0", "false", "no", "off", ""):
        return None
    if clave == "voxready":
        return VOXREADY_PROMPT
    if clave in ("1", "true", "yes", "si", "on"):
        return base.initial_prompt
    return texto


def options_for(spec: ModelSpec, overrides: dict | None = None) -> InferenceOptions:
    """Opciones efectivas de una configuración: valores del modelo + sobrescrituras."""
    overrides = overrides or {}
    base = spec.inference
    language = overrides.get("language", base.language or "")
    return InferenceOptions(
        language=language or None,
        beam_size=int(overrides.get("beam", base.beam_size)),
        vad_filter=_flag(overrides.get("vad"), base.vad_filter),
        vad_min_silence_ms=(
            int(overrides["vad_silence"]) if "vad_silence" in overrides else base.vad_min_silence_ms
        ),
        vad_speech_pad_ms=(
            int(overrides["vad_pad"]) if "vad_pad" in overrides else base.vad_speech_pad_ms
        ),
        initial_prompt=_initial_prompt(base, overrides.get("prompt")),
    )


def describe(name: str, spec: ModelSpec, options: InferenceOptions) -> str:
    data = options.to_dict()
    return (
        f"{name} (modelo {spec.name}, {spec.device}/{spec.compute_type}) · "
        f"lang={data['language']} beam={data['beam_size']} vad={data['vad_filter']} "
        f"silencio={data['vad_min_silence_ms']} pad={data['vad_speech_pad_ms']} "
        f"contexto={'sí' if data['initial_prompt'] else 'no'}"
    )


# ---------------------------------------------------------------- ejecución

def transcribe_sample(model, sample: dict, options: InferenceOptions) -> dict:
    """Transcribe una muestra reutilizando la MISMA función que usa el servicio."""
    from server import _run_transcription  # noqa: PLC0415 - se importa aquí para no crear la app al usar el módulo como librería

    started = time.perf_counter()
    segments, info = _run_transcription(model, str(sample["audio"]), options)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    duration = float(getattr(info, "duration", 0.0) or 0.0)
    return {
        "text": " ".join(segment["text"] for segment in segments).strip(),
        "elapsed_ms": elapsed_ms,
        "duration_seconds": round(duration, 3),
        "duration_after_vad": round(float(getattr(info, "duration_after_vad", 0.0) or 0.0), 3),
        "language": getattr(info, "language", None),
        "rtf": round(elapsed_ms / 1000 / duration, 3) if duration > 0 else None,
        "segments": len(segments),
    }


def edges(text: str, count: int = 4) -> str:
    """Primeras y últimas palabras: sirve para ver si el VAD cortó los bordes."""
    words = tokens(text)
    if len(words) <= count * 2:
        return " ".join(words)
    return f"{' '.join(words[:count])} … {' '.join(words[-count:])}"


def run_configuration(
    name: str,
    spec: ModelSpec,
    options: InferenceOptions,
    samples: list[dict],
    *,
    repeat: int = 1,
    check_borders: bool = False,
    model_dir: str | None = None,
    local_files_only: bool = False,
) -> dict:
    print(f"\n=== {describe(name, spec, options)} ===")
    started = time.perf_counter()
    model = default_loader(spec, model_dir, local_files_only)
    load_ms = round((time.perf_counter() - started) * 1000, 1)
    rss_loaded = working_set_mb()
    print(f"  carga del modelo: {load_ms:.0f} ms · memoria tras cargar: {rss_loaded} MB")

    rows: list[dict] = []
    for sample in samples:
        attempts = [transcribe_sample(model, sample, options) for _ in range(max(1, repeat))]
        best = attempts[0]
        times = sorted(attempt["elapsed_ms"] for attempt in attempts)
        word = word_error_rate(sample["reference"], best["text"])
        char = character_error_rate(sample["reference"], best["text"])
        row = {
            "config": name,
            "model": spec.name,
            "file": sample["audio"].name,
            "reference": sample["reference"],
            "text": best["text"],
            "wer": word["wer"],
            "cer": char["cer"],
            "substitutions": word["substitutions"],
            "deletions": word["deletions"],
            "insertions": word["insertions"],
            "reference_words": word["reference_words"],
            "elapsed_ms": best["elapsed_ms"],
            "median_ms": times[len(times) // 2],
            "rtf": best["rtf"],
            "duration_seconds": best["duration_seconds"],
            "duration_after_vad": best["duration_after_vad"],
            "segments": best["segments"],
            "language": best["language"],
        }
        rows.append(row)
        print(
            f"  {row['file']:18} WER {_pct(row['wer']):>7}  CER {_pct(row['cer']):>7}  "
            f"{row['elapsed_ms']:7.0f} ms  RTF {row['rtf'] if row['rtf'] is not None else '-'}  "
            f"VAD {row['duration_after_vad']:.2f}/{row['duration_seconds']:.2f} s  «{row['text'][:64]}»"
        )
        if check_borders:
            print(f"      ref: {edges(sample['reference'])}")
            print(f"      hip: {edges(best['text'])}")

    reference_words = sum(row["reference_words"] for row in rows)
    total_errors = sum(row["substitutions"] + row["deletions"] + row["insertions"] for row in rows)
    total_ms = sum(row["elapsed_ms"] for row in rows)
    rtf_values = [row["rtf"] for row in rows if row["rtf"] is not None]
    # Un audio sin referencia (por ejemplo, silencio) no produce WER/CER: se excluye del
    # promedio en vez de contarlo como 0 (que falsearía la media).
    wer_values = [row["wer"] for row in rows if row["wer"] is not None]
    cer_values = [row["cer"] for row in rows if row["cer"] is not None]
    summary = {
        "config": name,
        "model": spec.name,
        "options": options.to_dict(),
        "load_ms": load_ms,
        "rss_after_load_mb": rss_loaded,
        "rss_peak_mb": working_set_mb(peak=True),
        "samples": len(rows),
        "wer_global": (total_errors / reference_words) if reference_words else None,
        "wer_mean": (sum(wer_values) / len(wer_values)) if wer_values else None,
        "cer_mean": (sum(cer_values) / len(cer_values)) if cer_values else None,
        "errors": total_errors,
        "reference_words": reference_words,
        "total_ms": round(total_ms, 1),
        "mean_rtf": round(sum(rtf_values) / len(rtf_values), 3) if rtf_values else None,
        "rows": rows,
    }
    print(
        f"  RESUMEN: WER global {_pct(summary['wer_global'])} | WER medio {_pct(summary['wer_mean'])} | "
        f"CER medio {_pct(summary['cer_mean'])} | errores {total_errors}/{reference_words} palabras | "
        f"{total_ms / 1000:.2f} s | RTF medio {summary['mean_rtf']}"
    )
    return summary


# ---------------------------------------------------------------- línea de comandos

def _pct(value) -> str:
    return f"{value:.2%}" if value is not None else "-"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Evalúa WER/CER de los modelos con las MISMAS opciones que usa el servicio.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--muestras", required=True, help="Carpeta con los audios y referencias.tsv")
    parser.add_argument("--config", action="append", default=[], help="nombre,model=small,beam=5,…")
    parser.add_argument("--salida", help="Archivo JSON con todos los resultados (evidencia)")
    parser.add_argument("--repetir", type=int, default=1, help="Repeticiones por muestra (mide la mediana)")
    parser.add_argument("--limite", type=int, default=0, help="Usar solo las primeras N muestras")
    parser.add_argument("--comprobar-bordes", action="store_true", help="Imprime primeras/últimas palabras")
    parser.add_argument("--offline", action="store_true", help="No descargar modelos (local_files_only)")
    args = parser.parse_args(argv)

    folder = Path(args.muestras)
    samples = load_samples(folder, args.limite)
    if not samples:
        raise SystemExit(f"No hay muestras en {folder}")

    default_key, specs = specs_from_env()
    by_key = {spec.key: spec for spec in specs}
    print(f"Modelos configurados: {', '.join(by_key)} (por defecto: {default_key})")
    print(f"Muestras: {len(samples)} · referencias: {folder / 'referencias.tsv'}")

    model_dir = os.getenv("WHISPER_MODEL_DIR") or None
    local_only = args.offline or env_flag(None, "WHISPER_LOCAL_FILES_ONLY", False)

    summaries: list[dict] = []
    for raw in args.config or [default_key]:
        name, model_key, overrides = split_config(raw)
        spec = by_key.get(model_key)
        if spec is None:
            raise SystemExit(
                f"El modelo '{model_key}' no está configurado (WHISPER_MODELS={', '.join(by_key)}). "
                "Añádelo al entorno o usa otra clave."
            )
        summaries.append(
            run_configuration(
                name,
                spec,
                options_for(spec, overrides),
                samples,
                repeat=max(1, args.repetir),
                check_borders=args.comprobar_bordes,
                model_dir=model_dir,
                local_files_only=local_only,
            )
        )

    print("\n=== Comparación ===")
    print(
        f"{'config':20} {'WER global':>11} {'WER medio':>10} {'CER medio':>10} "
        f"{'total s':>8} {'RTF':>6} {'mem MB':>8}"
    )
    for summary in summaries:
        print(
            f"{summary['config']:20} {_pct(summary['wer_global']):>11} {_pct(summary['wer_mean']):>10} "
            f"{_pct(summary['cer_mean']):>10} {summary['total_ms'] / 1000:8.2f} "
            f"{summary['mean_rtf'] if summary['mean_rtf'] is not None else '-':>6} "
            f"{summary['rss_peak_mb'] if summary['rss_peak_mb'] is not None else '-':>8}"
        )
    print(
        "\nNota: con audio sintético (TTS) los valores absolutos NO representan voz humana; "
        "usa las mismas muestras para comparar CONFIGURACIONES entre sí."
    )

    if args.salida:
        Path(args.salida).write_text(
            json.dumps(
                {
                    "generadoEn": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "muestras": str(folder),
                    "configuraciones": summaries,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"Resultados guardados en {args.salida}")
    return 0


if __name__ == "__main__":
    sys.exit(main())


