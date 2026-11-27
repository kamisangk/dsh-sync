import { randomUUID } from 'node:crypto'
import { BACKUP_ROOT, CATEGORY, INDEX_PATH, MAX_FILE_BYTES, MAX_INDEX_BYTES, SNAPSHOT_ID, encodeIndex, mergeIndex, parseIndex, verifyFiles } from './backup.js'

const MANIFEST = 'dsh-sync.json'
const MAX_HISTORY = 50
const MAX_ENTRIES = 2_000
const MAX_BYTES = 4 * 1024 * 1024
const MAX_ATTEMPTS = 6
const RETRY_MS = 250
const TIMEOUT_MS = 15_000
const NAME_PART = '[a-z0-9][a-z0-9._-]*'
const PACKAGE_NAME = new RegExp(`^(?:@${NAME_PART}/)?${NAME_PART}$`)
// Deliberately spelled with character classes so the source needs no backslashes.
const EXACT_VERSION = /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:[.][0-9A-Za-z-]+)*))?(?:[+][0-9A-Za-z-]+(?:[.][0-9A-Za-z-]+)*)?$/
const GITHUB_SPEC = new RegExp('^github:([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)/([a-z0-9_.-]{1,100})#([0-9a-f]{40})$', 'i')
const LOCK_BODY = '<?xml version="1.0" encoding="utf-8"?><d:lockinfo xmlns:d="DAV:">' +
  '<d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype>' +
  '<d:owner><d:href>dsh-sync</d:href></d:owner></d:lockinfo>'

const BACKSLASH = String.fromCharCode(92)

export class DavError extends Error {
  name = 'DavError'
}

const PASSTHROUGH = Symbol.for('dsh-sync/transform-error')

/** Mark a caller-owned error so createDav rethrows it instead of re-wrapping it. */
function passthrough(error) {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return
  try { error[PASSTHROUGH] = true } catch { /* frozen error: it still reaches the caller as a DavError */ }
}

/** A lock held by another writer; the caller may retry after the holder finishes. */
export class DavBusyError extends DavError {
  name = 'DavBusyError'
}

function isControlOrSpaceFree(value) {
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

function isStrongEtag(value) {
  if (typeof value !== 'string' || value.length < 2 || value[0] !== '"' || value[value.length - 1] !== '"') return false
  for (const character of value.slice(1, -1)) {
    const code = character.codePointAt(0)
    const visible = code === 0x21 || (code >= 0x23 && code <= 0x7e)
    const extended = code >= 0x80 && code <= 0xff
    if (!visible && !extended) return false
  }
  return true
}

function exactVersion(version) {
  if (typeof version !== 'string' || version.length > 256 || version.trim() !== version) return false
  const match = EXACT_VERSION.exec(version)
  if (!match || match[0] !== version || match.slice(1, 4).some(part => !Number.isSafeInteger(Number(part)))) return false
  return !match[4]?.split('.').some(part => /^0[0-9]+$/.test(part))
}

export function parseEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid plugin entry')
  const { name, version, spec, enabled } = value
  if (typeof name !== 'string' || name.length > 214 || name.trim() !== name || !PACKAGE_NAME.test(name) ||
      ['node_modules', 'favicon.ico'].includes(name) || !exactVersion(version) ||
      typeof enabled !== 'boolean' || typeof spec !== 'string' || spec.length > 512) {
    throw new TypeError('Invalid plugin name, version, spec or enabled flag')
  }
  if (spec === `${name}@${version}`) return { name, version, spec, enabled }
  const git = GITHUB_SPEC.exec(spec)
  if (git && git[0] === spec && !['.', '..'].includes(git[2]) && !git[1].includes('--')) {
    return { name, version, spec: spec.toLowerCase(), enabled }
  }
  throw new TypeError('Plugin source must be an exact npm package or a GitHub repository pinned to a full commit')
}

function parseEntries(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new TypeError(`Plugin entries must be an array of at most ${MAX_ENTRIES} items`)
  const names = new Set()
  const sorted = entries.map(value => {
    const entry = parseEntry(value)
    if (names.has(entry.name)) throw new TypeError('Duplicate plugin name in manifest')
    names.add(entry.name)
    return entry
  })
  return sorted.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

const EMPTY_DOCUMENT = () => ({ version: 1, entries: [], history: [] })

function parseDocument(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.history) || value.history.length > MAX_HISTORY) {
    throw new TypeError('Unsupported WebDAV manifest format or history size')
  }
  return { version: 1, entries: parseEntries(value.entries), history: value.history.map(parseEntries) }
}

