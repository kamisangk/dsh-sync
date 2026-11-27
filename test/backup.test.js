import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  PLUGIN_FILES, collectPluginFiles, describeSnapshot, digest, encodeIndex, listLocal, mergeIndex,
  parseIndex, parsePluginList, pruneLocal, readLocal, restoreItems, snapshotId, verifyFiles, writeLocal,
} from '../lib/backup.js';

const entry = (name = 'tool', version = '1.0.0', enabled = true) => ({name, version, spec: `${name}@${version}`, enabled});
const filesOf = (content = '{"version":1,"entries":[]}\n') => ({'plugins.json': Buffer.from(content)});
const tempProfile = () => mkdtemp(join(tmpdir(), 'dsh-sync-backup-'));

test('snapshot ids are sortable local timestamps', () => {
  assert.equal(snapshotId(new Date(2026, 10, 27, 20, 35, 12)), '20261127-203512');
  assert.match(snapshotId(), /^\d{8}-\d{6}$/);
  assert.throws(() => snapshotId('not a date'), /valid Date/);
  assert.throws(() => snapshotId(new Date(Number.NaN)), /valid Date/);
});

test('describeSnapshot records only the files that exist and rejects bad ids', () => {
  const files = filesOf();
  const snapshot = describeSnapshot('20260101-000000', files);
  assert.deepEqual(Object.keys(snapshot), ['id', 'createdAt', 'files']);
  assert.deepEqual(snapshot.files, [{path: 'plugins.json', bytes: files['plugins.json'].length, sha256: digest(files['plugins.json'])}]);
  assert.throws(() => describeSnapshot('../../etc', files), /Invalid snapshot id/);
  assert.throws(() => describeSnapshot('20260101-000000', null), /needs its files/);
  assert.throws(() => describeSnapshot('20260101-000000', {'plugins.json': Buffer.alloc(9 * 1024 * 1024)}), /total size limit/);
});

test('parseIndex rejects everything it does not fully understand', () => {
  const files = describeSnapshot('20260101-000000', filesOf()).files;
  const good = {version: 1, snapshots: [{id: '20260101-000000', createdAt: '2026-01-01T00:00:00.000Z', files}]};
  assert.deepEqual(parseIndex(good), good);
  const clone = value => JSON.parse(JSON.stringify(value));
  for (const broken of [
    null, [], {}, {version: 2, snapshots: []}, {version: 1}, {version: 1, snapshots: {}},
    {version: 1, snapshots: [{...good.snapshots[0], id: '2026-01-01'}]},
    {version: 1, snapshots: [good.snapshots[0], good.snapshots[0]]},
    {version: 1, snapshots: [{...good.snapshots[0], createdAt: 5}]},
    {version: 1, snapshots: [{...good.snapshots[0], files: []}]},
    {version: 1, snapshots: [{...good.snapshots[0], files: [{path: 'evil.sh', bytes: 1, sha256: '0'.repeat(64)}]}]},
    {version: 1, snapshots: [{...good.snapshots[0], files: [{path: 'plugins.json', bytes: -1, sha256: '0'.repeat(64)}]}]},
    {version: 1, snapshots: [{...good.snapshots[0], files: [{path: 'plugins.json', bytes: 1, sha256: 'xyz'}]}]},
    {version: 1, snapshots: [{...good.snapshots[0], files: [files[0], files[0]]}]},
    {version: 1, snapshots: [{...good.snapshots[0], files: [{path: 'plugins.json', bytes: 1.5, sha256: '0'.repeat(64)}]}]},
  ]) assert.equal(parseIndex(broken), null, JSON.stringify(broken));
  const huge = clone(good);
  huge.snapshots[0].files[0].bytes = 5 * 1024 * 1024;
  assert.equal(parseIndex(huge), null);
});

test('mergeIndex keeps the newest snapshots, replaces a repeated id and reports drops', () => {
  const one = describeSnapshot('20260101-000001', filesOf());
  const two = describeSnapshot('20260101-000002', filesOf());
  const three = describeSnapshot('20260101-000003', filesOf());
  const first = mergeIndex({version: 1, snapshots: []}, one, 3);
  assert.deepEqual(first.index.snapshots.map(s => s.id), ['20260101-000001']);
  assert.deepEqual(first.dropped, []);
  const second = mergeIndex(first.index, two, 3);
  assert.deepEqual(second.index.snapshots.map(s => s.id), ['20260101-000002', '20260101-000001']);
  const replaced = mergeIndex(second.index, {...two, createdAt: '2026-02-02T00:00:00.000Z'}, 3);
  assert.equal(replaced.index.snapshots.length, 2);
  assert.equal(replaced.index.snapshots[0].createdAt, '2026-02-02T00:00:00.000Z');
  const capped = mergeIndex(second.index, three, 2);
  assert.deepEqual(capped.index.snapshots.map(s => s.id), ['20260101-000003', '20260101-000002']);
  assert.deepEqual(capped.dropped, ['20260101-000001']);
  const none = mergeIndex(second.index, three, 0);
  assert.deepEqual(none.index.snapshots, []);
  assert.deepEqual(none.dropped, ['20260101-000002', '20260101-000001'], 'only entries that were in the index can drop');
});

