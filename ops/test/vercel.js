// Mocked tests for the serverless parts: Discord signature check, REST posting, interactions, routes.
// Needs no keys and makes no network calls.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeDiscord, verifyInteraction, handleInteraction, COMMANDS } from '../lib/discord.js';

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

// ---------- 1. Ed25519 signature check ----------
{
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
  const body = JSON.stringify({ type: 1 });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.sign(null, Buffer.from(ts + body), privateKey).toString('hex');
  assert.equal(verifyInteraction(body, sig, ts, pubHex), true);
  assert.equal(verifyInteraction(body + ' ', sig, ts, pubHex), false, 'tampered body');
  assert.equal(verifyInteraction(body, sig, String(Number(ts) + 1), pubHex), false, 'tampered timestamp');
  assert.equal(verifyInteraction(body, 'zz', ts, pubHex), false, 'garbage signature');
  assert.equal(verifyInteraction(body, sig, ts, ''), false, 'no public key configured');
  ok('Discord signatures: valid accepted, tampered/garbage/unconfigured rejected');
}

// ---------- fake Discord REST ----------
function fakeDiscordApi() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = url.replace('https://discord.com/api/v10', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, method: init.method || 'GET', body, auth: init.headers?.Authorization });
    const json = (o) => new Response(JSON.stringify(o), { status: 200 });
    if (path === '/guilds/G/channels' && init.method === 'POST') return json({ id: 'new' + calls.length, ...body });
    if (path === '/guilds/G/roles' && init.method === 'POST') return json({ id: 'RNEW', ...body });
    if (path === '/guilds/G/channels') return json([{ id: 'c-appr', name: 'approvals', type: 0 }, { id: 'c-log', name: 'agent-logs', type: 0 }, { id: 'c-pay', name: 'payments', type: 0 }, { id: 'c-voice', name: 'support', type: 2 }]);
    if (path === '/guilds/G') return json({ id: 'G', owner_id: 'OWNER' });
    if (path === '/guilds/G/roles') return json([{ id: 'R1', name: 'Approver' }, { id: 'R2', name: 'Member' }]);
    if (path === '/applications/@me') return json({ id: 'APP' });
    if (path.endsWith('/messages') && init.method === 'POST') return json({ id: 'm' + calls.length });
    return json({});
  };
  return { calls, fetchImpl };
}
const cfg = { discordToken: 'TOKEN', guildId: 'G', approverRole: 'Approver', approverIds: ['LISTED'] };

// ---------- 2. Posting ----------
{
  const f = fakeDiscordApi();
  const d = makeDiscord(cfg, f.fetchImpl);
  const order = { id: 42, channel: 'Website Build', name: 'Asha', email: 'a@x.in', budget: '', timeline: 'This month', source: 'Instagram', message: 'Need a store @everyone' };
  const plan = { summary: 'Store site', priority: 'high', agent: 'website_build', quote: '$450-$700', questions: ['Products?'], tasks: [{ agent: 'website_build', title: 'Plan site' }] };
  const id = await d.postApproval({ order, plan });
  const post = f.calls.find((c) => c.method === 'POST');
  assert.ok(id);
  assert.equal(post.path, '/channels/c-appr/messages');
  assert.deepEqual(post.body.allowed_mentions, { parse: [] }, 'no pings from AI/client text');
  assert.equal(post.body.components[0].components[0].custom_id, 'decision:approved:42');
  assert.equal(post.body.components[0].components[1].custom_id, 'decision:rejected:42');
  assert.ok(post.body.embeds[0].fields.every((x) => x.value && x.value.length <= 1024), 'no empty or oversized embed fields');
  assert.equal(post.auth, 'Bot TOKEN');
  ok('postApproval: right channel, buttons, no pings, valid embed fields');

  await d.postTo('agent-logs', 'x'.repeat(4500));
  const logPosts = f.calls.filter((c) => c.path === '/channels/c-log/messages');
  assert.equal(logPosts.length, 3, 'long text split into 3 messages');
  ok('postTo splits long text under the 2000-char limit');

  await assert.rejects(() => d.postTo('support', 'hi'), /not found/, 'voice channel is not a text room');
  ok('missing text channel gives a clear error');

  const missing = await d.missingChannels(['approvals', 'hosting']);
  assert.deepEqual(missing, ['hosting']);
  ok('missingChannels reports what still needs creating');

  await d.registerCommands();
  const put = f.calls.find((c) => c.method === 'PUT');
  assert.equal(put.path, '/applications/APP/guilds/G/commands');
  assert.deepEqual(put.body.map((c) => c.name), ['reply', 'mark-paid']);
  ok('slash commands registered for this server only');
}

