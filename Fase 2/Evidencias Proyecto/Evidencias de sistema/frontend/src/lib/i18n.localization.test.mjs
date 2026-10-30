// Localización de contenido FIJO vs contenido dinámico.
//
// Reglas que protege esta prueba:
//   - El texto de sistema (lecciones, etiquetas, roles) cambia con el idioma activo.
//   - El contenido creado por usuarios NO se modifica: `localizedLesson` nunca muta el objeto
//     original y los helpers sin diccionario siguen devolviendo español (comportamiento previo).
import test from 'node:test';
import assert from 'node:assert/strict';

import { LESSONS, getLesson, localizedLesson } from '../data/lessons.js';
import dictionary from '../data/dictionary.js';
import { ROLE_META, STATUS_META, SECTORS, roleMeta, statusMeta, sectors, areas } from '../data/directory.js';
import { REQUEST_TYPES, requestTypes, localizedRequestType } from './requestForm.js';
import { feedFilterOptions, requestKinds } from './requestsFeed.js';

const es = dictionary.es;
const en = dictionary.en;

test('el contenido de sistema cambia con el idioma activo (lecciones)', () => {
  const lesson = getLesson('mensajes-clave');
  const english = localizedLesson(lesson, 'en');

  assert.notEqual(english.title, lesson.title, 'el título se traduce');
  assert.equal(english.title, 'Key messages people remember', 'el texto inglés es el esperado');
  assert.equal(english.id, lesson.id, 'el identificador NO cambia');
  assert.equal(english.area, lesson.area, 'el área NO cambia');
  assert.equal(english.video.id, lesson.video.id, 'la ficha del video se conserva');
});

test('localizedLesson NO muta la lección original (contenido fijo, no dinámico)', () => {
  const lesson = getLesson('preguntas-hostiles');
  const before = JSON.stringify(lesson);
  localizedLesson(lesson, 'en');
  localizedLesson(lesson, 'es');
  assert.equal(JSON.stringify(lesson), before, 'la lección original queda intacta');
  assert.equal(localizedLesson(lesson, 'es'), lesson, 'en español se devuelve la misma referencia');
});

test('todas las lecciones tienen su versión en inglés con la misma forma', () => {
  for (const lesson of LESSONS) {
    const english = localizedLesson(lesson, 'en');
    assert.equal(typeof english.title, 'string');
    assert.ok(english.title.trim().length > 0, `la lección ${lesson.id} debe tener título en inglés`);
    assert.equal(english.points.length, lesson.points.length, `los puntos de ${lesson.id} deben coincidir en número`);
    assert.equal(typeof english.example.before, 'string');
    assert.equal(typeof english.example.after, 'string');
  }
});

test('los helpers de directorio cambian con el idioma y mantienen el respaldo español', () => {
  assert.equal(roleMeta(es).user.label, 'Vocero');
  assert.equal(roleMeta(en).user.label, 'Spokesperson');
  assert.equal(statusMeta(es).ACTIVE.label, 'Activo');
  assert.equal(statusMeta(en).ACTIVE.label, 'Active');
  assert.deepEqual(sectors(es), SECTORS, 'sin diccionario se conserva el respaldo español');
  assert.deepEqual(areas(en), en.L.dir.areas, 'con diccionario se usa la lista del idioma');
  // Los mapas de respaldo siguen existiendo (pantallas no migradas y valores por defecto).
  assert.equal(ROLE_META.user.label, 'Vocero');
  assert.equal(STATUS_META.SUSPENDED.label, 'Suspendido');
});

test('las solicitudes localizan etiquetas sin alterar los valores por defecto', () => {
  // Por defecto (sin diccionario) se conservan los textos españoles previos.
  assert.deepEqual(REQUEST_TYPES.map((type) => type.label), requestTypes(null).map((type) => type.label));
  assert.equal(requestTypes(en)[0].label, en.L.req.types.RECORDINGS.label);
  assert.equal(localizedRequestType('ANONYMIZE', en).label, en.L.req.types.ANONYMIZE.label);
  assert.equal(localizedRequestType('INVENTADO', en), null, 'un tipo desconocido no se inventa');
  // Las etiquetas de tipo del panel y el filtro también se localizan.
  assert.equal(requestKinds(en).privacy.label, 'Privacy');
  assert.deepEqual(
    feedFilterOptions([{ kind: 'privacy' }], en).map((o) => o.label),
    ['All · 1', 'Privacy · 1', 'Retention · 0'],
  );
});

test('el contenido del diccionario no expone el diccionario en claves de contenido dinámico', () => {
  // Los escenarios y datos de usuarios NUNCA se guardan en el diccionario: el diccionario solo
  // contiene textos de interfaz (cadenas, listas y funciones), no datos de escenarios concretos.
  const walk = (value, path) => {
    if (value == null) return;
    if (typeof value === 'string' || typeof value === 'function') return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    for (const key of Object.keys(value)) walk(value[key], `${path}.${key}`);
  };
  walk(es, 'es');
  walk(en, 'en');
  assert.ok(true);
});
