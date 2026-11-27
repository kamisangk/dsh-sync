import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { syncService } from '../index.js';
import { createGit } from '../lib/git.js';
import {
  applyModuleItems, classifyCordisBlock, collectModuleData, joinCordisPatch,
  reconcileModule, splitCordisPatch,
} from '../lib/modules.js';

const execFileAsync = promisify(execFile);

test('splitCordisPatch and classifyCordisBlock separate settings, models, mcp and ignore dsh-sync', () => {
  const yaml = [
    '# User overlay',
    '- insert:',
    '    - id: kamisangk-dsh-sync',
    '      name: "@kamisangk/dsh-sync"',
    '- override:',
    '    id: pi-ai',
    '    config:',
    '      providers:',
    '        deepseek: {}',
    '- insert:',
    '    - id: mem-mcp',
    '      name: "@deepseek-ai/dsh-mcp-client"',
    '      config:',
    '        serverName: memory',
    '        transport: stdio',
    '- override:',
    '    id: ui-locale',
    '    config:',
    '      language: zh',
  ].join('\n');

  const { preamble, blocks } = splitCordisPatch(yaml);
  assert.equal(preamble, '# User overlay');
  assert.equal(blocks.length, 4);
  assert.equal(classifyCordisBlock(blocks[0]), null);
  assert.equal(classifyCordisBlock(blocks[1]), 'models');
  assert.equal(classifyCordisBlock(blocks[2]), 'mcp');
  assert.equal(classifyCordisBlock(blocks[3]), 'settings');
  assert.equal(joinCordisPatch(preamble, blocks).trim(), yaml.trim());
});

test('collectModuleData and applyModuleItems round-trip settings, models, mcp and skills without clobbering siblings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sync-mod-'));
  const profileDir = join(root, 'profiles', 'web');
  const skillsDir = join(root, 'skills');
  await mkdir(profileDir, { recursive: true });
  await mkdir(join(skillsDir, 'my-skill'), { recursive: true });

  await writeFile(join(profileDir, 'cordis.patch.yml'), [
    '- override:',
    '    id: ui-locale',
    '    config:',
    '      language: zh',
    '- override:',
    '    id: pi-ai',
    '    config:',
    '      providers:',
    '        qcode: {}',
    '- insert:',
    '    - id: mem-mcp',
    '      name: "@deepseek-ai/dsh-mcp-client"',
    '      config:',
    '        serverName: memory',
  ].join('\n') + '\n');
  await writeFile(join(profileDir, '.mcp.json'), JSON.stringify({ mcpServers: { fs: { command: 'npx', args: ['-y', 'mcp-fs'] } } }, null, 2));
  await writeFile(join(skillsDir, 'my-skill', 'SKILL.md'), '# My Skill\nHello\n');

  const paths = { profileDir, dshHome: root, skillsDir };
  const settingsData = await collectModuleData('settings', paths);
  const modelsData = await collectModuleData('models', paths);
  const mcpData = await collectModuleData('mcp', paths);
  const skillsData = await collectModuleData('skills', paths);

  assert.deepEqual(settingsData.items.map(i => i.id), ['settings:ui-locale']);
  assert.deepEqual(modelsData.items.map(i => i.id), ['models:pi-ai']);
  assert.deepEqual(mcpData.items.map(i => i.id).sort(), ['mcp-json:fs', 'mcp:memory']);
  assert.deepEqual(skillsData.items.map(i => i.id), ['my-skill']);

  // Apply a new setting block and verify models & mcp blocks survive intact
  const outcomes = await applyModuleItems('settings', [{
    kind: 'install',
    remote: {
      id: 'settings:theme',
      label: 'theme',
      source: 'cordis.patch.yml',
      content: '- override:\n    id: theme\n    config:\n      mode: dark',
    },
  }], paths);
  assert.equal(outcomes[0].status, 'applied');
  const afterModels = await collectModuleData('models', paths);
  const afterSettings = await collectModuleData('settings', paths);
  assert.deepEqual(afterModels.items.map(i => i.id), ['models:pi-ai']);
  assert.deepEqual(afterSettings.items.map(i => i.id).sort(), ['settings:theme', 'settings:ui-locale']);

  // Apply a skill with path traversal attempt -> safely rejected
  const badSkill = await applyModuleItems('skills', [{
    kind: 'install',
    remote: { id: 'evil-skill', label: 'evil-skill', files: { '../escape.txt': 'nope' } },
  }], paths);
  assert.equal(badSkill[0].status, 'failed');

  await rm(root, { recursive: true, force: true });
});