// ---------- 3. Approver rules ----------
{
  const f = fakeDiscordApi();
  const d = makeDiscord(cfg, f.fetchImpl);
  const who = (id, roles = [], guild_id = 'G') => ({ guild_id, member: { user: { id }, roles } });
  assert.equal(await d.isApprover(who('OWNER')), true, 'owner');
  assert.equal(await d.isApprover(who('LISTED')), true, 'listed id');
  assert.equal(await d.isApprover(who('U1', ['R1'])), true, 'Approver role');
  assert.equal(await d.isApprover(who('U2', ['R2'])), false, 'other role');
  assert.equal(await d.isApprover(who('OWNER', [], 'OTHER-GUILD')), false, 'other server');
  assert.equal(await d.isApprover({ user: { id: 'OWNER' } }), false, 'DM, no guild');
  ok('approvers: owner, listed ids, Approver role; others and other servers refused');
}

// ---------- 4. Interactions ----------
{
  const f = fakeDiscordApi();
  const discord = makeDiscord(cfg, f.fetchImpl);
  const pending = [];
  const waitUntil = (p) => pending.push(p);
  const seen = [];
  let decided = false;
  const handlers = {
    decision: async (x) => { seen.push(['decision', x]); if (decided) return { ok: false }; decided = true; return { ok: true, work: Promise.resolve().then(() => seen.push(['work-done'])) }; },
    pay: async (x) => { seen.push(['pay', x]); return { ok: true }; },
    reply: async (x) => { seen.push(['reply', x]); return { ok: true }; },
    markPaid: async (x) => { seen.push(['markPaid', x]); return { ok: true, status: x.status }; },
    listOrders: async () => [{ id: 7, name: 'Asha', email: 'a@x.in', channel: 'Website Build', status: 'review' }, { id: 8, name: 'Ravi', email: 'r@x.in', channel: 'AI Films', status: 'new' }],
  };
  const ctx = { discord, handlers, waitUntil, log: { error() {} } };
  const base = { application_id: 'APP', token: 'TOK', guild_id: 'G' };

  assert.deepEqual(await handleInteraction({ type: 1 }, ctx), { type: 1 });
  ok('PING answered');

  const denied = await handleInteraction({ ...base, type: 3, member: { user: { id: 'U2' }, roles: ['R2'] }, data: { custom_id: 'decision:approved:7' } }, ctx);
  assert.equal(denied.type, 4); assert.equal(denied.data.flags, 64);
  assert.equal(seen.length, 0, 'nothing ran for a non-approver');
  ok('non-approver pressing Approve is refused privately and nothing runs');

  const r = await handleInteraction({ ...base, type: 3, member: { user: { id: 'OWNER' }, roles: [] }, data: { custom_id: 'decision:approved:7' } }, ctx);
  assert.deepEqual(r, { type: 6 });
  await Promise.all(pending.splice(0));
  assert.deepEqual(seen[0], ['decision', { orderId: '7', decision: 'approved', userId: 'OWNER' }]);
  assert.ok(seen.some((s) => s[0] === 'work-done'), 'specialist work awaited inside waitUntil');
  const edit = f.calls.find((c) => c.method === 'PATCH');
  assert.equal(edit.path, '/webhooks/APP/TOK/messages/@original');
  assert.match(edit.body.content, /Approved by/); assert.deepEqual(edit.body.components, []);
  assert.equal(edit.auth, undefined, 'interaction webhooks need no bot token');
  ok('Approve: answers in time, runs decision + specialists in the background, removes the buttons');

  await handleInteraction({ ...base, type: 3, member: { user: { id: 'OWNER' }, roles: [] }, data: { custom_id: 'decision:approved:7' } }, ctx);
  await Promise.all(pending.splice(0));
  assert.match(f.calls.filter((c) => c.method === 'PATCH').at(-1).body.content, /Already handled/);
  ok('second click: "Already handled"');

  await handleInteraction({ ...base, type: 3, member: { user: { id: 'U1' }, roles: ['R1'] }, data: { custom_id: 'pay:paid:P1:7' } }, ctx);
  await Promise.all(pending.splice(0));
  assert.deepEqual(seen.find((s) => s[0] === 'pay')[1], { paymentId: 'P1', orderId: '7', action: 'paid', userId: 'U1' });
  ok('payment button routed to billing with the right ids');

  const ac = await handleInteraction({ ...base, type: 4, member: { user: { id: 'OWNER' }, roles: [] }, data: { name: 'reply', options: [{ name: 'order', value: 'ravi', focused: true }] } }, ctx);
  assert.equal(ac.type, 8); assert.equal(ac.data.choices.length, 1); assert.equal(ac.data.choices[0].value, '8');
  const acDenied = await handleInteraction({ ...base, type: 4, member: { user: { id: 'U2' }, roles: [] }, data: { name: 'reply', options: [] } }, ctx);
  assert.deepEqual(acDenied.data.choices, [], 'no order list for non-approvers');
  ok('order autocomplete filters, and shows nothing to non-approvers');

  const cmd = await handleInteraction({ ...base, type: 2, member: { user: { id: 'OWNER' }, roles: [] }, data: { name: 'mark-paid', options: [{ name: 'order', value: '7' }, { name: 'status', value: 'deposit_paid' }] } }, ctx);
  assert.deepEqual(cmd, { type: 5, data: { flags: 64 } });
  await Promise.all(pending.splice(0));
  assert.deepEqual(seen.find((s) => s[0] === 'markPaid')[1], { orderId: '7', status: 'deposit_paid', userId: 'OWNER' });
  assert.match(f.calls.filter((c) => c.method === 'PATCH').at(-1).body.content, /deposit_paid/);
  ok('/mark-paid deferred privately, then confirmed');

  await handleInteraction({ ...base, type: 2, member: { user: { id: 'OWNER' }, roles: [] }, data: { name: 'reply', options: [{ name: 'order', value: '7' }, { name: 'message', value: 'When is it ready?' }] } }, ctx);
  await Promise.all(pending.splice(0));
  assert.deepEqual(seen.find((s) => s[0] === 'reply')[1], { orderId: '7', clientMessage: 'When is it ready?', userId: 'OWNER' });
  ok('/reply passes the pasted client message to Support');

  assert.equal(COMMANDS.length, 2);
}


