import { useEffect, useState } from 'react';
import { ArrowRight, Zap, GripVertical } from 'lucide-react';
import { get, money, patch, dayDate, STATUS_FLOW, STATUS_LABEL } from '../lib/api';
import { Badge, Drawer, Skeleton, useToast } from '../components/kit';
import OrderDetail from './OrderDetail';

const COL_ACCENT: Record<string, string> = {
  new: '#00AEEF', proof: '#EC008C', approved: '#D6CB00', print: '#1F2328',
  finishing: '#7C3AED', ready: '#059669', shipped: '#0F766E', completed: '#9AA1AA',
};

export default function Board() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const { toast } = useToast();

  const load = () => get('/api/os/orders?board=1').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); const t = setInterval(load, 25000); return () => clearInterval(t); }, []);

  async function move(id: number, status: string) {
    const card = rows?.find((r) => r.id === id);
    if (!card || card.status === status) return;
    setRows((r) => (r || []).map((x) => (x.id === id ? { ...x, status } : x))); // optimistic
    try { await patch(`/api/os/orders/${id}`, { status }); toast(`${card.order_number} → ${STATUS_LABEL[status]}`); load(); }
    catch (e: any) { toast(e.message || 'Move failed', 'err'); load(); }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h2 className="font-black text-[14px]">Shop floor</h2>
        <p className="mt-1 text-[13px] text-ink-500">
          Drag a job to the next stage — or tap a card and use the stage buttons. Every move writes a timeline event,
          closes the matching task and notifies the customer.
        </p>
      </div>

      {rows === null ? (
        <div className="scroll-x"><div className="flex gap-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[320px] w-[272px] shrink-0 rounded-xl" />)}</div></div>
      ) : (
        <div className="scroll-x pb-2 -mx-3 px-3 sm:mx-0 sm:px-0">
          <div className="flex gap-3 min-w-max">
            {STATUS_FLOW.map((s) => {
              const cards = rows.filter((r) => r.status === s);
              const value = cards.reduce((a, c) => a + c.total, 0);
              return (
                <section key={s}
                  onDragOver={(e) => { e.preventDefault(); setOver(s); }}
                  onDragLeave={() => setOver((o) => (o === s ? null : o))}
                  onDrop={(e) => { e.preventDefault(); setOver(null); if (drag) move(drag, s); setDrag(null); }}
                  className={`w-[280px] shrink-0 rounded-xl border bg-white flex flex-col max-h-[calc(100vh-230px)]
                    ${over === s ? 'border-[#00AEEF] ring-2 ring-[#00AEEF]/25' : 'border-ink-100'}`}>
                  <header className="px-3 py-2.5 border-b border-ink-100 sticky top-0 bg-white rounded-t-xl">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COL_ACCENT[s] }} />
                      <p className="font-black text-[13px]">{STATUS_LABEL[s]}</p>
                      <span className="ml-auto text-[12px] font-bold text-ink-500 tnum">{cards.length}</span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-ink-500 tnum">{money(value)}</p>
                  </header>
                  <div className="p-2 space-y-2 overflow-y-auto">
                    {cards.length === 0 && (
                      <p className="px-2 py-6 text-center text-[12px] text-ink-300">Empty stage</p>
                    )}
                    {cards.map((o) => (
                      <article key={o.id} draggable
                        onDragStart={() => setDrag(o.id)} onDragEnd={() => { setDrag(null); setOver(null); }}
                        className={`rounded-lg border border-ink-100 bg-white p-3 shadow-card hover:shadow-pop transition-shadow cursor-grab
                          ${drag === o.id ? 'opacity-50' : ''}`}>
                        <div className="flex items-start gap-2">
                          <GripVertical size={14} className="text-ink-300 mt-0.5 shrink-0" />
                          <button className="text-left min-w-0 flex-1" onClick={() => setOpenId(o.id)}>
                            <p className="font-bold text-[13px] truncate">{o.company || o.contact_name}</p>
                            <p className="text-[11.5px] text-ink-500 tnum">{o.order_number}</p>
                          </button>
                          {o.rush ? <Zap size={13} className="text-[#D6CB00] shrink-0" /> : null}
                        </div>
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <Badge>{o.source}</Badge>
                          <span className="text-[11.5px] text-ink-500 tnum">due {dayDate(o.due_date)}</span>
                          <span className="ml-auto text-[13px] font-black tnum">{money(o.total)}</span>
                        </div>
                        {STATUS_FLOW.indexOf(s) < STATUS_FLOW.length - 1 && (
                          <button className="btn-ghost btn-sm w-full mt-2.5 justify-between"
                            onClick={() => move(o.id, STATUS_FLOW[STATUS_FLOW.indexOf(s) + 1])}>
                            {STATUS_LABEL[STATUS_FLOW[STATUS_FLOW.indexOf(s) + 1]]} <ArrowRight size={13} />
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <Drawer open={openId !== null} onClose={() => setOpenId(null)} wide
        title={<><p className="label">Order detail</p><p className="font-black text-[15px]">Job ticket</p></>}>
        {openId !== null && <OrderDetail id={openId} onChanged={load} onDeleted={() => { setOpenId(null); load(); }} />}
      </Drawer>
    </div>
  );
}
