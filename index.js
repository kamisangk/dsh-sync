import { createHash, randomUUID } from 'node:crypto';
import { createDav, DavError } from './lib/core.js';
import { createGit, GitError } from './lib/git.js';
import { planReconciliation } from './lib/reconcile.js';
import { inventory } from './lib/planner.js';

export const inject = ['pluginManager', 'credentials', 'connection', 'webServer', 'tools'];
const KEY = 'kamisangk-dsh-sync/webdav';
const DEFAULTS = {address: '', dir: '', url: '', username: '', password: '', retention: 10, autoApply: false};
const MAX_BODY = 32 * 1024;
const PLAN_TTL = 10 * 60_000;

class RequestError extends Error {}

const GIT_KEY = 'kamisangk-dsh-sync/git';
const TARGET_KEY = 'kamisangk-dsh-sync/transport';
const GIT_DEFAULTS = {repo: '', branch: 'main', auth: 'ssh', token: '', gitUsername: 'x-access-token', authorName: 'DSH Sync', authorEmail: 'dsh-sync@localhost', autoApply: false};
const DIRECTIONS = ['both', 'upload', 'download'];

/** The address and folder fields are what the user configures; the URL is their join. */
export function splitWebdavUrl(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return {address: '', dir: ''};
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:') return {address: text, dir: ''};
    let dir = parsed.pathname;
    try { dir = decodeURIComponent(dir); } catch { /* keep the encoded path */ }
    return {address: parsed.origin, dir: dir.replace(/^\/+|\/+$/g, '')};
  } catch {
    return {address: text, dir: ''};
  }
}

export function composeWebdavUrl(address, dir) {
  const base = typeof address === 'string' ? address.trim().replace(/\/+$/, '') : '';
  const path = typeof dir === 'string' ? dir.trim().replace(/^\/+|\/+$/g, '') : '';
  return path ? `${base}/${path}` : base;
}

function publicSettings(settings, state) {
  const {password, git: {token, autoApply: gitAutoApply, ...git}, ...rest} = settings;
  return {...rest, git: {...git, autoApply: gitAutoApply, tokenSet: !!token}, passwordSet: !!password,
    webdavAutoApply: rest.autoApply, autoApply: rest.transport === 'git' ? gitAutoApply : rest.autoApply,
    direction: state.direction ?? 'both', overview: state.overview};
}

