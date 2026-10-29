// Audio PCM para el laboratorio «En tiempo real».
//
// POR QUÉ PCM Y NO `MediaRecorder.start(timeslice)`
// Un solo MediaRecorder WebM entrega en `dataavailable` fragmentos que NO son
// decodificables por separado: solo el primero lleva la cabecera EBML y los siguientes
// son continuación del flujo. Enviarlos a Whisper produce "no se pudo decodificar
// el audio". Reiniciar el MediaRecorder cada N segundos sí produce Blobs válidos, pero
// deja un hueco de decenas o cientos de milisegundos en cada corte.
//
// Aquí el video se graba con UN MediaRecorder continuo (el WebM de la sesión) y, del
// MISMO MediaStream, se toman muestras PCM con Web Audio. Cada fragmento se codifica
// como WAV 16 bits mono: formato aceptado por /api/lab/transcribe y decodificable.
// Ventajas: sin huecos entre fragmentos y cortes exactos por número de muestras.
// Limitación conocida: se envía a la frecuencia nativa del AudioContext (48 kHz en
// Windows); no se remuestrea en el navegador para no introducir aliasing, y el
// servicio se encarga de remuestrear a 16 kHz.

const RIFF_HEADER_BYTES = 44;

// Codifica muestras float32 [-1, 1] como WAV PCM 16 bits mono.
export function encodeWav(samples, sampleRate) {
  if (!samples || typeof samples.length !== 'number') throw new Error('muestras no válidas');
  const rate = Math.round(Number(sampleRate));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('frecuencia de muestreo no válida');

  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(RIFF_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // tamaño del bloque fmt
  view.setUint16(20, 1, true); // PCM entero
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes por segundo
  view.setUint16(32, 2, true); // alineación de bloque
  view.setUint16(34, 16, true); // bits por muestra
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(RIFF_HEADER_BYTES + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

// Acumula muestras y emite fragmentos de duración fija (más un resto al final).
// `offsetMs` es el instante del primer sample del fragmento dentro de la sesión: es la
// referencia temporal que permite situar el texto en el audio.
export function createPcmCollector({ sampleRate, chunkSeconds = 6, onChunk } = {}) {
  const rate = Math.round(Number(sampleRate));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('frecuencia de muestreo no válida');
  const chunkSamples = Math.max(1, Math.round(rate * Math.max(0.5, Number(chunkSeconds) || 6)));

  let buffer = new Float32Array(chunkSamples);
  let filled = 0;
  let flushedSamples = 0;
  let emitted = 0;

  function flush() {
    if (!filled) return null;
    const samples = buffer.subarray(0, filled).slice();
    const durationMs = Math.round((samples.length / rate) * 1000);
    const offsetMs = Math.round((flushedSamples / rate) * 1000);
    flushedSamples += samples.length;
    filled = 0;
    emitted += 1;
    const chunk = { samples, sampleRate: rate, durationMs, offsetMs, index: emitted - 1 };
    onChunk?.(chunk);
    return chunk;
  }

  return {
    push(input) {
      if (!input || typeof input.length !== 'number' || !input.length) return;
      let i = 0;
      while (i < input.length) {
        const take = Math.min(chunkSamples - filled, input.length - i);
        buffer.set(input.subarray(i, i + take), filled);
        filled += take;
        i += take;
        if (filled === chunkSamples) flush();
      }
    },
    flush,
    get capturedMs() {
      return Math.round(((flushedSamples + filled) / rate) * 1000);
    },
    get pendingMs() {
      return Math.round((filled / rate) * 1000);
    },
    get chunks() {
      return emitted;
    },
  };
}
