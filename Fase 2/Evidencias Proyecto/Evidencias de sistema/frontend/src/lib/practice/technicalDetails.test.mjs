// Guarda de privacidad técnica: los mensajes que ve el VOCERO nunca deben contener nombres de
// modelos o proveedores, códigos HTTP, identificadores internos de error ni motivos técnicos.
// Se comprueba sobre el código real de las pantallas implicadas (no hay DOM en las pruebas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const TECNICO = ['HTTP', '404', '410', 'kimi', 'nemotron', 'glm', 'gemma', 'deepseek', 'nvidia', 'proveedor', 'timeout', 'API_KEY', 'AI_UNAVAILABLE'];

test('los mensajes de fallo de la pantalla de análisis son genéricos', () => {
  // Los textos viven en el diccionario (analysis.fail) para poder traducirlos; la pantalla los
  // resuelve por clave, sin escribir mensajes propios.
  const component = read('../../pages/Analizando.jsx');
  assert.ok(component.includes('an.fail[result.reason]'), 'la pantalla debe resolver el mensaje por clave');

  for (const file of ['../../data/dictionary.js', '../../data/dictionary.en.js']) {
    const source = read(file);
    const start = source.indexOf('fail: {');
    assert.ok(start > -1, `debe existir el mapa de mensajes en ${file}`);
    const block = source.slice(start, source.indexOf('},', start));
    // Solo se revisan los TEXTOS que verá el vocero (no las claves internas del mapa).
    const messages = block.match(/'[^']*'/g) || [];
    assert.ok(messages.length >= 3, `debe haber mensajes definidos en ${file}`);
    for (const value of messages) {
      for (const token of TECNICO) {
        assert.ok(!value.includes(token), `el mensaje al vocero no debe contener "${token}": ${value}`);
      }
    }
    // El motivo interno se mapea a un texto genérico (no se muestra tal cual).
    assert.ok(block.includes('AI_UNAVAILABLE'));
  }
  assert.match(read('../../data/dictionary.js'), /inténtalo de nuevo en unos minutos/i);
  assert.match(read('../../data/dictionary.en.js'), /try again in a few minutes/i);
});

test('los textos de acceso al informe no exponen detalles internos', () => {
  const source = read('./reportAccess.js');
  const strings = source.match(/'[^']*'/g) || [];
  for (const value of strings) {
    for (const token of TECNICO) {
      assert.ok(!value.includes(token), `texto de interfaz con detalle técnico: ${value}`);
    }
  }
});
