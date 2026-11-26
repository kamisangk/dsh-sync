import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, inventory, makePlan } from '../lib/planner.js';

const bundle = (name, more = {}) => ({name, version:'1.0.0', source:`${name}@^1.0.0`, enabled:true, installed:true, availability:'profile', update:'registry', ...more});
const entry = (name, version, enabled = true) => ({name, version, spec:`${name}@${version}`, enabled});

test('exports only portable plugins at their installed versions', () => {
  const local = inventory([bundle('market'), bundle('development', {source:'link:D:/private/source'}), bundle('unpinned', {source:'github:owner/repo'}), bundle('built-in', {availability:'installation'}), bundle('@kamisangk/dsh-sync')]);
  assert.deepEqual(local.entries, [entry('market','1.0.0')]);
  const items = makePlan(local, [entry('development','1.0.0'), entry('absent','2.0.0'), entry('@deepseek-ai/built-in','1.0.0')]);
  assert.deepEqual(items.map(({name,kind,selected}) => [name,kind,selected]), [['absent','install',true],['development','manual',false],['market','local-only',false],['unpinned','manual',false]]);
  assert.equal(items.find(item => item.name === 'development').reason, 'local-source');
  assert.equal(items.find(item => item.name === 'unpinned').reason, 'unpinned');
  assert.ok(!JSON.stringify(items).includes('private'));
});

test('upgrade and bundle changes require selecting; newer local and changed sources are not applied', () => {
  const local = inventory(['upgrade','toggle','newer','cross'].map(name => bundle(name)));
  const items = makePlan(local, [entry('upgrade','1.0.1'), entry('toggle','1.0.0',false), entry('newer','0.9.0'), {...entry('cross','1.0.0'), spec:`github:owner/repo#${'a'.repeat(40)}`}]);
  assert.deepEqual(items.map(({kind,selectable,selected}) => [kind,selectable,selected]), [['source-mismatch',false,false],['local-newer',false,false],['disable',true,false],['upgrade',true,false]]);
  assert.ok(compareVersions('2.0.0-rc.2','2.0.0-rc.10') < 0);
  assert.ok(compareVersions('2.0.0-rc.10','2.0.0') < 0);
});
