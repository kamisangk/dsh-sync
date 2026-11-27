import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDav, parseEntry } from '../lib/core.js'
import { describeSnapshot } from '../lib/backup.js'

const config = { url: 'https://dav.example.net/a/sync', username: 'user', password: 'pass' }
const manifestPath = '/a/sync/dsh-sync.json'
const indexPath = '/a/sync/backup/plugins/index.json'
const backupFiles = () => ({
  'package.json': Buffer.from('{"name":"demo","version":"1.0.0"}\n'),
  'plugins.json': Buffer.from('{"version":1,"entries":[]}\n'),
})
const sha = 'abcdef0123456789'.repeat(2) + 'abcdef01'
const npm = (name, version = '1.0.0', enabled = true) => ({ name, version, spec: `${name}@${version}`, enabled })

function mockDav({ ignoreMatch = false, ignoreNone = false, weakEtag = false, beforePut, rejectIndexOnce = false } = {}) {
  const files = new Map()
  const requests = []
  const collections = new Set(['/a/sync/'])
  let indexRejections = 0
  let revision = 0
  const tag = () => `${weakEtag ? 'W/' : ''}"rev-${++revision}"`
  const fetcher = async (url, init) => {
    const target = new URL(url)
    assert.equal(target.origin, 'https://dav.example.net')
    assert.match(target.pathname, /^\/a\/sync\//)
    assert.equal(init.redirect, 'error')
    assert(init.signal instanceof AbortSignal)
    const headers = new Headers(init.headers)
    assert.equal(headers.get('authorization'), 'Basic dXNlcjpwYXNz')
    const path = target.pathname
    const { method, body } = init
    const record = { path, method, body, headers }
    requests.push(record)
    if (method === 'MKCOL') {
      if (!path.endsWith('/')) return new Response(null, { status: 409 })
      if (collections.has(path)) return new Response(null, { status: 405 })
      const parent = path.replace(/[^/]+\/$/, '')
      if (!collections.has(parent)) return new Response(null, { status: 409 })
      collections.add(path)
      return new Response(null, { status: 201 })
    }
    if (method === 'PUT') {
      if (beforePut) await beforePut(record)
      if (rejectIndexOnce && path === indexPath && indexRejections === 0) {
        indexRejections += 1
        return new Response(null, { status: 412 })
      }
      const previous = files.get(path)
      const match = headers.get('if-match')
      if (!ignoreMatch && match && previous?.etag !== match ||
          !ignoreNone && headers.get('if-none-match') === '*' && previous) {
        record.status = 412
        return new Response(null, { status: 412 })
      }
      const etag = tag()
      files.set(path, { body, etag })
      record.status = previous ? 204 : 201
      return new Response(null, { status: record.status, headers: { etag } })
    }
    if (method === 'GET') {
      const file = files.get(path)
      return file ? new Response(file.body, { headers: { etag: file.etag } }) : new Response(null, { status: 404 })
    }
    if (method === 'DELETE') return new Response(null, { status: files.delete(path) ? 204 : 404 })
    return new Response(null, { status: 405 })
  }
  return {
    fetcher, requests, files,
    collections,
    seed(document) { files.set(manifestPath, { body: JSON.stringify(document), etag: tag() }) },
    manifest() { return JSON.parse(files.get(manifestPath).body) },
    writes() { return requests.filter(({ method, path }) => method === 'PUT' && path === manifestPath) },
  }
}

function twoPartBarrier() {
  let arrivals = 0
  let open
  const gate = new Promise(resolve => { open = resolve })
  return async () => {
    if (++arrivals === 2) open()
    await gate
  }
}

test('plugin specs are exact npm or pinned GitHub only', () => {
  const exact = npm('@test/handy-tool', '1.2.3-rc.1+build.3', false)
  assert.deepEqual(parseEntry({ ...exact, unrelated: 'ignored' }), exact)
  const pinned = { ...npm('another-tool'), spec: `github:Owner/Another-Tool#${sha.toUpperCase()}` }
  assert.deepEqual(parseEntry(pinned), { ...pinned, spec: `github:owner/another-tool#${sha}` })
  for (const spec of ['tool@^1.0.0', 'tool@latest', 'other@1.0.0', 'tool@1.0.0\n', 'tool@npm:other@1.0.0',
    'file:/tmp/tool', 'link:../tool', 'https://github.com/o/r', 'git+ssh://git@github.com/o/r', 'gitlab:o/r', 'o/r',
    'github:owner/repo#main', 'github:owner/repo#abcdef0', `github:owner/..#${sha}`, `github:owner/repo/sub#${sha}`,
    `github:owner/repo#${sha}\n`, `github:owner/repo#${sha}?token=abc`]) {
    assert.throws(() => parseEntry({ ...npm('tool'), spec }), TypeError, spec)
  }
  for (const entry of [npm('Upper'), npm('x', '01.0.0'), npm('x', '1.0.0-rc.01'), npm('x', '1.0.0\n'),
    npm('x', '1.0.0', 'true'), { ...npm('x'), enabled: undefined }]) assert.throws(() => parseEntry(entry), TypeError)
})

test('publication unions only local additions, preserves conflicts, and keeps manifest history empty', async () => {
  const server = mockDav()
  const dav = createDav(config, server.fetcher)
  const a = npm('a')
  const b = npm('b')
  assert.deepEqual(await dav.read(), { entries: [], historyCount: 0 })
  assert.deepEqual(await dav.publish([b]), { entries: [b], added: 1, historyCount: 0 })
  assert.equal(server.writes()[0].headers.get('if-none-match'), '*')
  assert.deepEqual(await dav.publish([npm('b', '2.0.0', false), a]), { entries: [a, b], added: 1, historyCount: 0 })
  assert.match(server.writes()[1].headers.get('if-match'), /^"rev-/)
  assert.deepEqual(server.manifest().history, [])
  assert.deepEqual(await dav.publish([npm('a', '2.0.0')]), { entries: [a, b], added: 0, historyCount: 0 })
  assert.equal(server.writes().length, 2)
  assert.deepEqual([...server.files.keys()], [manifestPath])
  assert.deepEqual(await dav.read(), { entries: [a, b], historyCount: 0 })
})

test('manifest clears legacy history and validates retention range', async () => {
  const server = mockDav()
  const dav = createDav(config, server.fetcher)
  server.seed({ version: 1, entries: [npm('a')], history: [[npm('legacy')]] })
  assert.equal((await dav.read()).historyCount, 1)
  assert.deepEqual(await dav.publish([], 2), { entries: [npm('a')], added: 0, historyCount: 0 })
  assert.deepEqual(server.manifest().history, [])
  for (const value of [51, -1, 1.1, '10']) await assert.rejects(dav.publish([], value), /retention/)
})

test('creation race must re-read and re-union after 412', { timeout: 3_000 }, async () => {
  const server = mockDav({ beforePut: twoPartBarrier() })
  const first = createDav(config, server.fetcher)
  const second = createDav(config, server.fetcher)
  const a = npm('a')
  const b = npm('b')
  const results = await Promise.all([first.publish([a]), second.publish([b])])
  assert.equal(results[0].added, 1)
  assert.equal(results[1].added, 1)
  assert.deepEqual(await first.read(), { entries: [a, b], historyCount: 0 })
  assert.deepEqual(server.writes().map(write => write.status), [201, 412, 204])
  assert.equal(server.writes()[1].headers.get('if-none-match'), '*')
  assert.ok(server.writes()[2].headers.get('if-match'))
})

test('update race keeps both additions and one backup per successful update', { timeout: 3_000 }, async () => {
  const server = mockDav({ beforePut: twoPartBarrier() })
  const a = npm('a')
  const b = npm('b')
  const c = npm('c')
  server.seed({ version: 1, entries: [a], history: [] })
  await Promise.all([createDav(config, server.fetcher).publish([b]), createDav(config, server.fetcher).publish([c])])
  const doc = server.manifest()
  assert.deepEqual(doc.entries, [a, b, c])
  assert.deepEqual(doc.history, [])
  assert.deepEqual(server.writes().map(write => write.status), [204, 412, 204])
})

for (const options of [{ ignoreMatch: true }, { ignoreNone: true }, { weakEtag: true }]) {
  test(`unsafe server fails closed before manifest PUT: ${Object.keys(options)[0]}`, async () => {
    const server = mockDav(options)
    const dav = createDav(config, server.fetcher)
    await assert.rejects(dav.publish([npm('a')]), /conditional writes|strong ETag/)
    assert.deepEqual(server.writes(), [])
    assert.equal(server.files.size, 0)
    assert.ok(server.requests.some(record => record.method === 'DELETE' && record.path !== manifestPath))
  })
}

test('legacy oversized history is cleared on next publish so manifest stays compact', async () => {
  const server = mockDav()
  const dav = createDav(config, server.fetcher)
  const entries = Array.from({ length: 160 }, (_, i) => npm(`long-${i}-${'a'.repeat(190)}`, `1.0.0+${'b'.repeat(240)}`))
  server.seed({ version: 1, entries, history: [entries] })
  const result = await dav.publish([npm('new')], 50)
  assert.equal(result.historyCount, 0)
  assert.deepEqual(server.manifest().history, [])
})

test('invalid remote documents, oversized streams, and redirects are rejected', async () => {
  for (const document of [{ version: 2, entries: [], history: [] }, { version: 1, entries: [npm('x'), npm('x')], history: [] },
    { version: 1, entries: [], history: [[{ ...npm('x'), spec: 'https://example.org/something.tgz' }]] }]) {
    const server = mockDav()
    server.seed(document)
    await assert.rejects(createDav(config, server.fetcher).publish([npm('local')]))
    assert.deepEqual(server.writes(), [])
  }
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); controller.close() } })
  await assert.rejects(createDav(config, async () => new Response(stream, { headers: { etag: '"a"' } })).read(), /size limit/)
  const dav = createDav(config, async (_url, init) => {
    assert.equal(init.redirect, 'error')
    return Response.redirect('https://example.org/', 302)
  })
  await assert.rejects(dav.read(), /redirects are not allowed/)
  for (const url of ['http://dav.example.net/', 'https://name:secret@dav.example.net/', 'https://dav.example.net/?foo=bar', 'https://dav.example.net/#a']) {
    assert.throws(() => createDav({ ...config, url }), /HTTPS collection|Invalid WebDAV collection/)
  }
})

