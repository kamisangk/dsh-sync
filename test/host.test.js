import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { composeWebdavUrl, splitWebdavUrl, syncService } from '../index.js';
import { DavError } from '../lib/core.js';

async function fixture({ bundles = [], plugins = [], remote = [{name:'remote-plugin', version:'1.2.0', spec:'remote-plugin@1.2.0', enabled:false}], rowOverride = false } = {}) {
  const records = new Map();
  const profile = await mkdtemp(join(tmpdir(), 'dsh-sync-host-'));
  let historyCount = 0;
  const backups = new Map();
  let backupIndex = [];
  let backupProblem;
  const calls = [];
  const state = {bundles: bundles.map(bundle => ({...bundle})), plugins: plugins.map(plugin => ({...plugin}))};
  const manager = {
    listBundles: async () => state.bundles.map(bundle => ({...bundle})),
    listPlugins: async () => state.plugins.map(plugin => ({...plugin})),
    installBundle: async (...args) => { calls.push(['installBundle', ...args]); return {application: 'restart-required'}; },
    setBundleEnabled: async (name, enabled) => {
      calls.push(['setBundleEnabled', name, enabled]);
      const bundle = state.bundles.find(item => item.name === name);
      if (bundle) bundle.enabled = enabled;
      return {application: 'applied', changed: true};
    },
    setPluginEnabled: async (id, enabled) => {
      calls.push(['setPluginEnabled', id, enabled]);
      if (rowOverride && enabled) return {application: 'overridden', changed: false};
      const plugin = state.plugins.find(item => item.entryId === id);
      if (plugin) plugin.enabled = enabled;
      return {application: 'applied', changed: true};
    },
  };
  const start = () => syncService(manager, {
    readRecord: async key => structuredClone(records.get(key)),
    modifyRecord: async (key, fn) => { records.set(key, structuredClone(fn(records.get(key)))); },
  }, cfg => {
    if (!cfg.url.startsWith('https://')) throw new TypeError('WebDAV requires an HTTPS collection URL without embedded credentials, query or fragment');
    return {
      read: async () => ({entries: structuredClone(remote), historyCount}),
      update: async (transform, retention) => {
        const next = transform(structuredClone(remote));
        const previous = new Map(remote.map(entry => [entry.name, entry]));
        const added = next.filter(entry => !previous.has(entry.name)).length;
        const updated = next.filter(entry => previous.has(entry.name) && JSON.stringify(previous.get(entry.name)) !== JSON.stringify(entry)).length;
        historyCount = Math.min(retention, historyCount + Number(!!remote.length && !!(added + updated)));
        remote.splice(0, remote.length, ...next);
        return {entries: structuredClone(remote), added, updated, historyCount};
      },
      mode: async () => 'lock',
      backupRead: async () => {
        if (backupProblem) throw new DavError(backupProblem);
        return {version: 1, snapshots: structuredClone(backupIndex)};
      },
      backupWrite: async (entry, files, retention) => {
        if (backupProblem) throw new DavError(backupProblem);
        backups.set(entry.id, Object.fromEntries(Object.entries(files).map(([name, body]) => [name, Buffer.from(body)])));
        backupIndex = [structuredClone(entry), ...backupIndex.filter(item => item.id !== entry.id)].slice(0, retention);
        return {index: {version: 1, snapshots: structuredClone(backupIndex)}};
      },
      backupFetch: async id => {
        if (backupProblem) throw new DavError(backupProblem);
        const files = backups.get(id);
        if (!files) throw new DavError(`Backup ${id} is not on the remote side`);
        return {...files};
      },
      backupDelete: async ids => {
        if (backupProblem) throw new DavError(backupProblem);
        const set = new Set(ids);
        const removed = backupIndex.filter(item => set.has(item.id)).map(item => item.id);
        backupIndex = backupIndex.filter(item => !set.has(item.id));
        for (const id of removed) backups.delete(id);
        return {index: {version: 1, snapshots: structuredClone(backupIndex)}, removed};
      },
    };
  }, undefined, {profileDir: profile});
  const op = start();
  const save = (more = {}) => op({action: 'save', url: 'https://dav.example/sync/', username: 'me', password: 'test-password', retention: 10, autoApply: false, ...more});
  return {op, save, calls, state, remote, start, records, profile, backups: () => backupIndex,
    failBackups: message => { backupProblem = message; }, dropRemoteBackups: () => { backupIndex = []; backups.clear(); }};
}

