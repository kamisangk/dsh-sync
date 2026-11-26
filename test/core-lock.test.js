import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDav } from '../lib/core.js'

const config = { url: 'https://dav.example.net/a/sync', username: 'user', password: 'pass' }
const manifestPath = '/a/sync/dsh-sync.json'
const npm = (name, version = '1.0.0', enabled = true) => ({ name, version, spec: `${name}@${version}`, enabled })

// Mimics a server that ignores ETag preconditions (Koofr) but enforces RFC 4918 write locks.
function mockLockDav({ ignorePreconditions = true, acceptWrongToken = false, holdLockMs = 0 } = {}) {
  const files = new Map()
  const locks = new Map()
  const requests = []
  let revision = 0
  let tokens = 0
  const etag = () => `"rev-${++revision}"`
  const tokenIn = headers => {
    const header = headers.get('if') ?? ''
    const match = header.match(/^[(]<([^>]+)>[)]$/)
    return match?.[1]
  }
  const fetcher = async (url, init) => {
    const { pathname, origin } = new URL(url)
    assert.equal(origin, 'https://dav.example.net')
    assert.equal(init.redirect, 'error')
    const headers = new Headers(init.headers)
    assert.equal(headers.get('authorization'), 'Basic dXNlcjpwYXNz')
    const { method, body } = init
    const record = { path: pathname, method, body, headers, status: 0 }
    requests.push(record)
    const locked = locks.has(pathname)
    if (method === 'GET') {
      const file = files.get(pathname)
      record.status = file ? 200 : 404
      return file ? new Response(file.body, { headers: { etag: file.etag } }) : new Response(null, { status: 404 })
    }
    if (method === 'LOCK') {
      if (locked) { record.status = 423; return new Response(null, { status: 423 }) }
      const token = String(++tokens)
      locks.set(pathname, token)
      if (!files.has(pathname)) files.set(pathname, { body: '', etag: etag() })
      if (holdLockMs) setTimeout(() => locks.delete(pathname), holdLockMs)
      record.status = 201
      return new Response(null, { status: 201, headers: { 'lock-token': `<${token}>` } })
    }
    if (method === 'UNLOCK') {
      const header = headers.get('lock-token') ?? ''
      if (locks.get(pathname) !== header.slice(1, -1)) { record.status = 409; return new Response(null, { status: 409 }) }
      locks.delete(pathname)
      record.status = 204
      return new Response(null, { status: 204 })
    }
    if (method === 'PUT') {
      // Preconditions are ignored, exactly like the live server under test.
      if (locked && !acceptWrongToken && tokenIn(headers) !== locks.get(pathname)) {
        record.status = 423
        return new Response(null, { status: 423 })
      }
      files.set(pathname, { body, etag: etag() })
      record.status = 201
      return new Response(null, { status: 201, headers: { etag: files.get(pathname).etag } })
    }
    if (method === 'DELETE') {
      if (locked) { record.status = 423; return new Response(null, { status: 423 }) }
      const existed = files.delete(pathname)
      locks.delete(pathname)
      record.status = existed ? 204 : 404
      return new Response(null, { status: record.status })
    }
    record.status = 405
    return new Response(null, { status: 405 })
  }
  return {
    fetcher, requests, files, locks,
    seed(document) { files.set(manifestPath, { body: JSON.stringify(document), etag: etag() }) },
    manifest() { return JSON.parse(files.get(manifestPath).body) },
    manifestWrites() { return requests.filter(r => r.method === 'PUT' && r.path === manifestPath) },
  }
}

test('lock mode is detected when ETag preconditions are ignored, and unions additions', async () => {
  const server = mockLockDav()
  const dav = createDav(config, server.fetcher)
  assert.equal(await dav.mode(), 'lock')
  const a = npm('a')
  assert.deepEqual(await dav.publish([a]), { entries: [a], added: 1, historyCount: 0 })
  assert.deepEqual(await dav.publish([npm('b')]), { entries: [a, npm('b')], added: 1, historyCount: 1 })
  for (const write of server.manifestWrites()) assert.match(write.headers.get('if'), /^[(]<[0-9]+>[)]$/)
  assert.equal(server.locks.size, 0, 'every lock is released')
  assert.equal(server.files.get(manifestPath).body.includes('dsh-sync-probe'), false)
})

test('concurrent publishers serialize through the lock and keep both additions', { timeout: 10_000 }, async () => {
  const server = mockLockDav({ holdLockMs: 0 })
  const first = createDav(config, server.fetcher)
  const second = createDav(config, server.fetcher)
  const [a, b] = await Promise.all([first.publish([npm('a')]), second.publish([npm('b')])])
  assert.equal(a.added + b.added, 2)
  assert.deepEqual((await first.read()).entries.map(entry => entry.name), ['a', 'b'])
  assert.equal((await first.read()).historyCount, 1)
})

test('a publisher backs off while another device holds the lock', { timeout: 10_000 }, async () => {
  const server = mockLockDav()
  const dav = createDav(config, server.fetcher)
  await dav.mode()
  const locked = server.requests.length
  server.locks.set(manifestPath, 'another-device')
  setTimeout(() => server.locks.delete(manifestPath), 500)
  const started = Date.now()
  const result = await dav.publish([npm('a')])
  assert.equal(result.added, 1)
  assert.ok(Date.now() - started >= 300, 'retried instead of failing immediately')
  assert.ok(server.requests.slice(locked).some(record => record.method === 'LOCK' && record.status === 423))
})

test('a server that accepts writes under the wrong lock token is refused', async () => {
  const server = mockLockDav({ acceptWrongToken: true })
  const dav = createDav(config, server.fetcher)
  await assert.rejects(dav.mode(), /neither conditional writes .* nor exclusive write locks/)
  assert.deepEqual(server.manifestWrites(), [])
})