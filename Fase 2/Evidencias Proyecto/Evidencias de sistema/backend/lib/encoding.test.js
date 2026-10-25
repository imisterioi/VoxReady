// Guardia de codificación: ningún archivo del backend puede contener mojibake por DOBLE CODIFICACIÓN
// (bytes UTF-8 decodificados como Windows-1252 y vueltos a guardar como UTF-8) ni caracteres de
// reemplazo. Es el defecto real que apareció en pantalla: en lugar de "Según tu área más débil" el
// vocero leía los caracteres C3 BA / C3 A1 / C3 A9 escritos como texto (notación escapada a
// propósito: este archivo no debe contener el mojibake ni como ejemplo). Se comprueba sobre los
// BYTES de cada archivo, no sobre lo que muestra un terminal (los terminales Windows suelen
// decodificar UTF-8 como CP1252 y "fabricar" ese texto).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EXTENSIONES = new Set(['.js', '.jsx', '.mjs', '.json', '.md', '.css', '.html']);
const EXCLUIR = /node_modules|[\\/]dist[\\/]|[\\/]uploads[\\/]|[\\/]\.git[\\/]/;

// Bytes que CP1252 asigna a 0x80-0x9F: los que siguen a C3/C2/E2 cuando el texto está doblemente codificado.
const CP1252_BYTES = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

function archivos(dir, salida = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (EXCLUIR.test(completo)) continue;
    if (entrada.isDirectory()) archivos(completo, salida);
    else if (EXTENSIONES.has(path.extname(entrada.name).toLowerCase())) salida.push(completo);
  }
  return salida;
}

// Devuelve las líneas con mojibake (o con carácter de reemplazo) de un texto.
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

test('ningún archivo del backend contiene mojibake de doble codificación', () => {
  const problemas = [];
  for (const archivo of archivos(ROOT)) {
    const texto = fs.readFileSync(archivo, 'utf8');
    const corruptas = lineasCorruptas(texto);
    if (corruptas.length) problemas.push({ archivo: path.relative(ROOT, archivo), lineas: corruptas.slice(0, 3) });
  }
  assert.deepEqual(
    problemas,
    [],
    `hay texto doblemente codificado (UTF-8 leído como CP1252): ${JSON.stringify(problemas)}`,
  );
});

test('el texto de referencia del proyecto está correctamente codificado', () => {
  // Anclas semánticas: si alguien vuelve a reescribir estos archivos con la codificación equivocada,
  // estas cadenas dejan de existir tal cual.
  const entrevistador = fs.readFileSync(path.join(ROOT, 'ai', 'interviewer.test.js'), 'utf8');
  assert.ok(entrevistador.includes("'¿Qué medidas tomaron?'"), 'la fixture del entrevistador debe llevar ¿ y ó correctos');

  const evaluador = fs.readFileSync(path.join(ROOT, 'ai', 'evaluator.js'), 'utf8');
  assert.ok(evaluador.includes('Evaluación') || evaluador.includes('evaluación'), 'los comentarios del evaluador deben conservar los acentos');
  assert.ok(!evaluador.includes('Ã'), 'el evaluador no puede contener secuencias dobles');
});
