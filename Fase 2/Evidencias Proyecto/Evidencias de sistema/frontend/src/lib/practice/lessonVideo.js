// URL del video de UNA microlección. Se entrega por la ruta protegida del backend
// (`/api/micro-lessons/:id/video`), que exige sesión válida: no hay ruta pública ni enlace externo.
// `apiUrl` y `token` se reciben como parámetros para poder probar el módulo en Node.
export function lessonVideoUrl(lessonId, { apiUrl, token } = {}) {
  if (!lessonId || !apiUrl) return null;
  return `${apiUrl}/api/micro-lessons/${encodeURIComponent(lessonId)}/video?token=${encodeURIComponent(token || '')}`;
}

// ------------------------------------------- Enlaces externos (YouTube)
// Solo se aceptan enlaces de YouTube por HTTPS. Devuelve { provider, videoId, embedUrl, watchUrl }
// o null si el enlace no es admisible. La reproducción integrada se construye SIEMPRE desde el
// identificador extraído (youtube-nocookie.com): nunca se inyecta la URL del usuario tal cual, así
// que no se ejecuta contenido arbitrario ni se abren sitios externos automáticamente.
const YOUTUBE_HOSTS = [
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be',
];
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseLessonVideoUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.includes(host)) return null;

  let videoId = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] || null;
  } else if (url.pathname === '/watch') {
    videoId = url.searchParams.get('v');
  } else {
    const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
    if (match) videoId = match[1];
  }
  if (!videoId || !YOUTUBE_ID.test(videoId)) return null;

  return {
    provider: 'youtube',
    videoId,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
