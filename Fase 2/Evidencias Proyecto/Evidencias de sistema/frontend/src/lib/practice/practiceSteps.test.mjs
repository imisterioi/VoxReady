// Los indicadores de etapas son EXCLUSIVAMENTE visuales: no deben permitir navegación por clic.
// Se comprueba sobre el código real del componente compartido (no hay DOM en las pruebas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../components/PracticeSteps.jsx', import.meta.url), 'utf8');

test('los indicadores de etapas no son enlaces ni botones', () => {
  assert.ok(!/<Link\b/.test(source), 'no debe usar <Link>');
  assert.ok(!/\bto=\{/.test(source), 'no debe declarar destinos de navegación');
  assert.ok(!/onClick/.test(source), 'no debe tener manejadores de clic');
  assert.ok(!/<button\b/.test(source), 'no debe ser un botón');
  assert.ok(!/<a\s/.test(source), 'no debe ser un ancla');
  assert.ok(!/role="(button|link)"/.test(source), 'no debe simular un control interactivo');
  assert.ok(!/tabIndex/.test(source), 'no debe ser enfocable');
});

test('conserva apariencia, orden de etapas y etapa actual', () => {
  assert.match(source, /d\.flow/, 'usa la misma lista y orden de etapas (sistema de traducciones)');
  assert.match(source, /aria-current=\{active \? 'step' : undefined\}/, 'marca la etapa actual');
  assert.match(source, /rounded-full/, 'conserva la apariencia de las píldoras');
  assert.match(source, /select-none/, 'el texto no es seleccionable como control');
  assert.match(source, /bg-primary text-primary-ink/, 'conserva el resaltado de la etapa actual');
  assert.match(source, /name="check"/, 'conserva el indicador de etapas completadas');
});
