// Guardia de codificación del frontend: ningún archivo puede contener mojibake por DOBLE
// CODIFICACIÓN (bytes UTF-8 decodificados como Windows-1252 y reescritos como UTF-8). Este defecto
// llegó a pantalla en la página del informe (la etiqueta de lecciones se leía como los caracteres
// C3 BA / C3 A1 escritos tal cual, en lugar de "Según tu área más débil"; se cita en notación
// escapada a propósito, para que este archivo no contenga el mojibake ni como ejemplo). La
// comprobación se hace sobre los BYTES de los archivos y sobre los literales que el vocero ve.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = fileURLToPath(new URL('../../../', import.meta.url)); // frontend/
const EXTENSIONES = new Set(['.js', '.jsx', '.mjs', '.json', '.css', '.html']);
const EXCLUIR = /node_modules|[\\/]dist[\\/]|[\\/]\.git[\\/]/;

const CP1252_BYTES = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

function archivos(dir, salida = []) {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = join(dir, entrada.name);
    if (EXCLUIR.test(completo)) continue;
    if (entrada.isDirectory()) archivos(completo, salida);
    else if (EXTENSIONES.has(extname(entrada.name).toLowerCase())) salida.push(completo);
  }
  return salida;
}

function lineasCorruptas(texto) {
  const encontradas = [];
  texto.split('\n').forEach((linea, indice) => {
    const chars = Array.from(linea);
    for (let i = 0; i < chars.length; i += 1) {
      const cp = chars[i].codePointAt(0);
      const siguiente = i + 1 < chars.length ? chars[i + 1].codePointAt(0) : -1;
      const prefijo = cp === 0xc3 || cp === 0xc2 || cp === 0xe2;
      const alto = (siguiente >= 0xa0 && siguiente <= 0xff) || CP1252_BYTES.has(siguiente);
      if ((prefijo && alto) || cp === 0xfffd) {
        encontradas.push({ linea: indice + 1, texto: linea.trim().slice(0, 100) });
        break;
      }
    }
  });
  return encontradas;
}

test('ningún archivo del frontend contiene mojibake de doble codificación', () => {
  const problemas = [];
  for (const archivo of archivos(FRONTEND)) {
    const corruptas = lineasCorruptas(readFileSync(archivo, 'utf8'));
    if (corruptas.length) problemas.push({ archivo: relative(FRONTEND, archivo), lineas: corruptas.slice(0, 3) });
  }
  assert.deepEqual(problemas, [], `hay texto doblemente codificado: ${JSON.stringify(problemas)}`);
});

test('los textos del informe que ve el vocero están correctos', () => {
  const informe = readFileSync(join(FRONTEND, 'src', 'pages', 'InformeCoach.jsx'), 'utf8');
  // Las etiquetas del informe viven en el diccionario (idioma activo); se comprueba ahí el texto
  // exacto, con sus acentos, comillas y puntos suspensivos.
  const diccionario = readFileSync(join(FRONTEND, 'src', 'data', 'dictionary.js'), 'utf8');
  // Etiqueta reportada como rota en una sesión real.
  assert.ok(diccionario.includes("lessonsWeakest: 'Según tu área más débil'"), 'la etiqueta de lecciones debe llevar “Según tu área más débil”');
  // Comillas curvas que envuelven la cita del informe (el texto de la cita viene de la base de datos).
  assert.ok(informe.includes('“{report.cita}”'), 'la cita debe ir entre comillas curvas correctas');
  assert.ok(diccionario.includes("redLinesTitle: 'Líneas rojas'"), 'los títulos con acentos deben conservarse');
  assert.ok(diccionario.includes("loading: 'Cargando tu informe…'"), 'los puntos suspensivos deben ser el carácter … correcto');
});

test('el cliente HTTP lee el informe como JSON (UTF-8 por especificación)', () => {
  const api = readFileSync(join(FRONTEND, 'src', 'lib', 'api.js'), 'utf8');
  assert.match(api, /response\.json\(\)/, 'la respuesta se decodifica con response.json() (UTF-8)');
  assert.ok(!/TextDecoder|latin1|binary/.test(api), 'no debe haber decodificaciones manuales');
});