test('backups write their files plus an index and come back verified', async () => {
  const server = mockDav()
  const dav = createDav(config, server.fetcher)
  const files = backupFiles()
  const entry = describeSnapshot('20260101-000000', files)
  await dav.backupWrite(entry, files, 5)
  assert.deepEqual([...server.files.keys()].sort(), [
    '/a/sync/backup/plugins/20260101-000000/package.json',
    '/a/sync/backup/plugins/20260101-000000/plugins.json',
    indexPath,
  ])
  const index = await dav.backupRead()
  assert.equal(index.snapshots.length, 1)
  assert.deepEqual(index.snapshots[0].files.map(file => file.path), ['package.json', 'plugins.json'])
  const fetched = await dav.backupFetch('20260101-000000')
  assert.deepEqual(fetched['package.json'], files['package.json'])
  assert.deepEqual(fetched['plugins.json'], files['plugins.json'])
})

test('backup retention removes the dropped folder from the collection', async () => {
  const server = mockDav()
  const dav = createDav(config, server.fetcher)
  const first = backupFiles()
  await dav.backupWrite(describeSnapshot('20260101-000000', first), first, 1)
  const second = {...backupFiles(), 'package.json': Buffer.from('{"name":"demo","version":"2.0.0"}\n')}
  await dav.backupWrite(describeSnapshot('20260101-000001', second), second, 1)
  const index = await dav.backupRead()
  assert.deepEqual(index.snapshots.map(snapshot => snapshot.id), ['20260101-000001'])
  for (const path of server.files.keys()) assert.ok(!path.includes('20260101-000000'), path)
  await assert.rejects(dav.backupFetch('20260101-000000'), /not on the remote side/)
})

