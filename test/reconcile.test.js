import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDav } from '../lib/core.js';
import { inventory } from '../lib/planner.js';
import { planReconciliation } from '../lib/reconcile.js';

const config = {url: 'https://dav.example.net/a/sync/', username: 'user', password: 'pass'};
const manifestPath = '/a/sync/dsh-sync.json';
const sha = 'abcdef0123456789'.repeat(2) + 'abcdef01';

const entry = (name, version = '1.0.0', enabled = true) => ({name, version, spec: `${name}@${version}`, enabled});
const bundle = (name, version = '1.0.0', enabled = true, source) => ({
  name, version, source: source ?? `${name}@^${version}`, enabled, update: 'registry', rows: [], availability: 'profile',
});
const localOf = (...bundles) => inventory(bundles, []);
const gitEntry = (name, version = '1.0.0', enabled = true) => ({
  name, version, spec: `github:owner/${name}#${sha}`, enabled,
});

function mockDav({ignorePreconditions = false} = {}) {
  const files = new Map();
  const locks = new Map();
  const requests = [];
  let revision = 0;
  let tokens = 0;
  const etag = () => `"rev-${++revision}"`;
  const tokenIn = headers => (headers.get('if') ?? '').match(/^[(]<([^>]+)>[)]$/)?.[1];
  const fetcher = async (url, init) => {
    const {pathname, origin} = new URL(url);
    assert.equal(origin, 'https://dav.example.net');
    assert.equal(init.redirect, 'error');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Basic dXNlcjpwYXNz');
    const {method, body} = init;
    const record = {path: pathname, method, body, headers, status: 0};
    requests.push(record);
    const locked = locks.has(pathname);
    if (method === 'GET') {
      const file = files.get(pathname);
      record.status = file ? 200 : 404;
      return file ? new Response(file.body, {headers: {etag: file.etag}}) : new Response(null, {status: 404});
    }
    if (method === 'LOCK') {
      if (locked) { record.status = 423; return new Response(null, {status: 423}); }
      const token = String(++tokens);
      locks.set(pathname, token);
      if (!files.has(pathname)) files.set(pathname, {body: '', etag: etag()});
      record.status = 201;
      return new Response(null, {status: 201, headers: {'lock-token': `<${token}>`}});
    }
    if (method === 'UNLOCK') {
      if (locks.get(pathname) !== (headers.get('lock-token') ?? '').slice(1, -1)) { record.status = 409; return new Response(null, {status: 409}); }
      locks.delete(pathname);
      record.status = 204;
      return new Response(null, {status: 204});
    }
    if (method === 'PUT') {
      const previous = files.get(pathname);
      if (!ignorePreconditions) {
        const match = headers.get('if-match');
        if ((match && previous?.etag !== match) || (headers.get('if-none-match') === '*' && previous)) {
          record.status = 412;
          return new Response(null, {status: 412});
        }
      }
      if (ignorePreconditions && locked && tokenIn(headers) !== locks.get(pathname)) {
        record.status = 423;
        return new Response(null, {status: 423});
      }
      files.set(pathname, {body, etag: etag()});
      record.status = previous ? 204 : 201;
      return new Response(null, {status: record.status, headers: {etag: files.get(pathname).etag}});
    }
    if (method === 'DELETE') {
      if (locked) { record.status = 423; return new Response(null, {status: 423}); }
      const existed = files.delete(pathname);
      record.status = existed ? 204 : 404;
      return new Response(null, {status: record.status});
    }
    record.status = 405;
    return new Response(null, {status: 405});
  };
  return {
    fetcher, requests, files, locks,
    seed(document) { files.set(manifestPath, {body: JSON.stringify(document), etag: etag()}); },
    manifest() { return JSON.parse(files.get(manifestPath).body); },
    writes() { return requests.filter(record => record.method === 'PUT' && record.path === manifestPath); },
    stored() { return this.manifest().entries; },
  };
}

// ---------------------------------------------------------------- reconciliation

test('a portable local-only plugin is published; no baseline is invented for a differing pair', () => {
  const result = planReconciliation(localOf(bundle('alpha')), [], []);
  assert.deepEqual(result.items.map(item => [item.name, item.kind, item.canPublishLocal]), [['alpha', 'local-only', true]]);
  assert.deepEqual(result.nextEntries, [entry('alpha')]);
  assert.deepEqual(result.baseline, []);
});

test('a remote row this machine lacks is offered as an install, including a previously synced one', () => {
  const result = planReconciliation(localOf(), [entry('beta')], [entry('beta')]);
  assert.deepEqual(result.items.map(item => [item.kind, item.selectable, item.selected, item.canApplyRemote, item.remoteKind]),
    [['install', true, true, true, 'install']]);
  assert.deepEqual(result.nextEntries, [entry('beta')], 'the remote row is preserved');
  assert.deepEqual(result.baseline, [entry('beta')], 'a missing side never deletes the baseline');
});

