// Guarda la paleta de la organización (PUT /api/tenant/branding). La usan la página
// Estilo y los colores de muestra del header cuando quien elige es el administrador.
import { apiFetch, getCurrentUser, getToken, saveSession } from './api';
import { DEFAULT_PALETTE, normalizePalette, samePalette, setOrgPalette, setPreviewPalette } from './palette';

export async function saveOrgPalette(palette) {
  const isDefault = samePalette(palette, DEFAULT_PALETTE);
  const body = isDefault ? { brandColor: null, accentColor: null } : { brandColor: palette.brand, accentColor: palette.accent };
  await apiFetch('/api/tenant/branding', { method: 'PUT', body });

  // La sesión guardada también lleva la paleta, para aplicarla al recargar
  const saved = isDefault ? null : normalizePalette(palette);
  const user = getCurrentUser();
  if (user) saveSession(getToken(), { ...user, palette: saved });
  setOrgPalette(saved);
  setPreviewPalette(null);
  return { isDefault };
}
