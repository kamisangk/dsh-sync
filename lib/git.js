/**
 * Git transport for the sync manifest.
 *
 * The manifest is one JSON blob at the repository root. Every operation runs in an
 * isolated temporary repository, so nothing of the user's clones is executed: fetch
 * the branch, read the blob, build the next commit with plumbing (hash-object /
 * ls-tree / mktree / commit-tree) and push that commit with an ordinary non-force
 * refspec. A rejected push means another writer won the race, so the transform runs
 * again on the fresh remote state.
 *
 * The rebuilt tree keeps every root entry the branch already had; only the manifest
 * entry is replaced, so other files in the repository are never deleted.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEntry } from './core.js'

const MANIFEST = 'dsh-sync.json'
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024
const MAX_ENTRIES = 2_000
const DEFAULT_ATTEMPTS = 4
const TIMEOUT_MS = 120_000
const MAX_REMOTE_LENGTH = 2_048
const MISSING_BRANCH_HINTS = ["couldn't find remote ref", 'could not find remote ref', 'no such remote ref']
const REJECTION_HINTS = [
  'non-fast-forward', 'fetch first', '! [rejected]', 'stale info',
  // Two writers creating the branch at the same time: the loser races the ref lock.
  'cannot lock ref', 'reference already exists', 'failed to update ref',
]

export class GitError extends Error {
  name = 'GitError'
}

export const DEFAULT_AUTHOR = {name: 'dsh-sync', email: 'dsh-sync@localhost'}

function hasControl(value) {
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/** Space or control characters make a remote ambiguous or shell-friendly; refuse both. */
function hasSpaceOrControl(value) {
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code <= 0x20 || code === 0x7f) return true
  }
  return false
}

function windowsPath(value) {
  return value.length > 2 && value[1] === ':' && /[A-Za-z]/.test(value[0])
}

/**
 * Parse the scp-like `user@host:path` form without letting option or
 * remote-helper syntax through: `ext::…`, `-oProxyCommand=…`, `--upload-pack=…`
 * and any authority that is not `user@host` are rejected.
 */
function scpRemote(repo) {
  if (repo.includes('://')) return null
  const colon = repo.indexOf(':')
  if (colon <= 0 || colon === repo.length - 1) return null
  const authority = repo.slice(0, colon)
  const path = repo.slice(colon + 1)
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(authority)) return null
  const separator = authority.indexOf('@')
  const user = authority.slice(0, separator)
  const host = authority.slice(separator + 1)
  if (user === '' || host === '' || host.startsWith('-') || host.startsWith('.') ||
      host.endsWith('.') || host.includes('..')) return null
  if (path === '' || path.startsWith('-') || hasSpaceOrControl(path)) return null
  return 'ssh'
}

/**
 * Classify a remote. Production accepts https and ssh only; plain local paths are
 * accepted solely for tests, where `allowLocal` is set by the caller.
 */
export function classifyRemote(repo, {allowLocal = false} = {}) {
  if (typeof repo !== 'string' || repo.length === 0 || repo.length > MAX_REMOTE_LENGTH ||
      repo.trim() !== repo || hasControl(repo)) {
    throw new GitError('Invalid git remote')
  }
  if (repo.startsWith('https://')) {
    if (hasSpaceOrControl(repo)) throw new GitError('Invalid git remote')
    let parsed
    try { parsed = new URL(repo) } catch { throw new GitError('Invalid git remote') }
    if (parsed.username !== '' || parsed.password !== '') {
      throw new GitError('Git remote must not embed credentials; supply a token instead')
    }
    if (parsed.search !== '' || parsed.hash !== '') throw new GitError('Invalid git remote')
    return 'https'
  }
  if (repo.startsWith('ssh://')) {
    if (hasSpaceOrControl(repo)) throw new GitError('Invalid git remote')
    let parsed
    try { parsed = new URL(repo) } catch { throw new GitError('Invalid git remote') }
    if (parsed.password !== '') throw new GitError('Git remote must not embed a password')
    return 'ssh'
  }
  if (scpRemote(repo) !== null) return 'ssh'
  if (allowLocal && (windowsPath(repo) || repo.startsWith('/') || repo.startsWith('./') || repo.startsWith('../'))) {
    return 'local'
  }
  throw new GitError('Git remote must be an https or ssh URL')
}

