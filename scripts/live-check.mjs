// Live WebDAV check. Credentials come from the environment; nothing is written to the repository.
//   DSH_DAV_URL  https://host/dav/root/WebDAV/Tool/temp/
//   DSH_DAV_USER, DSH_DAV_PASS
import { createDav, parseEntry } from '../lib/core.js';

const url = process.env.DSH_DAV_URL;
const username = process.env.DSH_DAV_USER ?? '';
const password = process.env.DSH_DAV_PASS ?? '';
if (!url) throw new Error('DSH_DAV_URL is required');

const auth = username || password ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : undefined;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};
const call = async (target, method, extra = {}, body) => {
  const response = await fetch(target, {
    method, body, redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { ...(auth ? { authorization: auth } : {}), 'cache-control': 'no-cache', ...extra },
  });
  return response;
};

const base = new URL(url);
base.pathname = base.pathname.replace(/\/?$/, '/');
const segments = base.pathname.split('/').filter(Boolean);
for (let i = 1; i <= segments.length; i++) {
  const target = new URL(base.href);
  target.pathname = `/${segments.slice(0, i).join('/')}/`;
  const head = await call(target.href, 'PROPFIND', { depth: '0' });
  await head.body?.cancel().catch(() => {});
  if (head.status < 400) continue;
  const made = await call(target.href, 'MKCOL');
  await made.body?.cancel().catch(() => {});
  if (![201, 405].includes(made.status)) throw new Error(`MKCOL ${target.pathname} failed (HTTP ${made.status})`);
}
check('collection reachable', true, base.pathname);

const entry = (name, version = '1.0.0', enabled = true) => parseEntry({ name, version, spec: `${name}@${version}`, enabled });
const names = entries => entries.map(item => item.name).join(',');
const dav = createDav({ url: base.href, username, password });
const mode = await dav.mode().catch(error => error);
check('writes are serialized (ETag or lock)', mode === 'etag' || mode === 'lock', mode instanceof Error ? mode.message : `mode=${mode}`);

const initial = await dav.publish([entry('live-alpha')], 3);
check('first publish adds the entry', initial.added === 1 && names(initial.entries) === 'live-alpha', `added=${initial.added}`);

const second = await dav.publish([entry('live-alpha'), entry('live-beta', '2.0.0', false)], 3);
const union = await dav.read();
check('publish unions without replacing', names(union.entries) === 'live-alpha,live-beta', names(union.entries));
check('history keeps the previous list', union.historyCount === 1, `historyCount=${union.historyCount}, added=${second.added}`);
check('disabled state round-trips', union.entries.find(item => item.name === 'live-beta')?.enabled === false);

const other = createDav({ url: base.href, username, password });
const concurrent = await Promise.allSettled([
  dav.publish([entry('live-gamma')], 5),
  other.publish([entry('live-delta')], 5),
]);
const mergedNames = names((await dav.read()).entries);
check('concurrent publishes both land', mergedNames === 'live-alpha,live-beta,live-delta,live-gamma',
  `${mergedNames}; ${concurrent.map(result => result.status).join('/')}`);

const trimmed = await dav.publish([], 1);
const final = await dav.read();
check('retention trims to the configured count', final.historyCount <= 1, `historyCount=${final.historyCount}, trimmed=${trimmed.historyCount}`);
check('unchanged publish adds no history', (await dav.publish([], 1)).historyCount === final.historyCount);

// Clean up this run, and release any leftover lock from earlier probes.
const deleteQuietly = async target => {
  const removed = await call(target, 'DELETE');
  await removed.body?.cancel().catch(() => {});
  return removed.status;
};
check('cleanup removed the manifest', [204, 404].includes(await deleteQuietly(new URL('dsh-sync.json', base.href).href)));
const listing = await call(base.href, 'PROPFIND', { depth: '1' });
const listed = [...(await listing.text()).matchAll(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/gi)].map(match => match[1]);
const leftovers = listed.filter(href => /dsh-sync|probe-|lock2?-/i.test(decodeURIComponent(href)));
for (const href of leftovers) {
  const target = new URL(href, base.origin).href;
  if (decodeURIComponent(target).endsWith('/temp/')) continue;
  let status = await deleteQuietly(target);
  if (status === 423) {
    // A zombie lock from an earlier probe: take the lock, then remove the file.
    const taken = await call(target, 'LOCK', { 'content-type': 'application/xml', depth: '0' }, '<?xml version="1.0"?><d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype><d:owner><d:href>dsh-sync</d:href></d:owner></d:lockinfo>');
    const header = taken.headers.get('lock-token');
    await taken.body?.cancel().catch(() => {});
    if (header) {
      const released = await call(target, 'UNLOCK', { 'lock-token': header });
      await released.body?.cancel().catch(() => {});
      status = await deleteQuietly(target);
    }
  }
  console.log(`cleanup ${decodeURIComponent(new URL(target).pathname)} -> HTTP ${status}`);
}
const after = await call(base.href, 'PROPFIND', { depth: '1' });
const remaining = [...(await after.text()).matchAll(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/gi)]
  .map(match => match[1]).filter(href => /dsh-sync|probe-|lock2?-/i.test(decodeURIComponent(href)));
check('no sync files remain', remaining.length === 0, remaining.join(', ') || 'clean');

const failed = results.filter(item => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);