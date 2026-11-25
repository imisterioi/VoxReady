// Portadas de los videos de microlección.
//
// Este módulo NO depende del DOM al importarse, así que se puede probar en Node. Las funciones que
// usan el navegador (`extractVideoFrame`) solo acceden a `document` cuando se las llama.
//
// Reglas:
//  - La portada de YouTube se construye ÚNICAMENTE a partir del identificador ya validado del video
//    (11 caracteres), nunca de una URL arbitraria introducida por el usuario.
//  - El primer fotograma de un archivo subido se obtiene en el NAVEGADOR (canvas) desde el propio
//    archivo o su URL: no se sube nada al backend para generar la previsualización.

const YOUTUBE_POSTER_HOST = 'https://i.ytimg.com/vi';
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

// Imágenes de portada disponibles para un vídeo de YouTube, ordenadas de mayor a menor resolución.
// Devuelve [] si el identificador no es válido (nunca se inventa una ruta).
//  - quality 'max' (por defecto): comienza en `maxresdefault` (portada grande, para el formulario).
//  - quality 'sd': comienza en `hqdefault` (suficiente para una miniatura de tarjeta y evita el
//    404 que YouTube devuelve en los vídeos que no tienen `maxresdefault`). Es la MISMA estrategia:
//    mismas candidatas de i.ytimg.com por identificador validado, con la misma caída en cascada.
export function youtubePosterCandidates(videoId, { quality = 'max' } = {}) {
  const id = typeof videoId === 'string' ? videoId.trim() : '';
  if (!YOUTUBE_ID.test(id)) return [];
  const sizes = quality === 'sd' ? ['hqdefault', 'mqdefault'] : ['maxresdefault', 'hqdefault', 'mqdefault'];
  return sizes.map((size) => `${YOUTUBE_POSTER_HOST}/${id}/${size}.jpg`);
}

// Extrae el primer fotograma de un vídeo como dataURL (JPEG) usando un canvas local.
// `source` puede ser un File/Blob (se crea y se libera su ObjectURL aquí) o una URL.
// Devuelve `null` —sin lanzar— cuando el navegador no puede decodificar el vídeo o tarda demasiado,
// para que la interfaz muestre un estado alternativo en lugar de romperse.
export function extractVideoFrame(source, { seekTo = 0.1, timeoutMs = 8000, width = 480, crossOrigin = true } = {}) {
  return new Promise((resolve) => {
    if (!source || typeof document === 'undefined') {
      resolve(null);
      return;
    }

    const ownsUrl = typeof source !== 'string';
    let url = source;
    if (ownsUrl) {
      try {
        url = URL.createObjectURL(source);
      } catch {
        resolve(null);
        return;
      }
    }

    const video = document.createElement('video');
    let finished = false;
    let timer = null;

    const cleanup = (result) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      try {
        video.removeAttribute('src');
        video.load();
      } catch {
        /* best-effort */
      }
      if (ownsUrl) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* best-effort */
        }
      }
      resolve(result);
    };

    const capture = () => {
      try {
        const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = Math.max(1, Math.round(width / ratio));
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        cleanup(canvas.toDataURL('image/jpeg', 0.72));
      } catch {
        // Canvas «manchado» o vídeo no decodificable: no hay fotograma utilizable.
        cleanup(null);
      }
    };

    timer = setTimeout(() => cleanup(null), timeoutMs);
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    if (crossOrigin) video.crossOrigin = 'anonymous';
    video.addEventListener('error', () => cleanup(null));
    video.addEventListener('seeked', capture);
    video.addEventListener('loadeddata', () => {
      // Un pequeño avance garantiza un fotograma pintado en todos los navegadores.
      try {
        if (Number.isFinite(video.duration) && video.duration > seekTo) video.currentTime = seekTo;
        else capture();
      } catch {
        capture();
      }
    });
    video.src = url;
  });
}