test('a corrupted backup file is refused instead of restored', async () => {
  const server = mockDav()
  const dav = createDav(config, server.fetcher)
  const files = backupFiles()
  await dav.backupWrite(describeSnapshot('20260101-000000', files), files, 5)
  const stored = server.files.get('/a/sync/backup/plugins/20260101-000000/plugins.json')
  stored.body = Buffer.from('{"version":1,"entries":[{"name":"evil"}]}\n')
  await assert.rejects(dav.backupFetch('20260101-000000'), /corrupt plugins.json/)
})

test('the backup index is rewritten when another writer wins the first attempt', async () => {
  const server = mockDav({ rejectIndexOnce: true })
  const dav = createDav(config, server.fetcher)
  const files = backupFiles()
  await dav.backupWrite(describeSnapshot('20260101-000000', files), files, 5)
  const indexPuts = server.requests.filter(({ method, path }) => method === 'PUT' && path === indexPath)
  assert.equal(indexPuts.length, 2, 'the 412 forced a second read-and-merge pass')
  assert.equal((await dav.backupRead()).snapshots.length, 1)
})

test('backup ids and retention are validated before any request', async () => {
  const server = mockDav()
  const dav = createDav(config, server.fetcher)
  const files = backupFiles()
  assert.throws(() => describeSnapshot('../x', files), /Invalid snapshot id/)
  const entry = describeSnapshot('20260101-000000', files)
  await assert.rejects(dav.backupWrite(entry, files, 0), /between 1 and 50/)
  await assert.rejects(dav.backupWrite(entry, files, 51), /between 1 and 50/)
  assert.equal(server.requests.length, 0)
})

test('backupDelete removes selected snapshots from index and collection, and supports categories', async () => {
  const server = mockDav()
  const dav = createDav(config, server.fetcher)
  const files = { 'plugins.json': Buffer.from('{"version":1,"entries":[]}\n') }
  await dav.backupWrite(describeSnapshot('20260101-000001', files, '2026-01-01T00:00:01.000Z', 'plugins'), files, 5, 'plugins')
  await dav.backupWrite(describeSnapshot('20260101-000002', files, '2026-01-01T00:00:02.000Z', 'plugins'), files, 5, 'plugins')
  const sFiles = { 'settings.json': Buffer.from('{"version":1,"category":"settings","items":[]}\n') }
  await dav.backupWrite(describeSnapshot('20260101-000003', sFiles, '2026-01-01T00:00:03.000Z', 'settings'), sFiles, 5, 'settings')
  const del = await dav.backupDelete(['20260101-000001'], 'plugins')
  assert.deepEqual(del.removed, ['20260101-000001'])
  assert.deepEqual((await dav.backupRead('plugins')).snapshots.map(x => x.id), ['20260101-000002'])
  assert.deepEqual((await dav.backupRead('settings')).snapshots.map(x => x.id), ['20260101-000003'])
  assert.equal(server.files.has('/a/sync/backup/plugins/20260101-000001/plugins.json'), false)
  assert.equal(server.files.has('/a/sync/backup/settings/20260101-000003/settings.json'), true)
})