test('download never publishes and switching direction invalidates plans', async () => {
  const {op, save, calls, remote, start} = await fixture({bundles: [{name: 'local-plugin', version: '1.0.0', spec: 'local-plugin@1.0.0', source: 'local-plugin@1.0.0', enabled: true}]});
  await save();
  await save({autoApply: true});
  await op({action: 'direction', direction: 'download'});
  const before = structuredClone(remote);
  const result = await op({action: 'sync'});
  assert.deepEqual(remote, before);
  assert.equal(calls.length, 1);
  assert.equal(result.overview.lastAttempt.status, 'pending');
  assert.equal((await start()({action: 'status'})).direction, 'download');
  await op({action: 'direction', direction: 'upload'});
  await assert.rejects(op({action: 'apply', id: result.id, selected: ['remote-plugin']}), /expired/);
  await assert.rejects(op({action: 'sync', expectedDirection: 'download', expectedTarget: 'https://dav.example/sync/'}), /direction changed/);
  assert.deepEqual(remote, before);
  const uploaded = await op({action: 'sync'});
  assert.equal(calls.length, 1);
  assert.equal(uploaded.items.some(item => item.kind === 'install'), false);
  assert.equal(uploaded.overview.lastAttempt.status, 'success');
});

test('Git settings preserve separate WebDAV state and never expose tokens', async () => {
  const {op, save, start} = await fixture();
  await save();
  await op({action: 'direction', direction: 'upload'});
  const git = {repo: 'https://git.example/sync.git', auth: 'https', token: 'test-token-rn0'};
  const status = await op({action: 'save', transport: 'git', git, autoApply: true});
  assert.equal(status.transport, 'git');
  assert.equal(status.git.tokenSet, true);
  assert.equal(status.autoApply, false);
  assert.equal(status.direction, 'both');
  assert.ok(!JSON.stringify(status).includes(git.token));
  const restarted = start();
  const {token, ...withoutToken} = git;
  assert.equal((await restarted({action: 'save', transport: 'git', git: withoutToken, autoApply: false})).git.tokenSet, true);
  assert.equal((await save()).direction, 'upload');
});

test('credentials are not returned; preview and default sync do not install', async () => {
  const {op, save, calls} = await fixture();
  assert.equal((await op({action: 'status'})).autoApply, false);
  const saved = await save();
  assert.equal(saved.passwordSet, true);
  assert.ok(!JSON.stringify(saved).includes('test-password'));
  await op({action: 'preview'});
  const plan = await op({action: 'sync'});
  assert.deepEqual(calls, []);
  const applied = await op({action: 'apply', id: plan.id, selected: ['remote-plugin']});
  assert.deepEqual(applied.outcomes, [{name: 'remote-plugin', kind: 'install', status: 'restart-required'}]);
  assert.equal(applied.overview.lastApply.counts['restart-required'], 1);
  assert.deepEqual(calls, [['installBundle', 'remote-plugin@1.2.0', {enabled: false, saveExact: true, expected: {name: 'remote-plugin', version: '1.2.0'}}]]);
});

test('the saved connection test reports the detected write strategy', async () => {
  const {op, save} = await fixture();
  await save();
  assert.equal((await op({action: 'test'})).mode, 'lock');
  // The saved settings decide the connection; caller-supplied fields are ignored.
  assert.equal((await op({action: 'test', url: 'https://evil.example/'})).mode, 'lock');
});

test('a missing URL is reported before any network access', async () => {
  const {op} = await fixture();
  await assert.rejects(op({action: 'test'}), /Save a connection first/);
  await assert.rejects(op({action: 'save', url: 'http://dav.example/', username: '', password: '', retention: 10, autoApply: false}), /HTTPS collection URL/);
});

test('a changed remote inventory invalidates the plan before installing', async () => {
  const {op, save, calls, remote} = await fixture();
  await save();
  const plan = await op({action: 'preview'});
  remote[0].enabled = true;
  await assert.rejects(op({action: 'apply', id: plan.id, selected: ['remote-plugin']}), /changed/);
  assert.deepEqual(calls, []);
});