test('reconcileModule performs 3-way union and detects divergent conflicts', () => {
  const item = (id, sha) => ({ id, label: id, sha256: sha.repeat(64) });
  const res = reconcileModule(
    [item('local-new', '1'), item('same', '2'), item('both-diff', '3'), item('local-edit', '5')],
    [item('remote-new', '9'), item('same', '2'), item('both-diff', '4'), item('local-edit', '6')],
    [item('same', '2'), item('both-diff', '0'), item('local-edit', '6')],
  );
  const byId = Object.fromEntries(res.items.map(i => [i.id, i.kind]));
  assert.deepEqual(byId, {
    'local-new': 'local-only',
    'remote-new': 'install',
    'both-diff': 'conflict',
    'local-edit': 'local-update',
  });
  assert.deepEqual(res.nextItems.map(i => i.id).sort(), ['both-diff', 'local-edit', 'local-new', 'remote-new', 'same']);
  assert.equal(res.nextItems.find(i => i.id === 'local-edit').sha256, '5'.repeat(64));
});

test('end-to-end Git multi-module sync, backup_create, backup_delete and restore for settings, models, mcp and skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sync-e2e-mod-'));
  const bare = join(root, 'remote.git');
  const profileA = join(root, 'a', 'profiles', 'web');
  const skillsA = join(root, 'a', 'skills');
  const profileB = join(root, 'b', 'profiles', 'web');
  const skillsB = join(root, 'b', 'skills');
  await mkdir(profileA, { recursive: true });
  await mkdir(join(skillsA, 'skill-alpha'), { recursive: true });
  await mkdir(profileB, { recursive: true });
  await mkdir(join(skillsB, 'skill-beta'), { recursive: true });
  await execFileAsync('git', ['init', '--bare', '-b', 'main', bare]);

  await writeFile(join(profileA, 'cordis.patch.yml'), '- override:\n    id: ui-locale\n    config:\n      language: zh\n');
  await writeFile(join(skillsA, 'skill-alpha', 'SKILL.md'), '# Alpha\n');
  await writeFile(join(skillsB, 'skill-beta', 'SKILL.md'), '# Beta\n');

  const makeHost = (profileDir, skillsDir) => {
    const records = new Map();
    const manager = { listBundles: async () => [], listPlugins: async () => [] };
    return syncService(
      manager,
      {
        readRecord: async k => structuredClone(records.get(k)),
        modifyRecord: async (k, fn) => { records.set(k, structuredClone(fn(records.get(k)))); },
      },
      undefined,
      () => createGit({ repo: bare, branch: 'main', auth: 'ssh', allowLocalRepo: true, authorName: 'Test', authorEmail: 'test@local' }),
      { profileDir, dshHome: join(profileDir, '../..'), skillsDir },
    );
  };

  const hostA = makeHost(profileA, skillsA);
  const hostB = makeHost(profileB, skillsB);
  const gitCfg = { action: 'save', transport: 'git', retention: 5, autoApply: true, git: { repo: 'git@github.com:org/repo.git', branch: 'main', auth: 'ssh' } };
  await hostA(gitCfg);
  await hostB(gitCfg);
  // Re-save with autoApply: true on same connection
  await hostA(gitCfg);
  await hostB(gitCfg);

  // Machine A syncs skills & settings
  const syncA1 = await hostA({ action: 'sync', category: 'skills' });
  assert.equal(syncA1.added, 1);
  assert.equal(syncA1.overview.lastBackup.uploaded, true);

  const syncSettingsA = await hostA({ action: 'sync', category: 'settings' });
  assert.equal(syncSettingsA.added, 1);

  // Machine B syncs skills (two-way union!) -> B publishes skill-beta AND auto-installs skill-alpha
  const syncB = await hostB({ action: 'sync', category: 'skills' });
  assert.equal(syncB.added, 1);
  assert.equal(syncB.outcomes.length, 1);
  assert.equal(await readFile(join(skillsB, 'skill-alpha', 'SKILL.md'), 'utf8'), '# Alpha\n');

  // Machine A syncs skills again -> receives skill-beta!
  const syncA2 = await hostA({ action: 'sync', category: 'skills' });
  assert.equal(syncA2.outcomes.length, 1);
  assert.equal(await readFile(join(skillsA, 'skill-beta', 'SKILL.md'), 'utf8'), '# Beta\n');

  // Backup management on skills: create, list, restore, delete
  const created = await hostA({ action: 'backup_create', category: 'skills' });
  assert.equal(created.uploaded, true);
  const listed = await hostA({ action: 'backups', category: 'skills' });
  assert.ok(listed.items.length >= 2);
  assert.ok(listed.items[0].name.startsWith('dsh-skills.'));

  const restored = await hostA({ action: 'restore', category: 'skills', id: created.id });
  assert.equal(restored.category, 'skills');
  assert.ok(restored.safety);

  const del = await hostA({ action: 'backup_delete', category: 'skills', ids: [created.id] });
  assert.deepEqual(del.removed, [created.id]);

  await rm(root, { recursive: true, force: true });
});
