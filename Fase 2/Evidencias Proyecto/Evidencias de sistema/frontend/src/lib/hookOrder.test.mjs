// Guarda de ORDEN DE HOOKS.
//
// La lista de dependencias de `useEffect` / `useMemo` / `useCallback` se evalúa DURANTE el render.
// Si menciona una variable declarada con `const`/`let` más abajo en el archivo, esa variable todavía
// está en la zona muerta temporal y el componente lanza:
//     ReferenceError: Cannot access 'x' before initialization
// React desmonta el árbol y la pantalla queda en blanco. Esta prueba lo detecta sin navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const SRC = new URL('..', import.meta.url);

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx|js)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
};

// Declaraciones que NO se pueden usar antes de su línea (a diferencia de `function`, que se eleva).
const DECL = [
  /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
  /^\s*(?:const|let|var)\s*\{([^}]*)\}\s*=/,
  /^\s*(?:const|let|var)\s*\[([^\]]*)\]\s*=/,
];
// Parámetros de funciones y arrow functions: un parámetro puede TAPAR una declaración posterior de
// otro ámbito (p. ej. un prop `item` y un estado `item` en otro componente del mismo archivo), así
// que si un nombre aparece como parámetro no se evalúa como error de orden.
const PARAMS = [
  /^\s*(?:export\s+default\s+)?(?:async\s+)?function\s*[\w$]*\s*\(([^)]*)\)/,
  /\(([^)]*)\)\s*=>/,
];
const DEPS = /^\s*\},?\s*\[([^\]]*)\]\s*\)\s*;?\s*$/;
const IMPORT = /^\s*import\s+([\s\S]*?)\s+from\s+['"]/;
const IDENT = /[A-Za-z_$][\w$]*/g;

const namesOf = (text) => (text.match(IDENT) || []).filter((name) => !['as', 'from', 'type'].includes(name));

// Detector reutilizable (permite comprobar que NO es vacuo con un fragmento sintético).
export function findHookOrderProblems(source, relative = 'archivo') {
  const lines = source.split('\n');
  const imported = new Set();
  const params = new Set();
  const declared = new Map();
  const problems = [];

  lines.forEach((line, index) => {
    const importMatch = line.match(IMPORT);
    if (importMatch) for (const name of namesOf(importMatch[1])) imported.add(name);
    for (const pattern of PARAMS) {
      const match = line.match(pattern);
      if (match) for (const name of namesOf(match[1])) params.add(name);
    }
    for (const pattern of DECL) {
      const match = line.match(pattern);
      if (!match) continue;
      for (const name of namesOf(match[1])) if (!declared.has(name)) declared.set(name, index);
    }
  });

  lines.forEach((line, index) => {
    const deps = line.match(DEPS);
    if (!deps) return;
    for (const raw of deps[1].split(',')) {
      const name = raw.trim().split(/[.[]/)[0].trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
      if (imported.has(name) || params.has(name)) continue;
      const at = declared.get(name);
      if (at != null && at > index) {
        problems.push(`${relative}: «${name}» se usa en las dependencias de la línea ${index + 1} pero se declara en la ${at + 1}`);
      }
    }
  });

  return problems;
}

test('ningún hook usa en sus dependencias una variable declarada más abajo', () => {
  const problems = [];
  for (const file of walk(SRC)) {
    problems.push(...findHookOrderProblems(readFileSync(file, 'utf8'), file.pathname.split('/src/')[1]));
  }
  assert.deepEqual(problems, [], `orden de hooks incorrecto:\n${problems.join('\n')}`);
});

test('el detector reconoce el error real que dejó la pantalla en blanco', () => {
  // Mismo patrón que rompió MainLayout: el efecto usa `loadNotifications` antes de declararla.
  const roto = [
    'import { useCallback, useEffect } from "react";',
    'export default function Vista() {',
    '  useEffect(() => {',
    '    cargar();',
    '  }, [cargar]);',
    '  const cargar = useCallback(async () => {}, []);',
    '  return null;',
    '}',
  ].join('\n');
  const problems = findHookOrderProblems(roto, 'Vista.jsx');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /«cargar»/);

  // Y no marca un prop que tapa un estado declarado más abajo (falso positivo descartado).
  const correcto = [
    'function Editor({ item }) {',
    '  useEffect(() => {}, [item.id]);',
    '  return null;',
    '}',
    'export default function Pagina() {',
    '  const [item, setItem] = useState(null);',
    '  return null;',
    '}',
  ].join('\n');
  assert.deepEqual(findHookOrderProblems(correcto, 'Pagina.jsx'), []);
});