test('auto-apply runs only on sync and only for missing bundles', async () => {
  const {op, save, calls} = await fixture();
  await save();
  await save({autoApply: true});
  await op({action: 'preview'});
  assert.equal(calls.length, 0);
  const synced = await op({action: 'sync'});
  assert.equal(calls.length, 1);
  assert.deepEqual(synced.outcomes, [{name: 'remote-plugin', kind: 'install', status: 'restart-required'}]);
  const next = await save({url: 'https://dav.example/other/', password: undefined, autoApply: true});
  assert.equal(next.autoApply, false);
  assert.equal(next.passwordSet, false);
});

test('enabling a bundle also clears the row-level disable that outranks it', async () => {
  const {op, save, calls, state, remote} = await fixture({
    bundles: [{name: 'toggle-target', version: '1.0.0', source: 'toggle-target@^1.0.0', enabled: false, update: 'registry',
      rows: [{rowId: 'toggle-row', moduleName: 'toggle-target', entryId: 'include:toggle-row'}]}],
    plugins: [{entryId: 'include:toggle-row', moduleName: 'toggle-target', enabled: false}],
    remote: [{name: 'toggle-target', version: '1.0.0', spec: 'toggle-target@1.0.0', enabled: true}],
  });
  await save();
  remote[0].enabled = false;
  await op({action: 'preview'});
  remote[0].enabled = true;
  const plan = await op({action: 'preview'});
  const enable = plan.items.find(item => item.kind === 'enable');
  const outcome = await op({action: 'apply', id: plan.id, selected: [enable.id]});
  assert.deepEqual(outcome.outcomes, [{name: 'toggle-target', kind: 'enable', status: 'applied'}]);
  assert.deepEqual(calls, [['setBundleEnabled', 'toggle-target', true], ['setPluginEnabled', 'include:toggle-row', true]]);
  assert.equal(state.plugins[0].enabled, true);
});

test('a row pinned by a higher layer is reported without keeping the bundle selection', async () => {
  const {op, save, calls, state, remote} = await fixture({
    rowOverride: true,
    bundles: [{name: 'pinned-target', version: '1.0.0', source: 'pinned-target@^1.0.0', enabled: false, update: 'registry',
      rows: [{rowId: 'pinned-row', moduleName: 'pinned-target', entryId: 'include:pinned-row'}]}],
    plugins: [{entryId: 'include:pinned-row', moduleName: 'pinned-target', enabled: false}],
    remote: [{name: 'pinned-target', version: '1.0.0', spec: 'pinned-target@1.0.0', enabled: true}],
  });
  await save();
  remote[0].enabled = false;
  await op({action: 'preview'});
  remote[0].enabled = true;
  const plan = await op({action: 'preview'});
  const enable = plan.items.find(item => item.kind === 'enable');
  const outcome = await op({action: 'apply', id: plan.id, selected: [enable.id]});
  assert.deepEqual(outcome.outcomes, [{name: 'pinned-target', kind: 'enable', status: 'overridden'}]);
  assert.deepEqual(calls, [
    ['setBundleEnabled', 'pinned-target', true],
    ['setPluginEnabled', 'include:pinned-row', true],
    ['setPluginEnabled', 'include:pinned-row', false],
    ['setBundleEnabled', 'pinned-target', false],
  ]);
  assert.equal(state.bundles[0].enabled, false, 'the selection we added is undone');
});

test('a remembered baseline survives service restart and separates publish from conflict', async () => {
  const {op, save, state, remote, start} = await fixture({
    bundles: [{name: 'alpha', version: '1.0.0', source: 'alpha@1.0.0', enabled: true, update: 'registry'}],
    remote: [{name: 'alpha', version: '1.0.0', spec: 'alpha@1.0.0', enabled: true}],
  });
  await save();
  await op({action: 'preview'});
  const restarted = start();
  state.bundles[0].version = '2.0.0';
  assert.equal((await restarted({action: 'preview'})).items[0].kind, 'local-update');
  const published = await restarted({action: 'sync'});
  assert.equal(published.updated, 1);
  assert.equal(published.historyCount, 1);
  assert.equal(published.overview.lastSync.updated, 1);
  assert.equal(remote[0].version, '2.0.0');
  state.bundles[0].version = '4.0.0';
  remote[0] = {...remote[0], version: '3.0.0', spec: 'alpha@3.0.0'};
  const {id, items, overview} = await restarted({action: 'sync'});
  assert.equal(overview.conflictCount, 1);
  assert.equal(items[0].baseline.version, '2.0.0');
  assert.equal(remote[0].version, '3.0.0');
  remote[0] = {...remote[0], enabled: false};
  await assert.rejects(restarted({action: 'resolve', id, name: 'alpha', choice: 'local'}), /changed/);
  const refreshed = await restarted({action: 'preview'});
  const resolved = await restarted({action: 'resolve', id: refreshed.id, name: 'alpha', choice: 'local'});
  assert.equal(resolved.updated, 1);
  assert.equal(resolved.overview.conflictCount, 0);
  assert.equal(remote[0].version, '4.0.0');
});