test('encodeIndex emits JSON with a trailing newline', () => {
  const buffer = encodeIndex({version: 1, snapshots: []});
  assert.equal(buffer.toString('utf8'), '{\n  "version": 1,\n  "snapshots": []\n}\n');
});

test('verifyFiles refuses corrupted, missing and unexpected files', () => {
  const files = filesOf();
  const snapshot = describeSnapshot('20260101-000000', files);
  assert.deepEqual(verifyFiles(snapshot, files), files);
  assert.throws(() => verifyFiles(snapshot, {'plugins.json': Buffer.from('{"tampered":true}\n')}), /corrupt plugins.json/);
  assert.throws(() => verifyFiles(snapshot, {}), /missing plugins.json/);
  assert.throws(() => verifyFiles(null, files), /files are missing/);
});

test('restoreItems covers install, upgrade, enable, disable and never uninstalls', () => {
  const desired = [entry('keep', '1.0.0'), entry('upgrade', '2.0.0'), entry('enable', '1.0.0'), entry('disable', '1.0.0', false), entry('install', '1.0.0')];
  const current = [entry('keep', '1.0.0'), entry('upgrade', '1.0.0'), entry('enable', '1.0.0', false), entry('disable', '1.0.0'), entry('extra', '1.0.0')];
  const {items, extra} = restoreItems(current, desired);
  assert.deepEqual(items.map(item => [item.name, item.kind]), [
    ['upgrade', 'upgrade'], ['enable', 'enable'], ['disable', 'disable'], ['install', 'install'],
  ]);
  assert.ok(items.every(item => item.remote.spec !== undefined));
  assert.deepEqual(extra, ['extra'], 'the extra plugin is reported, never uninstalled');
  assert.deepEqual(restoreItems(desired, desired).items, []);
  assert.deepEqual(restoreItems([], desired).items.map(item => item.kind), ['install', 'install', 'install', 'install', 'install']);
  // A version change outranks an enabled change, and the spec difference alone is enough.
  assert.equal(restoreItems([entry('a', '1.0.0')], [{...entry('a', '1.0.0'), spec: 'a@2.0.0'}]).items[0].kind, 'upgrade');
});

test('collectPluginFiles reads what exists and always writes the portable list', async () => {
  const profile = await tempProfile();
  await writeFile(join(profile, 'package.json'), '{"name":"profile"}\n');
  await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const entries = [entry('tool')];
  const files = await collectPluginFiles(profile, entries);
  assert.deepEqual(Object.keys(files), ['package.json', 'pnpm-lock.yaml', 'plugins.json']);
  assert.deepEqual(JSON.parse(files['plugins.json'].toString('utf8')), {version: 1, entries});
  const missing = await collectPluginFiles(profile, []);
  assert.deepEqual(Object.keys(missing), ['package.json', 'pnpm-lock.yaml', 'plugins.json']);
});

test('collectPluginFiles refuses a file beyond the backup limit', async () => {
  const profile = await tempProfile();
  await writeFile(join(profile, 'package.json'), Buffer.alloc(4 * 1024 * 1024 + 1));
  await assert.rejects(collectPluginFiles(profile, []), /too large to back up/);
});

test('local snapshots round-trip, list newest first and prune only snapshot folders', async () => {
  const root = await tempProfile();
  const newer = {'plugins.json': Buffer.from('{"version":1,"entries":[]}\n')};
  const older = {...newer};
  await writeLocal(root, '20260101-000001', older);
  await writeLocal(root, '20260101-000002', newer);
  assert.deepEqual(await listLocal(root), ['20260101-000002', '20260101-000001']);
  assert.deepEqual(await readLocal(root, '20260101-000002'), newer);
  assert.equal(await readLocal(root, '20260101-000003'), null);
  assert.equal(await readLocal(root, '../x'), null);
  await mkdir(join(root, 'notes'), {recursive: true});
  await writeFile(join(root, 'notes', 'keep.txt'), 'x');
  await pruneLocal(root, ['20260101-000002']);
  assert.deepEqual(await listLocal(root), ['20260101-000002']);
  assert.equal(await readFile(join(root, 'notes', 'keep.txt'), 'utf8'), 'x', 'unrelated folders survive');
  await assert.rejects(writeLocal(root, '../escape', newer), /Invalid snapshot id/);
});

test('parsePluginList rejects documents without entries', () => {
  assert.deepEqual(parsePluginList(Buffer.from('{"version":1,"entries":[{"name":"a"}]}\n')), [{name: 'a'}]);
  for (const body of ['', 'not json', '{}', '[]', '{"entries":{}}']) {
    assert.throws(() => parsePluginList(Buffer.from(body)), /plugins.json/, body);
  }
  assert.deepEqual(PLUGIN_FILES, ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'plugins.json']);
});
