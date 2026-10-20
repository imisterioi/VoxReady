// Captura de medios de una práctica: creación del grabador de audio, parada ordenada,
// construcción del Blob y subida.
//
// POR QUÉ EXISTE ESTE MÓDULO
// Se reprodujo en un navegador real (Edge/Chromium 155) que un `MediaRecorder` con un MIME
// *solo de audio* (`audio/webm;codecs=opus`) sobre un `MediaStream` **mixto** (cámara +
// micrófono) construye bien pero falla al arrancar:
//     NotSupportedError: Failed to execute 'start' on 'MediaRecorder'
// No depende del bitrate ni del MIME: con `new MediaStream(stream.getAudioTracks())`
// arranca y entrega datos. Por eso el grabador de audio SIEMPRE usa un stream solo-audio.
//
// El módulo no toca el DOM directamente: recibe las factorías (MediaRecorder, MediaStream,
// Blob, fetch) para poder probarse sin navegador.

export const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

const codedError = (code, cause) => {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
};

// Primer MIME que el navegador declara soportado (o null si ninguno).
export function pickSupportedMime(isSupported, candidates = AUDIO_MIME_CANDIDATES) {
  if (typeof isSupported !== 'function') return null;
  for (const mime of candidates) {
    try {
      if (isSupported(mime)) return mime;
    } catch {
      /* un navegador puede lanzar con tipos raros: se ignora */
    }
  }
  return null;
}

// Stream con SOLO las pistas de audio vivas. Es la corrección del fallo reproducido.
export function audioOnlyStream(stream, StreamCtor = globalThis.MediaStream) {
  const tracks = typeof stream?.getAudioTracks === 'function' ? stream.getAudioTracks() : [];
  const live = tracks.filter((track) => {
    const state = track?.readyState;
    return !state || state === 'live';
  });
  if (!live.length) throw codedError('AUDIO_TRACK_MISSING');
  if (typeof StreamCtor !== 'function') throw codedError('MEDIASTREAM_UNAVAILABLE');
  return new StreamCtor(live);
}

// Crea y arranca el grabador de audio. Lanza errores con `code` para poder diagnosticar.
export function startAudioRecorder({
  stream,
  MediaRecorderCtor = globalThis.MediaRecorder,
  isSupported = MediaRecorderCtor?.isTypeSupported?.bind(MediaRecorderCtor),
  StreamCtor = globalThis.MediaStream,
  bitrate = 32000,
  onData,
  onError,
} = {}) {
  const mime = pickSupportedMime(isSupported);
  if (!mime) throw codedError('AUDIO_MIME_UNSUPPORTED');
  if (typeof MediaRecorderCtor !== 'function') throw codedError('MEDIARECORDER_UNAVAILABLE');

  const audioStream = audioOnlyStream(stream, StreamCtor);

  let recorder;
  try {
    recorder = new MediaRecorderCtor(audioStream, { mimeType: mime, audioBitsPerSecond: bitrate });
  } catch (error) {
    throw codedError('AUDIO_RECORDER_ERROR', error);
  }

  recorder.ondataavailable = (event) => {
    if (event?.data?.size) onData?.(event.data);
  };
  if (typeof onError === 'function') {
    recorder.onerror = (event) => onError(event?.error || codedError('AUDIO_RECORDER_ERROR'));
  }

  try {
    recorder.start(1000);
  } catch (error) {
    throw codedError('AUDIO_RECORDER_START_FAILED', error);
  }
  if (recorder.state !== 'recording') throw codedError('AUDIO_RECORDER_NOT_STARTED');

  return { recorder, stream: audioStream, mime };
}

// Detiene el grabador y espera al evento `stop` (los `dataavailable` finales llegan antes).
export function stopAndWait(recorder) {
  return new Promise((resolve) => {
    if (!recorder || recorder.state === 'inactive') return resolve(false);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(true);
    };
    recorder.onstop = finish;
    if (typeof recorder.addEventListener === 'function') recorder.addEventListener('stop', finish);
    try {
      recorder.stop();
    } catch {
      finish();
    }
  });
}

export function buildBlob(chunks, type, BlobCtor = globalThis.Blob) {
  return new BlobCtor(Array.isArray(chunks) ? chunks : [], { type });
}

// Detiene los grabadores que sigan activos (descarte, salida de la práctica).
// Devuelve cuántos se detuvieron. Nunca lanza: un grabador ya cerrado no es un problema.
export function stopAll(recorders = []) {
  let stopped = 0;
  for (const recorder of recorders) {
    try {
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
        stopped += 1;
      }
    } catch {
      /* ya estaba cerrado o el navegador lo rechazó: se ignora */
    }
  }
  return stopped;
}

// Sube un Blob y devuelve un resultado explícito. NUNCA lanza y nunca registra el token.
export async function uploadBlob({ url, blob, type, fetchImpl = globalThis.fetch } = {}) {
  if (!blob || !blob.size) return { ok: false, reason: 'EMPTY', bytes: 0 };
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: blob,
    });
    if (!response?.ok) {
      return { ok: false, reason: 'HTTP', status: response?.status ?? null, bytes: blob.size };
    }
    return { ok: true, status: response.status, bytes: blob.size };
  } catch (error) {
    return { ok: false, reason: 'NETWORK', error: error?.name || 'Error', bytes: blob.size };
  }
}