test('disabling drops the bundle layer and reports the change', async () => {
  const {op, save, calls, remote} = await fixture({
    bundles: [{name: 'toggle-target', version: '1.0.0', source: 'toggle-target@^1.0.0', enabled: true, update: 'registry',
      rows: [{rowId: 'toggle-row', moduleName: 'toggle-target', entryId: 'include:toggle-row'}]}],
    plugins: [{entryId: 'include:toggle-row', moduleName: 'toggle-target', enabled: true}],
    remote: [{name: 'toggle-target', version: '1.0.0', spec: 'toggle-target@1.0.0', enabled: false}],
  });
  await save();
  remote[0].enabled = true;
  await op({action: 'preview'});
  remote[0].enabled = false;
  const plan = await op({action: 'preview'});
  const disable = plan.items.find(item => item.kind === 'disable');
  assert.ok(disable, 'a disable item exists');
  const outcome = await op({action: 'apply', id: plan.id, selected: [disable.id]});
  assert.deepEqual(outcome.outcomes, [{name: 'toggle-target', kind: 'disable', status: 'applied'}]);
  assert.deepEqual(calls, [['setBundleEnabled', 'toggle-target', false]]);
});

test('the URL split and join cover the shapes a user types', () => {
  assert.deepEqual(splitWebdavUrl('https://dav.example/a/b/'), {address: 'https://dav.example', dir: '/a/b/'});
  assert.deepEqual(splitWebdavUrl('https://dav.example'), {address: 'https://dav.example', dir: ''});
  assert.deepEqual(splitWebdavUrl('https://dav.example/'), {address: 'https://dav.example', dir: ''});
  assert.deepEqual(splitWebdavUrl('https://dav.example/my%20folder/%E5%AD%98/'),
    {address: 'https://dav.example', dir: '/my folder/存/'});
  assert.deepEqual(splitWebdavUrl(''), {address: '', dir: ''});
  assert.equal(composeWebdavUrl('https://dav.example/dav/', '/team/sync/'), 'https://dav.example/dav/team/sync/');
  assert.equal(composeWebdavUrl('https://dav.example/dav', '/team/sync'), 'https://dav.example/dav/team/sync');
  assert.equal(composeWebdavUrl('https://dav.example/dav', 'team/sync'), 'https://dav.example/dav/team/sync',
    'a folder typed without a leading slash is still relative to the address');
  assert.equal(composeWebdavUrl('https://dav.example', ''), 'https://dav.example');
});

test('WebDAV saves the address and folder as separate fields', async () => {
  const {op, save, records} = await fixture();
  const saved = await save({url: undefined, address: 'https://dav.example/dav/', dir: '/team/sync/'});
  assert.equal(saved.address, 'https://dav.example/dav');
  assert.equal(saved.dir, '/team/sync/', 'the folder keeps the slashes the user typed');
  assert.equal(saved.url, 'https://dav.example/dav/team/sync/');
  assert.equal(records.get('kamisangk-dsh-sync/webdav').payload.address, 'https://dav.example/dav');
  assert.equal(records.get('kamisangk-dsh-sync/webdav').payload.dir, '/team/sync/');
  await op({action: 'direction', direction: 'upload'});
  const next = await save({url: undefined, address: 'https://dav.example/dav', dir: '/team/sync/', password: 'test-password-2'});
  assert.equal(next.dir, '/team/sync/');
  assert.equal(next.url, 'https://dav.example/dav/team/sync/');
  assert.equal(next.direction, 'upload', 'the same address and folder keep the saved state');
  // A folder typed without the leading slash composes the same collection and keeps the same state.
  const relative = await save({url: undefined, address: 'https://dav.example/dav', dir: 'team/sync'});
  assert.equal(relative.dir, 'team/sync', 'the stored folder stays exactly as typed');
  assert.equal(relative.url, 'https://dav.example/dav/team/sync');
  assert.equal(relative.direction, 'upload', 'the folder spelling does not reset the target state');
});

