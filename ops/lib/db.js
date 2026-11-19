import { createClient } from '@supabase/supabase-js';

/**
 * All database access for the agents. Uses the SERVICE (secret) key, so this file must only ever
 * run on your server, never in the browser.
 */
const LIST_COLS = 'id,name,email,service,status,payment_status,created_at';

/** The website calls the requested service `service`; the agents call it `channel`. Map once, here. */
export const normalizeLead = (row) => (row ? { ...row, channel: row.service ?? row.channel ?? null } : row);
const normAll = (rows) => (rows || []).map(normalizeLead);

export function makeDb(cfg) {
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const T = cfg.leadsTable || 'leads';
  const must = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  const now = () => new Date().toISOString();
  // Escape LIKE wildcards so an email like "a_b@x.com" only matches itself.
  const likeEscape = (s) => String(s).replace(/[\\%_]/g, '\\$&');

  return {
    // ---------- orders ----------
    /** Atomically claim new orders (status new -> triaging) so two cycles never take the same one. */
    async claimNewOrders(limit) {
      const rows = must(
        await sb.from(T).select('id').eq('status', 'new').order('created_at', { ascending: true }).limit(limit)
      );
      const claimed = [];
      for (const r of rows) {
        const got = must(
          await sb.from(T).update({ status: 'triaging' }).eq('id', r.id).eq('status', 'new').select().maybeSingle()
        );
        if (got) claimed.push(normalizeLead(got));
      }
      return claimed;
    },

    async getOrder(id) {
      return normalizeLead(must(await sb.from(T).select('*').eq('id', id).single()));
    },

    async updateOrder(id, patch) {
      must(await sb.from(T).update(patch).eq('id', id));
    },

    async listRecentOrders(limit = 25) {
      return normAll(
        must(await sb.from(T).select(LIST_COLS).order('created_at', { ascending: false }).limit(limit))
      );
    },

    /** Only one decision can win: moves awaiting_approval -> approved/rejected. Returns null if already handled. */
    async claimForDecision(orderId, newStatus) {
      return must(
        await sb.from(T).update({ status: newStatus }).eq('id', orderId).eq('status', 'awaiting_approval').select().maybeSingle()
      );
    },

    /** After a restart: un-stick orders that were mid-triage, and list orders whose work was interrupted. */
    async recoverInterrupted() {
      must(await sb.from(T).update({ status: 'new' }).eq('status', 'triaging'));
      const rows = must(await sb.from(T).select('id').eq('status', 'in_progress'));
      return rows.map((r) => r.id);
    },

    // ---------- tasks ----------
    async insertTasks(orderId, tasks) {
      const rows = tasks.map((t) => ({ order_id: orderId, agent: t.agent, title: t.title, details: t.details, status: 'proposed' }));
      return must(await sb.from('tasks').insert(rows).select());
    },
    async getTasks(orderId, statuses) {
      return must(await sb.from('tasks').select('*').eq('order_id', orderId).in('status', statuses).order('created_at'));
    },
    async updateTask(id, patch) {
      must(await sb.from('tasks').update({ ...patch, updated_at: now() }).eq('id', id));
    },
    async setTasks(orderId, fromStatus, patch) {
      must(await sb.from('tasks').update({ ...patch, updated_at: now() }).eq('order_id', orderId).eq('status', fromStatus));
    },

    // ---------- audit ----------
    async log({ agent, order_id = null, task_id = null, event, detail = {} }) {
      const { error } = await sb.from('agent_logs').insert({ agent, order_id, task_id, event, detail });
      if (error) console.error('[agent_logs]', error.message); // logging must never crash an agent
    },
    async recordApproval(orderId, discordMessage) {
      must(await sb.from('approvals').insert({ order_id: orderId, discord_message: discordMessage }));
    },
    async finishApproval(orderId, decision, userId) {
      must(
        await sb.from('approvals').update({ decision, decided_by: userId, decided_at: now() }).eq('order_id', orderId).is('decision', null)
      );
    },

    // ---------- payments (billing agent) ----------
    /** Insert a verified webhook event. Returns null if this event_id was already stored (idempotent). */
    async insertPayment(evt) {
      const { data, error } = await sb
        .from('payments')
        .insert({
          provider: evt.provider,
          event_id: evt.event_id,
          kind: evt.kind,
          amount: evt.amount,
          currency: evt.currency,
          email: evt.email,
          reference: evt.reference,
        })
        .select()
        .maybeSingle();
      if (error) {
        if (error.code === '23505') return null;
        throw new Error(error.message);
      }
      return data;
    },
    /** pending -> confirmed/ignored, exactly once. */
    async claimPayment(id, status) {
      return must(await sb.from('payments').update({ status }).eq('id', id).eq('status', 'pending').select().maybeSingle());
    },
    async findUnpaidOrdersByEmail(email) {
      return normAll(
        must(await sb
          .from(T)
          .select(LIST_COLS)
          .ilike('email', likeEscape(String(email).trim()))
          .in('payment_status', ['unpaid', 'deposit_paid'])
          .not('status', 'in', '(rejected,triage_failed)')
          .order('created_at', { ascending: false })
          .limit(5))
      );
    },
    async markOrderPayment(orderId, paymentStatus) {
      must(await sb.from(T).update({ payment_status: paymentStatus }).eq('id', orderId));
    },

    // ---------- watchdog / digest ----------
    async ordersByStatus(statuses, olderThanIso) {
      let q = sb.from(T).select('id,name,service,status,payment_status,created_at,triaged_at').in('status', statuses);
      if (olderThanIso) q = q.lt('created_at', olderThanIso);
      return normAll(must(await q.limit(100)));
    },
    async deliveredButUnpaid() {
      return normAll(
        must(await sb.from(T).select('id,name,service,status,payment_status').in('status', ['review', 'delivered']).neq('payment_status', 'paid').limit(50))
      );
    },
    async statusCounts() {
      const rows = must(await sb.from(T).select('status').limit(5000));
      const counts = {};
      for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
      return counts;
    },
    async failedTaskCountSince(iso) {
      const { count, error } = await sb.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('updated_at', iso);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    async pendingPaymentCount() {
      const { count, error } = await sb.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('kind', 'payment');
      if (error) throw new Error(error.message);
      return count ?? 0;
    },

    // ---------- small key/value store (serverless functions keep no memory between runs) ----------
    async getState(key) {
      const row = must(await sb.from('ops_state').select('value').eq('key', key).maybeSingle());
      return row?.value ?? null;
    },
    async setState(key, value) {
      must(await sb.from('ops_state').upsert({ key, value, updated_at: now() }));
    },
  };
}
