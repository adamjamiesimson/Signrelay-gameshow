import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyHosting } from '../scripts/verify-hosting.mjs';

test('Hosting verification retries HTML and stale manifests, then checks release bytes and content types', async () => {
  const html = Buffer.from('<!doctype html>');
  const worker = Buffer.from('/* worker */');
  const manifest = { version: 'ready', assets: [{ path: 'index.html', bytes: html.length,
    sha256: createHash('sha256').update(html).digest('hex') }] };
  const messages = [];
  let polls = 0;
  const request = async url => {
    assert.match(url.searchParams.get('release'), /^ready-/);
    switch (url.pathname) {
      case '/runtime.json':
        if (++polls === 1) return new Response(html, { headers: { 'Content-Type': 'text/html' } });
        return Response.json(polls === 2 ? { version: 'old' } : manifest);
      case '/sw.js':
        return new Response(worker, { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' } });
      default:
        return new Response(html, { headers: { 'Content-Type': 'text/html', 'Permissions-Policy': 'camera=(self), microphone=()',
          'Content-Security-Policy': "default-src 'self'" } });
    }
  };
  await verifyHosting('https://signrelay-gameshow.web.app/', { manifest, worker }, { request, delays: [0, 0, 0], report: message => messages.push(message) });
  assert.match(messages[0], /HTTP 200, text\/html/);
  assert.match(messages[1], /version old does not match ready/);
  assert.match(messages[2], /^Verified .*ready/);
});