export function syncService(manager, credentials, connect = createDav, connectGit = createGit) {
  let plan;
  let busy = false;
  const local = async () => inventory(await manager.listBundles(), await manager.listPlugins());
  const readSettings = async () => {
    const [webdav, git, target] = await Promise.all([KEY, GIT_KEY, TARGET_KEY].map(key => credentials.readRecord(key)));
    const saved = webdav?.payload ?? {};
    const parts = splitWebdavUrl(saved.url);
    const address = typeof saved.address === 'string' ? saved.address : parts.address;
    const dir = typeof saved.dir === 'string' ? saved.dir : parts.dir;
    // The stored URL is what names this target's state; only records without one are recomposed.
    const url = typeof saved.url === 'string' && saved.url ? saved.url : composeWebdavUrl(address, dir);
    return {...DEFAULTS, ...saved, address, dir, url, git: {...GIT_DEFAULTS, ...git?.payload}, transport: target?.payload?.transport === 'git' ? 'git' : 'webdav'};
  };
  const stateKey = settings => 'kamisangk-dsh-sync/state-' + createHash('sha256')
    .update(JSON.stringify([process.env.DSH_PROFILE_DIR ?? process.env.DSH_PROFILE ?? '', ...(
      settings.transport === 'git' ? ['git', settings.git.repo, settings.git.branch] : [settings.url, settings.username])])).digest('hex');
  const readState = async key => {
    const value = (await credentials.readRecord(key))?.payload;
    return value?.version === 1 ? value : {version: 1, baseline: [], overview: {}};
  };
  const reconcile = (here, entries, state) => {
    return planReconciliation(here, entries, state.baseline);
  };
  const snapshot = (here, there, mode, summary, previous = {}) => ({
    ...previous, ...(mode ? {mode} : {}), checkedAt: new Date().toISOString(),
    localCount: here.entries.length, remoteCount: there.entries.length,
    historyCount: there.historyCount, conflictCount: summary.items.filter(i => i.kind === 'conflict').length,
  });
  const applicationSummary = outcomes => {
    const counts = {};
    for (const {status} of outcomes) counts[status] = (counts[status] ?? 0) + 1;
    return {at: new Date().toISOString(), counts};
  };

  async function setEnabled(name, on) {
    const bundleOf = async () => (await manager.listBundles()).find(bundle => bundle.name === name);
    const before = await bundleOf();
    if (!before) throw new RequestError(`Plugin ${name} is no longer installed.`);
    const wasSelected = before.enabled === true;
    let status = {application: 'applied', changed: false};
    if (before.enabled !== on) {
      const change = await manager.setBundleEnabled(name, on);
      if (change.application === 'failed' || change.application === 'cancelled') return change;
      status = change;
    }
    if (!on) return status;
    // A row-level `disabled` override (user patch or a higher layer such as an agent preset) outranks bundle selection.
    const rows = (await bundleOf())?.rows ?? [];
    let overridden;
    const toggled = [];
    for (const row of rows) {
      if (row.entryId === undefined) continue;
      const live = (await manager.listPlugins()).find(plugin => plugin.entryId === row.entryId);
      if (!live || live.enabled) continue;
      const change = await manager.setPluginEnabled(row.entryId, true);
      if (change.application === 'failed' || change.application === 'cancelled') return change;
      toggled.push(row.entryId);
      if (change.application === 'overridden') overridden = change;
      status = change;
    }
    if (overridden && !wasSelected) {
      // Put the user's own overrides back exactly as they were, then drop the selection we added.
      for (const entryId of toggled) await manager.setPluginEnabled(entryId, false).catch(() => {});
      await manager.setBundleEnabled(name, false).catch(() => {});
    }
    return overridden ?? status;
  }

  async function applyItems(items) {
    const outcomes = [];
    for (const item of items) {
      let change;
      try {
        const entry = item.remote;
        if (item.kind === 'install') {
          change = await manager.installBundle(entry.spec, {enabled: entry.enabled, saveExact: true, expected: {name: entry.name, version: entry.version}});
        } else if (item.kind === 'upgrade') {
          const result = await manager.updateBundle(entry.name, entry.version, entry.spec.startsWith('github:') ? {spec: entry.spec} : undefined);
          change = result.result;
          if (result.restore) {
            outcomes.push({name: item.name, status: change.application, detail: `Restore: ${result.restore.application}`});
            continue;
          }
        } else if (item.kind === 'enable' || item.kind === 'disable') {
          change = await setEnabled(entry.name, item.kind === 'enable');
        }
        outcomes.push({name: item.name, status: change?.pendingBuilds?.length ? 'approval-required' : change?.application ?? 'failed',
          ...(change?.error?.code ? {detail: change.error.code} : {})});
      } catch {
        outcomes.push({name: item.name, status: 'failed'});
      }
    }
    return outcomes;
  }

  function remember(items, extra) {
    // Detach the plan from live manager/remote objects so a later change cannot rewrite the plan it is compared against.
    const snapshot = structuredClone(items);
    plan = {id: randomUUID(), at: Date.now(), items: snapshot};
    return {id: plan.id, items: structuredClone(snapshot), ...extra};
  }

  return async function operation(input) {
    if (busy) throw new RequestError('Another sync operation is running.');
    busy = true;
    let reportFailure;
    try {
      const settings = await readSettings();
      const key = stateKey(settings);
      const state = await readState(key);
      const direction = state.direction ?? 'both';
      const mayUpload = direction !== 'download';
      const mayDownload = direction !== 'upload';
      const saveState = async (baseline, overview, nextDirection = direction) => {
        await credentials.modifyRecord(key, () => ({kind: 'grant', payload: {version: 1, direction: nextDirection, baseline, overview}}));
      };
      const attempt = (outcomes, items) => ({at: new Date().toISOString(), direction,
        status: outcomes.some(item => !['applied', 'restart-required'].includes(item.status)) ? 'failed'
          : items.some(item => item.selectable || item.kind === 'conflict' || (mayUpload && ['local-only', 'local-update'].includes(item.kind))) || outcomes.some(item => item.status === 'restart-required') ? 'pending' : 'success'});
      if (input.action === 'status') return publicSettings(settings, state);
      if (input.action === 'direction') {
        if (!DIRECTIONS.includes(input.direction)) throw new RequestError('Invalid sync direction.');
        if (!(settings.transport === 'git' ? settings.git.repo : settings.url)) throw new RequestError('Save a connection first.');
        await saveState(state.baseline, state.overview, input.direction);
        plan = undefined;
        return publicSettings(settings, {...state, direction: input.direction});
      }
      if (input.action === 'save') {
        if (input.transport !== undefined && !['webdav', 'git'].includes(input.transport)) throw new RequestError('Invalid transport.');
        if (input.transport === 'git') {
          if (!input.git || typeof input.git !== 'object' || typeof input.autoApply !== 'boolean') throw new RequestError('Invalid Git settings.');
          const updated = {...GIT_DEFAULTS};
          for (const field of ['repo', 'branch', 'auth', 'gitUsername', 'authorName', 'authorEmail']) {
            const value = input.git[field] ?? GIT_DEFAULTS[field];
            if (typeof value !== 'string' || value.length > 2048) throw new RequestError('Invalid Git settings.');
            updated[field] = value.trim();
          }
          const same = ['repo', 'branch', 'auth', 'gitUsername'].every(field => updated[field] === settings.git[field]);
          if (input.git.token !== undefined && (typeof input.git.token !== 'string' || input.git.token.length > 2048 || /[\u0000\r\n]/.test(input.git.token))) throw new RequestError('Invalid Git token.');
          updated.token = updated.auth === 'https' ? input.git.token || (same ? settings.git.token : '') : '';
          updated.autoApply = input.autoApply && same && settings.transport === 'git';
          try { connectGit(updated); } catch (error) { throw new RequestError(error.message); }
          await credentials.modifyRecord(GIT_KEY, () => ({kind: 'grant', payload: updated}));
          await credentials.modifyRecord(TARGET_KEY, () => ({kind: 'grant', payload: {transport: 'git'}}));
          plan = undefined;
          const next = {...settings, git: updated, transport: 'git'};
          return publicSettings(next, await readState(stateKey(next)));
        }
        const {url, address, dir, username, password, retention, autoApply} = input;
        const suppliedUrl = typeof url === 'string' ? url.trim() : '';
        const fromParts = typeof address === 'string' || typeof dir === 'string';
        if (!fromParts && typeof url !== 'string') throw new RequestError('Invalid WebDAV settings.');
        const parts = fromParts
          ? {address: typeof address === 'string' ? address : '', dir: typeof dir === 'string' ? dir : ''}
          : splitWebdavUrl(suppliedUrl);
        if (parts.address.length > 2048 || parts.dir.length > 2048 ||
            typeof username !== 'string' || username.length > 256 ||
            (password !== undefined && (typeof password !== 'string' || password.length > 2048)) ||
            !Number.isInteger(retention) || retention < 0 || retention > 50 || typeof autoApply !== 'boolean') {
          throw new RequestError('Invalid WebDAV settings.');
        }
        const cleanAddress = parts.address.trim().replace(/\/+$/, '');
        const cleanDir = parts.dir.trim().replace(/^\/+|\/+$/g, '');
        // A dot segment would silently resolve somewhere else once the URL is parsed.
        if (cleanDir.split('/').some(segment => segment === '.' || segment === '..')) throw new RequestError('Invalid WebDAV folder path.');
        const cleanUrl = composeWebdavUrl(cleanAddress, cleanDir);
        if (!cleanUrl) throw new RequestError('Save a server address first.');
        const cleanUsername = username.trim();
        // A record written before the split keeps its exact URL, so re-saving the same address and
        // folder under a new password does not move the state key (direction, baseline, overview).
        const sameAddress = cleanUrl === composeWebdavUrl(settings.address, settings.dir);
        const sameConnection = sameAddress && cleanUsername === settings.username;
        const suppliedParts = suppliedUrl ? splitWebdavUrl(suppliedUrl) : {address: '', dir: ''};
        const nextUrl = sameAddress ? settings.url
          : suppliedUrl && composeWebdavUrl(suppliedParts.address, suppliedParts.dir) === cleanUrl ? suppliedUrl : cleanUrl;
        const updated = {url: nextUrl, address: cleanAddress, dir: cleanDir, username: cleanUsername,
          password: password || (sameConnection ? settings.password : ''), retention,
          autoApply: autoApply && sameConnection && settings.transport === 'webdav'};
        try { connect(updated) } catch (error) { throw new RequestError(error instanceof Error ? error.message : 'Invalid WebDAV settings.') }
        await credentials.modifyRecord(KEY, () => ({kind: 'grant', payload: updated}));
        await credentials.modifyRecord(TARGET_KEY, () => ({kind: 'grant', payload: {transport: 'webdav'}}));
        plan = undefined;
        const next = {...settings, ...updated, transport: 'webdav'};
        return publicSettings(next, await readState(stateKey(next)));
      }
      const isGit = settings.transport === 'git';
      const autoApply = isGit ? settings.git.autoApply : settings.autoApply;
      if (input.action === 'sync' || input.action === 'apply' || input.action === 'resolve') {
        reportFailure = error => saveState(state.baseline, {...state.overview, lastAttempt: {
          at: new Date().toISOString(), direction, status: 'failed',
          error: error instanceof RequestError || error instanceof DavError || error instanceof GitError ? error.message : 'Plugin sync failed.',
        }});
      }
      if (!(isGit ? settings.git.repo : settings.url)) throw new RequestError('Save a connection first.');
      let dav;
      try { dav = isGit ? connectGit(settings.git) : connect(settings); }
      catch (error) { throw new RequestError(error.message); }
      function directional(items) {
        return items.filter(item => item.kind === 'conflict' || item.kind === 'manual' ||
          (['local-only', 'local-update'].includes(item.kind) ? mayUpload : mayDownload)).map(item => item.kind === 'conflict'
          ? {...item, canPublishLocal: mayUpload && item.canPublishLocal, canApplyRemote: mayDownload && item.canApplyRemote}
          : item);
      }
      async function record(here, there, previous = state.overview, mode) {
        const summary = reconcile(here, there.entries, state);
        const overview = snapshot(here, there, mode, summary, previous);
        if (previous.outcomes) {
          overview.lastAttempt = attempt(previous.outcomes, directional(summary.items));
          if (overview.lastAttempt.status === 'failed') overview.lastAttempt.error = 'One or more plugin changes failed. Review the operation results.';
          delete overview.outcomes;
        }
        await saveState(summary.baseline, overview);
        return {items: directional(summary.items), overview, historyCount: there.historyCount};
      }
      const freshAgainst = (item, here, entries) => {
        const fresh = directional(reconcile(here, entries, state).items).find(candidate => candidate.id === item.id);
        if (JSON.stringify(fresh) !== JSON.stringify(item)) throw new RequestError('The plugin inventory changed. Preview again.');
        return fresh;
      };
      if (input.action === 'test') {
        const mode = await dav.mode();
        const overview = {...state.overview, mode};
        await saveState(state.baseline, overview);
        return {mode, overview};
      }
      if (input.action === 'preview') {
        const [here, there] = await Promise.all([local(), dav.read()]);
        const {items, ...extra} = await record(here, there);
        return remember(items, extra);
      }
      if (input.action === 'sync') {
        const target = isGit ? `${settings.git.repo} @ ${settings.git.branch}` : settings.url;
        if ((input.expectedDirection !== undefined && input.expectedDirection !== direction) ||
            (input.expectedTarget !== undefined && input.expectedTarget !== target)) {
          reportFailure = undefined;
          throw new RequestError('The sync target or direction changed. Reload settings and try again.');
        }
        plan = undefined;
        const here = await local();
        const mode = mayUpload ? await dav.mode() : undefined;
        const published = mayUpload ? await dav.update(entries => reconcile(here, entries, state).nextEntries, settings.retention) : await dav.read();
        const pending = directional(reconcile(here, published.entries, state).items);
        const outcomes = mayDownload && autoApply ? await applyItems(pending.filter(item => item.kind === 'install')) : [];
        const {added = 0, updated = 0} = published;
        const {items, ...extra} = await record(await local(), published, {
          ...state.overview, outcomes, lastSync: {at: new Date().toISOString(), added, updated},
          ...(outcomes.length ? {lastApply: applicationSummary(outcomes)} : {}),
        }, mode);
        return remember(items, {...extra, added, updated, outcomes});
      }
      if (input.action === 'apply' || input.action === 'resolve') {
        if (!plan || plan.id !== input.id || Date.now() - plan.at > PLAN_TTL) throw new RequestError('This plan expired. Preview again.');
        if (input.action === 'resolve') {
          const item = plan.items.find(candidate => candidate.name === input.name && candidate.kind === 'conflict');
          if (!item || !((input.choice === 'local' && item.canPublishLocal) || (input.choice === 'remote' && item.canApplyRemote))) throw new RequestError('This conflict choice is not available.');
          plan = undefined;
          const here = await local();
          if (input.choice === 'local') {
            const mode = await dav.mode();
            const there = await dav.update(entries => {
              freshAgainst(item, here, entries);
              return entries.map(entry => entry.name === item.name ? item.local : entry);
            }, settings.retention);
            const {items, ...extra} = await record(await local(), there, {
              ...state.overview, outcomes: [], lastSync: {at: new Date().toISOString(), added: there.added, updated: there.updated},
            }, mode);
            return remember(items, {...extra, added: there.added, updated: there.updated, outcomes: []});
          }
          const there = await dav.read();
          freshAgainst(item, here, there.entries);
          const outcomes = await applyItems([{...item, kind: item.remoteKind}]);
          const {items, ...extra} = await record(await local(), there, {
            ...state.overview, outcomes, lastApply: applicationSummary(outcomes),
          });
          return remember(items, {...extra, outcomes});
        }
        if (!Array.isArray(input.selected) || !input.selected.length || input.selected.some(id => typeof id !== 'string')) throw new RequestError('Select at least one change.');
        const selected = new Set(input.selected);
        const chosen = plan.items.filter(item => selected.has(item.id) && item.selectable);
        if (chosen.length !== selected.size) throw new RequestError('This plan does not contain all the selected changes.');
        plan = undefined;
        const [here, there] = await Promise.all([local(), dav.read()]);
        for (const item of chosen) freshAgainst(item, here, there.entries);
        const outcomes = await applyItems(chosen);
        const {overview} = await record(await local(), there, {...state.overview, outcomes, lastApply: applicationSummary(outcomes)});
        return {outcomes, overview};
      }
      throw new RequestError('Unknown sync action.');
    } catch (error) {
      if (reportFailure) await reportFailure(error).catch(() => {});
      throw error;
    } finally { busy = false; }
  };
}

