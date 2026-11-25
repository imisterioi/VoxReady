// Hooks reutilizables para mostrar la portada de una microlección (catálogo del vocero y formulario de
// administración). Reutilizan `lib/practice/lessonPoster.js`, así que la lógica de portadas de YouTube y
// de extracción del primer fotograma NO se duplica en cada pantalla.
//
// Ninguno reproduce el vídeo: solo obtienen una imagen para mostrarla.
import { useEffect, useState } from 'react';
import { extractVideoFrame, youtubePosterCandidates } from '../lib/practice/lessonPoster';

// Primer fotograma de un vídeo. `source` es un File/Blob (archivo recién elegido) o una URL (video ya
// guardado, servido por su ruta protegida). Devuelve { status, frame }: status es 'idle' (sin fuente),
// 'loading', 'ok' (frame es un dataURL) o 'none' (no se pudo obtener). Nunca lanza.
export function useVideoFrame(source) {
  const [state, setState] = useState({ status: 'idle', frame: null });

  useEffect(() => {
    if (!source) {
      setState({ status: 'idle', frame: null });
      return undefined;
    }
    let active = true;
    setState({ status: 'loading', frame: null });
    extractVideoFrame(source).then((frame) => {
      if (active) setState({ status: frame ? 'ok' : 'none', frame });
    });
    return () => {
      active = false;
    };
  }, [source]);

  return state;
}

// Portada de un vídeo de YouTube. `externalLink` es el resultado de `parseLessonVideoUrl` (o null).
// `quality`: 'max' (por defecto, portada grande para el formulario) o 'sd' (miniaturas de tarjeta).
// Devuelve { url, exhausted, onError }:
//   - url: la candidata actual o null si no hay candidatas.
//   - onError: pasa a la siguiente candidata (se usa en el `onError` del <img>).
//   - exhausted: true cuando ninguna candidata cargó (el llamador muestra un estado alternativo).
export function useYoutubePoster(externalLink, { quality = 'max' } = {}) {
  const candidates = externalLink ? youtubePosterCandidates(externalLink.videoId, { quality }) : [];
  const videoId = externalLink ? externalLink.videoId : null;
  const [index, setIndex] = useState(0);

  // Al cambiar de vídeo se vuelve a empezar por la portada de mayor calidad.
  useEffect(() => {
    setIndex(0);
  }, [videoId]);

  return {
    url: index < candidates.length ? candidates[index] : null,
    exhausted: candidates.length > 0 && index >= candidates.length,
    onError: () => setIndex((current) => current + 1),
  };
}
