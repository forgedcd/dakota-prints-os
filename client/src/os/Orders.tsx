import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Search, Zap, Globe, Phone, Store, FileDown } from 'lucide-react';
import { API_BASE, get, money, shortDate, dayDate, STATUS_FLOW, STATUS_LABEL, STATUS_TONE, PAY_TONE } from '../lib/api';
import { Badge, Drawer, EmptyState, SkeletonRows } from '../components/kit';
import OrderDetail from './OrderDetail';

const SOURCE_ICON: Record<string, any> = { website: Globe, phone: Phone, rep: Store, walkin: Store };

export default function Orders() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const status = params.get('status') || 'all';
  const source = params.get('source') || 'all';
  const payment = params.get('payment') || 'all';

  const load = () => {
    const qs = new URLSearchParams({ status, source, payment });
    if (q.trim()) qs.set('q', q.trim());
    return get(`/api/os/orders?${qs}`).then(setRows).catch(() => setRows([]));
  };
  useEffect(() => { setRows(null); load(); /* eslint-disable-next-line */ }, [status, source, payment]);
  useEffect(() => { const t = setTimeout(load, 260); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  const setFilter = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    v === 'all' ? n.delete(k) : n.set(k, v);
    setParams(n, { replace: true });
  };

  const totals = useMemo(() => ({
    count: rows?.length || 0,
    value: (rows || []).reduce((a, r) => a + r.total, 0),
  }), [rows]);

  return (
    <div className="space-y-4">
      {/* filters */}
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
            <input className="field pl-9" placeholder="Search order number, company, contact or email"
              value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
          </div>
          <div className="flex gap-2">
            <select className="field sm:w-auto" value={source} onChange={(e) => setFilter('source', e.target.value)} aria-label="Source">
              {['all', 'website', 'phone', 'rep', 'walkin'].map((s) => <option key={s} value={s}>{s === 'all' ? 'All sources' : s}</option>)}
            </select>
            <select className="field sm:w-auto" value={payment} onChange={(e) => setFilter('payment', e.target.value)} aria-label="Payment">
              {['all', 'paid', 'deposit', 'unpaid'].map((s) => <option key={s} value={s}>{s === 'all' ? 'All payments' : s}</option>)}
            </select>
            <a className="btn-ghost btn-sm shrink-0" href={`${API_BASE}/api/os/reports/export.csv`} target="_blank" rel="noreferrer">
              <FileDown size={15} /> CSV
            </a>
          </div>
        </div>
        <div className="scroll-x -mx-1 px-1">
          <div className="flex gap-1.5 pb-1">
            {['all', ...STATUS_FLOW, 'cancelled'].map((s) => (
              <button key={s} className={`chip ${status === s ? 'chip-active' : ''}`} onClick={() => setFilter('status', s)}>
                {s === 'all' ? 'All statuses' : STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        {rows && (
          <p className="text-[12.5px] text-ink-500 tnum">
            {totals.count} order{totals.count === 1 ? '' : 's'} · {money(totals.value)} booked
          </p>
        )}
      </div>

      {/* list */}
      {rows === null ? <SkeletonRows rows={6} /> : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="No orders match these filters"
            body="Clear the filters, or fire Settings → Send test order to watch one land here."
            action={<button className="btn-ghost btn-sm" onClick={() => { setQ(''); setParams({}, { replace: true }); }}>Clear filters</button>} />
        </div>
      ) : (
        <>
          {/* mobile cards */}
          <ul className="md:hidden space-y-2.5">
            {rows.map((o) => {
              const Icon = SOURCE_ICON[o.source] || Store;
              return (
                <li key={o.id}>
                  <button className="card w-full text-left p-3.5" onClick={() => nav(`/orders/${o.id}`)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-[14px] truncate">{o.company || o.contact_name}</p>
                        <p className="text-[12px] text-ink-500 tnum">{o.order_number}</p>
                      </div>
                      <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2 flex-wrap text-[12px] text-ink-500">
                      <span className="inline-flex items-center gap-1"><Icon size={12} /> {o.source}</span>
                      <span>·</span><span className="tnum">due {dayDate(o.due_date)}</span>
                      {o.rush ? <Zap size={12} className="text-[#D6CB00]" /> : null}
                      <span className="ml-auto font-black text-ink text-[14px] tnum">{money(o.total)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* desktop table */}
          <div className="hidden md:block card overflow-hidden">
            <div className="scroll-x">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-paper-50 border-b border-ink-100 text-left">
                    {['Order', 'Customer', 'Status', 'Payment', 'Source', 'Due', 'Items', 'Total'].map((h) => (
                      <th key={h} className="px-3 py-2.5 label whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((o) => {
                    const Icon = SOURCE_ICON[o.source] || Store;
                    return (
                      <tr key={o.id} className="hover:bg-paper-50 cursor-pointer" onClick={() => nav(`/orders/${o.id}`)}>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className="font-bold tnum">{o.order_number}</span>
                          {o.rush ? <Zap size={12} className="inline ml-1.5 text-[#D6CB00]" /> : null}
                          <span className="block text-[11.5px] text-ink-500">{shortDate(o.created_at)}</span>
                        </td>
                        <td className="px-3 py-2.5 max-w-[220px]">
                          <span className="font-medium truncate block">{o.company || o.contact_name}</span>
                          <span className="text-[11.5px] text-ink-500 truncate block">{o.email}</span>
                        </td>
                        <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge></td>
                        <td className="px-3 py-2.5"><Badge tone={PAY_TONE[o.payment_status]}>{o.payment_status}</Badge></td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1.5 text-ink-500"><Icon size={13} /> {o.source}</span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap tnum">{dayDate(o.due_date)}</td>
                        <td className="px-3 py-2.5 tnum">{o.item_count}{o.open_tasks ? <span className="text-ink-300"> · {o.open_tasks} open</span> : null}</td>
                        <td className="px-3 py-2.5 font-black tnum whitespace-nowrap">{money(o.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <Drawer open={!!id} onClose={() => nav('/orders')} wide
        title={<><p className="label">Order detail</p><p className="font-black text-[15px] tnum">{(rows || []).find((r: any) => String(r.id) === String(id))?.order_number || 'Order'}</p></>}>
        {id && <OrderDetail id={Number(id)} onChanged={load} onDeleted={() => { nav('/orders'); load(); }} />}
      </Drawer>
    </div>
  );
}
