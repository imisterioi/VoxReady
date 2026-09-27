import { useState } from 'react';
import Icon from './Icon';
import { API_URL, getToken } from '../lib/api';
import { cx } from './ui';

// Reproductor de la grabación de una sesión (GET /api/sessions/:id/video).
// Las grabaciones del navegador (WebM de MediaRecorder) no traen su duración:
// se fuerza el cálculo saltando al final y volviendo al inicio, así la barra
// de avance funciona.
export default function SessionVideo({ sessionId, className }) {
  const [failed, setFailed] = useState(false);
  const src = `${API_URL}/api/sessions/${sessionId}/video?token=${encodeURIComponent(getToken() || '')}`;

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

  if (failed) {
    return (
      <div className={cx('aspect-video bg-subtle/60 flex flex-col items-center justify-center gap-2 text-center px-6', className)}>
        <Icon name="video" size={24} className="text-faint" />
        <p className="text-sm text-muted">No hay grabación disponible.</p>
        <p className="text-xs text-faint">Pudo no haberse subido, o se eliminó según la política de retención de la organización.</p>
      </div>
    );
  }

  return (
    <video
      controls
      preload="metadata"
      className={cx('w-full aspect-video bg-[#0B1118] -scale-x-100', className)}
      src={src}
      onLoadedMetadata={fixDuration}
      onError={() => setFailed(true)}
    />
  );
}