async function readInput(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    if (size > MAX_BODY) { req.resume(); throw new RequestError('Request too large.'); }
    chunks.push(chunk);
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RequestError('Invalid JSON request.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequestError('Invalid sync request.');
  return parsed;
}

export function apply(ctx) {
  const operation = syncService(ctx.pluginManager, ctx.credentials);
  ctx.effect(() => ctx.tools.register({
    name: 'dsh_plugin_sync',
    description: 'Synchronize this machine\'s DeepSeek Harness plugin inventory over WebDAV or Git. ' +
      'Actions: status, configure, direction, test, preview, sync, apply, resolve. No action uninstalls or downgrades. ' +
      'sync respects the saved direction; it installs missing bundles only when downloads are allowed and autoApply is on. ' +
      'apply uses selected plan items. resolve uses the side the user explicitly chose for a named conflict.',
    parameters: {
      type: 'object',
      properties: {
        action: {type: 'string', enum: ['status', 'configure', 'direction', 'test', 'preview', 'sync', 'apply', 'resolve'], description: 'Operation to run.'},
        direction: {type: 'string', enum: ['upload', 'download', 'both'], description: 'direction: sync rule for the current target.'},
        transport: {type: 'string', enum: ['webdav', 'git'], description: 'configure: transport to activate.'},
        git: {type: 'object', required: ['repo'], additionalProperties: false, properties: {
          repo: {type: 'string'}, branch: {type: 'string'}, auth: {type: 'string', enum: ['ssh', 'https']},
          gitUsername: {type: 'string'}, token: {type: 'string'}, authorName: {type: 'string'}, authorEmail: {type: 'string'},
        }},
        address: {type: 'string', description: 'configure: WebDAV server address, for example https://host/dav. The folder is appended to it.'},
        dir: {type: 'string', description: 'configure: WebDAV folder path under that address, for example dsh-sync. May be empty for the address itself.'},
        url: {type: 'string', description: 'configure: complete WebDAV collection URL, for example https://host/dav/root/dir/; equivalent to address + dir.'},
        username: {type: 'string', description: 'configure: WebDAV user name.'},
        password: {type: 'string', description: 'configure: WebDAV password. It is stored in the DSH credential store, never in the remote list; omit it to keep the saved one.'},
        retention: {type: 'integer', minimum: 0, maximum: 50, description: 'configure: remote backups to keep, 0-50; the current list is not counted.'},
        autoApply: {type: 'boolean', description: 'configure: install missing bundles during sync. Defaults to false.'},
        id: {type: 'string', description: 'apply or resolve: plan id returned by preview or sync.'},
        name: {type: 'string', description: 'resolve: name of the conflicting plugin.'},
        choice: {type: 'string', enum: ['local', 'remote'], description: 'resolve: the side explicitly selected by the user.'},
        selected: {type: 'array', items: {type: 'string'}, description: 'apply: item ids from that plan.'},
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {type: 'object'},
      render: (_args, value) => [{type: 'text', text: JSON.stringify(value, null, 2)}],
    },
    async execute(args) {
      if (args.action === 'configure') {
        return operation({action: 'save', transport: args.transport, git: args.git, address: args.address, dir: args.dir,
          url: args.url ?? '', username: args.username ?? '', password: args.password,
          retention: args.retention ?? 10, autoApply: args.autoApply ?? false});
      }
      if (args.action === 'apply') return operation({action: 'apply', id: args.id, selected: args.selected});
      if (args.action === 'resolve') return operation({action: 'resolve', id: args.id, name: args.name, choice: args.choice});
      return operation({action: args.action, direction: args.direction});
    },
  }));
  ctx.effect(() => ctx.webServer.register({kind: 'exact', path: '/kamisangk-dsh-sync/api', async handler(req, res) {
    const answer = (status, payload) => {
      res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
      res.end(JSON.stringify(payload));
    };
    const admission = ctx.connection.admit(req);
    if (!('peer' in admission)) return answer(admission.rejection, {ok: false, error: 'Request not authorized.'});
    if (admission.peer !== ctx.connection.browserPeer || req.headers['x-dsh-sync'] !== '1') return answer(403, {ok: false, error: 'An authenticated DSH browser is required.'});
    if (req.method !== 'POST') return answer(405, {ok: false, error: 'POST required.'});
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return answer(415, {ok: false, error: 'JSON required.'});
    try { return answer(200, {ok: true, value: await operation(await readInput(req))}); }
    catch (error) {
      const safe = error instanceof RequestError || error instanceof DavError || error instanceof GitError;
      return answer(safe ? 400 : 500, {ok: false, error: safe ? error.message : 'Plugin sync failed.'});
    }
  }}));
}
