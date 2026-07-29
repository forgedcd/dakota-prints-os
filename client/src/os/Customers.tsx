import { useEffect, useState } from 'react';
import { Search, Plus, Mail, Phone, MapPin, Globe } from 'lucide-react';
import { fullDate, get, money, patch, post, shortDate, STATUS_LABEL, STATUS_TONE } from '../lib/api';
import { Badge, ConfirmDialog, Drawer, EmptyState, Field, SkeletonRows, useToast } from '../components/kit';

function CustomerPanel({ id, onSaved }: { id: number; onSaved: () => void }) {
  const [c, setC] = useState<any | null>(null);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  useEffect(() => {
    get(`/api/os/customers/${id}`).then((r) => { setC(r); setForm(r); });
  }, [id]);
  if (!c) return <SkeletonRows rows={5} />;

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[18px] font-black">{c.company || c.contact_name}</p>
            <p className="text-[13px] text-ink-500">{c.contact_name}</p>
          </div>
          <div className="flex gap-1.5">
            <Badge>{c.derived_source === 'repeat' ? 'Repeat' : c.source}</Badge>
            <Badge tone="bg-[#059669]/10 text-[#046B4D] border-[#059669]/25">{money(c.total_spend)} lifetime</Badge>
          </div>
        </div>
        <ul className="mt-3 grid sm:grid-cols-2 gap-2 text-[13px] text-ink-700">
          <li className="flex gap-2"><Mail size={14} className="mt-0.5 text-ink-300" />{c.email}</li>
          <li className="flex gap-2"><Phone size={14} className="mt-0.5 text-ink-300" />{c.phone || '—'}</li>
          <li className="flex gap-2 sm:col-span-2"><MapPin size={14} className="mt-0.5 text-ink-300" />
            {[c.address, c.city, c.state, c.zip].filter(Boolean).join(', ') || '—'}</li>
        </ul>
      </section>

      <section className="card p-4">
        <h3 className="font-black text-[14px]">Edit record</h3>
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          {[['company', 'Company'], ['contact_name', 'Contact'], ['email', 'Email'], ['phone', 'Phone'],
            ['address', 'Address'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP']].map(([k, l]) => (
            <Field key={k} label={l}>
              <input className="field" value={form[k] || ''} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
          <div className="sm:col-span-2">
            <Field label="Internal notes">
              <textarea className="field min-h-[76px] py-2.5" value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        </div>
        <button className="btn-primary btn-sm mt-3" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await patch(`/api/os/customers/${id}`, form); toast('Customer saved'); onSaved(); }
          catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); }
        }}>Save changes</button>
      </section>

      <section className="card p-4">
        <h3 className="font-black text-[14px]">Order history</h3>
        <ul className="mt-3 divide-y divide-ink-100">
          {c.orders.map((o: any) => (
            <li key={o.id} className="py-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold tnum">{o.order_number}</p>
                <p className="text-[11.5px] text-ink-500">{shortDate(o.created_at)} · {o.source}</p>
              </div>
              <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
              <span className="text-[13px] font-black tnum">{money(o.total)}</span>
            </li>
          ))}
          {c.orders.length === 0 && <li className="py-3 text-[13px] text-ink-500">No orders yet.</li>}
        </ul>
      </section>

      <section className="card p-4">
        <h3 className="font-black text-[14px]">Recent activity</h3>
        <ol className="mt-3 space-y-3">
          {c.activity.slice(0, 12).map((a: any) => (
            <li key={a.id} className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 rounded-full bg-ink-300 shrink-0" />
              <div>
                <p className="text-[13px]">{a.message}</p>
                <p className="text-[11.5px] text-ink-500 tnum">{a.order_number} · {fullDate(a.created_at)}</p>
              </div>
            </li>
          ))}
          {c.activity.length === 0 && <li className="text-[13px] text-ink-500">Nothing logged yet.</li>}
        </ol>
      </section>
    </div>
  );
}

