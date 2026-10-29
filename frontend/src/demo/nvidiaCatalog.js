// Catálogo del laboratorio de NVIDIA, tal como lo entrega el backend sin API key configurada.
// Generado desde backend/lib/nvidiaCatalog.js: en la demo ningún modelo se puede llamar.
export const NVIDIA_CATALOG = {
  "ok": true,
  "keyConfigured": false,
  "asr": [
    {
      "key": "whisper-large-v3",
      "label": "Whisper Large v3 (NVIDIA Build)",
      "model": "openai/whisper-large-v3",
      "protocol": "riva-grpc",
      "language": "multi",
      "availability": "ready",
      "callable": false,
      "spanish": "documentado (multilingüe; no probado aquí)",
      "audio": "WAV/OPUS/FLAC, mono, 16 bits",
      "punctuation": "no documentado en la ficha",
      "timestamps": "no documentado en la ficha",
      "source": "https://build.nvidia.com/openai/whisper-large-v3/api"
    },
    {
      "key": "parakeet-ctc-0_6b-es",
      "label": "Parakeet CTC 0.6B ES",
      "model": "nvidia/parakeet-ctc-0_6b-es",
      "protocol": "riva-grpc",
      "language": "es-US",
      "availability": "ready",
      "callable": false,
      "spanish": "documentado (modelo de español)",
      "audio": "WAV/OGG/OPUS, mono, 16 bits",
      "punctuation": "documentado: puntuación incluida",
      "timestamps": "documentado: timestamps por palabra",
      "source": "https://build.nvidia.com/nvidia/parakeet-ctc-0_6b-es/api"
    },
    {
      "key": "parakeet-1_1b-rnnt-multilingual",
      "label": "Parakeet 1.1B RNNT multilingüe",
      "model": "nvidia/parakeet-1_1b-rnnt-multilingual-asr",
      "protocol": "riva-grpc",
      "language": "es-US",
      "availability": "ready",
      "callable": false,
      "spanish": "documentado (multilingüe; español no verificado en llamada)",
      "audio": "WAV/OGG/OPUS, mono, 16 bits",
      "punctuation": "no documentado en la ficha",
      "timestamps": "no documentado en la ficha",
      "source": "https://build.nvidia.com/nvidia/parakeet-1_1b-rnnt-multilingual-asr/api"
    },
    {
      "key": "canary-1b-asr",
      "label": "Canary 1B ASR",
      "model": "nvidia/canary-1b-asr",
      "protocol": "riva-grpc",
      "language": "es-US",
      "availability": "ready",
      "callable": false,
      "spanish": "documentado (multilingüe con traducción; español no verificado en llamada)",
      "audio": "WAV/OPUS/FLAC, mono, 16 bits",
      "punctuation": "no documentado en la ficha",
      "timestamps": "no documentado en la ficha",
      "source": "https://build.nvidia.com/nvidia/canary-1b-asr/api"
    },
    {
      "key": "conformer-ctc-asr",
      "label": "Conformer CTC ASR (español)",
      "model": "nvidia/conformer-ctc-asr",
      "protocol": "riva-grpc",
      "language": "es-US",
      "availability": "ready",
      "callable": false,
      "spanish": "documentado (español, salida en minúsculas)",
      "audio": "WAV/OGG/OPUS, mono, 16 bits",
      "punctuation": "no: la ficha indica salida en minúsculas",
      "timestamps": "no documentado en la ficha",
      "source": "https://build.nvidia.com/nvidia/conformer-ctc-asr/api"
    },
    {
      "key": "parakeet-tdt-0.6b",
      "label": "Parakeet TDT 0.6B",
      "model": "nvidia/parakeet-tdt-0.6b",
      "protocol": "unknown",
      "language": null,
      "availability": "undocumented",
      "callable": false,
      "spanish": "no verificable (sin ficha)",
      "audio": "no documentado",
      "punctuation": "no documentado",
      "timestamps": "no documentado",
      "source": "https://build.nvidia.com/nvidia/parakeet-tdt-0.6b"
    }
  ],
  "voice": [
    {
      "key": "nemotron-voicechat",
      "label": "Nemotron VoiceChat",
      "model": "nvidia/nemotron-voicechat",
      "protocol": "no publicado",
      "availability": "early_access",
      "spanish": "no verificado (la ficha destaca inglés)",
      "source": "https://build.nvidia.com/nvidia/nemotron-voicechat",
      "reason": "La ficha oficial sólo ofrece «Apply for Early Access» y una demo: no publica endpoint, function-id ni protocolo."
    }
  ]
};
