import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Copy, Save, Webhook, Users, Terminal, RefreshCw, Send, Globe, Activity,
  CheckCircle2, XCircle, ExternalLink, Mail,
} from 'lucide-react';
import { API_BASE, get, post, put, shortDate } from '../lib/api';
import { Badge, Field, SkeletonRows, Spinner, useToast } from '../components/kit';
import { CmykRule } from '../components/brand';

const SHOP_FIELDS: [string, string][] = [
  ['shop_name', 'Shop name'], ['shop_tagline', 'Tagline'], ['shop_phone', 'Phone'],
  ['shop_email', 'Email'], ['shop_address', 'Address'], ['notify_email', 'Internal notification email'],
];
const NUM_FIELDS: [string, string, string][] = [
  ['tax_rate', 'Sales tax %', 'Applied to subtotal + rush fee'],
  ['rush_fee_pct', 'Rush fee %', 'Added when a job is flagged rush'],
  ['default_turnaround', 'Default turnaround (days)', 'Used when a product has none'],
  ['low_stock_threshold', 'Blank reorder point', 'Triggers a restock task + alert'],
];
const TEMPLATES: [string, string][] = [
  ['tpl_order_received', 'Order received'], ['tpl_proof_ready', 'Proof ready'],
  ['tpl_deposit_reminder', 'Deposit reminder'], ['tpl_ready_pickup', 'Ready for pickup'],
  ['tpl_shipped', 'Shipped'], ['tpl_reorder_followup', 'Reorder follow-up'],
];

const PAYLOAD = `{
  "customer": {
    "company": "Aberdeen Ace Hardware",
    "contact_name": "Jamie Fox",
    "email": "jamie@example.com",
    "phone": "605-555-0143",
    "address": "905 6th Ave SE", "city": "Aberdeen", "state": "SD", "zip": "57401"
  },
  "items": [
    { "sku": "SP-TEE-1C", "qty": 48,
      "spec": { "garment_colors": "Black", "ink_colors": "White + Red",
                "size_breakdown": { "S": 6, "M": 12, "L": 18, "XL": 12 } } },
    { "sku": "SGN-YARD", "qty": 10, "spec": { "sides": "Single-sided" } }
  ],
  "rush": false,
  "fulfillment": "ship",
  "payment_method": "Pay on invoice",
  "artwork_url": "/uploads/art-1738000000-logo.ai",
  "po_number": "PO-88213",
  "notes": "Match last spring's ink."
}`;

