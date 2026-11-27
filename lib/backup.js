import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Everything a plugin backup consists of. Paths are relative to one snapshot folder. */
export const PLUGIN_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'plugins.json'];
/** Where snapshots live inside the same collection that holds the manifest. */
export const BACKUP_ROOT = 'backup';
export const CATEGORY = 'plugins';
export const INDEX_PATH = `${BACKUP_ROOT}/${CATEGORY}/index.json`;
export const SNAPSHOT_ID = /^\d{8}-\d{6}$/;
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_INDEX_BYTES = 1024 * 1024;

const pad = value => String(value).padStart(2, '0');

/** Sortable id in the machine's local time: 20261127-203512. */
export function snapshotId(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError('snapshotId() needs a valid Date');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function totalBytes(files) {
  let total = 0;
  for (const value of Object.values(files)) total += value.length;
  return total;
}

/** Builds the index entry for a freshly collected snapshot. */
export function describeSnapshot(id, files, createdAt = new Date().toISOString()) {
  if (!SNAPSHOT_ID.test(id)) throw new TypeError('Invalid snapshot id');
  if (!files || typeof files !== 'object') throw new TypeError('A snapshot needs its files');
  if (totalBytes(files) > MAX_TOTAL_BYTES) throw new TypeError('Snapshot exceeds its total size limit');
  return {
    id,
    createdAt,
    files: PLUGIN_FILES.filter(name => files[name] !== undefined).map(name => ({
      path: name, bytes: files[name].length, sha256: digest(files[name]),
    })),
  };
}

/** Strictly validates what arrived from the remote side before anything is used. */
export function parseIndex(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) return null;
  if (!Array.isArray(value.snapshots)) return null;
  const seen = new Set();
  const snapshots = [];
  for (const raw of value.snapshots) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const { id, createdAt, files } = raw;
    if (typeof id !== 'string' || !SNAPSHOT_ID.test(id) || seen.has(id)) return null;
    if (typeof createdAt !== 'string' || createdAt === '' || createdAt.length > 64) return null;
    if (!Array.isArray(files) || files.length === 0 || files.length > PLUGIN_FILES.length) return null;
    const paths = new Set();
    let bytes = 0;
    for (const file of files) {
      if (!file || typeof file !== 'object') return null;
      const { path, bytes: size, sha256 } = file;
      if (typeof path !== 'string' || !PLUGIN_FILES.includes(path) || paths.has(path)) return null;
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) return null;
      if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
      paths.add(path);
      bytes += size;
    }
    if (bytes > MAX_TOTAL_BYTES) return null;
    seen.add(id);
    snapshots.push({ id, createdAt, files });
  }
  return {version: 1, snapshots};
}

export function encodeIndex(index) {
  return Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
}

/**
 * Puts `snapshot` in front of the existing list, caps it at `retention` and reports the ids that
 * fell out. Snapshot ids are second-resolution, so a repeated id replaces the older entry instead
 * of duplicating it.
 */
export function mergeIndex(index, snapshot, retention) {
  const kept = index.snapshots.filter(entry => entry.id !== snapshot.id);
  const snapshots = [snapshot, ...kept].slice(0, retention);
  const keptIds = new Set(snapshots.map(entry => entry.id));
  const dropped = index.snapshots.filter(entry => !keptIds.has(entry.id)).map(entry => entry.id);
  return {index: {version: 1, snapshots}, dropped};
}

/** Reads the profile files a plugin backup consists of; `plugins.json` is the portable list. */
export async function collectPluginFiles(profileDir, entries) {
  const files = {};
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    let buffer;
    try { buffer = await readFile(join(profileDir, name)) } catch { continue }
    if (buffer.length > MAX_FILE_BYTES) throw new Error(`${name} is too large to back up`);
    files[name] = buffer;
  }
  files['plugins.json'] = Buffer.from(`${JSON.stringify({version: 1, entries}, null, 2)}\n`);
  if (totalBytes(files) > MAX_TOTAL_BYTES) throw new Error('Plugin configuration is too large to back up');
  return files;
}

/** Local staging copy, kept so a restore still works when the remote copy is gone. */
export async function writeLocal(root, id, files) {
  if (!SNAPSHOT_ID.test(id)) throw new TypeError('Invalid snapshot id');
  const dir = join(root, id);
  await mkdir(dir, {recursive: true});
  for (const name of PLUGIN_FILES) {
    if (files[name] === undefined) continue;
    await writeFile(join(dir, name), files[name]);
  }
  return dir;
}

export async function readLocal(root, id) {
  if (!SNAPSHOT_ID.test(id)) return null;
  const dir = join(root, id);
  const files = {};
  let found = false;
  for (const name of PLUGIN_FILES) {
    try { files[name] = await readFile(join(dir, name)) } catch { continue }
    found = true;
  }
  return found ? files : null;
}

export async function listLocal(root) {
  let names;
  try { names = await readdir(root) } catch { return [] }
  return names.filter(name => SNAPSHOT_ID.test(name)).sort().reverse();
}

/** Drops local staging copies beyond `keep` ids; unrelated files are never touched. */
export async function pruneLocal(root, keep) {
  const keepIds = new Set(keep);
  for (const id of await listLocal(root)) {
    if (keepIds.has(id)) continue;
    await rm(join(root, id), {recursive: true, force: true}).catch(() => {});
  }
}

/** Picks the files of one snapshot, verifying size and digest, in the format transports deliver. */
export function verifyFiles(entry, files) {
  if (!entry || !files) throw new Error('Backup files are missing');
  const out = {};
  for (const file of entry.files) {
    const buffer = files[file.path];
    if (!buffer) throw new Error(`Backup ${entry.id} is missing ${file.path}`);
    if (buffer.length !== file.bytes || digest(buffer) !== file.sha256) {
      throw new Error(`Backup ${entry.id} has a corrupt ${file.path}`);
    }
    out[file.path] = buffer;
  }
  return out;
}

export function parsePluginList(buffer) {
  let value;
  try { value = JSON.parse(buffer.toString('utf8')) } catch { throw new Error('plugins.json is not valid JSON') }
  if (!value || typeof value !== 'object' || !Array.isArray(value.entries)) throw new Error('plugins.json has no entries');
  return value.entries;
}

/**
 * Diff between the installed inventory and a snapshot. Extra installed plugins are reported
 * separately: nothing here ever uninstalls.
 */
export function restoreItems(current, desired) {
  const here = new Map(current.map(entry => [entry.name, entry]));
  const wanted = new Map(desired.map(entry => [entry.name, entry]));
  const items = [];
  for (const [name, entry] of wanted) {
    const local = here.get(name);
    if (!local) items.push({name, kind: 'install', remote: entry});
    else if (local.version !== entry.version || local.spec !== entry.spec) items.push({name, kind: 'upgrade', remote: entry, local});
    else if (local.enabled !== entry.enabled) items.push({name, kind: entry.enabled ? 'enable' : 'disable', remote: entry, local});
  }
  const extra = current.filter(entry => !wanted.has(entry.name)).map(entry => entry.name);
  return {items, extra};
}

export async function statLocal(root, id) {
  try { return await stat(join(root, id)) } catch { return null }
}