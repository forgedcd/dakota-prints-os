// Printable job ticket + packing slip. Rendered outside the OS chrome so the
// page prints clean on 8.5x11. The real lockup heads both documents.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { CmykRule, DakotaLockup } from '../components/brand';
import { get, money, dayDate, fullDate, STATUS_LABEL } from '../lib/api';
import { cleanLabel } from '../lib/pricing';
import { Skeleton } from '../components/kit';

export default function JobTicket() {
  const { id } = useParams();
  const [o, setO] = useState<any>(null);
  const [shop, setShop] = useState<any>({});
  const [err, setErr] = useState('');

  useEffect(() => {
    get(`/api/os/orders/${id}`).then(setO).catch((e) => setErr(e.message || 'Order not found'));
    get('/api/os/settings').then(setShop).catch(() => {});
  }, [id]);

  if (err) return (
    <div className="min-h-screen grid place-items-center p-6 text-center">
      <div>
        <p className="label text-dpred">Job ticket</p>
        <h1 className="mt-2 text-[22px] font-black">{err}</h1>
        <Link className="btn-ghost btn-sm mt-4" to="/orders"><ArrowLeft size={14} /> Back to orders</Link>
      </div>
    </div>
  );
  if (!o) return <div className="p-6 space-y-3 max-w-[820px] mx-auto"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;

  const c = o.customer || {};
  const shipTo = [c.address, [c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean);

  const Header = ({ kind }: { kind: string }) => (
    <div className="border-b border-ink-100 pb-4">
      <div className="flex items-start justify-between gap-4">
        <DakotaLockup width={210} priority />
        <div className="text-right">
          <p className="label">{kind}</p>
          <p className="mt-1 text-[19px] font-black tnum leading-none">{o.order_number}</p>
          <p className="mt-1.5 text-[12px] text-ink-500">
            {STATUS_LABEL[o.status]} · {o.payment_status.toUpperCase()}{o.rush ? ' · RUSH' : ''}
          </p>
        </div>
      </div>
      <CmykRule className="cmyk-rule-thin mt-4" />
    </div>
  );

  const Meta = () => (
    <div className="grid sm:grid-cols-3 gap-x-6 gap-y-4 mt-5 text-[12.5px]">
      <div>
        <p className="label">Customer</p>
        <p className="mt-1.5 font-bold text-[13.5px]">{c.company || c.contact_name}</p>
        {c.company && c.contact_name && <p className="text-ink-500">{c.contact_name}</p>}
        <p className="text-ink-500 break-words">{c.email}</p>
        <p className="text-ink-500">{c.phone}</p>
      </div>
      <div>
        <p className="label">{o.fulfillment === 'pickup' ? 'Pickup' : 'Ship to'}</p>
        {o.fulfillment === 'pickup'
          ? <p className="mt-1.5 text-ink-500">Counter pickup — {shop.shop_address}</p>
          : <p className="mt-1.5 text-ink-500 whitespace-pre-line">{shipTo.join('\n') || '—'}</p>}
        {o.tracking_number && <p className="mt-1 font-mono text-[12px]">Tracking {o.tracking_number}</p>}
      </div>
      <div>
        <p className="label">Schedule</p>
        <dl className="mt-1.5 space-y-0.5 text-ink-500">
          <div className="flex justify-between gap-3"><dt>Received</dt><dd className="tnum text-ink">{dayDate(o.created_at)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Due</dt><dd className="tnum font-bold text-ink">{dayDate(o.due_date)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Source</dt><dd className="text-ink capitalize">{o.source}</dd></div>
          {o.po_number && <div className="flex justify-between gap-3"><dt>PO</dt><dd className="text-ink">{o.po_number}</dd></div>}
        </dl>
      </div>
    </div>
  );

  const Lines = ({ withPrice }: { withPrice: boolean }) => (
    <table className="w-full mt-5 text-[12.5px] border-t border-ink-100">
      <thead>
        <tr className="text-left text-ink-500">
          <th className="py-2 font-bold uppercase tracking-[0.1em] text-[10.5px]">Item &amp; specs</th>
          <th className="py-2 w-[70px] text-right font-bold uppercase tracking-[0.1em] text-[10.5px]">Qty</th>
          {withPrice && <>
            <th className="py-2 w-[80px] text-right font-bold uppercase tracking-[0.1em] text-[10.5px]">Unit</th>
            <th className="py-2 w-[90px] text-right font-bold uppercase tracking-[0.1em] text-[10.5px]">Total</th>
          </>}
          {!withPrice && <th className="py-2 w-[90px] text-right font-bold uppercase tracking-[0.1em] text-[10.5px]">Packed</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-ink-100 align-top">
        {(o.items || []).map((it: any) => (
          <tr key={it.id}>
            <td className="py-2.5 pr-3">
              <p className="font-bold text-[13px]">{it.name}</p>
              {it.spec && Object.keys(it.spec).length > 0 && (
                <ul className="mt-1 grid gap-0.5 text-ink-500">
                  {Object.entries(it.spec).map(([k, v]: any) => (
                    <li key={k}>
                      <span className="uppercase tracking-[0.08em] text-[10.5px] text-ink-300">{k.replace(/_/g, ' ')}:</span>{' '}
                      {typeof v === 'object' && v !== null
                        ? Object.entries(v).map(([sk, sv]) => `${sk} ${sv}`).join(' · ')
                        : cleanLabel(String(v))}
                    </li>
                  ))}
                </ul>
              )}
              {it.design_service ? (
                <div className="mt-1.5 border-l-2 border-[#EC008C] pl-2">
                  <p className="uppercase tracking-[0.08em] text-[10px] font-bold text-[#B00A6C]">Design it for me — brief</p>
                  <p className="text-[12px] whitespace-pre-line">{it.design_brief || 'No brief supplied — call the customer before starting art.'}</p>
                </div>
              ) : null}
              {it.files?.length ? (
                <ul className="mt-1.5 text-ink-500">
                  <li className="uppercase tracking-[0.08em] text-[10px] font-bold text-ink-300">Attached files</li>
                  {it.files.map((f: any) => (
                    <li key={f.id || f.url} className="font-mono text-[11px]">
                      {f.kind}: {f.filename || f.url.split('/').pop()}
                    </li>
                  ))}
                </ul>
              ) : null}
            </td>
            <td className="py-2.5 text-right tnum font-bold">{it.qty}</td>
            {withPrice ? <>
              <td className="py-2.5 text-right tnum">{money(it.unit_price)}</td>
              <td className="py-2.5 text-right tnum font-bold">{money(it.line_total)}</td>
            </> : <td className="py-2.5 text-right text-ink-300">☐</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );

  const Totals = () => (
    <div className="mt-4 flex justify-end">
      <dl className="w-full sm:w-[260px] text-[12.5px] space-y-1">
        <div className="flex justify-between"><dt className="text-ink-500">Subtotal</dt><dd className="tnum">{money(o.subtotal)}</dd></div>
        {o.rush_fee > 0 && <div className="flex justify-between"><dt className="text-ink-500">Rush fee</dt><dd className="tnum">{money(o.rush_fee)}</dd></div>}
        <div className="flex justify-between"><dt className="text-ink-500">{o.fulfillment === 'pickup' ? 'Pickup' : 'Shipping'}</dt><dd className="tnum">{money(o.shipping)}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-500">Tax</dt><dd className="tnum">{money(o.tax)}</dd></div>
        <div className="flex justify-between border-t border-ink-100 pt-1.5 font-black text-[15px]"><dt>Total</dt><dd className="tnum">{money(o.total)}</dd></div>
      </dl>
    </div>
  );

  return (
    <div className="min-h-screen bg-paper-50 print:bg-white">
      <div className="no-print sticky top-0 z-30 bg-white border-b border-ink-100">
        <div className="max-w-[860px] mx-auto px-4 h-[60px] flex items-center gap-3">
          <Link className="btn-ghost btn-sm" to={`/orders/${o.id}`}><ArrowLeft size={14} /> Back</Link>
          <p className="text-[13.5px] font-bold truncate">Job ticket · {o.order_number}</p>
          <div className="flex-1" />
          <button className="btn-primary btn-sm" onClick={() => window.print()}><Printer size={15} /> Print</button>
        </div>
        <CmykRule className="cmyk-rule-thin" />
      </div>

      <div className="max-w-[860px] mx-auto p-4 sm:p-6 space-y-5 print:p-0 print:space-y-0">
        {/* ------------------------------------------------ job ticket */}
        <section className="bg-white border border-ink-100 rounded-xl p-5 sm:p-7 print:border-0 print:rounded-none print:p-0 print:break-after-page">
          <Header kind="Production job ticket" />
          <Meta />
          <Lines withPrice />
          <Totals />
          {(o.items || []).some((i: any) => i.design_service) && (
            <div className="mt-5 border-2 border-[#EC008C] rounded-lg p-3.5">
              <p className="label text-[#B00A6C]">Art department first — customer requested a design</p>
              <ul className="mt-1.5 space-y-1 text-[12.5px]">
                {(o.items || []).filter((i: any) => i.design_service).map((i: any) => (
                  <li key={i.id}><strong>{i.name}:</strong> {i.design_brief || 'no brief supplied'}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11.5px] text-ink-500">
                Files attached: {(o.items || []).reduce((n: number, i: any) => n + (i.files?.length || 0), 0)}
              </p>
            </div>
          )}
          {o.notes && (
            <div className="mt-5 border border-ink-100 rounded-lg p-3.5">
              <p className="label">Shop notes</p>
              <p className="mt-1 text-[12.5px] whitespace-pre-line">{o.notes}</p>
            </div>
          )}
          <div className="mt-5 grid sm:grid-cols-3 gap-3 text-[11px]">
            {['Proofed by / date', 'Printed by / date', 'QC + packed by / date'].map((l) => (
              <div key={l} className="border border-ink-100 rounded-lg px-3 pt-2 pb-6">
                <p className="label text-[9.5px]">{l}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[10.5px] text-ink-300">
            {shop.shop_name} · {shop.shop_address} · {shop.shop_phone} · printed {fullDate(new Date().toISOString())}
          </p>
        </section>

        {/* ---------------------------------------------- packing slip */}
        <section className="bg-white border border-ink-100 rounded-xl p-5 sm:p-7 print:border-0 print:rounded-none print:p-0">
          <Header kind="Packing slip" />
          <Meta />
          <Lines withPrice={false} />
          <p className="mt-6 text-[12px] text-ink-500">
            Short something or see a defect? Call {shop.shop_phone} within 5 business days and we will make it right.
          </p>
          <p className="mt-3 text-[10.5px] text-ink-300">
            {shop.shop_name} · {shop.shop_address} · {shop.shop_email}
          </p>
        </section>
      </div>
    </div>
  );
}
