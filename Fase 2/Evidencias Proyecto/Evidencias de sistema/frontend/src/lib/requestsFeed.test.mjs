import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUEST_KINDS,
  buildRequestsFeed,
  countRequestsByKind,
  feedFilterOptions,
  filterRequestsFeed,
} from './requestsFeed.js';

const privacy = (id, createdAt) => ({ id, createdAt, scope: 'RECORDINGS', status: 'PENDING' });
const retention = (id, createdAt) => ({ id, createdAt, requestedDays: 90, status: 'PENDING' });

test('los dos tipos de solicitud se juntan en una sola lista ordenada por fecha', () => {
  const feed = buildRequestsFeed({
    privacy: [privacy('p1', '2026-03-01T10:00:00Z'), privacy('p2', '2026-03-05T10:00:00Z')],
    extensions: [retention('r1', '2026-03-03T10:00:00Z')],
  });
  assert.deepEqual(feed.map((i) => i.request.id), ['p2', 'r1', 'p1'], 'de la más reciente a la más antigua');
  assert.deepEqual(feed.map((i) => i.kind), ['privacy', 'retention', 'privacy']);
});

test('cada elemento conserva la solicitud original y su tipo', () => {
  const original = privacy('p1', '2026-03-01T10:00:00Z');
  const feed = buildRequestsFeed({ privacy: [original] });
  assert.equal(feed[0].request, original, 'no se copia ni se transforma el dato');
  assert.equal(feed[0].kind, 'privacy');
});

test('sin solicitudes la lista queda vacía (no se inventan elementos)', () => {
  assert.deepEqual(buildRequestsFeed(), []);
  assert.deepEqual(buildRequestsFeed({ privacy: [], extensions: [] }), []);
});

test('el filtro interno separa por tipo sin perder ninguna solicitud', () => {
  const feed = buildRequestsFeed({ privacy: [privacy('p1', '2026-03-01T10:00:00Z')], extensions: [retention('r1', '2026-03-02T10:00:00Z')] });
  assert.equal(filterRequestsFeed(feed, 'all').length, 2);
  assert.deepEqual(filterRequestsFeed(feed, 'privacy').map((i) => i.request.id), ['p1']);
  assert.deepEqual(filterRequestsFeed(feed, 'retention').map((i) => i.request.id), ['r1']);
  assert.equal(filterRequestsFeed(feed, 'otro').length, 0, 'un filtro desconocido no devuelve todo');
});

test('los recuentos y las etiquetas del filtro reflejan el contenido', () => {
  const feed = buildRequestsFeed({
    privacy: [privacy('p1', '2026-03-01T10:00:00Z'), privacy('p2', '2026-03-02T10:00:00Z')],
    extensions: [retention('r1', '2026-03-03T10:00:00Z')],
  });
  assert.deepEqual(countRequestsByKind(feed), { all: 3, privacy: 2, retention: 1 });
  assert.deepEqual(feedFilterOptions(feed).map((o) => o.value), ['all', 'privacy', 'retention']);
  assert.deepEqual(feedFilterOptions(feed).map((o) => o.label), ['Todas · 3', 'Privacidad · 2', 'Retención · 1']);
});

test('cada tipo tiene su etiqueta y su tono para distinguirlos en la lista', () => {
  assert.equal(REQUEST_KINDS.privacy.label, 'Privacidad');
  assert.equal(REQUEST_KINDS.retention.label, 'Retención');
  assert.notEqual(REQUEST_KINDS.privacy.tone, REQUEST_KINDS.retention.tone);
});
