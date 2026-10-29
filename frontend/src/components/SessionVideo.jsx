import { useEffect, useState } from 'react';
import Icon from './Icon';
import { cx } from './ui';
import { API_URL, DEMO_MODE, getToken } from '../lib/api';
import { sessionVideoUrl } from '../lib/practice/sessionVideo';
import { demoVideoUrl } from '../demo/server';

// Reproductor de la grabación de una sesión (GET /api/sessions/:id/video).
// - La URL se construye con el ID de la sesión mostrada: no hay respaldo a otra sesión.
// - SIN reflejo: el vídeo grabado conserva su orientación y los controles nativos quedan
//   en su sitio (el espejo es solo de la vista previa en vivo).
// Las grabaciones del navegador (WebM de MediaRecorder) no traen su duración:
// se fuerza el cálculo saltando al final y volviendo al inicio, así la barra
// de avance funciona.
export default function SessionVideo({ sessionId, className }) {
  const [failed, setFailed] = useState(false);
  // En la demo la grabación solo existe en la pestaña donde se hizo la práctica
  const src = DEMO_MODE ? demoVideoUrl(sessionId) : sessionVideoUrl(sessionId, { apiUrl: API_URL, token: getToken() });

  // Al cambiar de sesión se descarta el estado del vídeo anterior: si la sesión A falló,
  // no debe mostrarse "no disponible" en la sesión B.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const fixDuration = (e) => {
    const video = e.currentTarget;
    if (video.duration !== Infinity) return;
    const restore = () => {
      video.removeEventListener('timeupdate', restore);
      video.currentTime = 0;
    };
    video.addEventListener('timeupdate', restore);
    video.currentTime = 1e101;
  };

  if (!src || failed) {
    return (
      <div className={cx('aspect-video bg-subtle/60 flex flex-col items-center justify-center gap-2 text-center px-6', className)}>
        <Icon name="video" size={24} className="text-faint" />
        <p className="text-sm text-muted">No hay grabación disponible.</p>
        <p className="text-xs text-faint">
          {DEMO_MODE
            ? 'En la versión de demostración, la grabación solo se puede ver en la misma pestaña donde se realizó la práctica.'
            : 'Pudo no haberse subido, o se eliminó según la política de retención de la organización.'}
        </p>
      </div>
    );
  }

  return (
    <video
      key={src}
      controls
      controlsList="nodownload noplaybackrate"
      disablePictureInPicture
      onContextMenu={(event) => event.preventDefault()}
      preload="metadata"
      className={cx('w-full aspect-video bg-[#0B1118]', className)}
      src={src}
      onLoadedMetadata={fixDuration}
      onError={() => setFailed(true)}
    />
  );
}

