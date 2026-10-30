// Actualización automática del catálogo de escenarios al cambiar de idioma.
//
// El catálogo lo filtra el BACKEND según el idioma del usuario, así que el frontend debe volver a
// PEDIRLO cuando el idioma efectivo cambia (no basta con re-renderizar). Estas comprobaciones son
// estáticas sobre el código real (el repositorio no tiene entorno de DOM) y complementan la prueba
// pura de `languageChanged`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { effectiveCode, languageChanged } from './language.js';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const catalog = read('../pages/ElegirEscenario.jsx');
const i18n = read('./i18n.jsx');

test('el catálogo usa la señal de idioma aplicado que expone el proveedor i18n', () => {
  assert.match(catalog, /const\s*\{[^}]*langVersion[^}]*\}\s*=\s*useI18n\(\)/, 'ElegirEscenario debe leer langVersion');
  assert.match(i18n, /langVersion/, 'el proveedor debe exponer langVersion');
  assert.match(i18n, /languageChanged/, 'el proveedor debe invalidar usando la regla pura languageChanged');
});

test('el catálogo se vuelve a pedir cuando cambia el idioma aplicado', () => {
  const effect = catalog.match(/useEffect\([\s\S]*?\[intento,\s*langVersion\]\s*\)/);
  assert.ok(effect, 'debe existir un efecto de carga cuyas dependencias incluyan langVersion');
  assert.match(effect[0], /apiGet\('\/api\/scenarios\/my'\)/, 'la recarga usa el endpoint real (filtrado del backend)');
});

test('al cambiar de idioma se descarta el catálogo anterior (no se mezclan idiomas)', () => {
  const clear = catalog.match(/useEffect\([\s\S]*?setEscenarios\(\[\]\)[\s\S]*?\[lang\]\s*\)/);
  assert.ok(clear, 'al cambiar lang debe vaciarse el catálogo anterior y mostrarse la carga');
  assert.match(clear[0], /setCargando\(true\)/, 'mientras llega el catálogo nuevo se muestra el estado de carga');
});

test('la actualización no depende de navegar, recargar ni cerrar sesión', () => {
  assert.doesNotMatch(catalog, /window\.location\.(reload|assign|href)/, 'no debe recargar la página');
  assert.doesNotMatch(catalog, /clearSession\(\)/, 'no debe cerrar sesión');
  assert.doesNotMatch(catalog, /useNavigate\(\)[\s\S]{0,400}langVersion/, 'no debe navegar fuera al cambiar el idioma');
});

test('el filtrado por idioma NO se hace en el frontend', () => {
  // La lista visible se filtra por búsqueda y categoría, nunca por idioma del escenario.
  const filtered = catalog.match(/const escenariosFiltrados = useMemo\([\s\S]*?\}, \[[^\]]*\]\);/);
  assert.ok(filtered, 'debe existir el filtro de la lista visible');
  assert.doesNotMatch(filtered[0], /language/, 'el idioma del escenario no decide qué se muestra');
  assert.match(catalog, /apiGet\('\/api\/scenarios\/my'\)/, 'el backend sigue filtrando el catálogo');
});

test('el reintento manual sigue funcionando y no provoca ciclos', () => {
  assert.match(catalog, /setIntento\(\(n\) => n \+ 1\)/, 'el botón de reintento sigue disponible');
  // Las dependencias del efecto son valores estables (contadores), no objetos que cambien en cada render.
  assert.doesNotMatch(catalog, /\[intento,\s*langVersion,\s*d\]/, 'el diccionario no debe ir en las dependencias');
});

test('simulación del cambio de idioma: se refresca al cambiar y no al re-aplicar el mismo', () => {
  // Modela la regla real (`languageChanged`) que gobierna `langVersion`.
  let applied = 'es';
  const refreshes = [];
  const applyLanguage = (next) => {
    if (languageChanged(applied, next)) {
      applied = effectiveCode(next);
      refreshes.push(applied);
    }
  };

  applyLanguage('en'); // 1) español → inglés
  applyLanguage('es'); // 2) inglés → español
  applyLanguage('en'); // 3) español → inglés otra vez
  applyLanguage('en'); // re-aplicar el mismo idioma: sin petición nueva
  assert.deepEqual(refreshes, ['en', 'es', 'en'], 'una recarga por cambio real, ninguna por repetir el mismo idioma');
});
