// Guarda contra errores de tipo en el diccionario («x is not a function»).
//
// Si una pantalla hace `const t = d.L.u3;` y luego llama `t.algo(...)`, esa clave del diccionario
// debe ser una FUNCIÓN en todos los idiomas habilitados. Cuando es texto, el render lanza
// «t.algo is not a function», React desmonta el árbol y la pantalla queda en negro.
// Este test descubre ese caso en cualquier pantalla, sin mantener una lista a mano.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import dictionary from '../data/dictionary.js';
import { LANGUAGE_CODES } from './language.js';

const SRC = new URL('..', import.meta.url);

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx|js)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
};

const files = walk(SRC).filter((url) => !url.pathname.includes('/data/'));

const resolve = (code, path) =>
  path.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), dictionary[code]);

test('las claves del diccionario llamadas como función son funciones en todos los idiomas', () => {
  const problems = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // Alias locales que apuntan a una rama del diccionario: `const t = d.L.u3;`
    for (const declaration of source.matchAll(/const\s+(\w+)\s*=\s*d((?:\.\w+)+)\s*;/g)) {
      const [, alias, rawPath] = declaration;
      const path = rawPath.slice(1);
      for (const code of LANGUAGE_CODES) {
        if (resolve(code, path) === undefined) {
          problems.push(`${file.pathname.split('/src/')[1]}: «${alias} = d.${path}» no existe en «${code}»`);
        }
      }
      // Cada uso `alias.clave(` debe corresponder a una función del diccionario.
      const calls = source.matchAll(new RegExp(`\\b${alias}\\.(\\w+)\\s*\\(`, 'g'));
      for (const call of calls) {
        const key = call[1];
        for (const code of LANGUAGE_CODES) {
          const value = resolve(code, `${path}.${key}`);
          if (typeof value !== 'function') {
            problems.push(
              `${file.pathname.split('/src/')[1]}: ${alias}.${key}(...) se llama como función pero en «${code}» es ${typeof value}`,
            );
          }
        }
      }
    }
  }
  assert.deepEqual(problems, [], `llamadas incompatibles con el diccionario:\n${problems.join('\n')}`);
});
