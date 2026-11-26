import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { classifyRemote, createGit, localGitRuntime } from '../lib/git.js'

const entry = (name, version = '1.0.0', enabled = true) => ({name, version, spec: `${name}@${version}`, enabled})

function run(cwd, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, {cwd, windowsHide: true, encoding: 'buffer'}, (error, stdout, stderr) => {
      if (error) reject(new Error(`${args.join(' ')}: ${String(stderr)}`))
      else resolve(String(stdout).trim())
    })
    child.stdin.end(input ?? '')
  })
}

async function bareRemote() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sync-git-test-'))
  const path = join(root, 'remote.git')
  await run(root, ['init', '--bare', '--quiet', path])
  return {root, path, cleanup: () => rm(root, {recursive: true, force: true})}
}

const local = path => createGit({repo: path, allowLocalRepo: true, authorName: 'test', authorEmail: 'test@localhost'})

/** Seed the bare remote with an ordinary worktree commit, so it holds unrelated paths. */
async function seedWorktree(root, barePath, files) {
  const work = join(root, 'seed')
  await mkdir(work, {recursive: true})
  await run(work, ['init', '--quiet'])
  for (const [rel, content] of Object.entries(files)) {
    const target = join(work, ...rel.split('/'))
    await mkdir(dirname(target), {recursive: true})
    await writeFile(target, content)
  }
  await run(work, ['add', '-A'])
  await run(work, ['-c', 'user.name=seed', '-c', 'user.email=seed@localhost', 'commit', '--quiet', '-m', 'seed'])
  await run(work, ['push', '--quiet', barePath, 'HEAD:refs/heads/main'])
}

test('classifyRemote accepts https and ssh, rejects credentials and other protocols', () => {
  assert.equal(classifyRemote('https://github.com/o/r.git'), 'https')
  assert.equal(classifyRemote('https://git.example.com:8443/team/r.git'), 'https')
  assert.equal(classifyRemote('ssh://git@github.com/o/r.git'), 'ssh')
  assert.equal(classifyRemote('git@github.com:o/r.git'), 'ssh')
  assert.equal(classifyRemote('D:/repos/local.git', {allowLocal: true}), 'local')
  for (const repo of ['http://github.com/o/r.git', 'file:///d/repos/r.git', 'git://github.com/o/r.git',
    'ftp://example.com/r.git', 'https://user:pass@github.com/o/r.git', 'ssh://git:secret@github.com/o/r.git',
    'https://github.com/o/r.git?token=abc', 'https://github.com/o/r.git#frag', ' github.com/o/r ',
    'D:/repos/local.git', 'ext::ssh -i key host git-upload-pack /r', '-oProxyCommand=id:path',
    'user@-oProxyCommand=id:path', '--upload-pack=id:path', 'user@host:path with space',
    'user@host:', 'user@host:-rf', 'user@host:pa\u0000th']) {
    assert.throws(() => classifyRemote(repo), /remote/i, repo)
  }
})

test('read returns an empty list for a branch that does not exist yet', async () => {
  const remote = await bareRemote()
  try {
    const client = local(remote.path)
    assert.deepEqual(await client.read(), {entries: [], historyCount: null})
    assert.equal(await client.mode(), 'git')
  } finally { await remote.cleanup() }
})

test('update publishes a version 1 document and a second client reads it back', async () => {
  const remote = await bareRemote()
  try {
    const first = local(remote.path)
    const result = await first.update(entries => [...entries, entry('dsh-notes', '1.2.0', false)])
    assert.deepEqual(result, {entries: [entry('dsh-notes', '1.2.0', false)], added: 1, updated: 0, historyCount: null})
    const document = JSON.parse(await run(remote.path, ['show', 'main:dsh-sync.json']))
    assert.equal(document.version, 1)
    assert.deepEqual(document.history, [])
    assert.deepEqual(document.entries, [entry('dsh-notes', '1.2.0', false)])
    const second = local(remote.path)
    assert.deepEqual(await second.read(), {entries: [entry('dsh-notes', '1.2.0', false)], historyCount: null})
  } finally { await remote.cleanup() }
})

test('an unchanged transform reports zero work and leaves the branch untouched', async () => {
  const remote = await bareRemote()
  try {
    const client = local(remote.path)
    await client.update(() => [entry('dsh-notes')])
    const before = await run(remote.path, ['rev-parse', 'main'])
    assert.deepEqual(await client.update(entries => entries), {entries: [entry('dsh-notes')], added: 0, updated: 0, historyCount: null})
    assert.equal(await run(remote.path, ['rev-parse', 'main']), before)
  } finally { await remote.cleanup() }
})

