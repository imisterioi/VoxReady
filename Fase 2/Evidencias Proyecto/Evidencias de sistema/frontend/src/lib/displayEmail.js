// Presentación VISUAL del correo de un usuario. Nunca modifica el dato: solo el texto que se pinta.
//
// Los usuarios anonimizados reciben un correo generado `anon+<id>@removed.local`
// (ver backend/lib/anonymize.js). Se abrevia para que no rompa la maquetación de las tarjetas y
// siga permitiendo distinguir unos registros de otros (se conservan los primeros caracteres del id).
const ANON_EMAIL = /^anon\+([^@]+)@removed\.local$/i;

export function isAnonymizedEmail(email) {
  return ANON_EMAIL.test(String(email || ''));
}

export function displayEmail(user, { visibleChars = 3 } = {}) {
  const email = typeof user === 'string' ? user : user?.email;
  if (!email) return '';
  const match = ANON_EMAIL.exec(String(email));
  if (!match) return String(email); // correo normal: se muestra tal cual
  const id = match[1];
  const head = id.slice(0, Math.max(1, Math.min(visibleChars, id.length)));
  return `anon+${head}...@removed.local`;
}