function encodeDocument(document) {
  const body = JSON.stringify(document)
  if (Buffer.byteLength(body) > MAX_BYTES) throw new DavError('WebDAV manifest and history exceed the 4 MiB limit; lower backup retention')
  return body
}

function discard(response) {
  response.body?.cancel().catch(() => {})
  return response.status
}

function tokenOf(header) {
  if (typeof header !== 'string' || !header.startsWith('<') || !header.endsWith('>')) return undefined
  const token = header.slice(1, -1)
  return token === '' ? undefined : token
}

async function boundedText(response, limit = MAX_BYTES) {
  if (Number(response.headers.get('content-length')) > limit) {
    discard(response)
    throw new DavError('WebDAV response exceeds its size limit')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      size += value.byteLength
      if (size > limit) throw new DavError('WebDAV response exceeds its size limit')
      text += decoder.decode(value, { stream: true })
    }
  } catch (error) {
    reader.cancel().catch(() => {})
    if (error instanceof DavError) throw error
    if (error instanceof TypeError) throw new DavError('WebDAV response is not valid UTF-8')
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new DavError('WebDAV response timed out')
    throw error
  } finally {
    reader.releaseLock()
  }
}

function statusError(method, status) {
  if (status === 423) return new DavBusyError(`WebDAV ${method} refused: the resource is locked by another writer`)
  return new DavError(`WebDAV ${method} failed (HTTP ${status})`)
}

function strongEtag(response) {
  const etag = response.headers.get('etag')
  if (!isStrongEtag(etag)) {
    discard(response)
    throw new DavError('WebDAV server did not provide a strong ETag')
  }
  return etag
}

export function createDav(config, fetcher = fetch) {
  const forward = error => new DavError(error.message)
  let transport
  try { transport = buildDav(config, fetcher) } catch (error) { throw forward(error) }
  const wrapped = {}
  for (const [key, run] of Object.entries(transport)) {
    wrapped[key] = async (...args) => {
      try { return await run(...args) } catch (error) { throw error instanceof DavError || error?.[PASSTHROUGH] === true ? error : forward(error) }
    }
  }
  return wrapped
}

