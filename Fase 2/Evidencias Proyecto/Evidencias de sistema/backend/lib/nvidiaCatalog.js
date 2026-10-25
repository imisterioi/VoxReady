// Catálogo VERIFICADO de modelos de voz alojados en NVIDIA Build (build.nvidia.com).
// Cada dato se copió de la ficha oficial; no hay IDs, rutas ni function-ids inventados.
// Si una ficha no publica endpoint ni function-id, el modelo se marca como no disponible.
// Los modelos NO se ejecutan localmente: los ASR de Riva se llaman por gRPC al endpoint
// alojado (`grpc.nvcf.nvidia.com:443`) con el `function-id` de la ficha.
const RIVA_HOST = 'grpc.nvcf.nvidia.com:443';

const AVAILABILITY = {
  READY: 'ready',
  EARLY_ACCESS: 'early_access',
  UNDOCUMENTED: 'undocumented',
};

const ASR_MODELS = [
  {
    key: 'whisper-large-v3',
    model: 'openai/whisper-large-v3',
    label: 'Whisper Large v3 (NVIDIA Build)',
    protocol: 'riva-grpc',
    host: RIVA_HOST,
    functionId: 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d',
    language: 'multi',
    languageNote: 'La ficha usa `--language-code multi` para detección automática y recomienda fijar el idioma.',
    spanish: 'documentado (multilingüe; no probado aquí)',
    audio: 'WAV/OPUS/FLAC, mono, 16 bits',
    punctuation: 'no documentado en la ficha',
    timestamps: 'no documentado en la ficha',
    availability: AVAILABILITY.READY,
    source: 'https://build.nvidia.com/openai/whisper-large-v3/api',
  },
  {
    key: 'parakeet-ctc-0_6b-es',
    model: 'nvidia/parakeet-ctc-0_6b-es',
    label: 'Parakeet CTC 0.6B ES',
    protocol: 'riva-grpc',
    host: RIVA_HOST,
    functionId: 'a9eeee8f-b509-4712-b19d-194361fa5f31',
    language: 'es-US',
    languageNote: 'Ficha específica de español; el ejemplo oficial usa `--language-code es-US`.',
    spanish: 'documentado (modelo de español)',
    audio: 'WAV/OGG/OPUS, mono, 16 bits',
    punctuation: 'documentado: puntuación incluida',
    timestamps: 'documentado: timestamps por palabra',
    availability: AVAILABILITY.READY,
    source: 'https://build.nvidia.com/nvidia/parakeet-ctc-0_6b-es/api',
  },
  {
    key: 'parakeet-1_1b-rnnt-multilingual',
    model: 'nvidia/parakeet-1_1b-rnnt-multilingual-asr',
    label: 'Parakeet 1.1B RNNT multilingüe',
    protocol: 'riva-grpc',
    host: RIVA_HOST,
    functionId: '71203149-d3b7-4460-8231-1be2543a1fca',
    language: 'es-US',
    languageNote: 'La ficha dice «25 idiomas» sin enumerarlos; se envía es-US en la prueba.',
    spanish: 'documentado (multilingüe; español no verificado en llamada)',
    audio: 'WAV/OGG/OPUS, mono, 16 bits',
    punctuation: 'no documentado en la ficha',
    timestamps: 'no documentado en la ficha',
    availability: AVAILABILITY.READY,
    source: 'https://build.nvidia.com/nvidia/parakeet-1_1b-rnnt-multilingual-asr/api',
  },
];

ASR_MODELS.push(
  {
    key: 'canary-1b-asr',
    model: 'nvidia/canary-1b-asr',
    label: 'Canary 1B ASR',
    protocol: 'riva-grpc',
    host: RIVA_HOST,
    functionId: 'b0e8b4a5-217c-40b7-9b96-17d84e666317',
    language: 'es-US',
    languageNote: 'Fuente y destino se eligen con source_language/target_language en custom-configuration.',
    spanish: 'documentado (multilingüe con traducción; español no verificado en llamada)',
    audio: 'WAV/OPUS/FLAC, mono, 16 bits',
    punctuation: 'no documentado en la ficha',
    timestamps: 'no documentado en la ficha',
    availability: AVAILABILITY.READY,
    source: 'https://build.nvidia.com/nvidia/canary-1b-asr/api',
  },
  {
    key: 'conformer-ctc-asr',
    model: 'nvidia/conformer-ctc-asr',
    label: 'Conformer CTC ASR (español)',
    protocol: 'riva-grpc',
    host: RIVA_HOST,
    functionId: '50124cf2-fb60-4a8c-9d25-d85b85199526',
    language: 'es-US',
    languageNote: 'Ficha: transcribe español; el ejemplo usa --language-code es-US.',
    spanish: 'documentado (español, salida en minúsculas)',
    audio: 'WAV/OGG/OPUS, mono, 16 bits',
    punctuation: 'no: la ficha indica salida en minúsculas',
    timestamps: 'no documentado en la ficha',
    availability: AVAILABILITY.READY,
    source: 'https://build.nvidia.com/nvidia/conformer-ctc-asr/api',
  },
  {
    key: 'parakeet-tdt-0.6b',
    model: 'nvidia/parakeet-tdt-0.6b',
    label: 'Parakeet TDT 0.6B',
    protocol: 'unknown',
    host: null,
    functionId: null,
    language: null,
    languageNote: 'La página pública no devolvió ficha ni instrucciones de API.',
    spanish: 'no verificable (sin ficha)',
    audio: 'no documentado',
    punctuation: 'no documentado',
    timestamps: 'no documentado',
    availability: AVAILABILITY.UNDOCUMENTED,
    source: 'https://build.nvidia.com/nvidia/parakeet-tdt-0.6b',
  },
);

const VOICE_MODELS = [
  {
    key: 'nemotron-voicechat',
    model: 'nvidia/nemotron-voicechat',
    label: 'Nemotron VoiceChat',
    // La ficha sólo ofrece «Apply for Early Access» y una demo: no publica endpoint,
    // ni function-id, ni formato de mensajes. No se inventa un WebRTC/WS.
    protocol: 'no publicado',
    host: null,
    functionId: null,
    availability: AVAILABILITY.EARLY_ACCESS,
    spanish: 'no verificado (la ficha destaca inglés)',
    source: 'https://build.nvidia.com/nvidia/nemotron-voicechat',
  },
];

function asrModel(key) {
  return ASR_MODELS.find((model) => model.key === key) || null;
}

function voiceModel(key) {
  return VOICE_MODELS.find((model) => model.key === key) || null;
}

// Un modelo ASR se puede llamar sólo si tiene host + function-id publicados.
function isCallable(model) {
  return Boolean(model && model.availability === AVAILABILITY.READY && model.host && model.functionId);
}

module.exports = { ASR_MODELS, VOICE_MODELS, AVAILABILITY, RIVA_HOST, asrModel, voiceModel, isCallable };

