import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const TOKEN = /^[a-f0-9]{64}$/;
export const MAX_BODY = 150_000;
const FIELDS = ['token', 'maskedName', 'state', 'issuedOn', 'validUntil', 'revision', 'updatedAt'];
export const keyFor = token => `record-${createHash('sha256').update(token).digest('hex')}`;
export const referenceFor = token => `VRF-${token.slice(0, 12).toUpperCase()}`;

export function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  } });
}

export async function boundedBody(request, maximum) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('content');
  if (Number(request.headers.get('content-length')) > maximum) throw new Error('size');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('body');
  let size = 0;
  const parts = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new Error('size'); }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts).toString('utf8');
}

export function authenticated(request, body, secret, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const stamp = request.headers.get('x-treasury-timestamp') || '';
  const signature = request.headers.get('x-treasury-signature') || '';
  if (!/^\d{10}$/.test(stamp) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(now / 1000 - Number(stamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${stamp}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('record');
  if (Object.keys(record).some(key => !FIELDS.includes(key) && key !== 'testRecord') || FIELDS.some(key => !Object.hasOwn(record, key))) throw new Error('fields');
  if (Object.hasOwn(record, 'testRecord') && typeof record.testRecord !== 'boolean') throw new Error('testRecord');
  if (!TOKEN.test(record.token)) throw new Error('token');
  if (typeof record.maskedName !== 'string' || record.maskedName.length > 120 ||
      !/^(?:\p{L}\*{3})(?: \p{L}\*{3})*$/u.test(record.maskedName)) throw new Error('mask');
  if (!['active', 'revoked'].includes(record.state)) throw new Error('state');
  if (!validDate(record.issuedOn) || (record.validUntil !== null && !validDate(record.validUntil))) throw new Error('date');
  if (!Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error('revision');
  if (typeof record.updatedAt !== 'string' || !/Z$|[+-]\d{2}:\d{2}$/.test(record.updatedAt) ||
      !Number.isFinite(Date.parse(record.updatedAt))) throw new Error('updatedAt');
  return { ...Object.fromEntries(FIELDS.filter(key => key !== 'token').map(key => [key, record[key]])), testRecord: record.testRecord === true };
}

export async function upsert(store, record, now = new Date().toISOString()) {
  const data = validateRecord(record);
  const key = keyFor(record.token);
  for (let attempt = 0; attempt < 4; attempt++) {
    const previous = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    if (previous) {
      const old = previous.data;
      if (old.revision > data.revision) return 'stale';
      if (old.state === 'revoked' && data.state !== 'revoked') return 'conflict';
      if (old.revision === data.revision) {
        return Object.keys(data).every(field => old[field] === data[field]) ? 'unchanged' : 'conflict';
      }
    }
    const result = await store.setJSON(key, { ...data, reference: referenceFor(record.token), publishedAt: now },
      previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
    if (result.modified) return 'accepted';
  }
  return 'conflict';
}

export function publicResult(record, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  let status = record.state === 'revoked' ? 'revoked' : !record.validUntil ? 'unconfirmed' : record.validUntil < today ? 'expired' : 'active';
  return { status, maskedName: record.maskedName, reference: record.reference,
    issuedOn: record.issuedOn, validUntil: record.validUntil, updatedAt: record.updatedAt,
    publishedAt: record.publishedAt, issuer: 'Municipal Treasury Office, Dipaculao', testRecord: record.testRecord === true };
}

export function handlers({ getStore, secret, enabled, now = () => new Date() }) {
  return {
    async verify(request) {
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
      if (!enabled()) return json(503, { error: 'Verification is temporarily unavailable' });
      let payload;
      try { payload = JSON.parse(await boundedBody(request, 256)); } catch { return json(400, { error: 'Invalid verification request' }); }
      if (Object.keys(payload || {}).length !== 1 || !TOKEN.test(payload.token || '')) return json(400, { error: 'Invalid verification link' });
      try {
        const record = await getStore().get(keyFor(payload.token), { type: 'json', consistency: 'strong' });
        return record ? json(200, publicResult(record, now())) : json(404, { error: 'Record not found or not yet published' });
      } catch { return json(503, { error: 'Verification is temporarily unavailable' }); }
    },
    async publish(request) {
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
      if (!enabled() || !secret() || secret().length < 32) return json(503, { error: 'Publication is disabled' });
      let body;
      try { body = await boundedBody(request, MAX_BODY); } catch { return json(400, { error: 'Invalid request' }); }
      if (!authenticated(request, body, secret(), now().valueOf())) return json(401, { error: 'Unauthorized' });
      let records;
      try {
        const payload = JSON.parse(body);
        if (Object.keys(payload).length !== 1 || !Array.isArray(payload.records) || !payload.records.length || payload.records.length > 50) throw new Error();
        records = payload.records;
        for (const record of records) validateRecord(record);
        if (new Set(records.map(record => record.token)).size !== records.length) throw new Error();
      } catch { return json(400, { error: 'Only approved masked verification fields are accepted' }); }
      try {
        const store = getStore();
        const accepted = [];
        let conflicts = 0;
        for (const record of records) {
          const result = await upsert(store, record, now().toISOString());
          // Older updates are acknowledged without replacing a newer cloud revision.
          if (result === 'conflict') conflicts++; else accepted.push(record.token);
        }
        return json(200, { accepted, conflicts });
      } catch { return json(503, { error: 'Publication unavailable; retry later' }); }
    },
  };
}
