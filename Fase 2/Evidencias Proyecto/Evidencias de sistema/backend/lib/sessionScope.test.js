// Alcance de la consulta del historial de prácticas por rol (aislamiento entre organizaciones).
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveSessionOwner } = require('./sessionScope');

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const voceroA = { id: 'u-a', role: 'VOCERO', tenantId: TENANT_A };
const voceroB = { id: 'u-b', role: 'VOCERO', tenantId: TENANT_B };
const adminA = { id: 'a-a', role: 'ADMIN', tenantId: TENANT_A };
const adminB = { id: 'a-b', role: 'ADMIN', tenantId: TENANT_B };
const staff = { id: 's-1', role: 'SYSTEM', tenantId: null };

const users = { 'u-a': voceroA, 'u-b': voceroB, 'a-a': adminA, 'a-b': adminB };
const findUser = async (id) => users[id] || null;

test('el vocero consulta siempre sus propias prácticas', async () => {
  const self = await resolveSessionOwner({ apiRole: 'user', requester: voceroA, findUser });
  assert.equal(self.id, 'u-a');
  const same = await resolveSessionOwner({ apiRole: 'user', requester: voceroA, requestedUserId: 'u-a', findUser });
  assert.equal(same.id, 'u-a');
});

test('el vocero no puede consultar las prácticas de otro vocero', async () => {
  const result = await resolveSessionOwner({ apiRole: 'user', requester: voceroA, requestedUserId: 'u-b', findUser });
  assert.equal(result.status, 403);
  assert.match(result.error, /tus propias prácticas/);
});

test('el administrador consulta a un vocero de su organización', async () => {
  const result = await resolveSessionOwner({ apiRole: 'admin', requester: adminA, requestedUserId: 'u-a', findUser });
  assert.equal(result.id, 'u-a');
  assert.equal(result.scope, 'tenant');
});

test('el administrador NO puede consultar voceros de otra organización', async () => {
  const result = await resolveSessionOwner({ apiRole: 'admin', requester: adminA, requestedUserId: 'u-b', findUser });
  assert.equal(result.status, 403);
  assert.match(result.error, /tu organización/);
});

test('el administrador debe indicar el vocero (sin id no se asume ninguno)', async () => {
  const result = await resolveSessionOwner({ apiRole: 'admin', requester: adminA, findUser });
  assert.equal(result.status, 400);
});

test('un objetivo que no es vocero (o no existe) no es consultable', async () => {
  assert.equal((await resolveSessionOwner({ apiRole: 'admin', requester: adminA, requestedUserId: 'a-a', findUser })).status, 404);
  assert.equal((await resolveSessionOwner({ apiRole: 'admin', requester: adminA, requestedUserId: 'no-existe', findUser })).status, 404);
  assert.equal((await resolveSessionOwner({ apiRole: 'system', requester: staff, requestedUserId: 'a-a', findUser })).status, 404);
});

test('master y system pueden consultar a cualquier vocero', async () => {
  const master = await resolveSessionOwner({ apiRole: 'master', requester: { id: 'm-1', role: 'MASTER' }, requestedUserId: 'u-b', findUser });
  assert.equal(master.id, 'u-b');
  assert.equal(master.scope, 'global');
  const system = await resolveSessionOwner({ apiRole: 'system', requester: staff, requestedUserId: 'u-b', findUser });
  assert.equal(system.id, 'u-b');
});

test('un rol ausente o desconocido se trata como el más restrictivo (solo lo propio)', async () => {
  const missing = await resolveSessionOwner({ requester: voceroA, findUser });
  assert.equal(missing.id, 'u-a');
  assert.equal(missing.scope, 'self');
  const foreign = await resolveSessionOwner({ apiRole: 'raro', requester: voceroA, requestedUserId: 'u-b', findUser });
  assert.equal(foreign.status, 403);
});

test('el administrador de otra organización tampoco entra por el id del vocero', async () => {
  const result = await resolveSessionOwner({ apiRole: 'admin', requester: adminB, requestedUserId: 'u-a', findUser });
  assert.equal(result.status, 403);
});
