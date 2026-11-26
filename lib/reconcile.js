import { compareVersions, PACKAGE_NAME } from './planner.js';
import { parseEntry } from './core.js';

const IGNORED = name => name === PACKAGE_NAME || name.startsWith('@deepseek-ai/');

const byName = (left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

/** Git sources are compared by repository, registry sources by the registry itself. */
const originOf = entry => (entry.spec.startsWith('github:') ? entry.spec.split('#')[0] : 'registry');

function sameEntry(left, right) {
  return Boolean(left && right) && left.name === right.name && left.version === right.version &&
    left.spec === right.spec && left.enabled === right.enabled;
}

/** Entries read back from saved state are re-validated instead of trusted. */
function readBaseline(baselineEntries) {
  const entries = [];
  for (const value of Array.isArray(baselineEntries) ? baselineEntries : []) {
    try {
      const entry = parseEntry(value);
      if (!IGNORED(entry.name)) entries.push(entry);
    } catch { /* a stale or hand-edited record is dropped, not fatal */ }
  }
  return new Map(entries.map(entry => [entry.name, entry]));
}

/**
 * Whether this machine's row may replace the remote row: same source, never a downgrade, and no
 * same-version source drift. Publishing an equal-version toggle is allowed.
 */
function canPublish(here, there, info) {
  if (!info?.portable || !here || !there) return false;
  if (originOf(here) !== originOf(there)) return false;
  const order = compareVersions(here.version, there.version);
  if (order === null || order < 0) return false;
  if (order > 0) return true;
  return here.spec === there.spec && here.enabled !== there.enabled;
}

/**
 * The remote-side action for a pair, mirroring `makePlan`: install / upgrade / enable / disable,
 * or null when the remote row must not overwrite the local one.
 */
function remoteAction(here, there, info) {
  if (!there) return null;
  if (!here) return {kind: 'install'};
  if (!info?.portable) return null;
  if (originOf(here) !== originOf(there)) return null;
  const order = compareVersions(here.version, there.version);
  if (order === null) return null;
  if (order < 0) {
    const target = originOf(there) === 'registry' ? 'registry' : 'git';
    return info.update === target ? {kind: 'upgrade'} : null;
  }
  if (order === 0) {
    if (here.spec !== there.spec) return null;
    if (here.enabled !== there.enabled) return {kind: there.enabled ? 'enable' : 'disable'};
  }
  return null;
}

const applyItem = (name, action, here, there) => ({
  id: name, name, kind: action.kind, local: here ?? null, remote: there ?? null,
  selectable: true, selected: action.kind === 'install',
  canApplyRemote: true, remoteKind: action.kind,
});

/** A row this machine would write for the first time. */
const localOnlyItem = (name, here) => ({
  id: name, name, kind: 'local-only', local: here, remote: null,
  selectable: false, selected: false, canPublishLocal: true, canApplyRemote: false,
});

/** A published row whose local copy changed while the remote copy did not. */
const localUpdateItem = (name, here, there) => ({
  id: name, name, kind: 'local-update', local: here, remote: there,
  selectable: false, selected: false, canPublishLocal: true, canApplyRemote: false,
});

const conflictItem = (name, here, there, base, {publish, apply, reason}) => ({
  id: name, name, kind: 'conflict', local: here ?? null, remote: there ?? null, baseline: base ?? null,
  selectable: false, selected: false,
  canPublishLocal: publish, canApplyRemote: Boolean(apply), ...(apply ? {remoteKind: apply.kind} : {}),
  reason,
});

const manualItem = (name, here, there, reason) => ({
  id: name, name, kind: 'manual', local: here ?? null, remote: there ?? null,
  selectable: false, selected: false, canPublishLocal: false, canApplyRemote: false, reason,
});

/**
 * Reconcile a machine's plugin inventory with the published list and the last agreed baseline.
 *
 * Every remote row is preserved in `nextEntries`, including rows this machine does not own
 * (`@deepseek-ai/*` and this plugin itself), because the write path refuses to remove anything.
 * A name already present in the local inventory is never offered as a remote install: a local row
 * that cannot be published (local development, protected, uninstalled leftovers) stays visible as
 * `manual` instead of being overwritten.
 *
 * A baseline advances only for names whose two sides are equal, so a drifted, missing or
 * conflicted name keeps the previous baseline and stays visible until it is resolved.
 * `baseline` should be persisted only after the `nextEntries` write succeeded.
 */
export function planReconciliation(localInventory, remoteEntries, baselineEntries = []) {
  const occupied = localInventory?.occupied instanceof Map ? localInventory.occupied : new Map();
  const published = new Map();
  for (const value of Array.isArray(remoteEntries) ? remoteEntries : []) {
    const entry = parseEntry(value);
    published.set(entry.name, entry);
  }
  const remote = new Map([...published].filter(([name]) => !IGNORED(name)));
  const baseline = readBaseline(baselineEntries);

  const names = new Set([...occupied.keys(), ...remote.keys(), ...baseline.keys()]);
  const items = [];
  const nextEntries = new Map(published);
  const nextBaseline = new Map(baseline);

  for (const name of [...names].sort()) {
    if (IGNORED(name)) continue;
    const info = occupied.get(name);
    const here = info?.entry;
    const there = remote.get(name);
    const base = baseline.get(name);

    if (here && there && sameEntry(here, there)) {
      nextBaseline.set(name, here);
      continue;
    }

    if (here && !there) {
      if (info.portable) {
        nextEntries.set(name, here);
        items.push(localOnlyItem(name, here));
      } else {
        items.push(manualItem(name, here, null, info.reason ?? 'unsupported-source'));
      }
      continue;
    }

    if (!here && there) {
      items.push(applyItem(name, {kind: 'install'}, null, there));
      continue;
    }

    if (!here && !there) {
      // Known only from the baseline: never a deletion, and nothing to reconcile until a side returns.
      continue;
    }

    const publish = canPublish(here, there, info);
    const apply = remoteAction(here, there, info);
    const localChanged = !sameEntry(here, base);
    const remoteChanged = !sameEntry(there, base);

    if (!base) {
      items.push(conflictItem(name, here, there, base, {publish, apply, reason: 'no-baseline'}));
      continue;
    }

    if (localChanged && !remoteChanged) {
      if (publish) {
        nextEntries.set(name, here);
        items.push(localUpdateItem(name, here, there));
      } else {
        items.push(conflictItem(name, here, there, base, {publish: false, apply, reason: 'local-change-not-publishable'}));
      }
      continue;
    }

    if (!localChanged && remoteChanged) {
      if (apply) items.push(applyItem(name, apply, here, there));
      else items.push(manualItem(name, here, there, 'remote-change-not-applicable'));
      continue;
    }

    items.push(conflictItem(name, here, there, base, {publish, apply, reason: 'divergent'}));
  }

  return {
    items: items.sort(byName),
    nextEntries: [...nextEntries.values()].sort(byName),
    baseline: [...nextBaseline.values()].sort(byName),
  };
}