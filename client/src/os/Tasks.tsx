import { useEffect, useMemo, useState } from 'react';
import { Plus, CheckCircle2, Trash2 } from 'lucide-react';
import { dayDate, del, get, patch, post } from '../lib/api';
import { Badge, Drawer, EmptyState, Field, SkeletonRows, useToast } from '../components/kit';

const TYPES = ['payment', 'proof', 'print', 'finishing', 'ship', 'followup'];
const TYPE_TONE: Record<string, string> = {
  payment: 'bg-[#E11D2E]/8 text-[#A5121F] border-[#E11D2E]/25',
  proof: 'bg-[#EC008C]/10 text-[#B00A6C] border-[#EC008C]/25',
  print: 'bg-[#00AEEF]/12 text-[#0475A0] border-[#00AEEF]/30',
  finishing: 'bg-[#7C3AED]/10 text-[#5B21B6] border-[#7C3AED]/25',
  ship: 'bg-[#0F766E]/10 text-[#0B5D57] border-[#0F766E]/25',
  followup: 'bg-[#FFF200]/25 text-[#7A6A00] border-[#D6CB00]/50',
};

export default function Tasks() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [type, setType] = useState('all');
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({ title: '', type: 'followup', due_date: new Date().toISOString().slice(0, 10), assigned_to: '' });
  const { toast } = useToast();

  const load = () => get('/api/os/tasks').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const list = useMemo(() => (rows || []).filter((t) =>
    (filter === 'all' || t.status === filter) && (type === 'all' || t.type === type)), [rows, filter, type]);

  const today = new Date(new Date().toDateString());
  const overdue = list.filter((t) => t.status === 'open' && new Date(t.due_date) < today).length;

  async function toggle(t: any) {
    try { await patch(`/api/os/tasks/${t.id}`, { status: t.status === 'open' ? 'done' : 'open' }); load(); }
    catch (e: any) { toast(e.message, 'err'); }
  }

  return (
    <div className="space-y-4">
      <div className="card p-3 sm:p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex gap-1.5">
          {(['open', 'done', 'all'] as const).map((f) => (
            <button key={f} className={`chip ${filter === f ? 'chip-active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <select className="field sm:w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Task type">
          {['all', ...TYPES].map((t) => <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>)}
        </select>
        <p className="text-[12.5px] text-ink-500 tnum sm:ml-2">
          {list.length} shown{overdue > 0 && <span className="text-dpred font-bold"> · {overdue} overdue</span>}
        </p>
        <button className="btn-primary btn-sm sm:ml-auto" onClick={() => setAdding(true)}><Plus size={15} /> New task</button>
      </div>

      {rows === null ? <SkeletonRows rows={7} /> : list.length === 0 ? (
        <div className="card"><EmptyState icon={<CheckCircle2 size={20} />} title="Nothing here" body="No tasks match this filter — the floor is clear." /></div>
      ) : (
        <ul className="space-y-2">
          {list.map((t) => {
            const late = t.status === 'open' && new Date(t.due_date) < today;
            return (
              <li key={t.id} className="card p-3.5 flex items-start gap-3">
                <button onClick={() => toggle(t)} aria-label={t.status === 'open' ? `Complete ${t.title}` : `Reopen ${t.title}`}
                  className={`mt-0.5 h-[20px] w-[20px] rounded border-2 shrink-0 grid place-items-center
                    ${t.status === 'done' ? 'bg-ink border-ink text-white' : 'border-ink-300 hover:border-ink'}`}>
                  {t.status === 'done' && <CheckCircle2 size={13} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-[14px] leading-snug ${t.status === 'done' ? 'line-through text-ink-300' : 'font-bold'}`}>{t.title}</p>
                  <p className="mt-0.5 text-[12px] text-ink-500 tnum">
                    {t.order_number ? `${t.order_number} · ${t.company || t.contact_name || ''}` : 'Shop task'} · {t.assigned_to || 'unassigned'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <Badge tone={TYPE_TONE[t.type]}>{t.type}</Badge>
                  <span className={`text-[11.5px] tnum ${late ? 'text-dpred font-bold' : 'text-ink-500'}`}>{dayDate(t.due_date)}</span>
                </div>
                <button className="btn-ghost btn-sm px-2 text-dpred" aria-label={`Delete ${t.title}`}
                  onClick={async () => { await del(`/api/os/tasks/${t.id}`); toast('Task deleted'); load(); }}>
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Drawer open={adding} onClose={() => setAdding(false)}
        title={<><p className="label">New</p><p className="font-black text-[15px]">Add task</p></>}>
        <div className="space-y-3">
          <Field label="Title *"><input className="field" value={nf.title} onChange={(e) => setNf((f) => ({ ...f, title: e.target.value }))} /></Field>
          <Field label="Type">
            <select className="field" value={nf.type} onChange={(e) => setNf((f) => ({ ...f, type: e.target.value }))}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Due date"><input className="field" type="date" value={nf.due_date} onChange={(e) => setNf((f) => ({ ...f, due_date: e.target.value }))} /></Field>
          <Field label="Assigned to"><input className="field" placeholder="Evie Lundberg" value={nf.assigned_to} onChange={(e) => setNf((f) => ({ ...f, assigned_to: e.target.value }))} /></Field>
          <button className="btn-primary w-full" onClick={async () => {
            if (!nf.title.trim()) { toast('Give the task a title', 'err'); return; }
            try { await post('/api/os/tasks', nf); toast('Task created'); setAdding(false); setNf({ ...nf, title: '' }); load(); }
            catch (e: any) { toast(e.message, 'err'); }
          }}>Create task</button>
        </div>
      </Drawer>
    </div>
  );
}