// ---------- 2b. Self-setup ----------
{
  const f = fakeDiscordApi();
  const d = makeDiscord({ ...cfg, approverRole: 'Approver' }, f.fetchImpl);
  const r = await d.ensureSetup();
  assert.equal(r.appId, 'APP');
  assert.ok(f.calls.some((c) => c.method === 'PUT' && c.path === '/applications/APP/guilds/G/commands'), 'commands registered');
  assert.ok(!f.calls.some((c) => c.method === 'POST' && c.path === '/guilds/G/roles'), 'existing Approver role reused');
  assert.ok(f.calls.some((c) => c.method === 'PUT' && c.path === '/guilds/G/members/OWNER/roles/R1'), 'owner gets Approver');
  assert.ok(r.created.includes('support'), 'a voice channel named support does not count; text channel created');
  assert.ok(!r.created.includes('approvals') && !r.created.includes('agent-logs'), 'existing channels kept');
  assert.equal(r.created.length, 10);
  const made = f.calls.filter((c) => c.method === 'POST' && c.path === '/guilds/G/channels');
  assert.equal(made[0].body.type, 4, 'category created first');
  assert.ok(made.slice(1).every((c) => c.body.type === 0 && c.body.parent_id !== undefined), 'text channels inside the category');
  const f2 = fakeDiscordApi();
  const d2 = makeDiscord({ ...cfg, approverRole: 'Boss' }, f2.fetchImpl);
  const r2 = await d2.ensureSetup(['approvals']);
  assert.equal(r2.roleCreated, true);
  assert.deepEqual(r2.created, []);
  ok('ensureSetup: commands, role to owner, only missing channels created');
}