/** Real runtime: one git process per call, no shell, bounded output. */
export function localGitRuntime({executable = 'git'} = {}) {
  return {
    async run({args, cwd, env, input, timeoutMs = TIMEOUT_MS}) {
      const start = Date.now()
      return await new Promise(resolve => {
        const child = execFile(executable, args, {
          cwd, env, timeout: timeoutMs, windowsHide: true,
          maxBuffer: 16 * 1024 * 1024, encoding: 'buffer',
        }, (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof error.code === 'number' ? error.code : error.code === 'ENOENT' ? 127 : 1
          resolve({
            code,
            stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ''),
            stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr ?? ''),
            missing: error?.code === 'ENOENT',
            durationMs: Date.now() - start,
          })
        })
        if (input === undefined) child.stdin.end()
        else child.stdin.end(input)
      })
    },
  }
}

function text(buffer) {
  return Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer ?? '')
}

function failure(result) {
  if (result.missing) return new GitError('git executable not found')
  const message = text(result.stderr).trim().split(/\r?\n/).slice(-3).join(' ')
  return new GitError(`git failed (exit ${result.code})${message ? `: ${message}` : ''}`)
}

function normalizeEntries(value) {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) {
    throw new GitError(`Manifest entries must be an array of at most ${MAX_ENTRIES} items`)
  }
  const names = new Set()
  const entries = value.map(item => {
    const entry = parseEntry(item)
    if (names.has(entry.name)) throw new GitError('Duplicate plugin name in manifest')
    names.add(entry.name)
    return entry
  })
  return entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}

function parseDocument(buffer, maxBytes) {
  if (buffer.length > maxBytes) throw new GitError('Manifest exceeds its size limit')
  let value
  try { value = JSON.parse(text(buffer)) } catch { throw new GitError('Manifest is not valid JSON') }
  if (!value || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new GitError('Unsupported manifest format')
  }
  if (value.history !== undefined && !Array.isArray(value.history)) throw new GitError('Unsupported manifest format')
  return {entries: normalizeEntries(value.entries), history: value.history ?? []}
}

/** `git ls-tree -z` of the commit root: every existing path survives the rebuild. */
function parseRootTree(buffer) {
  const entries = []
  for (const record of text(buffer).split('\u0000')) {
    if (record === '') continue
    const tab = record.indexOf('\t')
    if (tab < 0) continue
    const [mode, type, sha] = record.slice(0, tab).split(' ')
    const path = record.slice(tab + 1)
    if (mode === undefined || type === undefined || sha === undefined || path === '') continue
    entries.push({mode, type, sha, path})
  }
  return entries
}

/**
 * @param {object} config
 * @param {string} config.repo remote URL (https or ssh)
 * @param {string} [config.branch] branch name, defaults to main
 * @param {string} [config.auth] 'https' | 'ssh'; inferred from the URL when omitted
 * @param {string} [config.token] HTTPS token; never placed in argv or on disk
 * @param {string} [config.gitUsername] HTTPS user name used with the token
 * @param {string} [config.authorName]
 * @param {string} [config.authorEmail]
 * @param {number} [config.maxBytes] test-only size override
 * @param {number} [config.attempts] push retry budget
 * @param {boolean} [config.allowLocalRepo] test-only: accept local paths
 * @param {object} [config.runtime] test-only runtime injection
 */
