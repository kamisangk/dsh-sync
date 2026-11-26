import { parseEntry } from './core.js';

export const PACKAGE_NAME = '@kamisangk/dsh-sync';

function portable(bundle) {
  const { name, version, enabled, source } = bundle;
  if (typeof source !== 'string') return null;
  const registry = source.startsWith(`${name}@`) && /^[~^]?[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(source.slice(name.length + 1));
  try {
    return parseEntry({ name, version, enabled, spec: registry ? `${name}@${version}` : source });
  } catch {
    return null;
  }
}

function reasonFor(bundle) {
  const source = typeof bundle.source === 'string' ? bundle.source : '';
  const local = source.startsWith('file:') || source.startsWith('link:') || /^[A-Za-z]:/.test(source) ||
    source.startsWith('/') || source.startsWith('./') || source.startsWith('../') || source.startsWith('.\\') || source.startsWith('..\\');
  if (local) return 'local-source';
  const git = source.startsWith('github:') || source.startsWith('git+') || source.startsWith('git:') || source.includes('.git');
  return git ? 'unpinned' : 'unsupported-source';
}

export function inventory(bundles, plugins = []) {
  const entries = [];
  const occupied = new Map();
  const live = new Map(plugins.map(plugin => [plugin.entryId, plugin.enabled]));
  for (const bundle of bundles) {
    if (!bundle.name || bundle.name === PACKAGE_NAME || bundle.availability === 'missing') continue;
    if (bundle.availability === 'installation' || bundle.official || bundle.name.startsWith('@deepseek-ai/')) continue;
    const rows = Array.isArray(bundle.rows) ? bundle.rows : [];
    const running = bundle.enabled !== false && rows.every(row => row.entryId === undefined || live.get(row.entryId) !== false);
    const portableEntry = !bundle.error && !bundle.readOnlyReason ? portable(bundle) : null;
    const entry = portableEntry
      ? { ...portableEntry, enabled: running }
      : { name: bundle.name, version: bundle.version ?? '', enabled: running };
    occupied.set(bundle.name, { entry, portable: !!portableEntry, reason: reasonFor(bundle), update: bundle.update });
    if (portableEntry) entries.push(entry);
  }
  return { entries, occupied };
}

export function compareVersions(left, right) {
  const split = value => value.split('+')[0].match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/)?.slice(1);
  const a = split(left), b = split(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) {
    const x = BigInt(a[i]), y = BigInt(b[i]);
    if (x !== y) return x > y ? 1 : -1;
  }
  if (a[3] === b[3]) return 0;
  if (!a[3] || !b[3]) return a[3] ? -1 : 1;
  const x = a[3].split('.'), y = b[3].split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x[i]), yn = /^\d+$/.test(y[i]);
    if (xn && yn) return BigInt(x[i]) < BigInt(y[i]) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

const origin = entry => entry.spec.startsWith('github:') ? entry.spec.split('#')[0] : 'registry';

export function makePlan(local, remoteEntries) {
  const remote = new Map(remoteEntries.filter(e => e.name !== PACKAGE_NAME && !e.name.startsWith('@deepseek-ai/')).map(e => [e.name, e]));
  const names = new Set([...remote.keys(), ...local.occupied.keys()]);
  const items = [];
  for (const name of [...names].sort()) {
    const here = local.occupied.get(name), there = remote.get(name);
    const add = (kind, reason) => items.push({ id: name, name, kind, local: here?.entry ?? null, remote: there ?? null, selectable: ['install','upgrade','enable','disable'].includes(kind), selected: kind === 'install', ...(reason ? { reason } : {}) });
    if (!here) { add('install'); continue; }
    if (!here.portable) { add('manual', here.reason); continue; }
    if (!there) { add('local-only'); continue; }
    if (origin(here.entry) !== origin(there)) { add('source-mismatch', 'source-mismatch'); continue; }
    const order = compareVersions(here.entry.version, there.version);
    if (order > 0) { add('local-newer'); continue; }
    if (order < 0) {
      const kind = origin(there) === 'registry' ? 'registry' : 'git';
      add(here.update === kind ? 'upgrade' : 'manual', here.update === kind ? undefined : 'unsupported-source');
      continue;
    }
    if (here.entry.spec !== there.spec || here.entry.version !== there.version) { add('manual', 'same-version-drift'); continue; }
    if (here.entry.enabled !== there.enabled) add(there.enabled ? 'enable' : 'disable');
  }
  return items;
}