test('equal sides agree silently and establish the baseline', () => {
  const result = planReconciliation(localOf(bundle('alpha')), [entry('alpha')], []);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.baseline, [entry('alpha')]);
  assert.deepEqual(result.nextEntries, [entry('alpha')]);
});

test('a remote-only change offers the remote side and keeps the old baseline', () => {
  const result = planReconciliation(localOf(bundle('alpha')), [entry('alpha', '1.1.0')], [entry('alpha')]);
  const [item] = result.items;
  assert.deepEqual([item.kind, item.selectable, item.selected, item.canApplyRemote, item.remoteKind],
    ['upgrade', true, false, true, 'upgrade']);
  assert.deepEqual(result.nextEntries, [entry('alpha', '1.1.0')], 'the local row is not written');
  assert.deepEqual(result.baseline, [entry('alpha')], 'the baseline waits until the sides agree');
});

test('a local-only change is published, and the baseline waits for that write', () => {
  const result = planReconciliation(localOf(bundle('alpha', '1.1.0')), [entry('alpha')], [entry('alpha')]);
  assert.deepEqual(result.items.map(item => [item.kind, item.canPublishLocal]), [['local-update', true]]);
  assert.deepEqual(result.items[0].remote, entry('alpha'), 'the pending remote value stays visible');
  assert.deepEqual(result.nextEntries, [entry('alpha', '1.1.0')]);
  assert.deepEqual(result.baseline, [entry('alpha')], 'the baseline advances only after the write succeeds');
});

test('divergence is a conflict that names the side worth taking', () => {
  const localNewer = planReconciliation(localOf(bundle('alpha', '2.0.0')), [entry('alpha', '1.5.0')], [entry('alpha')]);
  assert.deepEqual(localNewer.items.map(item => [item.kind, item.canPublishLocal, item.canApplyRemote, item.reason]),
    [['conflict', true, false, 'divergent']]);

  const remoteNewer = planReconciliation(localOf(bundle('alpha', '1.1.0')), [entry('alpha', '2.0.0')], [entry('alpha')]);
  assert.deepEqual(remoteNewer.items.map(item => [item.kind, item.canPublishLocal, item.canApplyRemote, item.remoteKind, item.reason]),
    [['conflict', false, true, 'upgrade', 'divergent']]);
  assert.deepEqual(remoteNewer.baseline, [entry('alpha')]);
});

test('an unbased mismatch is a conflict instead of a guess, and never writes', () => {
  const result = planReconciliation(localOf(bundle('alpha', '1.0.0')), [entry('alpha', '1.1.0')], []);
  const [item] = result.items;
  assert.deepEqual([item.kind, item.canPublishLocal, item.canApplyRemote, item.remoteKind, item.reason],
    ['conflict', false, true, 'upgrade', 'no-baseline']);
  assert.deepEqual(result.nextEntries, [entry('alpha', '1.1.0')]);
  assert.deepEqual(result.baseline, [], 'a differing pair infers no baseline');
});

test('a remote-side change that cannot be applied is manual, not a conflict', () => {
  const result = planReconciliation(localOf(bundle('alpha')), [gitEntry('alpha')], [entry('alpha')]);
  assert.deepEqual(result.items.map(item => [item.kind, item.canPublishLocal, item.canApplyRemote, item.reason]),
    [['manual', false, false, 'remote-change-not-applicable']]);
});

test('a local development plugin stays manual and never reaches the remote list', () => {
  const local = localOf(bundle('thing', '1.0.0', true, 'link:D:/dev/thing'));
  const result = planReconciliation(local, [entry('beta')], []);
  assert.deepEqual(result.items.map(item => [item.name, item.kind, item.reason]),
    [['beta', 'install', undefined], ['thing', 'manual', 'local-source']]);
  assert.deepEqual(result.nextEntries, [entry('beta')], 'only the owned remote row survives');
});

test('the published list never loses a row it already had', () => {
  const result = planReconciliation(localOf(bundle('alpha')), [entry('alpha'), entry('beta')], [entry('alpha')]);
  assert.deepEqual(result.nextEntries.map(item => item.name), ['alpha', 'beta']);
});

test('rows this machine does not own are preserved byte for byte', () => {
  const foreign = [
    {name: '@deepseek-ai/dsh-base', version: '0.2.2', spec: '@deepseek-ai/dsh-base@0.2.2', enabled: true},
    {name: '@deepseek-ai/dsh-web-app', version: '0.2.2', spec: '@deepseek-ai/dsh-web-app@0.2.2', enabled: false},
    {name: '@kamisangk/dsh-sync', version: '0.1.0', spec: '@kamisangk/dsh-sync@0.1.0', enabled: true},
  ];
  const result = planReconciliation(localOf(bundle('alpha')), [entry('alpha'), ...foreign], []);
  assert.deepEqual(result.items, [], 'no decision is made about foreign rows');
  assert.deepEqual(result.nextEntries, [entry('alpha'), ...foreign].sort((left, right) => (left.name < right.name ? -1 : 1)));
  assert.deepEqual(result.baseline, [entry('alpha')]);
});

