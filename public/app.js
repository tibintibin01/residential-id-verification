import { setupScanner } from './scanner.mjs';

const $ = id => document.getElementById(id);
let fragment = location.hash.slice(1);
const demo = new URLSearchParams(location.search).get('demo') === '1';
let token = /^[a-f0-9]{64}$/.test(fragment) ? fragment : '';
const states = {
  active: ['✓', 'RECORD FOUND', 'Active issuance', 'This issuance record is listed as active in the registry.'],
  expired: ['!', 'VALIDITY ENDED', 'This ID has expired', 'The record exists, but its validity date has passed. Contact the issuing office about renewal.'],
  revoked: ['×', 'CANCELLED BY ISSUER', 'This ID is revoked', 'The issuing office has cancelled this issuance. Contact the office for assistance.'],
  unconfirmed: ['!', 'RECORD FOUND', 'Validity needs confirmation', 'This record has no confirmed validity date. Contact the issuing office before relying on this ID.'],
  missing: ['?', 'NO MATCH RETURNED', 'Record not found', 'The record may not have been published yet, or the link may be incorrect. Contact the issuing office.'],
  unavailable: ['↻', 'CHECK COULD NOT COMPLETE', 'Temporarily unavailable', 'Please try again shortly. An unavailable service does not mean the card is invalid.'],
  home: ['↗', 'RESIDENTIAL ID VERIFICATION', 'Start with the card’s QR', 'Scan the QR printed on a supported Dipaculao residential ID to check its issuance record.'],
};
const date = value => value ? new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(value.length === 10 ? value + 'T00:00:00+08:00' : value)) : 'Not recorded';
const dateTime = value => value ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(value)) : 'Not recorded';
let controller;
let focusNextResult = false;

function render(status, record) {
  if (!demo) $('demo-banner').hidden = record?.testRecord !== true;
  const [icon, label, title, description] = states[status] || states.unavailable;
  $('status-icon').className = `status-icon ${status}`;
  $('status-icon').textContent = icon;
  $('status-label').textContent = label;
  $('result-title').textContent = title;
  $('result-description').textContent = description;
  $('record-details').hidden = !record;
  $('compare-note').hidden = !record;
  $('updated').textContent = record ? `Record updated ${dateTime(record.updatedAt)} · Published ${dateTime(record.publishedAt)} (Philippine time)` : '';
  if (record) {
    $('resident-name').textContent = record.maskedName;
    $('reference').textContent = record.reference;
    $('issued-on').textContent = date(record.issuedOn);
    $('valid-until').textContent = date(record.validUntil);
    $('issuer').textContent = record.issuer;
  }
  $('retry').hidden = !token || demo;
  $('retry').disabled = false;
  $('scan-button-label').textContent = status === 'home' ? 'Scan an ID' : 'Scan another ID';
  $('result').setAttribute('aria-busy', 'false');
  if (focusNextResult) { focusNextResult = false; $('result-title').focus(); }
}

async function lookup() {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  const currentToken = token;
  const timer = setTimeout(() => request.abort(), 12000);
  $('retry').disabled = true;
  $('result').setAttribute('aria-busy', 'true');
  $('record-details').hidden = true;
  $('compare-note').hidden = true;
  $('updated').textContent = '';
  $('status-icon').className = 'status-icon idle';
  $('status-icon').textContent = '↗';
  $('status-label').textContent = 'VERIFICATION SERVICE';
  $('result-title').textContent = 'Checking this ID';
  $('result-description').textContent = 'Contacting the verification registry…';
  try {
    const response = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentToken }), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: request.signal });
    if (controller !== request) return;
    if (response.status === 404 || response.status === 400) { render('missing'); return; }
    if (!response.ok) throw new Error('unavailable');
    const record = await response.json();
    if (controller !== request) return;
    if (!['active', 'expired', 'revoked', 'unconfirmed'].includes(record.status)) throw new Error('invalid result');
    render(record.status, record);
  } catch { if (controller === request) render('unavailable'); }
  finally { clearTimeout(timer); }
}

function demoResult(status) {
  document.querySelectorAll('[data-demo]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.demo === status)));
  render(status, ['missing', 'unavailable'].includes(status) ? undefined : {
    maskedName: 'J*** D*** C***', reference: 'VRF-DEMO7K4Q9X2A', issuedOn: '2026-10-01',
    validUntil: status === 'expired' ? '2025-06-30' : '2028-06-30', updatedAt: '2026-10-26T00:30:00Z',
    publishedAt: '2026-10-26T00:31:00Z', issuer: 'Municipal Treasury Office, Dipaculao',
  });
}

$('retry').addEventListener('click', lookup);
setupScanner({ onScan(scannedToken) {
  focusNextResult = true;
  if (location.pathname === '/verify' && !location.search) {
    if (location.hash === `#${scannedToken}`) { token = scannedToken; lookup(); }
    else location.hash = scannedToken;
  } else location.assign(`/verify#${scannedToken}`);
} });
addEventListener('hashchange', () => {
  if (demo) return;
  fragment = location.hash.slice(1);
  token = /^[a-f0-9]{64}$/.test(fragment) ? fragment : '';
  if (token) lookup();
  else { controller?.abort(); controller = undefined; render(fragment ? 'missing' : 'home'); }
});
if (demo) {
  $('demo-banner').hidden = false;
  $('demo-controls').hidden = false;
  document.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', () => demoResult(button.dataset.demo)));
  demoResult('active');
} else if (token) lookup();
else render(fragment ? 'missing' : 'home');