test('update merges into what the remote already lists', async () => {
  const remote = await bareRemote()
  try {
    await local(remote.path).update(() => [entry('alpha')])
    const result = await local(remote.path).update(entries => [...entries, entry('beta', '2.0.0', false)])
    assert.equal(result.added, 1)
    assert.deepEqual(result.entries.map(item => item.name), ['alpha', 'beta'])
    assert.deepEqual((await local(remote.path).read()).entries.map(item => item.name), ['alpha', 'beta'])
  } finally { await remote.cleanup() }
})

test('a transform that drops a published entry is refused and the remote is unchanged', async () => {
  const remote = await bareRemote()
  try {
    const client = local(remote.path)
    await client.update(() => [entry('alpha'), entry('beta')])
    const before = await run(remote.path, ['rev-parse', 'main'])
    await assert.rejects(client.update(() => [entry('alpha')]), /must not remove/)
    assert.equal(await run(remote.path, ['rev-parse', 'main']), before)
    assert.deepEqual((await client.read()).entries.map(item => item.name), ['alpha', 'beta'])
  } finally { await remote.cleanup() }
})

test('concurrent writers both land because a rejected push re-merges', async () => {
  const remote = await bareRemote()
  try {
    const left = local(remote.path)
    const right = local(remote.path)
    const [a, b] = await Promise.all([
      left.update(entries => [...entries, entry('from-left')]),
      right.update(entries => [...entries, entry('from-right')]),
    ])
    assert.equal(a.added + b.added, 2)
    assert.deepEqual((await left.read()).entries.map(item => item.name), ['from-left', 'from-right'])
  } finally { await remote.cleanup() }
})

test('an oversized manifest is refused before it is written', async () => {
  const remote = await bareRemote()
  try {
    const client = createGit({repo: remote.path, allowLocalRepo: true, maxBytes: 120})
    await assert.rejects(client.update(() => [entry('alpha'), entry('beta')]), /size limit/)
    assert.deepEqual(await client.read(), {entries: [], historyCount: null})
  } finally { await remote.cleanup() }
})

test('a rejected push is retried against the fresh remote state', async () => {
  const remote = await bareRemote()
  try {
    await local(remote.path).update(() => [entry('existing')])
    const inner = localGitRuntime()
    let pushes = 0
    const flaky = {
      async run(spec) {
        if (spec.args.includes('push')) {
          pushes += 1
          if (pushes === 1) return {code: 1, stdout: Buffer.from(''), stderr: Buffer.from('! [rejected] main -> main (non-fast-forward)')}
        }
        return inner.run(spec)
      },
    }
    const client = createGit({repo: remote.path, allowLocalRepo: true, runtime: flaky})
    const result = await client.update(entries => [...entries, entry('late')])
    assert.equal(result.added, 1)
    assert.equal(pushes, 2)
    assert.deepEqual((await client.read()).entries.map(item => item.name), ['existing', 'late'])
  } finally { await remote.cleanup() }
})

test('HTTPS credentials travel in the environment, never in argv or the manifest', async () => {
  const token = 'token-value-1234567890'
  const calls = []
  const fake = {
    async run(spec) {
      calls.push(spec)
      return {code: 0, stdout: Buffer.from(''), stderr: Buffer.from('')}
    },
  }
  const client = createGit({repo: 'https://git.example.com/team/repo.git', token, gitUsername: 'bot', runtime: fake})
  assert.equal(await client.mode(), 'git')
  assert.equal(calls.length, 1)
  const [call] = calls
  assert.ok(!call.args.join(' ').includes(token), 'token must not appear in argv')
  assert.equal(call.env.GIT_TERMINAL_PROMPT, '0')
  assert.ok(call.env.GIT_CONFIG_VALUE_0.startsWith('Authorization: Basic '))
  assert.ok(!call.env.GIT_CONFIG_VALUE_0.includes(token), 'token is base64 encoded inside the header only')
  assert.ok(!JSON.stringify(call.args).includes('Authorization'))
  assert.throws(() => createGit({repo: 'https://git.example.com/team/repo.git'}), /token is required/)
})

