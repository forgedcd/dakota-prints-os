import { useEffect, useMemo, useState } from 'react';
import { Mail, MessageSquare, Send } from 'lucide-react';
import { fullDate, get, post } from '../lib/api';
import { Badge, Drawer, EmptyState, Field, SkeletonRows, useToast } from '../components/kit';

export default function Messages() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [channel, setChannel] = useState('all');
  const [q, setQ] = useState('');
  const [compose, setCompose] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [nf, setNf] = useState({ customer_id: '', channel: 'email', subject: '', body: '' });
  const { toast } = useToast();

  const load = () => get('/api/os/messages').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); get('/api/os/customers').then(setCustomers).catch(() => {}); }, []);

  const list = useMemo(() => (rows || []).filter((m) =>
    (channel === 'all' || m.channel === channel) &&
    (!q.trim() || `${m.company} ${m.contact_name} ${m.subject} ${m.body}`.toLowerCase().includes(q.toLowerCase()))), [rows, channel, q]);

  return (
    <div className="space-y-4">
      <div className="card p-3 sm:p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <input className="field sm:max-w-xs" placeholder="Search messages" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search messages" />
        <div className="flex gap-1.5">
          {['all', 'email', 'sms'].map((c) => (
            <button key={c} className={`chip ${channel === c ? 'chip-active' : ''}`} onClick={() => setChannel(c)}>{c}</button>
          ))}
        </div>
        <button className="btn-primary btn-sm sm:ml-auto" onClick={() => setCompose(true)}><Send size={15} /> Compose</button>
      </div>

      <div className="card p-3.5 bg-paper-50 text-[12.5px] text-ink-500">
        Outbound mail and SMS are logged here and stubbed in code — the <span className="font-mono">logMessage()</span> service
        is where Resend (email) and Twilio (SMS) plug in. Nothing leaves the building in the prototype.
      </div>

      {rows === null ? <SkeletonRows rows={6} /> : list.length === 0 ? (
        <div className="card"><EmptyState icon={<Mail size={20} />} title="No messages" body="Send a proof or pickup notice from an order to see it logged here." /></div>
      ) : (
        <ul className="space-y-2.5">
          {list.map((m) => (
            <li key={m.id} className="card p-3.5">
              <div className="flex flex-wrap items-start gap-2 justify-between">
                <div className="min-w-0">
                  <p className="font-bold text-[13.5px] truncate">{m.company || m.contact_name || 'Customer'}</p>
                  <p className="text-[12px] text-ink-500 truncate">{m.email}{m.order_number ? ` · ${m.order_number}` : ''}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge tone={m.channel === 'sms' ? 'bg-[#00AEEF]/12 text-[#0475A0] border-[#00AEEF]/30' : ''}>
                    {m.channel === 'sms' ? <MessageSquare size={11} className="mr-1" /> : <Mail size={11} className="mr-1" />}{m.channel}
                  </Badge>
                  {m.template && <Badge>{m.template}</Badge>}
                  <span className="text-[11.5px] text-ink-500">{fullDate(m.created_at)}</span>
                </div>
              </div>
              {m.subject && <p className="mt-2 text-[13.5px] font-bold">{m.subject}</p>}
              <p className="mt-1 text-[13px] text-ink-700 whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
      )}

      <Drawer open={compose} onClose={() => setCompose(false)}
        title={<><p className="label">Outbound</p><p className="font-black text-[15px]">Compose message</p></>}>
        <div className="space-y-3">
          <Field label="Customer">
            <select className="field" value={nf.customer_id} onChange={(e) => setNf((f) => ({ ...f, customer_id: e.target.value }))}>
              <option value="">Select a customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.company || c.contact_name}</option>)}
            </select>
          </Field>
          <Field label="Channel">
            <select className="field" value={nf.channel} onChange={(e) => setNf((f) => ({ ...f, channel: e.target.value }))}>
              <option value="email">Email</option><option value="sms">SMS</option>
            </select>
          </Field>
          {nf.channel === 'email' && (
            <Field label="Subject"><input className="field" value={nf.subject} onChange={(e) => setNf((f) => ({ ...f, subject: e.target.value }))} /></Field>
          )}
          <Field label="Message">
            <textarea className="field min-h-[140px] py-2.5" value={nf.body} onChange={(e) => setNf((f) => ({ ...f, body: e.target.value }))} />
          </Field>
          <button className="btn-primary w-full" onClick={async () => {
            if (!nf.customer_id || !nf.body.trim()) { toast('Pick a customer and write a message', 'err'); return; }
            try {
              await post('/api/os/messages', { ...nf, customer_id: Number(nf.customer_id) });
              toast('Message logged for delivery');
              setCompose(false); setNf({ customer_id: '', channel: 'email', subject: '', body: '' }); load();
            } catch (e: any) { toast(e.message, 'err'); }
          }}>Send message</button>
        </div>
      </Drawer>
    </div>
  );
}