export default function Customers() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({ company: '', contact_name: '', email: '', phone: '', city: '', state: 'SD' });
  const { toast } = useToast();

  const load = () => get(`/api/os/customers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { const t = setTimeout(load, 240); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  return (
    <div className="space-y-4">
      <div className="card p-3 sm:p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
          <input className="field pl-9" placeholder="Search company, contact, email or city" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
        </div>
        <button className="btn-primary btn-sm" onClick={() => setAdding(true)}><Plus size={15} /> New customer</button>
      </div>

      {rows === null ? <SkeletonRows rows={6} /> : rows.length === 0 ? (
        <div className="card"><EmptyState title="No customers found" body="Try a different search term." /></div>
      ) : (
        <>
          <ul className="md:hidden space-y-2.5">
            {rows.map((c) => (
              <li key={c.id}>
                <button className="card w-full text-left p-3.5" onClick={() => setOpenId(c.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-[14px] truncate">{c.company || c.contact_name}</p>
                      <p className="text-[12px] text-ink-500 truncate">{c.email}</p>
                    </div>
                    <span className="font-black tnum text-[14px]">{money(c.total_spend)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-500">
                    <Badge>{c.source}</Badge>
                    <span className="tnum">{c.order_count} orders</span>
                    <span className="ml-auto tnum">{c.last_order ? shortDate(c.last_order) : '—'}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden md:block card overflow-hidden">
            <div className="scroll-x">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-paper-50 border-b border-ink-100 text-left">
                    {['Customer', 'Contact', 'Location', 'Source', 'Orders', 'Last order', 'Lifetime'].map((h) => (
                      <th key={h} className="px-3 py-2.5 label whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((c) => (
                    <tr key={c.id} className="hover:bg-paper-50 cursor-pointer" onClick={() => setOpenId(c.id)}>
                      <td className="px-3 py-2.5 font-bold max-w-[220px] truncate">{c.company || c.contact_name}</td>
                      <td className="px-3 py-2.5 max-w-[200px]">
                        <span className="block truncate">{c.contact_name}</span>
                        <span className="block text-[11.5px] text-ink-500 truncate">{c.email}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{[c.city, c.state].filter(Boolean).join(', ') || '—'}</td>
                      <td className="px-3 py-2.5">
                        <Badge>{c.source === 'website' ? <><Globe size={11} className="mr-1" />website</> : c.source}</Badge>
                      </td>
                      <td className="px-3 py-2.5 tnum">{c.order_count}</td>
                      <td className="px-3 py-2.5 tnum whitespace-nowrap">{c.last_order ? shortDate(c.last_order) : '—'}</td>
                      <td className="px-3 py-2.5 font-black tnum whitespace-nowrap">{money(c.total_spend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <Drawer open={openId !== null} onClose={() => setOpenId(null)} wide
        title={<><p className="label">Customer</p><p className="font-black text-[15px]">Account detail</p></>}>
        {openId !== null && <CustomerPanel id={openId} onSaved={load} />}
      </Drawer>

      <Drawer open={adding} onClose={() => setAdding(false)}
        title={<><p className="label">New</p><p className="font-black text-[15px]">Add customer</p></>}>
        <div className="space-y-3">
          {[['company', 'Company'], ['contact_name', 'Contact name *'], ['email', 'Email *'], ['phone', 'Phone'], ['city', 'City'], ['state', 'State']].map(([k, l]) => (
            <Field key={k} label={l}>
              <input className="field" value={(nf as any)[k]} onChange={(e) => setNf((f) => ({ ...f, [k]: e.target.value }))} />
            </Field>
          ))}
          <button className="btn-primary w-full" onClick={async () => {
            try {
              await post('/api/os/customers', nf);
              toast('Customer created');
              setAdding(false);
              setNf({ company: '', contact_name: '', email: '', phone: '', city: '', state: 'SD' });
              load();
            } catch (e: any) { toast(e.message, 'err'); }
          }}>Create customer</button>
        </div>
      </Drawer>
    </div>
  );
}
