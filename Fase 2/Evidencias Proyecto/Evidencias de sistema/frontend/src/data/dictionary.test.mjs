// Guarda de cobertura de traducciones.
//
// El sistema de i18n elige el diccionario del idioma activo: si un idioma no declara una clave, la
// pantalla muestra `undefined` (o una clave interna). Esta prueba impide que eso ocurra:
//   1. todos los idiomas habilitados tienen diccionario;
//   2. los diccionarios declaran EXACTAMENTE las mismas claves, con la misma forma;
//   3. ningún texto queda vacío.
import test from 'node:test';
import assert from 'node:assert/strict';
import dictionary from './dictionary.js';
import { LANGUAGE_CODES } from '../lib/language.js';

// Forma de un diccionario: lista de rutas con el tipo de valor final ('string' | 'function' | …).
const shape = (value, path = '', out = []) => {
  if (Array.isArray(value)) {
    out.push(`${path}[]`);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) shape(value[key], path ? `${path}.${key}` : key, out);
    return out;
  }
  out.push(`${path}:${typeof value}`);
  return out;
};

test('todos los idiomas habilitados tienen diccionario', () => {
  assert.ok(LANGUAGE_CODES.length >= 2, 'debe haber al menos dos idiomas habilitados');
  for (const code of LANGUAGE_CODES) {
    assert.ok(dictionary[code], `falta el diccionario del idioma «${code}»`);
  }
});

test('los diccionarios declaran las mismas claves (misma forma)', () => {
  const [base, ...others] = LANGUAGE_CODES;
  const reference = shape(dictionary[base]).sort();
  for (const code of others) {
    const current = shape(dictionary[code]).sort();
    const missing = reference.filter((key) => !current.includes(key));
    const extra = current.filter((key) => !reference.includes(key));
    assert.deepEqual(missing, [], `claves que faltan en «${code}»`);
    assert.deepEqual(extra, [], `claves que sobran en «${code}»`);
  }
});

test('ningún texto del diccionario está vacío', () => {
  const walk = (value, code, path) => {
    if (typeof value === 'string') {
      assert.ok(value.trim().length > 0, `texto vacío en «${code}»: ${path}`);
      return;
    }
    if (Array.isArray(value) || typeof value === 'function') return;
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) walk(value[key], code, `${path}.${key}`);
    }
  };
  for (const code of LANGUAGE_CODES) walk(dictionary[code], code, code);
});

test('los textos de interfaz no exponen claves internas ni marcadores sin resolver', () => {
  const walk = (value, code, path) => {
    if (typeof value === 'string') {
      assert.doesNotMatch(value, /\bundefined\b|\bnull\b|\{\{|\}\}/, `texto sospechoso en «${code}»: ${path}`);
      return;
    }
    if (Array.isArray(value) || typeof value === 'function') return;
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) walk(value[key], code, `${path}.${key}`);
    }
  };
  for (const code of LANGUAGE_CODES) walk(dictionary[code], code, code);
});
