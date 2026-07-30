import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Printer, Send, Truck, Zap, CheckCircle2, Trash2, Palette, Download, Paperclip } from 'lucide-react';
import { asset, del, fullDate, get, money, patch, post, dayDate, STATUS_FLOW, STATUS_LABEL, STATUS_TONE, PAY_TONE } from '../lib/api';
import { Badge, ConfirmDialog, Field, Skeleton, useToast } from '../components/kit';
import { cleanLabel } from '../lib/pricing';

const TEMPLATES = [
  ['proof_ready', 'Proof ready'], ['deposit_reminder', 'Deposit reminder'],
  ['ready_pickup', 'Ready for pickup'], ['shipped', 'Shipped'], ['reorder_followup', 'Reorder follow-up'],
];

export function SpecTable({ spec }: { spec: Record<string, any> }) {
  const entries = Object.entries(spec || {}).filter(([k]) => k !== 'artwork_url');
  if (!entries.length) return <p className="text-[12.5px] text-ink-300">No options recorded</p>;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-500 uppercase tracking-[0.08em] text-[10.5px] font-bold pt-0.5">{k.replace(/_/g, ' ')}</dt>
          <dd className="font-medium">
            {k === 'size_breakdown' && v && typeof v === 'object'
              ? Object.entries(v as any).filter(([, n]) => Number(n) > 0).map(([s, n]) => `${cleanLabel(s)}×${n}`).join('  ')
              : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const KIND_TONE: Record<string, string> = {
  artwork: 'bg-[#00AEEF]/12 text-[#0475A0] border-[#00AEEF]/30',
  logo: 'bg-[#EC008C]/10 text-[#B00A6C] border-[#EC008C]/25',
  reference: 'bg-[#FFF200]/25 text-[#7A6A00] border-[#D6CB00]/50',
};

const isImage = (u = '') => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(u.split('?')[0]);

/** Thumbnail grid of everything the customer attached to a line item. */
export function FileGrid({ files }: { files: any[] }) {
  if (!files?.length) return null;
  return (
    <div className="mt-2.5">
      <p className="label flex items-center gap-1.5"><Paperclip size={12} /> Customer files ({files.length})</p>
      <ul className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-2">
        {files.map((f) => (
          <li key={f.id || f.url} className="rounded-lg border border-ink-100 overflow-hidden bg-white">
            <a href={asset(f.url)} target="_blank" rel="noreferrer" className="block">
              <div className="h-24 bg-paper-100 grid place-items-center overflow-hidden">
                {isImage(f.url)
                  ? <img src={asset(f.url)} alt={f.filename || 'Customer file'} className="h-full w-full object-cover" loading="lazy"
                      onError={(e) => {
                        const el = e.currentTarget;
                        el.style.display = 'none';
                        const fallback = el.nextElementSibling as HTMLElement | null;
                        if (fallback) fallback.style.display = 'flex';
                      }} />
                  : null}
                <span style={{ display: isImage(f.url) ? 'none' : 'flex' }}
                  className="h-full w-full items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500">
                  <Paperclip size={12} />{((f.filename || f.url).split('.').pop() || 'file').slice(0, 6)}
                </span>
              </div>
            </a>
            <div className="p-2 space-y-1.5">
              <Badge tone={KIND_TONE[f.kind] || ''}>{f.kind || 'file'}</Badge>
              <p className="text-[11.5px] text-ink-500 truncate" title={f.filename || f.url}>{f.filename || f.url.split('/').pop()}</p>
              <a className="btn-ghost btn-sm w-full justify-center" href={asset(f.url)} download target="_blank" rel="noreferrer">
                <Download size={12} /> Download
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function OrderDetail({ id, onChanged, onDeleted }: { id: number; onChanged?: () => void; onDeleted?: () => void }) {
  const [o, setO] = useState<any | null>(null);
  const [note, setNote] = useState('');
  const [tracking, setTracking] = useState('');
  const [tpl, setTpl] = useState(TEMPLATES[0][0]);
  const [busy, setBusy] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const { toast } = useToast();

  const load = () => get(`/api/os/orders/${id}`).then((r) => { setO(r); setTracking(r.tracking_number || ''); });
  useEffect(() => { setO(null); load().catch((e) => toast(e.message, 'err')); /* eslint-disable-next-line */ }, [id]);

  if (!o) return <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>;

  const idx = STATUS_FLOW.indexOf(o.status);
  const next = idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;

  async function act(label: string, fn: () => Promise<any>, msg: string) {
    setBusy(label);
    try { const r = await fn(); if (r?.id) setO(r); else await load(); toast(msg); onChanged?.(); }
    catch (e: any) { toast(e.message || 'Action failed', 'err'); }
    finally { setBusy(''); }
  }

  return (
    <div className="space-y-4">
      {/* header block */}
      <section className="card p-4">
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div>
            <p className="text-[19px] font-black tnum">{o.order_number}</p>
            <p className="mt-0.5 text-[13px] text-ink-500">
              {o.customer?.company || o.customer?.contact_name} · {o.customer?.email}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
            <Badge tone={PAY_TONE[o.payment_status]}>{o.payment_status}</Badge>
            <Badge>{o.source}</Badge>
            {o.rush ? <Badge tone="bg-[#E11D2E]/8 text-[#A5121F] border-[#E11D2E]/25">Rush</Badge> : null}
            {o.items?.some((i: any) => i.design_service) ? (
              <Badge tone="bg-[#EC008C]/10 text-[#B00A6C] border-[#EC008C]/25"><Palette size={11} className="mr-1" />Design requested</Badge>
            ) : null}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px]">
          {[
            ['Placed', fullDate(o.created_at)], ['Promised', dayDate(o.due_date)],
            ['Fulfillment', o.fulfillment === 'pickup' ? 'Pickup' : 'Ship'], ['Total', money(o.total)],
          ].map(([l, v]) => (
            <div key={l as string}><dt className="label">{l}</dt><dd className="mt-1 font-bold tnum">{v}</dd></div>
          ))}
        </dl>

        {/* stage advance */}
        <div className="mt-4 scroll-x -mx-1 px-1">
          <div className="flex gap-1.5 pb-1">
            {STATUS_FLOW.map((s, i) => (
              <button key={s} disabled={busy !== '' || s === o.status}
                onClick={() => act(s, () => patch(`/api/os/orders/${o.id}`, { status: s }), `Moved to ${STATUS_LABEL[s]}`)}
                className={`chip ${i <= idx ? 'chip-active' : ''} ${s === o.status ? 'ring-2 ring-[#00AEEF]' : ''}`}>
                {i < idx && <CheckCircle2 size={12} />}{STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {next && (
            <button className="btn-accent btn-sm" disabled={busy !== ''}
              onClick={() => act('next', () => patch(`/api/os/orders/${o.id}`, { status: next }), `Advanced to ${STATUS_LABEL[next]}`)}>
              Advance to {STATUS_LABEL[next]} <ArrowRight size={14} />
            </button>
          )}
          {o.payment_status !== 'paid' && (
            <button className="btn-ghost btn-sm" disabled={busy !== ''}
              onClick={() => act('paid', () => patch(`/api/os/orders/${o.id}`, { payment_status: 'paid' }), 'Payment marked paid')}>
              Mark paid
            </button>
          )}
          {!o.rush && (
            <button className="btn-ghost btn-sm" disabled={busy !== ''}
              onClick={() => act('rush', () => patch(`/api/os/orders/${o.id}`, { rush: 1 }), 'Flagged as rush')}>
              <Zap size={14} /> Flag rush
            </button>
          )}
          <Link className="btn-ghost btn-sm" to={`/ticket/${o.id}`}><Printer size={14} /> Job ticket</Link>
          <button className="btn-ghost btn-sm text-dpred" onClick={() => setConfirmDel(true)}><Trash2 size={14} /> Delete</button>
        </div>
      </section>

      {/* line items */}
      <section className="card p-4">
        <h3 className="font-black text-[14px]">Line items &amp; specs</h3>
        <ul className="mt-3 divide-y divide-ink-100">
          {o.items.map((it: any) => (
            <li key={it.id} className="py-3 first:pt-0">
              <div className="flex justify-between gap-3">
                <p className="font-bold text-[13.5px]">{it.qty} × {it.name}</p>
                <p className="font-bold tnum shrink-0">{money(it.line_total)}</p>
              </div>
              {it.design_service ? (
                <div className="mt-2 rounded-lg border border-[#EC008C]/25 bg-[#EC008C]/[0.045] p-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-[#B00A6C]">
                    <Palette size={13} /> Design it for me
                  </p>
                  <p className="mt-1.5 text-[13px] whitespace-pre-wrap">
                    {it.design_brief || <span className="text-ink-500">Customer left the brief blank — call before starting art.</span>}
                  </p>
                </div>
              ) : null}
              <div className="mt-2"><SpecTable spec={it.spec || {}} /></div>
              <FileGrid files={it.files || []} />
            </li>
          ))}
        </ul>
        <dl className="mt-3 pt-3 border-t border-ink-100 space-y-1.5 text-[13px]">
          {[['Subtotal', o.subtotal], ['Rush fee', o.rush_fee], ['Shipping', o.shipping], ['Tax', o.tax]].map(([l, v]: any) => (
            <div key={l} className="flex justify-between"><dt className="text-ink-500">{l}</dt><dd className="font-bold tnum">{money(v)}</dd></div>
          ))}
          <div className="flex justify-between pt-1.5 border-t border-ink-100">
            <dt className="font-black">Total</dt><dd className="text-[17px] font-black tnum">{money(o.total)}</dd>
          </div>
        </dl>
        {o.artwork_url && (
          <a className="mt-3 inline-flex btn-ghost btn-sm" href={o.artwork_url} target="_blank" rel="noreferrer">Open customer artwork</a>
        )}
        {o.notes && <p className="mt-3 rounded-lg bg-paper-50 border border-ink-100 p-3 text-[13px]"><strong>Customer notes:</strong> {o.notes}</p>}
      </section>

      {/* fulfillment + comms */}
      <section className="card p-4 grid sm:grid-cols-2 gap-4">
        <div>
          <Field label="Tracking number">
            <div className="flex gap-2">
              <input className="field" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="1Z…" />
              <button className="btn-ghost px-3" disabled={busy !== ''}
                onClick={() => act('track', () => patch(`/api/os/orders/${o.id}`, { tracking_number: tracking }), 'Tracking saved')}
                aria-label="Save tracking"><Truck size={16} /></button>
            </div>
          </Field>
        </div>
        <div>
          <Field label="Send customer message">
            <div className="flex gap-2">
              <select className="field" value={tpl} onChange={(e) => setTpl(e.target.value)}>
                {TEMPLATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button className="btn-ghost px-3" disabled={busy !== ''}
                onClick={() => act('msg', () => post(`/api/os/orders/${o.id}/message`, { channel: 'email', template: tpl }), 'Message logged & queued')}
                aria-label="Send message"><Send size={16} /></button>
            </div>
          </Field>
        </div>
      </section>

      {/* tasks */}
      <section className="card p-4">
        <h3 className="font-black text-[14px]">Tasks</h3>
        <ul className="mt-3 space-y-2">
          {o.tasks.map((t: any) => (
            <li key={t.id} className="flex items-center gap-3">
              <button className={`h-[18px] w-[18px] rounded border-2 shrink-0 grid place-items-center
                  ${t.status === 'done' ? 'bg-ink border-ink text-white' : 'border-ink-300 hover:border-ink'}`}
                disabled={t.status === 'done'} aria-label={`Complete ${t.title}`}
                onClick={() => act(`t${t.id}`, () => patch(`/api/os/tasks/${t.id}`, { status: 'done' }), 'Task completed')}>
                {t.status === 'done' && <CheckCircle2 size={12} />}
              </button>
              <span className={`text-[13px] flex-1 ${t.status === 'done' ? 'line-through text-ink-300' : 'font-medium'}`}>{t.title}</span>
              <span className="text-[11.5px] text-ink-500 tnum">{dayDate(t.due_date)}</span>
            </li>
          ))}
          {o.tasks.length === 0 && <li className="text-[13px] text-ink-500">No tasks on this job.</li>}
        </ul>
      </section>

      {/* timeline */}
      <section className="card p-4">
        <h3 className="font-black text-[14px]">Timeline</h3>
        <form className="mt-3 flex gap-2" onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          act('note', () => post(`/api/os/orders/${o.id}/events`, { message: note.trim(), type: 'note' }), 'Note added').then(() => setNote(''));
        }}>
          <input className="field" placeholder="Add a shop note…" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-primary btn-sm px-4" disabled={busy !== '' || !note.trim()}>Add</button>
        </form>
        <ol className="mt-4 space-y-3.5">
          {o.events.map((e: any, i: number) => (
            <li key={e.id} className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 rounded-full shrink-0" style={{ background: i === 0 ? '#E11D2E' : '#C9CCD1' }} />
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{e.message}</p>
                <p className="text-[11.5px] text-ink-500">{fullDate(e.created_at)} · {e.actor || 'system'}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* messages */}
      {o.messages?.length > 0 && (
        <section className="card p-4">
          <h3 className="font-black text-[14px]">Customer messages</h3>
          <ul className="mt-3 space-y-3">
            {o.messages.map((m: any) => (
              <li key={m.id} className="rounded-lg border border-ink-100 p-3 bg-paper-50">
                <div className="flex items-center gap-2">
                  <Badge>{m.channel}</Badge>
                  <span className="text-[11.5px] text-ink-500">{fullDate(m.created_at)}</span>
                </div>
                {m.subject && <p className="mt-1.5 text-[13px] font-bold">{m.subject}</p>}
                <p className="mt-1 text-[12.5px] text-ink-700 whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog open={confirmDel} title={`Delete ${o.order_number}?`}
        body="This removes the order, its items, tasks and timeline. Prototype data only."
        onCancel={() => setConfirmDel(false)}
        onConfirm={async () => {
          setConfirmDel(false);
          try { await del(`/api/os/orders/${o.id}`); toast('Order deleted'); onDeleted?.(); }
          catch (e: any) { toast(e.message, 'err'); }
        }} />
    </div>
  );
}