export function createGit(config = {}) {
  const {
    repo, branch = 'main', token, gitUsername = 'x-access-token',
    authorName = DEFAULT_AUTHOR.name, authorEmail = DEFAULT_AUTHOR.email,
    maxBytes = DEFAULT_MAX_BYTES, attempts = DEFAULT_ATTEMPTS,
    allowLocalRepo = false, runtime,
  } = config
  if (typeof branch !== 'string' || branch === '' || branch.startsWith('-') || hasControl(branch) || branch.includes('..')) {
    throw new GitError('Invalid branch name')
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new GitError('Invalid size limit')
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 16) throw new GitError('Invalid retry budget')
  const kind = classifyRemote(repo, {allowLocal: allowLocalRepo})
  const auth = config.auth ?? (kind === 'local' ? 'ssh' : kind)
  if (auth !== 'https' && auth !== 'ssh') throw new GitError('Unsupported git authentication')
  if (auth === 'https' && kind !== 'https') throw new GitError('HTTPS authentication needs an https remote')
  if (auth === 'ssh' && kind === 'https') throw new GitError('SSH authentication needs an ssh remote')
  if (auth === 'https') {
    if (typeof token !== 'string' || token === '' || hasControl(token) || token.length > 4_096) {
      throw new GitError('An HTTPS token is required')
    }
    if (typeof gitUsername !== 'string' || gitUsername === '' || gitUsername.includes(':') || hasControl(gitUsername)) {
      throw new GitError('Invalid HTTPS user name')
    }
  }
  for (const [value, label] of [[authorName, 'author name'], [authorEmail, 'author email']]) {
    if (typeof value !== 'string' || value === '' || value.length > 256 || hasControl(value) ||
        value.includes('<') || value.includes('>')) {
      throw new GitError(`Invalid git ${label}`)
    }
  }

  const git = runtime ?? localGitRuntime()
  const transportEnv = {}
  if (auth === 'https') {
    const header = `Authorization: Basic ${Buffer.from(`${gitUsername}:${token}`).toString('base64')}`
    // GIT_CONFIG_* keeps the secret out of argv, out of the temp repository and out of
    // logs; redirects stay off so the header cannot be replayed at another host.
    transportEnv.GIT_CONFIG_COUNT = '3'
    transportEnv.GIT_CONFIG_KEY_0 = 'http.extraHeader'
    transportEnv.GIT_CONFIG_VALUE_0 = header
    transportEnv.GIT_CONFIG_KEY_1 = 'credential.helper'
    transportEnv.GIT_CONFIG_VALUE_1 = ''
    transportEnv.GIT_CONFIG_KEY_2 = 'http.followRedirects'
    transportEnv.GIT_CONFIG_VALUE_2 = 'false'
  } else if (auth === 'ssh') {
    transportEnv.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new'
    if (process.env.SSH_AUTH_SOCK) transportEnv.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK
  }
  const baseEnv = {
    PATH: process.env.PATH ?? '',
    SYSTEMROOT: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? '',
    HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
    USERPROFILE: process.env.USERPROFILE ?? '',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    GCM_INTERACTIVE: 'never',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
    // Production runs cannot reach file:// or remote helpers; local paths are test-only.
    ...(allowLocalRepo ? {} : {GIT_ALLOW_PROTOCOL: 'https:ssh'}),
    ...transportEnv,
  }

  async function run(args, {gitDir, hooks, gitConfig, cwd, input, allowFailure = false, extraEnv} = {}) {
    const full = gitDir === undefined
      ? args
      : ['--git-dir', gitDir, ...(hooks === undefined ? [] : ['-c', `core.hooksPath=${hooks}`, '-c', 'gc.auto=0']), ...args]
    const env = {
      ...baseEnv,
      // Ignore the user's global and system git config (URL rewrites, credential
      // helpers, includeIf rules) so a token travels only where this call sends it.
      ...(gitConfig === undefined ? {} : {GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1'}),
      ...extraEnv,
    }
    const result = await git.run({args: full, cwd, env, input, timeoutMs: TIMEOUT_MS})
    if (result.code !== 0 && !allowFailure) throw failure(result)
    return result
  }

  /** Isolated context: empty gitconfig, empty hooks directory and, when needed, a bare repo. */
  async function withContext(bare, action) {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-sync-git-'))
    const gitConfig = join(dir, 'gitconfig')
    const hooks = join(dir, 'hooks')
    const gitDir = join(dir, 'repo.git')
    await writeFile(gitConfig, '')
    await mkdir(hooks, {recursive: true})
    try {
      if (bare) {
        const init = await run(['init', '--bare', '--quiet', gitDir], {gitConfig, cwd: dir})
        if (init.code !== 0) throw new GitError('Could not create an isolated git repository')
      }
      return await action({gitDir, hooks, gitConfig, dir})
    } finally {
      await rm(dir, {recursive: true, force: true}).catch(() => {})
    }
  }

  const trackingRef = `refs/remotes/dsh-sync/${branch}`

  async function fetchInto(ctx) {
    const result = await run(['fetch', '--quiet', '--no-tags', '--no-auto-gc', repo, `+refs/heads/${branch}:${trackingRef}`], {
      ...ctx, allowFailure: true,
    })
    if (result.code !== 0) {
      const message = text(result.stderr)
      // Only a genuinely absent branch counts as empty; auth or network failures must surface.
      if (MISSING_BRANCH_HINTS.some(hint => message.includes(hint))) return null
      throw failure(result)
    }
    return await revParse(ctx, trackingRef)
  }

  async function revParse(ctx, ref) {
    const result = await run(['rev-parse', '--verify', '--quiet', ref], {...ctx, allowFailure: true})
    if (result.code !== 0) return null
    const value = text(result.stdout).trim()
    return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value) ? value : null
  }

  async function readDocument(ctx, commit) {
    if (commit === null) return {entries: [], history: []}
    const type = await run(['cat-file', '-t', `${commit}:${MANIFEST}`], {...ctx, allowFailure: true})
    if (type.code !== 0) return {entries: [], history: []}
    if (text(type.stdout).trim() !== 'blob') throw new GitError('Manifest is not a file in the repository')
    const size = await run(['cat-file', '-s', `${commit}:${MANIFEST}`], ctx)
    const bytes = Number(text(size.stdout).trim())
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new GitError('Could not read the manifest size')
    if (bytes > maxBytes) throw new GitError('Manifest exceeds its size limit')
    const blob = await run(['cat-file', 'blob', `${commit}:${MANIFEST}`], ctx)
    return parseDocument(blob.stdout, maxBytes)
  }

  async function rootEntries(ctx, commit) {
    if (commit === null) return []
    const listing = await run(['ls-tree', '-z', commit], ctx)
    return parseRootTree(listing.stdout).filter(entry => entry.path !== MANIFEST)
  }

  async function mode() {
    return await withContext(false, async ctx => {
      const result = await run(['ls-remote', '--heads', repo, branch], {...ctx, allowFailure: true})
      if (result.code !== 0) throw failure(result)
      return 'git'
    })
  }

  async function read() {
    return await withContext(true, async ctx => {
      const commit = await fetchInto(ctx)
      const {entries} = await readDocument(ctx, commit)
      return {entries, historyCount: null}
    })
  }

  async function update(transform) {
    if (typeof transform !== 'function') throw new TypeError('update() needs a transform function')
    for (let attempt = 0; attempt < attempts; attempt++) {
      const outcome = await withContext(true, async ctx => {
        const commit = await fetchInto(ctx)
        const current = await readDocument(ctx, commit)
        let proposed
        try { proposed = transform(structuredClone(current.entries)) }
        catch (error) { throw error }
        const next = normalizeEntries(proposed)
        const previous = new Map(current.entries.map(entry => [entry.name, entry]))
        for (const name of previous.keys()) {
          if (!next.some(entry => entry.name === name)) {
            throw new GitError('update() must not remove an entry that the remote manifest already lists')
          }
        }
        const added = next.filter(entry => !previous.has(entry.name)).length
        const updated = next.filter(entry => {
          const before = previous.get(entry.name)
          return before !== undefined && JSON.stringify(before) !== JSON.stringify(entry)
        }).length
        const result = {entries: next, added, updated, historyCount: null}
        if (added === 0 && updated === 0 && commit !== null) return {result, pushed: false}
        const body = JSON.stringify({version: 1, entries: next, history: []})
        if (Buffer.byteLength(body) > maxBytes) throw new GitError('Manifest exceeds its size limit')
        const blob = text((await run(['hash-object', '-w', '--stdin'], {...ctx, input: body})).stdout).trim()
        // Rebuild the root tree from what the branch already has, then swap the manifest.
        const preserved = await rootEntries(ctx, commit)
        const records = preserved.map(entry => `${entry.mode} ${entry.type} ${entry.sha}\t${entry.path}`)
        records.push(`100644 blob ${blob}\t${MANIFEST}`)
        const tree = text((await run(['mktree', '-z'], {...ctx, input: Buffer.from(records.join('\u0000') + '\u0000', 'utf8')})).stdout).trim()
        const message = `dsh-sync: update ${new Date().toISOString()}\n`
        const commitArgs = ['commit-tree', tree]
        if (commit !== null) commitArgs.push('-p', commit)
        const created = text((await run(commitArgs, {
          ...ctx, input: message,
          extraEnv: {
            GIT_AUTHOR_NAME: authorName, GIT_AUTHOR_EMAIL: authorEmail,
            GIT_COMMITTER_NAME: authorName, GIT_COMMITTER_EMAIL: authorEmail,
          },
        })).stdout).trim()
        const push = await run(['push', '--porcelain', '--no-follow-tags', repo, `${created}:refs/heads/${branch}`], {
          ...ctx, allowFailure: true,
        })
        if (push.code === 0) return {result, pushed: true}
        if (REJECTION_HINTS.some(hint => text(push.stderr).includes(hint))) return {result, pushed: false, rejected: true}
        throw failure(push)
      })
      if (outcome.rejected) continue
      return outcome.result
    }
    throw new GitError('Remote kept rejecting the push; another writer is active, retry later')
  }

  // `test`/`verify` mirror the WebDAV transport so the Host can pick either backend
  // through one interface; both are the same reachability probe as `mode`.
  return {mode, read, update, test: mode, verify: mode, transport: auth}
}