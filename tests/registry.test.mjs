import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handlers, keyFor, publicResult, upsert, validateRecord } from '../lib/registry.mjs';

const secret = 'fictional-test-secret-only-000000000000000000';
const now = new Date('2026-10-26T00:00:00Z');
const record = () => ({ token: 'a'.repeat(64), maskedName: 'J*** D*** C***', state: 'active',
  issuedOn: '2026-10-01', validUntil: '2028-06-30', revision: 1, updatedAt: now.toISOString() });
function store() {
  const values = new Map();
  let etag = 0;
  return {
    values,
    async getWithMetadata(key) { return values.get(key) || null; },
    async get(key) { return values.get(key)?.data || null; },
    async setJSON(key, data, condition) {
      const previous = values.get(key);
      if (condition.onlyIfNew && previous || condition.onlyIfMatch && condition.onlyIfMatch !== previous?.etag) return { modified: false };
      const entry = { data, etag: String(++etag) };
      values.set(key, entry);
      return { modified: true, etag: entry.etag };
    },
  };
}
function api(memory, enabled = true) { return handlers({ getStore: () => memory, secret: () => secret, enabled: () => enabled, now: () => now }); }
function post(path, value, signed = true, stamp = Math.floor(now.valueOf() / 1000)) {
  const body = JSON.stringify(value);
  const signature = createHmac('sha256', secret).update(`${stamp}.${body}`).digest('hex');
  return new Request(`https://residential-id.netlify.app/api/${path}`, { method: 'POST', body,
    headers: { 'Content-Type': 'application/json', ...(signed ? { 'X-Treasury-Timestamp': String(stamp), 'X-Treasury-Signature': signature } : {}) } });
}

test('authenticated publication and lookup expose only public whitelist', async () => {
  const memory = store();
  assert.equal((await api(memory).publish(post('publish', { records: [record()] }))).status, 200);
  const result = await api(memory).verify(post('verify', { token: record().token }, false));
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const body = await result.json();
  assert.equal(body.status, 'active');
  assert.equal(body.maskedName, 'J*** D*** C***');
  assert.ok(!('token' in body) && !('originId' in body) && !('revision' in body));
  assert.deepEqual(Object.keys(body).sort(), ['status', 'maskedName', 'reference', 'issuedOn', 'validUntil', 'updatedAt', 'publishedAt', 'issuer'].sort());
  assert.ok(![...memory.values.keys()][0].includes(record().token));
});
test('full names and unexpected personal fields are rejected before writing', async () => {
  const memory = store();
  for (const bad of [{ ...record(), fullName: 'JUAN DELA CRUZ' }, { ...record(), maskedName: 'JUAN DELA CRUZ' }, { ...record(), dob: '1990-01-01' }]) {
    assert.equal((await api(memory).publish(post('publish', { records: [bad] }))).status, 400);
  }
  assert.equal(memory.values.size, 0);
});
test('missing signature, expired signature, modified body and weak secret fail closed', async () => {
  const memory = store();
  assert.equal((await api(memory).publish(post('publish', { records: [record()] }, false))).status, 401);
  assert.equal((await api(memory).publish(post('publish', { records: [record()] }, true, Math.floor(now.valueOf() / 1000) - 301))).status, 401);
  const request = post('publish', { records: [record()] });
  const changed = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify({ records: [{ ...record(), state: 'revoked' }] }) });
  assert.equal((await api(memory).publish(changed)).status, 401);
  assert.equal((await handlers({ getStore: () => memory, enabled: () => true, secret: () => '' }).publish(post('publish', { records: [record()] }))).status, 503);
});
test('revocation and older retries cannot reactivate a card', async () => {
  const memory = store();
  await upsert(memory, record());
  assert.equal(await upsert(memory, { ...record(), state: 'revoked', revision: 2 }), 'accepted');
  assert.equal(await upsert(memory, record()), 'stale');
  assert.equal(await upsert(memory, { ...record(), revision: 3 }), 'conflict');
  assert.equal(memory.values.get(keyFor(record().token)).data.state, 'revoked');
});
test('same revision cannot silently replace a differing record', async () => {
  const memory = store();
  await upsert(memory, record());
  assert.equal(await upsert(memory, record()), 'unchanged');
  assert.equal(await upsert(memory, { ...record(), maskedName: 'M***' }), 'conflict');
});
test('conditional writes converge concurrent updates to the newest revision', async () => {
  const memory = store();
  await Promise.all([upsert(memory, record()), upsert(memory, { ...record(), revision: 2, validUntil: '2029-06-30' })]);
  assert.equal(memory.values.get(keyFor(record().token)).data.revision, 2);
});
test('expiry follows Philippine date and missing validity never becomes active', () => {
  assert.equal(publicResult({ ...record(), validUntil: '2026-10-26' }, new Date('2026-10-26T16:01:00Z')).status, 'expired');
  assert.equal(publicResult({ ...record(), validUntil: '2026-10-26' }, new Date('2026-10-26T15:59:00Z')).status, 'active');
  assert.equal(publicResult({ ...record(), validUntil: null }).status, 'unconfirmed');
});
test('unknown token and service failures have different responses', async () => {
  assert.equal((await api(store()).verify(post('verify', { token: 'b'.repeat(64) }, false))).status, 404);
  assert.equal((await api(store(), false).verify(post('verify', { token: 'b'.repeat(64) }, false))).status, 503);
  assert.equal((await api({ get() { throw new Error(); } }).verify(post('verify', { token: 'b'.repeat(64) }, false))).status, 503);
  assert.equal((await api(store()).verify(post('verify', { token: '../list' }, false))).status, 400);
});
test('invalid calendar dates and methods are rejected', async () => {
  assert.throws(() => validateRecord({ ...record(), validUntil: '2026-02-30' }));
  assert.equal((await api(store()).verify(new Request('https://example.test/api/verify'))).status, 405);
});

test('Netlify entry points reject preview contexts and disabled production', async () => {
  const { default: verify } = await import('../netlify/functions/verify.mjs');
  const { default: publish } = await import('../netlify/functions/publish.mjs');
  const saved = process.env.REGISTRY_ENABLED;
  try {
    process.env.REGISTRY_ENABLED = 'true';
    assert.equal((await verify(post('verify', { token: record().token }), { deploy: { context: 'deploy-preview' } })).status, 503);
    assert.equal((await publish(post('publish', { records: [record()] }), { deploy: { context: 'deploy-preview' } })).status, 503);
    process.env.REGISTRY_ENABLED = 'false';
    assert.equal((await verify(post('verify', { token: record().token }), { deploy: { context: 'production' } })).status, 503);
  } finally {
    if (saved === undefined) delete process.env.REGISTRY_ENABLED; else process.env.REGISTRY_ENABLED = saved;
  }
});