test('a legacy single-URL record keeps its state key after the split', async () => {
  const {op, records, save} = await fixture();
  records.set('kamisangk-dsh-sync/webdav', {kind: 'grant', payload: {
    url: 'https://dav.example/sync/', username: 'me', password: 'test-password', retention: 10, autoApply: false,
  }});
  const status = await op({action: 'status'});
  assert.equal(status.address, 'https://dav.example');
  assert.equal(status.dir, '/sync/');
  assert.equal(status.url, 'https://dav.example/sync/');
  await op({action: 'direction', direction: 'download'});
  const saved = await save({password: undefined});
  assert.equal(saved.url, 'https://dav.example/sync/', 'the stored URL string is preserved');
  assert.equal(saved.direction, 'download', 'the state record still maps to this target');
});

test('state keyed on the URL text with a trailing slash is still found and migrated', async () => {
  const {op, records, save} = await fixture();
  const profile = process.env.DSH_PROFILE_DIR ?? process.env.DSH_PROFILE ?? '';
  const keyOf = url => 'kamisangk-dsh-sync/state-' + createHash('sha256')
    .update(JSON.stringify([profile, url, 'me'])).digest('hex');
  records.set(keyOf('https://dav.example/sync/'),
    {kind: 'grant', payload: {version: 1, direction: 'download', baseline: [], overview: {}}});
  const status = await save();
  assert.equal(status.direction, 'download', 'the old key is read when the normalized key is absent');
  assert.equal(records.has(keyOf('https://dav.example/sync')), false);
  await op({action: 'direction', direction: 'upload'});
  assert.equal(records.get(keyOf('https://dav.example/sync')).payload.direction, 'upload',
    'the next write lands on the normalized key');
});

test('sync snapshots the plugin configuration before publishing it', async () => {
  const {op, save, profile, backups, remote} = await fixture({bundles: [{name: 'local-plugin', version: '1.0.0', spec: 'local-plugin@1.0.0', source: 'local-plugin@1.0.0', enabled: true}], remote: []});
  await save();
  const synced = await op({action: 'sync'});
  const local = await readdir(join(profile, '.dsh-sync', 'backups', 'plugins'));
  assert.equal(local.length, 1, 'one local snapshot exists');
  assert.equal(local[0], synced.backup, 'the reported id names the local folder');
  const listed = backups();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, synced.backup);
  assert.equal(listed[0].files.length, 1, 'the temp profile has no package files, only the plugin list');
  const plugins = JSON.parse(await readFile(join(profile, '.dsh-sync', 'backups', 'plugins', synced.backup, 'plugins.json'), 'utf8'));
  assert.deepEqual(plugins.entries.map(entry => entry.name), ['local-plugin']);
  assert.deepEqual(remote.map(entry => entry.name), ['local-plugin'], 'the manifest is still published');
});

test('download direction keeps a local snapshot without uploading one', async () => {
  const {op, save, profile, backups} = await fixture();
  await save();
  await op({action: 'direction', direction: 'download'});
  const synced = await op({action: 'sync'});
  assert.equal((await readdir(join(profile, '.dsh-sync', 'backups'))).length, 1);
  assert.equal(backups().length, 0, 'a download-only target never writes backups');
  assert.equal(synced.backup.length, 15);
});

test('a failed backup upload blocks the sync instead of publishing first', async () => {
  const {op, save, remote, failBackups} = await fixture({bundles: [{name: 'local-plugin', version: '1.0.0', spec: 'local-plugin@1.0.0', source: 'local-plugin@1.0.0', enabled: true}], remote: []});
  await save();
  failBackups('WebDAV MKCOL failed (HTTP 507)');
  await assert.rejects(op({action: 'sync'}), /HTTP 507/);
  assert.deepEqual(remote, [], 'the manifest is untouched when the backup cannot be written');
});

test('retention zero keeps snapshots local and never uploads them', async () => {
  const {op, save, profile, backups} = await fixture();
  await save({retention: 0});
  await op({action: 'sync'});
  assert.equal((await readdir(join(profile, '.dsh-sync', 'backups'))).length, 1);
  assert.equal(backups().length, 0);
});