function buildDav({ url, username, password }, fetcher) {
  if (typeof url !== 'string' || url.trim() !== url || ['?', '#', BACKSLASH].some(character => url.includes(character))) {
    throw new TypeError('Invalid WebDAV collection URL')
  }
  let collection
  try { collection = new URL(url) } catch { throw new TypeError('Invalid WebDAV collection URL') }
  if (collection.protocol !== 'https:' || collection.username || collection.password || collection.search || collection.hash) {
    throw new TypeError('WebDAV requires an HTTPS collection URL without embedded credentials, query or fragment')
  }
  while (collection.pathname.endsWith('//')) collection.pathname = collection.pathname.slice(0, -1)
  if (!collection.pathname.endsWith('/')) collection.pathname += '/'
  if (typeof username !== 'string' || username.includes(':') || typeof password !== 'string' ||
      username.length > 1_024 || password.length > 4_096 || !isControlOrSpaceFree(username + password)) {
    throw new TypeError('Invalid WebDAV credentials')
  }
  const authorization = username || password ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : undefined
  const manifest = new URL(MANIFEST, collection).href
  let mode

  async function request(target, method, conditions = {}, body, contentType = 'application/json') {
    const signal = AbortSignal.timeout(TIMEOUT_MS)
    let response
    try {
      response = await fetcher(target, {
        method, signal, redirect: 'error', cache: 'no-store',
        headers: {
          'cache-control': 'no-cache, no-store',
          ...(authorization ? { authorization } : {}),
          ...(body === undefined ? {} : { 'content-type': contentType }),
          ...conditions,
        },
        body,
      })
    } catch {
      throw new DavError(signal.aborted ? `WebDAV ${method} timed out` : `WebDAV ${method} request failed (network, TLS or redirect)`)
    }
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      discard(response)
      throw new DavError('WebDAV redirects are not allowed')
    }
    return response
  }

  const put = async (target, conditions, body) => discard(await request(target, 'PUT', conditions, body))
  const remove = async target => discard(await request(target, 'DELETE'))

  async function readCurrent() {
    const response = await request(manifest, 'GET')
    if (response.status === 404) {
      discard(response)
      return { etag: null, document: EMPTY_DOCUMENT() }
    }
    if (response.status !== 200) throw statusError('GET', discard(response))
    const etag = strongEtag(response)
    const text = await boundedText(response)
    if (text.trim() === '') return { etag, document: EMPTY_DOCUMENT() }
    let value
    try { value = JSON.parse(text) } catch { throw new DavError('WebDAV manifest is not valid JSON') }
    return { etag, document: parseDocument(value) }
  }

  async function acquire(target) {
    const response = await request(target, 'LOCK',
      { 'content-type': 'application/xml', depth: '0', timeout: 'Second-120' }, LOCK_BODY)
    if (response.status === 423) throw statusError('LOCK', discard(response))
    if (![200, 201].includes(response.status)) throw statusError('LOCK', discard(response))
    const token = tokenOf(response.headers.get('lock-token'))
    discard(response)
    if (!token) throw new DavError('WebDAV server did not return a lock token')
    return token
  }

  async function release(target, token) {
    const status = discard(await request(target, 'UNLOCK', { 'lock-token': `<${token}>` }))
    if (![200, 204, 409, 412].includes(status)) throw statusError('UNLOCK', status)
  }

  // ── Backups: whole plugin configurations under backup/plugins/<id>/ ──
  const backupObject = (id, name) => `${BACKUP_ROOT}/${CATEGORY}/${id}/${name}`
  const backupFolder = id => `${BACKUP_ROOT}/${CATEGORY}/${id}/`
  const ensured = new Set()

  async function ensureCollection(relative) {
    const segments = relative.replace(/\/+$/, '').split('/').filter(Boolean)
    let prefix = ''
    for (const segment of segments) {
      prefix += `${segment}/`
      if (ensured.has(prefix)) continue
      const status = discard(await request(new URL(prefix, collection).href, 'MKCOL'))
      // 405 is how most servers report a collection that already exists.
      if (status !== 201 && status !== 405) throw statusError('MKCOL', status)
      ensured.add(prefix)
    }
  }

  async function readBackupIndex() {
    const response = await request(new URL(INDEX_PATH, collection).href, 'GET')
    if (response.status === 404) {
      discard(response)
      return {index: {version: 1, snapshots: []}, etag: null}
    }
    if (response.status !== 200) throw statusError('backup GET', discard(response))
    let etag
    try { etag = strongEtag(response) } catch { etag = null }
    const text = await boundedText(response, MAX_INDEX_BYTES)
    let value
    try { value = JSON.parse(text) } catch { throw new DavError('Backup index is not valid JSON') }
    const index = parseIndex(value)
    if (!index) throw new DavError('Backup index has an unexpected shape')
    return {index, etag}
  }

  async function dropBackup(id, index) {
    const entry = index.snapshots.find(candidate => candidate.id === id)
    if (entry !== undefined) {
      for (const file of entry.files) {
        const status = discard(await request(new URL(backupObject(id, file.path), collection).href, 'DELETE'))
        if (![200, 204, 404].includes(status)) throw statusError('backup DELETE', status)
      }
    }
    const status = discard(await request(new URL(backupFolder(id), collection).href, 'DELETE'))
    if (![200, 204, 404, 409].includes(status)) throw statusError('backup DELETE', status)
  }

  async function backupRead() {
    return (await readBackupIndex()).index
  }

  async function backupWrite(entry, files, retention) {
    if (!SNAPSHOT_ID.test(String(entry?.id))) throw new DavError('Invalid backup id')
    if (!Number.isSafeInteger(retention) || retention < 1 || retention > MAX_HISTORY) {
      throw new DavError(`Backup retention must be an integer between 1 and ${MAX_HISTORY}`)
    }
    const safe = verifyFiles(entry, files)
    await ensureCollection(backupFolder(entry.id))
    for (const file of entry.files) {
      const status = discard(await request(new URL(backupObject(entry.id, file.path), collection).href, 'PUT', {}, safe[file.path], 'application/octet-stream'))
      if (![200, 201, 204].includes(status)) throw statusError('backup PUT', status)
    }
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const {index, etag} = await readBackupIndex()
      const merged = mergeIndex(index, entry, retention)
      const body = encodeIndex(merged.index)
      const conditions = etag === null ? {'if-none-match': '*'} : {'if-match': etag}
      const status = discard(await request(new URL(INDEX_PATH, collection).href, 'PUT', conditions, body))
      if (status === 412 || status === 428) continue
      if (![200, 201, 204].includes(status)) throw statusError('backup index PUT', status)
      for (const id of merged.dropped) await dropBackup(id, index)
      return {index: merged.index, dropped: merged.dropped}
    }
    throw new DavError('Backup index stayed busy; retry later')
  }

  async function backupFetch(id) {
    const index = await backupRead()
    const entry = index.snapshots.find(candidate => candidate.id === id)
    if (entry === undefined) throw new DavError(`Backup ${id} is not on the remote side`)
    const files = {}
    for (const file of entry.files) {
      const response = await request(new URL(backupObject(id, file.path), collection).href, 'GET')
      if (response.status !== 200) throw statusError('backup GET', discard(response))
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length > MAX_FILE_BYTES) throw new DavError('Backup file exceeds its size limit')
      files[file.path] = buffer
    }
    return verifyFiles(entry, files)
  }

  // Both probes use a disposable sibling so no invalid precondition ever reaches the manifest.
  const probe = () => new URL(`dsh-sync-probe-${randomUUID()}.json`, collection).href

  async function probeEtag() {
    const target = probe()
    const original = JSON.stringify({ probe: randomUUID(), revision: 1 })
    const updated = JSON.stringify({ probe: randomUUID(), revision: 2 })
    const invalid = JSON.stringify({ probe: randomUUID(), revision: 3 })
    const readProbe = async expected => {
      const response = await request(target, 'GET')
      if (response.status !== 200) throw statusError('probe GET', discard(response))
      const etag = strongEtag(response)
      if (await boundedText(response, 1_024) !== expected) throw new DavError('probe content changed')
      return etag
    }
    let failure
    try {
      const created = await put(target, { 'if-none-match': '*' }, original)
      if (![200, 201, 204].includes(created)) throw statusError('probe creation', created)
      const etag = await readProbe(original)
      if (await put(target, { 'if-none-match': '*' }, invalid) !== 412 || await readProbe(original) !== etag) return false
      const replaced = await put(target, { 'if-match': etag }, updated)
      if (![200, 201, 204].includes(replaced)) return false
      if (await readProbe(updated) === etag || await put(target, { 'if-match': etag }, invalid) !== 412) return false
      return true
    } catch (error) {
      if (error instanceof DavBusyError) return false
      failure = error
      throw error
    } finally {
      try {
        const deleted = await remove(target)
        if (![200, 204, 404, 423].includes(deleted) && !failure) throw statusError('probe cleanup', deleted)
      } catch (error) {
        if (!failure) throw error
      }
    }
  }

  async function probeLock() {
    const target = probe()
    let token
    try {
      token = await acquire(target)
      const written = await put(target, { if: `(<${token}>)` }, '{"probe":1}')
      if (![200, 201, 204].includes(written)) return false
      const refused = await put(target, { if: '(<dsh-sync-invalid-token>)' }, '{"probe":2}')
      return [412, 423].includes(refused)
    } catch (error) {
      if (error instanceof DavBusyError) return false
      throw error
    } finally {
      if (token !== undefined) await release(target, token).catch(() => {})
      await remove(target).catch(() => {})
    }
  }

  async function detect() {
    if (mode !== undefined) return mode
    const attempt = async probeRun => probeRun().catch(error => {
      if (error instanceof DavError) return false
      throw error
    })
    if (await attempt(probeEtag)) return (mode = 'etag')
    if (await attempt(probeLock)) return (mode = 'lock')
    throw new DavError('WebDAV server enforces neither conditional writes with strong ETags nor exclusive write locks; publishing could lose another device\'s list')
  }

  async function read() {
    const { document } = await readCurrent()
    return { entries: document.entries, historyCount: document.history.length }
  }

  const nextState = (document, local, etag, retention) => {
    const names = new Set(document.entries.map(entry => entry.name))
    const added = local.filter(entry => !names.has(entry.name))
    const entries = added.length ? parseEntries([...document.entries, ...added]) : document.entries
    const history = (added.length && etag !== null && document.entries.length > 0 ? [document.entries, ...document.history] : document.history).slice(0, retention)
    return { entries, added: added.length, history, changed: added.length > 0 || history.length !== document.history.length }
  }

  // Reconciliation writes whole entry rows, so any change to a row is a manifest change.
  const nextUpdate = (document, transform, retention) => {
    const previous = new Map(document.entries.map(entry => [entry.name, entry]))
    let proposed
    try {
      proposed = transform(structuredClone(document.entries))
    } catch (error) {
      // The caller owns plan validation; let its error type and message through untouched.
      passthrough(error)
      throw error
    }
    const entries = parseEntries(proposed)
    const next = new Map(entries.map(entry => [entry.name, entry]))
    for (const name of previous.keys()) {
      if (!next.has(name)) throw new DavError('update() must not remove an entry that the remote manifest already lists')
    }
    const added = entries.filter(entry => !previous.has(entry.name)).length
    const updated = entries.filter(entry => {
      const before = previous.get(entry.name)
      return before !== undefined && JSON.stringify(before) !== JSON.stringify(entry)
    }).length
    const archived = added > 0 || updated > 0
    const history = (archived && document.entries.length > 0 ? [document.entries, ...document.history] : document.history).slice(0, retention)
    const changed = archived || history.length !== document.history.length
    return { entries, added, updated, history, changed }
  }

  async function publishWithEtag(local, retention) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { etag, document } = await readCurrent()
      const state = nextState(document, local, etag, retention)
      const result = { entries: state.entries, added: state.added, historyCount: state.history.length }
      if (!state.changed) return result
      const body = encodeDocument({ version: 1, entries: state.entries, history: state.history })
      const status = await put(manifest, etag === null ? { 'if-none-match': '*' } : { 'if-match': etag }, body)
      if (status === 412) continue
      if (![200, 201, 204].includes(status)) throw statusError('PUT', status)
      return result
    }
    throw new DavError('WebDAV manifest changed repeatedly; retry synchronization')
  }

  async function updateWithEtag(transform, retention) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { etag, document } = await readCurrent()
      const state = nextUpdate(document, transform, retention)
      const result = { entries: state.entries, added: state.added, updated: state.updated, historyCount: state.history.length }
      if (!state.changed) return result
      const body = encodeDocument({ version: 1, entries: state.entries, history: state.history })
      const status = await put(manifest, etag === null ? { 'if-none-match': '*' } : { 'if-match': etag }, body)
      if (status === 412) continue
      if (![200, 201, 204].includes(status)) throw statusError('PUT', status)
      return result
    }
    throw new DavError('WebDAV manifest changed repeatedly; retry synchronization')
  }

  async function publishWithLock(local, retention) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let token
      try {
        token = await acquire(manifest)
      } catch (error) {
        if (error instanceof DavBusyError && attempt < MAX_ATTEMPTS - 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY_MS))
          continue
        }
        throw error
      }
      try {
        const { etag, document } = await readCurrent()
        const state = nextState(document, local, etag, retention)
        const result = { entries: state.entries, added: state.added, historyCount: state.history.length }
        if (!state.changed) return result
        const body = encodeDocument({ version: 1, entries: state.entries, history: state.history })
        const status = await put(manifest, { if: `(<${token}>)` }, body)
        if (status === 412 || status === 423) continue
        if (![200, 201, 204].includes(status)) throw statusError('PUT', status)
        return result
      } finally {
        await release(manifest, token).catch(() => {})
      }
    }
    throw new DavError('WebDAV manifest stayed locked by another device; retry synchronization later')
  }

  async function updateWithLock(transform, retention) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let token
      try {
        token = await acquire(manifest)
      } catch (error) {
        if (error instanceof DavBusyError && attempt < MAX_ATTEMPTS - 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY_MS))
          continue
        }
        throw error
      }
      try {
        const { etag, document } = await readCurrent()
        const state = nextUpdate(document, transform, retention)
        const result = { entries: state.entries, added: state.added, updated: state.updated, historyCount: state.history.length }
        if (!state.changed) return result
        const body = encodeDocument({ version: 1, entries: state.entries, history: state.history })
        const status = await put(manifest, { if: `(<${token}>)` }, body)
        if (status === 412 || status === 423) continue
        if (![200, 201, 204].includes(status)) throw statusError('PUT', status)
        return result
      } finally {
        await release(manifest, token).catch(() => {})
      }
    }
    throw new DavError('WebDAV manifest stayed locked by another device; retry synchronization later')
  }

  async function publish(localEntries, retention = 10) {
    if (!Number.isSafeInteger(retention) || retention < 0 || retention > MAX_HISTORY) {
      throw new TypeError(`Backup retention must be an integer between 0 and ${MAX_HISTORY}`)
    }
    const local = parseEntries(localEntries)
    await detect()
    return mode === 'etag' ? await publishWithEtag(local, retention) : await publishWithLock(local, retention)
  }

  /**
   * Rewrite the published list in place. `transform` receives a detached copy of the current
   * entries and returns the whole next list; it runs again on every conditional-write retry and
   * inside every lock, so it always sees the manifest it is about to replace. Entries may not be
   * dropped: removal semantics belong to a future explicit action, never to a rewrite.
   */
  async function update(transform, retention = 10) {
    if (typeof transform !== 'function') throw new TypeError('update() requires a transform function')
    if (!Number.isSafeInteger(retention) || retention < 0 || retention > MAX_HISTORY) {
      throw new TypeError(`Backup retention must be an integer between 0 and ${MAX_HISTORY}`)
    }
    await detect()
    return mode === 'etag' ? await updateWithEtag(transform, retention) : await updateWithLock(transform, retention)
  }

  return {
    read,
    publish,
    update,
    backupRead,
    backupWrite,
    backupFetch,
    verify: detect,
    test: async () => { await detect(); return true },
    mode: async () => detect(),
  }
}