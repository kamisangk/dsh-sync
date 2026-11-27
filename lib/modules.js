import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, assertCategory } from './backup.js';

export const MODULE_CATEGORIES = ['settings', 'models', 'mcp', 'skills'];
const SKILL_EXTS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.toml', '.css', '.html']);

function sha256Text(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Writes a file via temp sibling + rename so concurrent DSH boots never read a truncated file. */
export async function writeFileAtomic(filePath, content) {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.dsh-sync-tmp-${randomUUID()}`);
  await writeFile(tmp, content);
  await rename(tmp, filePath);
}

/** Resolves DSH_HOME and the user skills directory from explicit paths or profileDir. */
export function resolveModulePaths({ profileDir, dshHome, skillsDir } = {}) {
  const prof = resolve(profileDir ?? process.env.DSH_PROFILE_DIR ?? process.env.DSH_PROFILE ?? process.cwd());
  let home = dshHome ?? process.env.DSH_HOME;
  if (!home) {
    // Typical DSH layout: <DSH_HOME>/profiles/<name>
    const parent = dirname(prof);
    home = parent.endsWith(`${sep}profiles`) ? dirname(parent) : prof;
  }
  const resolvedHome = resolve(home);
  const resolvedSkills = resolve(skillsDir ?? join(resolvedHome, 'skills'));
  return { profileDir: prof, dshHome: resolvedHome, skillsDir: resolvedSkills };
}

/**
 * Classifies a top-level Cordis patch YAML block into `mcp`, `models`, or `settings`.
 * Returns `null` for dsh-sync's own registration entry so syncing never mutates itself.
 */
export function classifyCordisBlock(raw) {
  const text = String(raw);
  if (/kamisangk-dsh-sync|@kamisangk\/dsh-sync/i.test(text)) return null;
  if (/dsh-mcp-client|mcp-client|\bserverName\s*:/i.test(text)) return 'mcp';
  if (/dsh-model-|pi-ai|\bproviders\s*:|model-router|modelProvider/i.test(text)) return 'models';
  return 'settings';
}

function extractBlockId(raw, category) {
  const serverMatch = raw.match(/^\s+serverName\s*:\s*['"]?([A-Za-z0-9_.-]+)['"]?/m);
  if (category === 'mcp' && serverMatch) return `mcp:${serverMatch[1]}`;
  const idMatch = raw.match(/^\s*(?:-\s*)?id\s*:\s*['"]?([A-Za-z0-9_./:@-]+)['"]?/m);
  if (idMatch) return `${category}:${idMatch[1]}`;
  const targetMatch = raw.match(/^\s+target\s*:\s*['"]?([A-Za-z0-9_./:@-]+)['"]?/m);
  if (targetMatch) return `${category}:${targetMatch[1]}`;
  const nameMatch = raw.match(/^\s*(?:-\s*)?name\s*:\s*['"]?([A-Za-z0-9_./:@-]+)['"]?/m);
  if (nameMatch) return `${category}:${nameMatch[1]}`;
  return `${category}:block-${sha256Text(raw.trim()).slice(0, 10)}`;
}

function extractBlockLabel(raw, fallbackId) {
  const serverMatch = raw.match(/^\s+serverName\s*:\s*['"]?([A-Za-z0-9_.-]+)['"]?/m);
  if (serverMatch) return serverMatch[1];
  const idMatch = raw.match(/^\s*(?:-\s*)?id\s*:\s*['"]?([A-Za-z0-9_./:@-]+)['"]?/m);
  if (idMatch) return idMatch[1];
  const nameMatch = raw.match(/^\s*(?:-\s*)?name\s*:\s*['"]?([A-Za-z0-9_./:@-]+)['"]?/m);
  if (nameMatch) return nameMatch[1];
  return fallbackId;
}

/**
 * Splits a top-level YAML array (`cordis.patch.yml`) into preamble comments and top-level `- ...` blocks.
 * Preserves exact formatting of untouched blocks without requiring a third-party YAML library.
 */
export function splitCordisPatch(text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  const trimmed = normalized.trim();
  if (!trimmed || trimmed === '[]') return { preamble: '', blocks: [] };
  const lines = normalized.split('\n');
  const preambleLines = [];
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (/^-\s/.test(line) || line === '-') {
      if (current) blocks.push(current.join('\n').trimEnd());
      current = [line];
    } else if (current) {
      current.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (current) blocks.push(current.join('\n').trimEnd());
  return {
    preamble: preambleLines.join('\n').trimEnd(),
    blocks: blocks.filter(b => b.trim().length > 0),
  };
}

export function joinCordisPatch(preamble, blocks) {
  const cleaned = blocks.map(b => b.trimEnd()).filter(Boolean);
  if (cleaned.length === 0) return preamble ? `${preamble}\n[]\n` : '[]\n';
  const body = cleaned.join('\n');
  return preamble ? `${preamble}\n${body}\n` : `${body}\n`;
}

async function readOptionalText(filePath) {
  try {
    const buf = await readFile(filePath);
    if (buf.length > MAX_FILE_BYTES) throw new Error(`${filePath} exceeds size limit`);
    return buf.toString('utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function collectSkillDir(dir, baseDir, out, state) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await collectSkillDir(full, baseDir, out, state);
    } else if (entry.isFile()) {
      const extIdx = entry.name.lastIndexOf('.');
      const ext = extIdx >= 0 ? entry.name.slice(extIdx).toLowerCase() : '';
      if (ext && !SKILL_EXTS.has(ext)) continue;
      const buf = await readFile(full);
      if (buf.length > MAX_FILE_BYTES) continue;
      state.bytes += buf.length;
      if (state.bytes > MAX_TOTAL_BYTES) throw new Error('Skills configuration exceeds backup size limit');
      const rel = relative(baseDir, full).split(sep).join('/');
      out[rel] = buf.toString('utf8');
    }
  }
}

/** Collects portable items and raw snapshot files for `settings`, `models`, `mcp`, or `skills`. */
export async function collectModuleData(category, rawPaths = {}) {
  const cat = assertCategory(category);
  if (!MODULE_CATEGORIES.includes(cat)) throw new TypeError(`Unsupported module category: ${cat}`);
  const { profileDir, skillsDir } = resolveModulePaths(rawPaths);

  if (cat === 'skills') {
    const items = [];
    let dirs = [];
    try { dirs = await readdir(skillsDir, { withFileTypes: true }); } catch { dirs = []; }
    const state = { bytes: 0 };
    for (const dirent of dirs) {
      if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
      if (!/^[A-Za-z0-9._-]+$/.test(dirent.name)) continue;
      const skillPath = join(skillsDir, dirent.name);
      const files = {};
      await collectSkillDir(skillPath, skillPath, files, state);
      const fileKeys = Object.keys(files).sort();
      if (fileKeys.length === 0) continue;
      const orderedFiles = Object.fromEntries(fileKeys.map(k => [k, files[k]]));
      items.push({
        id: dirent.name,
        label: dirent.name,
        source: 'skills-dir',
        files: orderedFiles,
        sha256: sha256Text(stableJson(orderedFiles)),
      });
    }
    items.sort((a, b) => a.id.localeCompare(b.id));
    const snapshotFiles = {
      'skills.json': Buffer.from(`${JSON.stringify({ version: 1, category: 'skills', items }, null, 2)}\n`),
    };
    return { category: cat, items, files: snapshotFiles };
  }

  // settings / models / mcp read from cordis.patch.yml (+ .mcp.json for mcp)
  const patchPath = join(profileDir, 'cordis.patch.yml');
  const patchText = await readOptionalText(patchPath);
  const items = [];
  const seen = new Set();
  const snapshotFiles = {};
  if (patchText !== null) {
    snapshotFiles['cordis.patch.yml'] = Buffer.from(patchText, 'utf8');
    const { blocks } = splitCordisPatch(patchText);
    for (const raw of blocks) {
      if (classifyCordisBlock(raw) !== cat) continue;
      let id = extractBlockId(raw, cat);
      if (seen.has(id)) id = `${id}-${sha256Text(raw).slice(0, 6)}`;
      seen.add(id);
      items.push({
        id,
        label: extractBlockLabel(raw, id),
        source: 'cordis.patch.yml',
        content: raw.trimEnd(),
        sha256: sha256Text(raw.trimEnd()),
      });
    }
  }

  if (cat === 'mcp') {
    const mcpJsonPath = join(profileDir, '.mcp.json');
    const mcpText = await readOptionalText(mcpJsonPath);
    if (mcpText !== null) {
      snapshotFiles['.mcp.json'] = Buffer.from(mcpText, 'utf8');
      try {
        const parsed = JSON.parse(mcpText);
        const servers = parsed?.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : {};
        for (const [name, config] of Object.entries(servers)) {
          const id = `mcp-json:${name}`;
          const serialized = JSON.stringify(config, null, 2);
          items.push({
            id,
            label: `${name} (.mcp.json)`,
            source: '.mcp.json',
            serverName: name,
            config,
            sha256: sha256Text(stableJson(config)),
          });
        }
      } catch { /* ignore malformed .mcp.json during scan */ }
    }
  }

  items.sort((a, b) => a.id.localeCompare(b.id));
  snapshotFiles[`${cat}.json`] = Buffer.from(`${JSON.stringify({ version: 1, category: cat, items }, null, 2)}\n`);
  return { category: cat, items, files: snapshotFiles };
}

/** Validates a module manifest document stored on WebDAV or Git. */
export function parseModuleDocument(value, category) {
  const cat = assertCategory(category);
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
    throw new TypeError(`Unsupported ${cat} manifest format`);
  }
  if (!Array.isArray(value.items)) throw new TypeError(`Invalid ${cat} manifest items`);
  const seen = new Set();
  const items = [];
  for (const raw of value.items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`Invalid ${cat} item`);
    if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 256 || seen.has(raw.id)) {
      throw new TypeError(`Invalid or duplicate ${cat} item id`);
    }
    if (typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256)) {
      throw new TypeError(`Invalid ${cat} item digest`);
    }
    seen.add(raw.id);
    items.push(structuredClone(raw));
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return { version: 1, category: cat, items };
}

/**
 * 3-way union reconciliation for settings, models, mcp, and skills.
 * Local additions and local-only updates publish to remote; remote additions and remote-only updates
 * are offered locally; divergent edits are surfaced as conflicts. Nothing is ever silently deleted.
 */
export function reconcileModule(localItems, remoteItems, baselineItems = []) {
  const localMap = new Map(localItems.map(item => [item.id, item]));
  const remoteMap = new Map(remoteItems.map(item => [item.id, item]));
  const baseMap = new Map((baselineItems ?? []).map(item => [item.id, item]));
  const allIds = [...new Set([...localMap.keys(), ...remoteMap.keys()])].sort();

  const items = [];
  const nextRemote = new Map(remoteMap);
  const nextBaseline = new Map();

  for (const id of allIds) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);
    const base = baseMap.get(id);

    if (local && !remote) {
      nextRemote.set(id, local);
      items.push({ id, name: local.label ?? id, kind: 'local-only', selectable: false, local, remote: null, baseline: base ?? null });
      continue;
    }
    if (!local && remote) {
      items.push({ id, name: remote.label ?? id, kind: 'install', selectable: true, local: null, remote, baseline: base ?? null });
      continue;
    }
    if (local.sha256 === remote.sha256) {
      nextBaseline.set(id, local);
      continue;
    }
    if (base && base.sha256 === remote.sha256 && base.sha256 !== local.sha256) {
      nextRemote.set(id, local);
      items.push({ id, name: local.label ?? id, kind: 'local-update', selectable: false, local, remote, baseline: base });
      continue;
    }
    if (base && base.sha256 === local.sha256 && base.sha256 !== remote.sha256) {
      nextBaseline.set(id, base);
      items.push({ id, name: remote.label ?? id, kind: 'upgrade', selectable: true, local, remote, baseline: base });
      continue;
    }
    if (base) nextBaseline.set(id, base);
    items.push({
      id,
      name: local.label ?? remote.label ?? id,
      kind: 'conflict',
      reason: base ? 'divergent' : 'no-baseline',
      selectable: false,
      canPublishLocal: true,
      canApplyRemote: true,
      remoteKind: 'upgrade',
      local,
      remote,
      baseline: base ?? null,
    });
  }

  return {
    items,
    nextItems: [...nextRemote.values()].sort((a, b) => a.id.localeCompare(b.id)),
    baseline: [...nextBaseline.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Applies selected remote items into local DSH config files (atomic writes, preserves unrelated data). */
export async function applyModuleItems(category, selectedItems, rawPaths = {}) {
  const cat = assertCategory(category);
  const { profileDir, skillsDir } = resolveModulePaths(rawPaths);
  const outcomes = [];
  if (!selectedItems.length) return outcomes;

  if (cat === 'skills') {
    await mkdir(skillsDir, { recursive: true });
    for (const item of selectedItems) {
      const target = item.remote ?? item;
      if (!/^[A-Za-z0-9._-]+$/.test(target.id) || !target.files || typeof target.files !== 'object') {
        outcomes.push({ name: target.id, kind: item.kind ?? 'install', status: 'failed', detail: 'Invalid skill payload' });
        continue;
      }
      try {
        const skillRoot = join(skillsDir, target.id);
        await mkdir(skillRoot, { recursive: true });
        for (const [relPath, text] of Object.entries(target.files)) {
          if (relPath.includes('..') || relPath.startsWith('/') || relPath.includes('\\')) {
            throw new Error(`Invalid skill file path: ${relPath}`);
          }
          const dest = resolve(skillRoot, relPath);
          if (!dest.startsWith(resolve(skillRoot) + sep)) throw new Error(`Path escape: ${relPath}`);
          await writeFileAtomic(dest, Buffer.from(String(text), 'utf8'));
        }
        outcomes.push({ name: target.label ?? target.id, kind: item.kind ?? 'install', status: 'applied' });
      } catch (error) {
        outcomes.push({ name: target.label ?? target.id, kind: item.kind ?? 'install', status: 'failed', detail: error instanceof Error ? error.message : 'Write failed' });
      }
    }
    return outcomes;
  }

  // settings / models / mcp
  const cordisItems = [];
  const mcpJsonItems = [];
  for (const item of selectedItems) {
    const target = item.remote ?? item;
    if (cat === 'mcp' && target.source === '.mcp.json') mcpJsonItems.push({ item, target });
    else cordisItems.push({ item, target });
  }

  if (cordisItems.length > 0) {
    const patchPath = join(profileDir, 'cordis.patch.yml');
    const existingText = await readOptionalText(patchPath);
    const { preamble, blocks } = splitCordisPatch(existingText ?? '');
    const nextBlocks = [...blocks];
    const indexByKey = new Map();
    for (let i = 0; i < nextBlocks.length; i++) {
      const blockCat = classifyCordisBlock(nextBlocks[i]);
      if (blockCat !== cat) continue;
      const key = extractBlockId(nextBlocks[i], cat);
      if (!indexByKey.has(key)) indexByKey.set(key, i);
    }
    for (const { item, target } of cordisItems) {
      if (typeof target.content !== 'string' || !target.content.trim()) {
        outcomes.push({ name: target.label ?? target.id, kind: item.kind ?? 'install', status: 'failed', detail: 'Empty block' });
        continue;
      }
      const existingIdx = indexByKey.get(target.id);
      if (existingIdx !== undefined) {
        nextBlocks[existingIdx] = target.content.trimEnd();
      } else {
        indexByKey.set(target.id, nextBlocks.length);
        nextBlocks.push(target.content.trimEnd());
      }
      outcomes.push({ name: target.label ?? target.id, kind: item.kind ?? 'install', status: 'applied' });
    }
    await writeFileAtomic(patchPath, joinCordisPatch(preamble, nextBlocks));
  }

  if (mcpJsonItems.length > 0) {
    const mcpJsonPath = join(profileDir, '.mcp.json');
    const existingText = await readOptionalText(mcpJsonPath);
    let doc = { mcpServers: {} };
    if (existingText) {
      try {
        const parsed = JSON.parse(existingText);
        if (parsed && typeof parsed === 'object') doc = { ...parsed, mcpServers: { ...(parsed.mcpServers ?? {}) } };
      } catch { doc = { mcpServers: {} }; }
    }
    for (const { item, target } of mcpJsonItems) {
      if (!target.serverName || !target.config || typeof target.config !== 'object') {
        outcomes.push({ name: target.label ?? target.id, kind: item.kind ?? 'install', status: 'failed', detail: 'Invalid MCP config' });
        continue;
      }
      doc.mcpServers[target.serverName] = target.config;
      outcomes.push({ name: target.label ?? target.id, kind: item.kind ?? 'install', status: 'applied' });
    }
    await writeFileAtomic(mcpJsonPath, `${JSON.stringify(doc, null, 2)}\n`);
  }

  return outcomes;
}

/** Parses portable module items from a snapshot's `<category>.json` file. */
export function parseModuleSnapshotItems(category, files) {
  const cat = assertCategory(category);
  const buf = files?.[`${cat}.json`];
  if (!buf) throw new Error(`Backup has no usable ${cat}.json`);
  let parsed;
  try { parsed = JSON.parse(buf.toString('utf8')); }
  catch { throw new Error(`${cat}.json is not valid JSON`); }
  return parseModuleDocument(parsed, cat).items;
}