test('backups lists remote snapshots and local staging copies', async () => {
  const {op, save, failBackups} = await fixture({bundles: [{name: 'local-plugin', version: '1.0.0', spec: 'local-plugin@1.0.0', source: 'local-plugin@1.0.0', enabled: true}]});
  await save();
  await op({action: 'sync'});
  const listed = await op({action: 'backups'});
  assert.equal(listed.snapshots.length, 1);
  assert.equal(listed.local.length, 1);
  assert.equal(listed.retention, 10);
  assert.equal(listed.error, undefined);
  failBackups('WebDAV backup GET failed (HTTP 503)');
  const offline = await op({action: 'backups'});
  assert.equal(offline.snapshots.length, 0);
  assert.equal(offline.local.length, 1, 'local copies are still listed');
  assert.equal(offline.error, 'WebDAV backup GET failed (HTTP 503)');
});

test('restore reinstalls the recorded plugins, enables rows and never uninstalls', async () => {
  const {op, save, state, calls, backups} = await fixture({bundles: [
    {name: 'local-plugin', version: '1.0.0', spec: 'local-plugin@1.0.0', source: 'local-plugin@1.0.0', enabled: true},
  ]});
  await save();
  await op({action: 'sync'});
  const id = backups()[0].id;
  // Drift after the snapshot: the plugin was disabled and another one appeared.
  state.bundles.find(bundle => bundle.name === 'local-plugin').enabled = false;
  state.bundles.push({name: 'extra-plugin', version: '1.0.0', spec: 'extra-plugin@1.0.0', source: 'extra-plugin@1.0.0', enabled: true});
  const restored = await op({action: 'restore', id});
  assert.deepEqual(restored.outcomes, [{name: 'local-plugin', kind: 'enable', status: 'applied'}]);
  assert.deepEqual(restored.extra, ['extra-plugin']);
  assert.ok(calls.some(call => call[0] === 'setBundleEnabled' && call[1] === 'local-plugin' && call[2] === true));
  assert.notEqual(restored.safety, id, 'the pre-restore state got its own snapshot');
  assert.deepEqual(Object.keys(restored.overview.lastRestore), ['at', 'id']);
});

test('restore falls back to the local copy when the remote one is gone', async () => {
  const {op, save, backups, dropRemoteBackups} = await fixture({bundles: [{name: 'local-plugin', version: '1.0.0', spec: 'local-plugin@1.0.0', source: 'local-plugin@1.0.0', enabled: true}]});
  await save();
  await op({action: 'sync'});
  const id = backups()[0].id;
  dropRemoteBackups();
  const restored = await op({action: 'restore', id});
  assert.deepEqual(restored.outcomes, [], 'the configuration already matches');
  assert.equal(restored.id, id);
});

test('restore rejects an unknown or malformed backup id', async () => {
  const {op, save} = await fixture();
  await save();
  await assert.rejects(op({action: 'restore', id: '../etc'}), /Invalid backup id/);
  await assert.rejects(op({action: 'restore', id: '20260101-000000'}), /not on the remote side/);
});

test('unchanged sync keeps a local snapshot without uploading redundant remote backups', async () => {
  const {op, save, backups} = await fixture({
    bundles: [{name: 'same-plugin', version: '1.0.0', spec: 'same-plugin@1.0.0', source: 'same-plugin@1.0.0', enabled: true}],
    remote: [{name: 'same-plugin', version: '1.0.0', spec: 'same-plugin@1.0.0', enabled: true}],
  });
  await save();
  const synced = await op({action: 'sync'});
  assert.equal(backups().length, 0, 'no remote backup is uploaded when nothing changes');
  assert.equal(synced.overview.lastBackup.uploaded, false);
});

test('backup_create and backup_delete manage remote and local snapshots with size metadata', async () => {
  const {op, save, backups} = await fixture({bundles: [{name: 'local-plugin', version: '1.0.0', spec: 'local-plugin@1.0.0', source: 'local-plugin@1.0.0', enabled: true}]});
  await save();
  const created1 = await op({action: 'backup_create', category: 'plugins'});
  const created2 = await op({action: 'backup_create', category: 'plugins'});
  assert.equal(created1.uploaded, true);
  assert.equal(backups().length, 2);
  const listed = await op({action: 'backups', category: 'plugins'});
  assert.equal(listed.items.length, 2);
  assert.ok(listed.items[0].name.startsWith('dsh-plugins.'));
  assert.ok(listed.items[0].totalBytes > 0);
  const deleted = await op({action: 'backup_delete', category: 'plugins', ids: [created1.id, created2.id]});
  assert.equal(deleted.removed.length, 2);
  assert.equal(deleted.localRemoved.length, 2);
  assert.equal(deleted.items.length, 0);
});