// ---------- 5. Routes (no keys set) ----------
{
  for (const k of ['OPS_SECRET', 'SUPABASE_SERVICE_KEY', 'DISCORD_PUBLIC_KEY', 'DISCORD_BOT_TOKEN']) delete process.env[k];
  const mkRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r; return r; };

  const tick = (await import('../../api/ops/tick.js')).default;
  let res = mkRes(); await tick({ method: 'POST', headers: { 'x-ops-secret': 'guess' } }, res);
  assert.equal(res.code, 401, 'no OPS_SECRET configured => everything refused');
  process.env.OPS_SECRET = 's3cret-value';
  res = mkRes(); await tick({ method: 'POST', headers: { 'x-ops-secret': 'wrong-value!' } }, res);
  assert.equal(res.code, 401);
  res = mkRes(); await tick({ method: 'POST', headers: { 'x-ops-secret': 's3cret-value' } }, res);
  assert.equal(res.code, 503, 'right secret but no Supabase key => clear 503');
  assert.match(res.body.error, /SUPABASE_SERVICE_KEY/);
  res = mkRes(); await tick({ method: 'GET', headers: {} }, res);
  assert.equal(res.code, 405);
  ok('tick: wrong/missing secret refused; missing Supabase key reported clearly');

  const setup = (await import('../../api/ops/setup.js')).default;
  res = mkRes(); await setup({ method: 'GET', headers: {} }, res);
  assert.equal(res.code, 200);
  assert.ok(Object.values(res.body).every((v) => typeof v === 'boolean'), 'setup status shows only true/false, never values');
  ok('setup GET reveals only true/false');

  const { POST } = await import('../../api/ops/discord.js');
  const r1 = await POST(new Request('https://x/api/ops/discord', { method: 'POST', body: '{"type":1}', headers: { 'x-signature-ed25519': 'aa', 'x-signature-timestamp': '1' } }));
  assert.equal(r1.status, 401, 'unsigned interaction refused');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  process.env.DISCORD_PUBLIC_KEY = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
  const body = '{"type":1}'; const ts = '1700000000';
  const sig = crypto.sign(null, Buffer.from(ts + body), privateKey).toString('hex');
  const r2 = await POST(new Request('https://x/api/ops/discord', { method: 'POST', body, headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts } }));
  assert.equal(r2.status, 200); assert.deepEqual(await r2.json(), { type: 1 });
  ok('interactions endpoint: unsigned refused, Discord PING verified and answered');

  const pay = await import('../../api/ops/payments.js');
  const p1 = await pay.POST(new Request('https://x/api/ops/payments?provider=razorpay', { method: 'POST', body: '{}' }));
  assert.equal(p1.status, 503, 'razorpay off until its secret is set');
  const p2 = await pay.POST(new Request('https://x/api/ops/payments?provider=evil', { method: 'POST', body: '{}' }));
  assert.equal(p2.status, 404);
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const p3 = await pay.POST(new Request('https://x/api/ops/payments?provider=stripe', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=bad' } }));
  assert.equal(p3.status, 400, 'bad Stripe signature refused');
  ok('payments: off until configured; unknown provider and bad signatures refused');

  const wd = (await import('../../api/ops/watchdog.js')).default;
  res = mkRes(); await wd({ method: 'POST', headers: {}, query: {} }, res);
  assert.equal(res.code, 401);
  ok('watchdog route requires the secret');
}

console.log(`\n✅ All ${passed} serverless checks passed`);
