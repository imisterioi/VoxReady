from faster_whisper import WhisperModel

print("Cargando modelo Whisper...")

model = WhisperModel(
    "base",
    device="cpu",
    compute_type="int8"
)

print("Modelo Whisper cargado correctamente.")