test('a conflict keeps the baseline that produced it', () => {
  const base = entry('alpha', '1.0.0');
  const result = planReconciliation(localOf(bundle('alpha', '2.0.0')), [entry('alpha', '1.5.0')], [base]);
  const [conflict] = result.items;
  assert.deepEqual([conflict.kind, conflict.baseline], ['conflict', base]);
});

// ---------------------------------------------------------------- update()

test('update archives the previous list whenever an existing row changes', async () => {
  const server = mockDav();
  const dav = createDav(config, server.fetcher);
  server.seed({version: 1, entries: [entry('alpha')], history: []});
  const result = await dav.update(entries => entries.map(item => ({...item, enabled: false})), 5);
  assert.deepEqual([result.added, result.updated, result.historyCount], [0, 1, 1]);
  assert.deepEqual(result.entries, [entry('alpha', '1.0.0', false)]);
  assert.deepEqual(server.manifest().history, [[entry('alpha')]]);
  assert.deepEqual(server.stored(), [entry('alpha', '1.0.0', false)]);
});

test('update writes nothing when the transform changes nothing', async () => {
  const server = mockDav();
  const dav = createDav(config, server.fetcher);
  server.seed({version: 1, entries: [entry('alpha')], history: [[entry('beta')]]});
  const result = await dav.update(entries => entries, 5);
  assert.deepEqual([result.added, result.updated, result.historyCount], [0, 0, 1]);
  assert.equal(server.writes().length, 0);
});

test('a reduced retention trims history without inventing a backup', async () => {
  const server = mockDav();
  const dav = createDav(config, server.fetcher);
  server.seed({version: 1, entries: [entry('alpha')], history: [[entry('one')], [entry('two')], [entry('three')]]});
  const result = await dav.update(entries => entries, 1);
  assert.deepEqual([result.added, result.updated, result.historyCount], [0, 0, 1]);
  assert.deepEqual(server.manifest().history, [[entry('one')]]);
  assert.equal(server.writes().length, 1);
});

test('update refuses to drop a row the remote list already has', async () => {
  const server = mockDav();
  const dav = createDav(config, server.fetcher);
  server.seed({version: 1, entries: [entry('alpha'), entry('beta')], history: []});
  await assert.rejects(dav.update(() => [entry('alpha')]), /must not remove/);
  assert.equal(server.writes().length, 0);
  assert.deepEqual(server.stored().map(item => item.name), ['alpha', 'beta']);
});

test('a transform error reaches the caller unchanged', async () => {
  const server = mockDav();
  const dav = createDav(config, server.fetcher);
  server.seed({version: 1, entries: [entry('alpha')], history: []});
  class StalePlan extends Error { name = 'StalePlan'; }
  const failure = new StalePlan('the preview is stale');
  await assert.rejects(dav.update(() => { throw failure; }), error => error === failure);
  assert.equal(server.writes().length, 0);
});

test('the transform runs again after a lost conditional write and sees the new list', {timeout: 5_000}, async () => {
  const server = mockDav();
  const dav = createDav(config, server.fetcher);
  server.seed({version: 1, entries: [entry('alpha')], history: []});
  const seen = [];
  let raced = false;
  const fetcher = async (url, init) => {
    // A second device wins the manifest between our GET and PUT: answer 412 and let it stand.
    if (!raced && init.method === 'PUT' && new URL(url).pathname === manifestPath) {
      raced = true;
      server.seed({version: 1, entries: [entry('alpha'), entry('beta')], history: []});
      return new Response(null, {status: 412});
    }
    return server.fetcher(url, init);
  };
  const racing = createDav(config, fetcher);
  const result = await racing.update(entries => {
    seen.push(entries.map(item => item.name).join(','));
    return [...entries, entry('gamma')];
  }, 5);
  assert.equal(seen.length, 2, 'the transform ran twice');
  assert.deepEqual(seen, ['alpha', 'alpha,beta'], 'the retry saw the concurrent writer');
  assert.deepEqual(result.entries.map(item => item.name), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(server.stored().map(item => item.name), ['alpha', 'beta', 'gamma']);
});

test('update works under a lock-only server and releases the lock', {timeout: 5_000}, async () => {
  const server = mockDav({ignorePreconditions: true});
  const dav = createDav(config, server.fetcher);
  assert.equal(await dav.mode(), 'lock');
  server.seed({version: 1, entries: [entry('alpha')], history: []});
  const result = await dav.update(entries => [...entries, entry('beta')], 5);
  assert.deepEqual(result.entries.map(item => item.name), ['alpha', 'beta']);
  assert.equal(result.added, 1);
  assert.equal(server.locks.size, 0, 'every lock is released');
});