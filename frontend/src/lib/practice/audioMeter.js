// Medición de la voz con Web Audio (sin enviar audio a ningún servidor).
// Mide por respuesta: tiempo hasta empezar a hablar, tiempo hablando,
// pausas largas y variación del volumen (monotonía).

const SAMPLE_MS = 100; // una muestra cada 100 ms
const LONG_PAUSE_MS = 1500; // silencio que cuenta como "pausa larga"

export default class AudioMeter {
  constructor(stream) {
    this.available = false;
    this.level = 0; // 0-1, para mostrar en pantalla
    this.lastVoiceAt = 0;
    this.noiseFloor = 0.01;
    this.answer = null;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioCtx();
      const source = this.context.createMediaStreamSource(stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      source.connect(this.analyser);
      this.buffer = new Float32Array(this.analyser.fftSize);
      this.timer = setInterval(() => this.sample(), SAMPLE_MS);
      this.available = true;
    } catch (error) {
      console.warn('No se pudo medir el audio:', error);
    }
  }

  // Volumen RMS actual y detección de voz con umbral adaptativo al ruido del ambiente
  sample() {
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (const v of this.buffer) sum += v * v;
    const rms = Math.sqrt(sum / this.buffer.length);

    // El piso de ruido baja rápido y sube lento (se adapta al silencio de la sala)
    this.noiseFloor = rms < this.noiseFloor ? rms : this.noiseFloor * 0.995 + rms * 0.005;
    const threshold = Math.max(0.012, this.noiseFloor * 3);
    const speaking = rms > threshold;

    const now = performance.now();
    this.level = Math.min(1, rms / 0.15);
    if (speaking) this.lastVoiceAt = now;

    if (this.answer && !this.answer.paused) this.answer.samples.push({ t: now, rms, speaking });
  }

  isSpeakingRecently(ms = 400) {
    return performance.now() - this.lastVoiceAt < ms;
  }

  startAnswer() {
    this.answer = { startedAt: performance.now(), samples: [], paused: false };
    this.context?.resume?.();
  }

  // Mientras el entrevistador repite la pregunta no se mide
  pause() {
    if (this.answer) this.answer.paused = true;
  }

  resume() {
    if (this.answer) this.answer.paused = false;
  }

  // Resultado de la respuesta actual
  endAnswer() {
    const answer = this.answer;
    this.answer = null;
    if (!answer || !this.available) return null;

    const { samples, startedAt } = answer;
    const voiced = samples.filter((s) => s.speaking);
    const firstVoice = voiced[0];

    // Pausas largas: silencios entre dos momentos con voz
    let longPauses = 0;
    let lastVoiceT = null;
    for (const s of samples) {
      if (!s.speaking) continue;
      if (lastVoiceT != null && s.t - lastVoiceT > LONG_PAUSE_MS) longPauses += 1;
      lastVoiceT = s.t;
    }

    const volumes = voiced.map((s) => s.rms);
    const mean = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1);
    const variance = volumes.reduce((a, b) => a + (b - mean) ** 2, 0) / (volumes.length || 1);

    return {
      durationMs: Math.round((samples.at(-1)?.t ?? startedAt) - startedAt),
      speakingMs: voiced.length * SAMPLE_MS,
      latencyMs: firstVoice ? Math.round(firstVoice.t - startedAt) : null,
      longPauses,
      volumeMean: mean,
      volumeVariation: volumes.length > 5 ? Math.sqrt(variance) / mean : null, // coeficiente de variación
    };
  }

  destroy() {
    clearInterval(this.timer);
    this.context?.close?.().catch(() => {});
  }
}
