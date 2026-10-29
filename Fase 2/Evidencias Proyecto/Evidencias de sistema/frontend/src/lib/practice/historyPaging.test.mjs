import assert from 'node:assert/strict';
import test from 'node:test';

import { COLLAPSED, PAGE_SIZE, historyWindow, pageNumbers } from './historyPaging.js';

// Historial: 10 visibles al inicio, ampliable a 20 y paginación por encima de 20.

test('sin sesiones no se muestra ningún control', () => {
  const w = historyWindow({ total: 0 });
  assert.equal(w.visible, 0);
  assert.equal(w.showExpand, false);
  assert.equal(w.showPagination, false);
  assert.equal(w.pages, 1);
});

test('con 10 sesiones se ven todas y no hay controles', () => {
  const w = historyWindow({ total: 10 });
  assert.equal(w.visible, COLLAPSED);
  assert.equal(w.showExpand, false, 'no hace falta la flecha');
  assert.equal(w.showPagination, false);
});

test('con 11 sesiones aparecen 10 y la flecha para ampliar a 11', () => {
  const collapsed = historyWindow({ total: 11 });
  assert.equal(collapsed.visible, 10);
  assert.equal(collapsed.showExpand, true);
  assert.equal(collapsed.canExpand, true);
  assert.equal(collapsed.showPagination, false);

  const expanded = historyWindow({ total: 11, expanded: true });
  assert.equal(expanded.visible, 11, 'se amplía hasta el máximo disponible');
});

test('con 20 sesiones la flecha amplía a 20 y todavía no hay paginación', () => {
  assert.equal(historyWindow({ total: 20 }).visible, 10);
  assert.equal(historyWindow({ total: 20, expanded: true }).visible, 20);
  assert.equal(historyWindow({ total: 20 }).showPagination, false);
  assert.equal(historyWindow({ total: 20 }).pages, 1);
});

test('con 21 sesiones hay paginación de 2 páginas y la primera muestra 10 o 20', () => {
  const w = historyWindow({ total: 21, page: 1 });
  assert.equal(w.showPagination, true);
  assert.equal(w.pages, 2);
  assert.equal(w.visible, 10);
  assert.equal(historyWindow({ total: 21, page: 1, expanded: true }).visible, 20);
});

test('la segunda página muestra el resto y nunca queda vacía', () => {
  const second = historyWindow({ total: 21, page: 2, expanded: true });
  assert.equal(second.page, 2);
  assert.equal(second.offset, PAGE_SIZE);
  assert.equal(second.inBlock, 1);
  assert.equal(second.visible, 1);
  assert.equal(second.canExpand, false, 'no hay más de 10 en este bloque');
});

test('una página fuera de rango se acota a la última existente (sin páginas vacías)', () => {
  const beyond = historyWindow({ total: 45, page: 99 });
  assert.equal(beyond.pages, 3);
  assert.equal(beyond.page, 3);
  assert.equal(beyond.offset, 40);
  assert.equal(beyond.visible, 5);
  assert.equal(historyWindow({ total: 45, page: 0 }).page, 1);
  assert.equal(historyWindow({ total: 45, page: 'x' }).page, 1);
});

test('con muchas sesiones se pide solo un bloque al servidor', () => {
  const w = historyWindow({ total: 500, page: 7, expanded: true });
  assert.equal(w.limit, PAGE_SIZE);
  assert.equal(w.offset, 6 * PAGE_SIZE);
  assert.equal(w.pages, 25);
  assert.equal(w.visible, PAGE_SIZE);
});

test('los números de página incluyen la activa y señalan los huecos', () => {
  assert.deepEqual(pageNumbers(1, 1), [1]);
  assert.deepEqual(pageNumbers(5, 3), [1, 2, 3, 4, 5], '1 2 3 4 5…');
  assert.deepEqual(pageNumbers(12, 1), [1, 2, 3, 4, 5, 'gap', 12]);
  assert.deepEqual(pageNumbers(12, 6), [1, 'gap', 4, 5, 6, 7, 8, 'gap', 12]);
  assert.deepEqual(pageNumbers(12, 12), [1, 'gap', 8, 9, 10, 11, 12]);
  assert.deepEqual(pageNumbers(3, 2), [1, 2, 3]);
});