export default function Settings() {
  const [s, setS] = useState<any | null>(null);
  const [hook, setHook] = useState<any | null>(null);
  const [status, setStatus] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastTest, setLastTest] = useState<any | null>(null);
  const { toast } = useToast();

  const loadHook = () => get('/api/os/webhooks').then(setHook).catch(() => setHook({ log: [] }));
  useEffect(() => { get('/api/os/settings').then(setS).catch(() => setS({})); loadHook(); }, []);
  if (!s) return <SkeletonRows rows={6} />;

  const set = (k: string, v: any) => setS((x: any) => ({ ...x, [k]: v }));
  const copy = (text: string, label: string) =>
    navigator.clipboard?.writeText(text).then(() => toast(`${label} copied`)).catch(() => toast('Copy failed', 'err'));

  const ordersUrl = hook?.webhook_url || s.webhook_url || '';
  const token = hook?.webhook_token || s.webhook_token || '';
  const curl = `curl -X POST ${ordersUrl} \\
  -H 'Content-Type: application/json' \\
  -H 'x-webhook-token: ${token}' \\
  -d '{"customer":{"contact_name":"Jamie Fox","email":"jamie@example.com","phone":"605-555-0143"},
       "items":[{"sku":"SP-TEE-1C","qty":48,"spec":{"garment_colors":"Black","ink_colors":"White"}}],
       "rush":false,"fulfillment":"ship","payment_method":"Pay on invoice"}'`;

  async function save() {
    setBusy(true);
    try { await put('/api/os/settings', s); toast('Settings saved'); loadHook(); }
    catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const r = await post('/api/os/webhooks/test', {});
      setLastTest(r);
      toast(`Test order ${r.order_number} created`);
      loadHook();
    } catch (e: any) { toast(e.message || 'Test failed', 'err'); } finally { setTesting(false); }
  }

  async function regenerate() {
    if (!window.confirm('Rotate the intake token? The website must be updated with the new value or its orders will 401.')) return;
    try {
      const r = await post('/api/os/webhooks/regenerate', {});
      setS((x: any) => ({ ...x, webhook_token: r.webhook_token }));
      toast('New token generated — update the website env var');
      loadHook();
    } catch (e: any) { toast(e.message, 'err'); }
  }

  async function checkSite() {
    setChecking(true);
    try { setStatus(await get('/api/os/website/status')); }
    catch (e: any) { toast(e.message, 'err'); } finally { setChecking(false); }
  }

  return (
    <div className="space-y-5">
      {/* ============================================ website integration */}
      <section className="card overflow-hidden">
        <div className="p-4 pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <Webhook size={16} className="text-[#00AEEF]" />
            <h2 className="font-black text-[14px]">Website integration</h2>
            <Badge className="ml-auto" tone="bg-paper-100 text-ink-700 border-ink-100">
              {hook?.counts?.total ? `${hook.counts.total} calls logged` : 'no calls yet'}
            </Badge>
          </div>
          <p className="mt-1.5 text-[13px] text-ink-500">
            dakotaprints.com is a separate site. It talks to this OS over three endpoints: order intake, catalog sync and
            customer tracking. Give the website team the URL + token below.
          </p>
        </div>
        <CmykRule className="cmyk-rule-thin mt-4" />

        <div className="p-4 space-y-3">
          <Field label="Order intake webhook (POST)">
            <div className="flex gap-2">
              <input className="field font-mono text-[12.5px]" readOnly value={ordersUrl} />
              <button className="btn-ghost px-3 shrink-0" onClick={() => copy(ordersUrl, 'Endpoint')} aria-label="Copy intake endpoint"><Copy size={15} /></button>
            </div>
          </Field>
          <div className="grid lg:grid-cols-2 gap-3">
            <Field label="Product sync (GET)">
              <div className="flex gap-2">
                <input className="field font-mono text-[12px]" readOnly value={hook?.products_url || ''} />
                <button className="btn-ghost px-3 shrink-0" onClick={() => copy(hook?.products_url, 'Products URL')} aria-label="Copy products endpoint"><Copy size={15} /></button>
              </div>
            </Field>
            <Field label="Order tracking (GET)">
              <div className="flex gap-2">
                <input className="field font-mono text-[12px]" readOnly value={hook?.track_url || ''} />
                <button className="btn-ghost px-3 shrink-0" onClick={() => copy(hook?.track_url, 'Tracking URL')} aria-label="Copy tracking endpoint"><Copy size={15} /></button>
              </div>
            </Field>
          </div>

          <Field label="Webhook token" hint={hook?.token_from_env
            ? 'Currently supplied by the OS_WEBHOOK_TOKEN environment variable.'
            : 'Sent as the x-webhook-token header. Set OS_WEBHOOK_TOKEN in the environment to pin it.'}>
            <div className="flex gap-2">
              <input className="field font-mono text-[12.5px]" readOnly value={token} />
              <button className="btn-ghost px-3 shrink-0" onClick={() => copy(token, 'Token')} aria-label="Copy token"><Copy size={15} /></button>
              <button className="btn-ghost px-3 shrink-0" onClick={regenerate} aria-label="Regenerate token" title="Regenerate token"><RefreshCw size={15} /></button>
            </div>
          </Field>

          {/* WEBSITE_URL target + connection status */}
          <div className="grid lg:grid-cols-[1fr_auto] gap-3 items-end">
            <Field label="Website URL (WEBSITE_URL)" hint="Where the public storefront lives — used for catalog sync links and connection checks.">
              <input className="field font-mono text-[12.5px]" value={s.website_url || ''} placeholder="https://www.dakotaprints.com"
                onChange={(e) => set('website_url', e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <button className="btn-ghost btn-sm" onClick={checkSite} disabled={checking}>
                {checking ? <Spinner /> : <Activity size={14} />} Check connection
              </button>
              {s.website_url && (
                <a className="btn-ghost btn-sm" href={s.website_url} target="_blank" rel="noreferrer" aria-label="Open website">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
          {status && (
            <p className={`text-[12.5px] font-bold flex items-center gap-1.5 ${status.reachable ? 'text-emerald-700' : 'text-dpred'}`}>
              {status.reachable ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              {status.reachable
                ? `Reachable — HTTP ${status.http_status} · checked ${shortDate(status.checked_at)}`
                : `Not reachable${status.http_status ? ` — HTTP ${status.http_status}` : ''}${status.message ? ` — ${status.message}` : ''}`}
            </p>
          )}
          {hook?.env_website_url && hook.env_website_url !== s.website_url && (
            <p className="text-[12px] text-ink-500">Environment WEBSITE_URL is <span className="font-mono">{hook.env_website_url}</span> — saving here overrides it for this database.</p>
          )}

          {/* built-in tester */}
          <div className="rounded-lg border border-ink-100 bg-paper-50 p-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold">Send test order</p>
                <p className="text-[12.5px] text-ink-500">
                  POSTs a sample 2-line rush order to this OS's own intake endpoint — no website required.
                  It lands on the dashboard feed and the board's New column with its task chain.
                </p>
              </div>
              <button className="btn-accent btn-sm shrink-0" onClick={sendTest} disabled={testing}>
                {testing ? <Spinner /> : <Send size={14} />} Send test order
              </button>
            </div>
            {lastTest && (
              <p className="mt-2.5 text-[12.5px] font-bold text-emerald-700">
                Created <Link className="underline" to={`/orders/${lastTest.id}`}>{lastTest.order_number}</Link> · ${Number(lastTest.total).toFixed(2)} · due {lastTest.due_date}
              </p>
            )}
          </div>

          {/* copy-paste examples */}
          <div className="grid lg:grid-cols-2 gap-3">
            <div className="min-w-0">
              <p className="label mb-1.5 flex items-center gap-1.5"><Terminal size={13} /> cURL example</p>
              <pre className="rounded-lg bg-ink text-white/90 p-3 text-[11.5px] leading-relaxed overflow-x-auto">{curl}</pre>
              <button className="btn-ghost btn-sm mt-2" onClick={() => copy(curl, 'cURL example')}><Copy size={14} /> Copy cURL</button>
            </div>
            <div className="min-w-0">
              <p className="label mb-1.5">JSON payload</p>
              <pre className="rounded-lg bg-ink text-white/90 p-3 text-[11.5px] leading-relaxed overflow-x-auto max-h-[300px]">{PAYLOAD}</pre>
              <button className="btn-ghost btn-sm mt-2" onClick={() => copy(PAYLOAD, 'Payload example')}><Copy size={14} /> Copy payload</button>
            </div>
          </div>
          <p className="text-[12px] text-ink-500">
            Responses: <span className="font-mono">201</span> with <span className="font-mono">{'{ order_number, id, total, due_date, status, track_url }'}</span> ·
            {' '}<span className="font-mono">401</span> bad token · <span className="font-mono">400</span> missing contact/items. The OS re-prices every
            line server-side from the product catalog, so the website never controls totals.
          </p>
        </div>

        {/* inbound log */}
        <div className="border-t border-ink-100">
          <div className="px-4 py-3 flex flex-wrap items-center gap-2">
            <Globe size={15} className="text-ink-500" />
            <p className="label">Last 20 inbound calls</p>
            {hook?.counts && (
              <span className="text-[12px] text-ink-500 tnum">{hook.counts.ok || 0} ok · {hook.counts.failed || 0} failed</span>
            )}
            <button className="btn-ghost btn-sm ml-auto" onClick={loadHook}><RefreshCw size={13} /> Refresh</button>
          </div>
          <div className="scroll-x border-t border-ink-100">
            <table className="w-full min-w-[720px] text-[12.5px]">
              <thead className="bg-paper-50 text-ink-500">
                <tr className="text-left">
                  <th className="px-4 py-2 font-bold uppercase tracking-[0.1em] text-[10.5px]">When</th>
                  <th className="px-3 py-2 font-bold uppercase tracking-[0.1em] text-[10.5px]">Endpoint</th>
                  <th className="px-3 py-2 font-bold uppercase tracking-[0.1em] text-[10.5px]">Status</th>
                  <th className="px-3 py-2 font-bold uppercase tracking-[0.1em] text-[10.5px]">Order</th>
                  <th className="px-3 py-2 font-bold uppercase tracking-[0.1em] text-[10.5px]">IP</th>
                  <th className="px-4 py-2 font-bold uppercase tracking-[0.1em] text-[10.5px]">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {(hook?.log || []).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-ink-500">No inbound calls yet — hit “Send test order”.</td></tr>
                )}
                {(hook?.log || []).map((l: any) => (
                  <tr key={l.id} className="hover:bg-paper-50">
                    <td className="px-4 py-2 whitespace-nowrap text-ink-500 tnum">{shortDate(l.created_at)}</td>
                    <td className="px-3 py-2 font-mono text-[11.5px] whitespace-nowrap">{l.endpoint}</td>
                    <td className="px-3 py-2">
                      <Badge tone={l.status < 400 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-dpred border-red-100'}>{l.status}</Badge>
                    </td>
                    <td className="px-3 py-2 tnum whitespace-nowrap">{l.order_number || '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11.5px] text-ink-500 whitespace-nowrap">{l.ip}</td>
                    <td className="px-4 py-2 text-ink-500 max-w-[280px] truncate" title={l.payload_preview || ''}>{l.payload_preview || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-black text-[14px]">Shop profile</h2>
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          {SHOP_FIELDS.map(([k, l]) => (
            <Field key={k} label={l}><input className="field" value={s[k] || ''} onChange={(e) => set(k, e.target.value)} /></Field>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-black text-[14px]">Pricing &amp; production defaults</h2>
        <div className="mt-3 grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {NUM_FIELDS.map(([k, l, hint]) => (
            <Field key={k} label={l} hint={hint}>
              <input className="field tnum" type="number" step="0.1" value={s[k] || ''} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-black text-[14px]">Message templates</h2>
        <p className="mt-1 text-[12.5px] text-ink-500">
          Placeholders: <span className="font-mono">{'{{contact_name}} {{order_number}} {{total}} {{deposit}} {{tracking_number}}'}</span>.
          Outbound email uses the branded stub layout — preview one to see the lockup header.
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {TEMPLATES.map(([k, l]) => (
            <Field key={k} label={l}>
              <textarea className="field min-h-[92px] py-2.5 text-[13px]" value={s[k] || ''} onChange={(e) => set(k, e.target.value)} />
              <a className="btn-ghost btn-sm mt-1.5" href={`${API_BASE}/api/os/email-preview?template=${k}`} target="_blank" rel="noreferrer">
                <Mail size={13} /> Preview email
              </a>
            </Field>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <div className="flex items-center gap-2"><Users size={16} /><h2 className="font-black text-[14px]">Staff accounts</h2></div>
        <ul className="mt-3 divide-y divide-ink-100">
          {(s.users || []).map((u: any) => (
            <li key={u.id} className="py-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold">{u.name}</p>
                <p className="text-[12px] text-ink-500 break-all">{u.email}</p>
              </div>
              <Badge>{u.role}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-ink-500">
          Demo passwords are seeded from ADMIN_PASSWORD (default <span className="font-mono">ForgedOS2026!</span>). Change it in the
          environment before a real deploy.
        </p>
      </section>

      <div className="sticky bottom-3 flex justify-end">
        <button className="btn-primary shadow-pop" disabled={busy} onClick={save}><Save size={16} /> Save settings</button>
      </div>
    </div>
  );
}
