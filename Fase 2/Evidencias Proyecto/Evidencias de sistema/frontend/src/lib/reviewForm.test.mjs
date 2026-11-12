// Guardas del formulario de revisión humana:
//   · los subcriterios SOLO se puntúan (no tienen retroalimentación individual);
//   · la retroalimentación escrita existe únicamente a nivel de las cuatro áreas principales;
//   · el comentario adicional está SIEMPRE disponible para quien revisa, pero en el informe del vocero
//     solo aparece si hay comentario escrito (sin textos genéricos de «no hay comentario»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = new URL('..', import.meta.url);
const read = (path) => readFileSync(new URL(path, SRC), 'utf8');

const modals = read('components/ReviewModals.jsx');
const report = read('pages/InformeCoach.jsx');

test('el editor de un área no ofrece retroalimentación por subcriterio', () => {
  assert.doesNotMatch(modals, /details\[item\.key\]\?\.feedback/, 'sin campo de texto por subcriterio');
  assert.doesNotMatch(modals, /feedback: event\.target\.value/, 'sin estado de retroalimentación por subcriterio');
  // La retroalimentación escrita sigue existiendo a nivel de área.
  assert.match(modals, /areaFeedbackL/);
});

test('el comentario adicional está siempre disponible para quien revisa', () => {
  assert.match(report, /onBlur=\{saveComment\}/, 'se guarda el comentario al salir del campo');
  assert.match(report, /commentDraft &&/, 'el campo se marca cuando hay comentario');
  assert.doesNotMatch(report, /noAdditionalComment/, 'sin texto genérico de «no hay comentario»');
});

test('el comentario solo aparece en el informe si tiene texto', () => {
  assert.match(report, /!view\.comment\.empty/, 'el apartado se oculta cuando no hay comentario');
});
