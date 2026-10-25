"""Extrae una ventana de audio a WAV PCM16 mono 16 kHz (para el Whisper local).

Se usa cuando el respaldo es el servicio local, que sólo acepta archivos completos.
La ventana la define el backend con los tiempos registrados en la sesión; aquí no se
decide ningún límite.

Uso: python slice_window.py --input-file <webm> --start-ms 1000 --end-ms 5000 --out <wav>
Salida: una línea JSON {"ok": true, "durationMs": 4000} o {"ok": false, "code": "..."}
"""
import argparse
import json
import os
import sys
import wave


def fail(code, message):
    print(json.dumps({"ok": False, "code": code, "message": str(message)[:300]}))
    sys.exit(0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-file", required=True)
    parser.add_argument("--start-ms", type=int, required=True)
    parser.add_argument("--end-ms", type=int, required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    try:
        import av
    except Exception as exc:
        fail("CLIENT_MISSING", f"PyAV no disponible: {exc}")

    try:
        container = av.open(args.input_file)
        resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)
        chunks = []
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().tobytes())
        pcm = b"".join(chunks)
    except Exception as exc:
        fail("DECODE_FAILED", f"No se pudo decodificar el audio: {exc}")

    total = len(pcm) // 2
    first = max(0, int(args.start_ms * 16))
    last = min(total, int(args.end_ms * 16))
    if last <= first:
        fail("EMPTY_WINDOW", f"Ventana vacía o fuera del audio ({args.start_ms}-{args.end_ms} ms).")

    slice_bytes = pcm[first * 2 : last * 2]
    try:
        with wave.open(args.out, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(16000)
            handle.writeframes(slice_bytes)
    except Exception as exc:
        fail("WRITE_FAILED", f"No se pudo escribir el fragmento: {exc}")

    print(json.dumps({"ok": True, "durationMs": round((last - first) / 16), "bytes": len(slice_bytes)}))


if __name__ == "__main__":
    main()
