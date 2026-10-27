import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireCamera, cameraErrorMessage, stopTracks, verificationTokenFromQr } from '../public/scanner.mjs';

const origin = 'https://residential-id.netlify.app';
const token = 'a'.repeat(64);
test('scanner accepts only supported links for the current verification website', () => {
  assert.equal(verificationTokenFromQr(`${origin}/verify#${token}`, origin), token);
  assert.equal(verificationTokenFromQr(` ${origin}/verify/#${token}\n`, origin), token);
  for (const value of [
    `https://other.example/verify#${token}`, `http://residential-id.netlify.app/verify#${token}`,
    `${origin}.evil.example/verify#${token}`, `https://user:password@residential-id.netlify.app/verify#${token}`,
    `${origin}/verify?demo=1#${token}`, `${origin}/verify?redirect=https://other.example#${token}`,
    `${origin}/#${token}`, `${origin}/verify#short`, `${origin}/verify#${token.toUpperCase()}`,
    'javascript:alert(1)', '{"fullName":"Legacy QR payload"}', '/verify#' + token,
    'x'.repeat(2049), null,
  ]) assert.equal(verificationTokenFromQr(value, origin), '', String(value));
});
test('HTTP loopback links work only within a matching local preview', () => {
  assert.equal(verificationTokenFromQr(`http://127.0.0.1:4174/verify#${token}`, 'http://127.0.0.1:4174'), token);
  assert.equal(verificationTokenFromQr(`http://127.0.0.1:4174/verify#${token}`, origin), '');
  assert.equal(verificationTokenFromQr(`http://other.example/verify#${token}`, 'http://other.example'), '');
});
test('permission denial, missing camera and busy camera have usable photo fallbacks', () => {
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /not allowed.*photo/);
  assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /No camera.*photo/);
  assert.match(cameraErrorMessage({ name: 'NotReadableError' }), /busy.*photo/);
  assert.match(cameraErrorMessage(new Error()), /could not start.*photo/);
});
test('all camera tracks are stopped during cleanup', () => {
  let stops = 0;
  stopTracks({ getTracks: () => [{ stop() { stops++; } }, { stop() { stops++; } }] });
  stopTracks(null);
  assert.equal(stops, 2);
});
test('a camera granted after the scanner closes is stopped immediately', async () => {
  let resolve, stops = 0, current = true;
  const pending = acquireCamera({ getUserMedia: () => new Promise(done => { resolve = done; }) }, () => current);
  current = false;
  resolve({ getTracks: () => [{ stop() { stops++; } }] });
  assert.equal(await pending, null);
  assert.equal(stops, 1);
});
test('camera acquisition requests the rear camera without a microphone', async () => {
  let requested;
  const stream = { getTracks: () => [] };
  assert.equal(await acquireCamera({ getUserMedia: async constraints => { requested = constraints; return stream; } }, () => true), stream);
  assert.equal(requested.audio, false);
  assert.equal(requested.video.facingMode.ideal, 'environment');
});
