"""Cliente oficial de Riva para los modelos ASR alojados de NVIDIA Build.

Se ejecuta como proceso hijo del backend Node (no es un servidor y NO ejecuta modelos
localmente: sólo envía audio al endpoint alojado `grpc.nvcf.nvidia.com:443`).

Uso:
  python asr_client.py --function-id <id> --language es-US --input-file <ruta>

Salida: una única línea JSON por stdout, para que Node la parsee sin ambigüedad.
  {"ok": true, "text": "...", "segments": [...], "decoded": {...}}
  {"ok": false, "code": "CLIENT_MISSING"|"NO_KEY"|"DECODE_FAILED"|"RIVA_ERROR", "message": "..."}

La API key se lee de NVIDIA_API_KEY en el entorno: nunca se pasa por argumentos ni se
escribe en la salida.
"""
import argparse
import json
import os
import sys
import time


def fail(code, message):
    print(json.dumps({"ok": False, "code": code, "message": str(message)[:500]}, ensure_ascii=False))
    sys.exit(0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--function-id", required=True)
    parser.add_argument("--server", default="grpc.nvcf.nvidia.com:443")
    parser.add_argument("--language", default="es-US")
    parser.add_argument("--input-file", required=True)
    # Ventana opcional en milisegundos: se recorta ANTES de transcribir para obtener una
    # transcripción independiente por respuesta (Whisper no devuelve offsets utilizables).
    parser.add_argument("--start-ms", type=int, default=None)
    parser.add_argument("--end-ms", type=int, default=None)
    args = parser.parse_args()

    key = os.environ.get("NVIDIA_API_KEY", "").strip()
    if not key:
        fail("NO_KEY", "Falta NVIDIA_API_KEY en el entorno del backend.")

    try:
        import riva.client
    except Exception as exc:  # ImportError y errores de ABI
        fail("CLIENT_MISSING", f"nvidia-riva-client no disponible: {exc}")

    # Conversión a WAV PCM16 mono: los modelos documentan WAV/OPUS/FLAC de 16 bits mono y
    # el navegador entrega WebM/Opus. Se convierte en memoria y se informa del cambio.
    decoded = {"converted": False}
    audio_bytes = None
    try:
        import av  # PyAV: decodifica WebM/Opus sin ffmpeg del sistema

        container = av.open(args.input_file)
        resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)
        frames = []
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                # `to_bytes()` entrega el PCM ya en s16/mono sin necesitar numpy; el
                # respaldo con to_ndarray() sólo se usa en versiones antiguas de PyAV.
                frames.append(out.to_bytes() if hasattr(out, "to_bytes") else out.to_ndarray().tobytes())
        for out in resampler.resample(None):
            frames.append(out.to_bytes() if hasattr(out, "to_bytes") else out.to_ndarray().tobytes())
        audio_bytes = b"".join(frames)
        decoded = {
            "converted": True,
            "encoding": "LINEAR_PCM",
            "sampleRate": 16000,
            "channels": 1,
            "bits": 16,
            "source": os.path.splitext(args.input_file)[1].lower() or "desconocido",
        }
    except Exception as exc:
        fail("DECODE_FAILED", f"No se pudo decodificar el audio: {exc}")

    if not audio_bytes:
        fail("DECODE_FAILED", "El audio quedó vacío después de decodificarlo.")

    # Recorte de la ventana [startMs, endMs) sobre el PCM ya normalizado (16 kHz mono s16):
    # 16 muestras por milisegundo. Se recorta antes de enviar, así cada respuesta se
    # transcribe sola y no depende de marcas temporales del servicio.
    window = None
    if args.start_ms is not None or args.end_ms is not None:
        total_samples = len(audio_bytes) // 2
        first = max(0, int((args.start_ms or 0) * 16))
        last = total_samples if args.end_ms is None else min(total_samples, int(args.end_ms * 16))
        if last <= first:
            fail("EMPTY_WINDOW", f"Ventana vacía o fuera del audio ({args.start_ms}–{args.end_ms} ms).")
        audio_bytes = audio_bytes[first * 2 : last * 2]
        window = {"startMs": args.start_ms or 0, "endMs": args.end_ms, "durationMs": round((last - first) / 16)}

    try:
        auth = riva.client.Auth(
            uri=args.server,
            use_ssl=True,
            metadata_args=[
                ["function-id", args.function_id],
                ["authorization", f"Bearer {key}"],
            ],
        )
        asr = riva.client.ASRService(auth)
        config = riva.client.RecognitionConfig(
            encoding=riva.client.AudioEncoding.LINEAR_PCM,
            sample_rate_hertz=16000,
            language_code=args.language,
            max_alternatives=1,
            audio_channel_count=1,
            enable_automatic_punctuation=True,
            # Necesario para separar respuestas por ventanas: sin esto el servicio puede
            # devolver texto sin tiempos y la asignación sería imposible (NO_TIMESTAMPS).
            enable_word_time_offsets=True,
        )
        started = time.time()
        response = asr.offline_recognize(audio_bytes, config)
        elapsed_ms = round((time.time() - started) * 1000, 1)
    except Exception as exc:
        fail("RIVA_ERROR", f"{type(exc).__name__}: {exc}")

    segments = []
    for result in getattr(response, "results", []) or []:
        for alt in getattr(result, "alternatives", []) or []:
            words = []
            for word in getattr(alt, "words", []) or []:
                words.append(
                    {
                        "word": word.word,
                        "start": float(word.start_time),
                        "end": float(word.end_time),
                    }
                )
            # Sin palabras no hay tiempos: se dejan en None para que Node lo detecte y
            # NO invente una separación de respuestas.
            segments.append(
                {
                    "text": alt.transcript,
                    "start": words[0]["start"] if words else None,
                    "end": words[-1]["end"] if words else None,
                    "confidence": getattr(alt, "confidence", None),
                    "words": words,
                }
            )

    text = " ".join(seg["text"].strip() for seg in segments if seg.get("text")).strip()
    print(
        json.dumps(
            {
                "ok": True,
                "text": text,
                "segments": segments,
                "elapsedMs": elapsed_ms,
                "language": args.language,
                "decoded": decoded,
                "window": window,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
