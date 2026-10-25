// El aviso de los 60 s es SOLO de interfaz: informa de que el informe continúa preparándose en
// segundo plano y dónde consultarlo. No cancela la evaluación ni modifica el backend.
// Se comprueba sobre el código real de la pantalla (las pruebas no tienen DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../pages/Analizando.jsx', import.meta.url), 'utf8');

// Efecto que dispara el aviso: desde su comentario hasta el cierre de dependencias.
function noticeEffect() {
  const start = source.indexOf('// Objetivo de experiencia');
  assert.ok(start > 0, 'el aviso debe existir en la pantalla');
  const end = source.indexOf('}, [error]);', start);
  assert.ok(end > start, 'el efecto del aviso debe estar completo');
  return source.slice(start, end);
}

test('el aviso aparece al superar 60 segundos', () => {
  const effect = noticeEffect();
  assert.match(effect, /setTimeout\(\(\) => setSlow\(true\), 60000\)/, 'se dispara a los 60 s');
  assert.match(source, /const pending = slow && !done && !error;/, 'solo se muestra mientras sigue pendiente');
  assert.match(source, /PENDING_TITLE/);
  assert.match(source, /PENDING_MESSAGE/);
});

test('si el sondeo del cliente se agota, la pantalla avisa de que sigue en segundo plano', () => {
  // El resultado 'pending' del runner NO es un error: muestra el aviso y ofrece salir a Mi progreso.
  assert.match(source, /result\.status === 'pending'\) setSlow\(true\)/, 'el sondeo agotado no marca error');
  assert.match(source, /to="\/vocero\/progreso"/, 'el vocero puede salir y consultarlo después');
  assert.ok(!/TIMEOUT/.test(source), 'ya no hay un mensaje de timeout del cliente que sugiera fallo');
  assert.ok(!/setError[\s\S]{0,80}pending/.test(source), 'el aviso no se muestra como error');
});

test('el efecto del aviso solo cambia el mensaje: no pide nada ni toca el estado', () => {
  const effect = noticeEffect();
  assert.ok(!/abort\(/.test(effect), 'el aviso no cancela la ejecución');
  assert.ok(!/apiFetch|fetch\(/.test(effect), 'el aviso no hace peticiones');
  assert.ok(!/evaluate/.test(effect), 'el aviso no vuelve a pedir la evaluación');
  assert.ok(!/setError/.test(effect), 'el aviso no es un error');
  assert.ok(!/attempt/.test(effect), 'el aviso no incrementa intentos');
  assert.match(effect, /clearTimeout\(id\)/, 'solo limpia su propio temporizador');
});
test('la pantalla no cancela el trabajo del backend: solo se cancela la ejecución local', () => {
  // Los únicos `abort()` son de la ejecución local (cleanup de React/StrictMode) sobre el controlador
  // del propio componente: no existe ninguna llamada que cancele la evaluación del backend.
  const abortCalls = source.match(/\.abort\(\)/g) || [];
  assert.ok(abortCalls.length > 0, 'se cancela la ejecución local al desmontar');
  assert.ok(!/apiFetch\([^)]*cancel/i.test(source), 'no hay ninguna petición de cancelación al backend');
  assert.match(source, /runRef\.current\?\.abort\(\)/, 'el cleanup usa el controlador local');
});
