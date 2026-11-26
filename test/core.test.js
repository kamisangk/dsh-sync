import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDav, parseEntry } from '../lib/core.js'

const config = { url: 'https://dav.example.net/a/sync', username: 'user', password: 'pass' }
const manifestPath = '/a/sync/dsh-sync.json'
const sha = 'abcdef0123456789'.repeat(2) + 'abcdef01'
const npm = (name, version = '1.0.0', enabled = true) => ({ name, version, spec: `${name}@${version}`, enabled })

function mockDav({ ignoreMatch = false, ignoreNone = false, weakEtag = false, beforePut } = {}) {
  const files = new Map()
  const requests = []
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
    if (method === 'PUT') {
      if (path === manifestPath && beforePut) await beforePut(record)
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

test('publication unions only local additions, preserves conflicts, and archives the previous current', async () => {
  const server = mockDav()
  const dav = createDav(config, server.fetcher)
  const a = npm('a')
  const b = npm('b')
  assert.deepEqual(await dav.read(), { entries: [], historyCount: 0 })
  assert.deepEqual(await dav.publish([b]), { entries: [b], added: 1, historyCount: 0 })
  assert.equal(server.writes()[0].headers.get('if-none-match'), '*')
  assert.deepEqual(await dav.publish([npm('b', '2.0.0', false), a]), { entries: [a, b], added: 1, historyCount: 1 })
  assert.match(server.writes()[1].headers.get('if-match'), /^"rev-/)
  assert.deepEqual(server.manifest().history, [[b]])
  assert.deepEqual(await dav.publish([npm('a', '2.0.0')]), { entries: [a, b], added: 0, historyCount: 1 })
  assert.equal(server.writes().length, 2)
  assert.deepEqual([...server.files.keys()], [manifestPath])
  assert.deepEqual(await dav.read(), { entries: [a, b], historyCount: 1 })
})

test('backup retention excludes current and can trim on an unchanged sync', async () => {
  const server = mockDav()
  const dav = createDav(config, server.fetcher)
  for (const name of ['a', 'b', 'c', 'd']) await dav.publish([npm(name)], 2)
  const document = server.manifest()
  assert.deepEqual(document.history.map(entries => entries.map(entry => entry.name)), [['a', 'b', 'c'], ['a', 'b']])
  assert.deepEqual(await dav.publish([], 1), { entries: document.entries, added: 0, historyCount: 1 })
  assert.deepEqual(server.manifest().history, [document.history[0]])
  assert.deepEqual(await dav.publish([], 0), { entries: document.entries, added: 0, historyCount: 0 })
  assert.deepEqual(await dav.publish([npm('e')], 0), { entries: [...document.entries, npm('e')], added: 1, historyCount: 0 })
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
  assert.deepEqual(await first.read(), { entries: [a, b], historyCount: 1 })
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
  assert.equal(doc.history[0].length, 2)
  assert.deepEqual(doc.history[1], [a])
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

test('oversized history blocks the entire update instead of silently dropping backups', async () => {
  const server = mockDav()
  const dav = createDav(config, server.fetcher)
  const entries = Array.from({ length: 160 }, (_, i) => npm(`long-${i}-${'a'.repeat(190)}`, `1.0.0+${'b'.repeat(240)}`))
  const historyCount = Math.floor((4 * 1024 * 1024 - Buffer.byteLength(JSON.stringify({ version: 1, entries, history: [] }))) / (Buffer.byteLength(JSON.stringify(entries)) + 1))
  assert.ok(historyCount < 50)
  server.seed({ version: 1, entries, history: Array.from({ length: historyCount }, () => entries) })
  assert.equal((await dav.read()).historyCount, historyCount)
  await assert.rejects(dav.publish([npm('new')], 50), /lower backup retention/)
  assert.deepEqual(server.writes(), [])
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