test('ssh remotes use BatchMode and never carry a token', async () => {
  const calls = []
  const fake = {async run(spec) { calls.push(spec); return {code: 0, stdout: Buffer.from(''), stderr: Buffer.from('')} }}
  const client = createGit({repo: 'git@github.com:owner/repo.git', runtime: fake})
  assert.equal(await client.mode(), 'git')
  assert.equal(calls[0].env.GIT_SSH_COMMAND, 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new')
  assert.ok(!('GIT_CONFIG_VALUE_0' in calls[0].env))
})

test('the rebuilt tree keeps unrelated files and directories', async () => {
  const remote = await bareRemote()
  try {
    await seedWorktree(remote.root, remote.path, {'README.md': '# notes\n', 'docs/guide.md': 'guide\n'})
    const client = local(remote.path)
    await client.update(() => [entry('alpha')])
    const listing = await run(remote.path, ['ls-tree', '-r', '--name-only', 'main'])
    assert.deepEqual(listing.split('\n').sort(), ['README.md', 'docs/guide.md', 'dsh-sync.json'])
    assert.equal(await run(remote.path, ['show', 'main:README.md']), '# notes')
    assert.equal(await run(remote.path, ['show', 'main:docs/guide.md']), 'guide')
    assert.deepEqual((await client.read()).entries.map(item => item.name), ['alpha'])
  } finally { await remote.cleanup() }
})

test('the rebuilt tree keeps a second manifest update from dropping those paths', async () => {
  const remote = await bareRemote()
  try {
    await seedWorktree(remote.root, remote.path, {'README.md': 'keep me', 'config/app.yaml': 'a: 1'})
    const client = local(remote.path)
    await client.update(() => [entry('alpha')])
    await client.update(entries => [...entries, entry('beta')])
    const listing = await run(remote.path, ['ls-tree', '-r', '--name-only', 'main'])
    assert.deepEqual(listing.split('\n').sort(), ['README.md', 'config/app.yaml', 'dsh-sync.json'])
  } finally { await remote.cleanup() }
})

test('authentication kind must match the remote scheme', () => {
  assert.throws(() => createGit({repo: 'https://git.example.com/team/repo.git', token: 't', auth: 'ssh'}), /SSH authentication needs an ssh remote/)
  assert.throws(() => createGit({repo: 'git@github.com:owner/repo.git', auth: 'https', token: 't'}), /HTTPS authentication needs an https remote/)
})

test('the git environment ignores global config and blocks redirects and other protocols', async () => {
  const remote = await bareRemote()
  try {
    const calls = []
    const inner = localGitRuntime()
    const recording = {async run(spec) { calls.push(spec); return inner.run(spec) }}
    const client = createGit({repo: remote.path, allowLocalRepo: true, runtime: recording})
    await client.update(() => [entry('alpha')])
    assert.ok(calls.length > 0)
    for (const call of calls) {
      assert.equal(call.env.GIT_CONFIG_NOSYSTEM, '1')
      assert.ok(call.env.GIT_CONFIG_GLOBAL, 'a private empty global config is used')
      assert.equal(call.env.GIT_ALLOW_PROTOCOL, undefined, 'local tests keep the file transport')
    }
  } finally { await remote.cleanup() }
})

test('https hardening sets redirects off and restricts protocols', async () => {
  const calls = []
  const fake = {async run(spec) { calls.push(spec); return {code: 0, stdout: Buffer.from(''), stderr: Buffer.from('')} }}
  const client = createGit({repo: 'https://git.example.com/team/repo.git', token: 'tok', runtime: fake})
  await client.mode()
  const [call] = calls
  assert.equal(call.env.GIT_CONFIG_COUNT, '3')
  assert.equal(call.env.GIT_CONFIG_VALUE_2, 'false')
  assert.equal(call.env.GIT_CONFIG_KEY_2, 'http.followRedirects')
  assert.equal(call.env.GIT_ALLOW_PROTOCOL, 'https:ssh')
})

test('an unreadable remote is an error, not an empty branch', async () => {
  const fake = {
    async run() {
      return {code: 128, stdout: Buffer.from(''), stderr: Buffer.from('fatal: could not read from remote repository.')}
    },
  }
  const client = createGit({repo: 'https://git.example.com/team/repo.git', token: 'secret-token', runtime: fake})
  await assert.rejects(client.read(), /git failed/)
  await assert.rejects(client.read(), error => !String(error.message).includes('secret-token'))
})

test('a failed remote read is reported without leaking the remote credentials', async () => {
  const fake = {
    async run() {
      return {code: 128, stdout: Buffer.from(''), stderr: Buffer.from('fatal: could not read Username for https://git.example.com')}
    },
  }
  const client = createGit({repo: 'https://git.example.com/team/repo.git', token: 'secret-token', runtime: fake})
  await assert.rejects(client.read(), error => error.name === 'GitError' && !String(error.message).includes('secret-token'))
})