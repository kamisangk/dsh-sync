// Render smoke check for client.js: catches undeclared identifiers and render-time
// TypeErrors that leave the Settings slot blank. It renders the page body with states the
// browser would reach (unconfigured, both connection forms, configured sync page), but does
// not verify visuals, layout, CSS, or interactions, and it never contacts the network.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const source = resolve(process.argv[2] ?? resolve(fileURLToPath(new URL('.', import.meta.url)), '../client.js'));

let registered;
globalThis.window = { __ModuleLoader__: { load: ({ id, factory }) => { registered = { id, factory }; } } };
new Function('window', readFileSync(source, 'utf8'))(globalThis.window);
if (!registered) throw new Error('client.js did not call window.__ModuleLoader__.load');

const calls = [];
let statePlan = null;
let stateIndex = 0;
const stub = {
  createElement(type, props, ...children) {
    const tree = { type, props: {...(props ?? {}), children: children.flat(Infinity).filter(child => child !== undefined && child !== null && child !== false) } };
    calls.push(tree);
    return tree;
  },
  useState(value) {
    const index = stateIndex++;
    const planned = statePlan && Object.hasOwn(statePlan, index) ? statePlan[index] : undefined;
    return [planned !== undefined ? planned : (typeof value === 'function' ? value() : value), () => {}];
  },
  useRef: value => ({current: value}),
  useId: () => 'smoke',
  useEffect: () => {},
  useSyncExternalStore: () => {},
};

const translate = key => key;
const locale = { register: () => {}, bind: () => translate, subscribe: () => () => {}, getSnapshot: () => ({active: 'en'}) };
const module = registered.factory(name => {
  if (name === 'react') return stub;
  throw new Error(`unexpected require: ${name}`);
});

let Page;
module.apply({
  effect: callback => callback(),
  locale,
  slots: {inject: (_name, callback) => callback(), register: (_options, component) => { Page = component; }},
});

if (typeof Page !== 'function') throw new Error('apply did not register a settings page');
Page();
const page = calls.at(-1);
const component = calls.map(node => node.type).find(type => typeof type === 'function' && type !== Page);
if (component === undefined) throw new Error('the settings page rendered no component');

// Hooks are stubbed, so a render gets its state slots by index instead of through React.
function render(state) {
  calls.length = 0;
  statePlan = state;
  stateIndex = 0;
  try { component({locale, t: translate}); }
  finally { statePlan = null; }
}
const hasInput = value => calls.some(node => node.type === 'input' && node.props.value === value);
const hasPlaceholder = text => calls.some(node => node.type === 'input' && node.props.placeholder === text);
const flush = label => {
  const tags = calls.filter(node => typeof node.type === 'string').map(node => node.type);
  console.log(`${label}: ${calls.length} elements; tags: ${[...new Set(tags)].join(', ')}`);
};

// Unconfigured first run: the page must still draw its skeleton.
render({});
if (!calls.some(node => node.type === 'section')) throw new Error('the unconfigured sync page rendered no section');
flush('unconfigured sync page');

const settings = {
  transport: 'webdav',
  url: 'https://dav.example/dav/sync',
  address: 'https://dav.example/dav',
  dir: '/sync',
  username: 'user',
  passwordSet: true,
  retention: '10',
  autoApply: false,
  webdavAutoApply: false,
  direction: 'both',
  git: {repo: '', branch: 'main', auth: 'ssh', gitUsername: '', tokenSet: false,
    authorName: 'DSH Sync', authorEmail: 'dsh-sync@localhost', autoApply: false},
  overview: null,
};
const draft = {...settings, password: '', git: {...settings.git, token: ''}};

render({0: 'connection', 1: settings, 2: draft, 9: ''});
if (!hasInput(settings.address) || !hasInput(settings.dir)) throw new Error('the connection page did not bind the address and folder fields');
if (!hasPlaceholder('https://webdav.example.com/dav') || !hasPlaceholder('/dsh-sync')) {
  throw new Error('the address and folder inputs are missing');
}
flush('WebDAV connection page');

render({0: 'connection', 1: {...settings, transport: 'git'}, 2: {...draft, transport: 'git'}, 9: ''});
if (!hasPlaceholder('git@github.com:owner/repo.git')) throw new Error('the Git connection page did not render');
flush('Git connection page');

render({0: 'sync', 1: settings, 2: draft, 9: ''});
if (!calls.some(node => node.type === 'section')) throw new Error('the configured sync page rendered no card');
flush('configured sync page');

render({0: 'sync', 1: settings, 2: draft, 8: {snapshots: [
  {id: '20260101-000000', createdAt: '2026-01-01T00:00:00.000Z', files: [{path: 'plugins.json', bytes: 2, sha256: '00'}]},
], local: ['20260101-000001']}, 9: '', 12: null});
if (!calls.some(node => node.type === 'button' && node.props.children[0] === 'restore')) throw new Error('the backup card rendered no restore action');
if (!calls.some(node => node.type === 'span' && node.props.children[0] === 'backup_local_only')) throw new Error('a local-only backup was not marked as such');
flush('sync page with backups');

render({0: 'sync', 1: {...settings, webdavAutoApply: true}, 2: draft, 9: ''});
const action = calls.find(node => node.type === 'button' && node.props.className === 'kds-primary');
if (!action || action.props.children[0] !== 'sync') throw new Error('the sync button label changed when auto install was on');
flush('sync page with auto install on');

console.log(`module id: ${registered.id}`);
