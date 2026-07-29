import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { Globe, Zap, ArrowRight, AlertTriangle, CheckSquare } from 'lucide-react';
import { get, money, shortDate, dayDate, STATUS_LABEL, STATUS_TONE, CHART_COLORS, patch } from '../lib/api';
import { Badge, EmptyState, KpiCard, Skeleton, SkeletonRows, useToast } from '../components/kit';

export default function Dashboard() {
  const [d, setD] = useState<any | null>(null);
  const { toast } = useToast();
  const load = () => get('/api/os/dashboard').then(setD).catch(() => setD({} as any));
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, []);

  if (!d) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[96px] rounded-xl" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]"><Skeleton className="h-[280px] rounded-xl" /><SkeletonRows rows={4} /></div>
      </div>
    );
  }

  const k = d.kpi || {};
  const weeks = (d.revenueByWeek || []).map((r: any) => ({ ...r, label: shortDate(r.start) }));

  async function completeTask(id: number) {
    try { await patch(`/api/os/tasks/${id}`, { status: 'done' }); toast('Task marked done'); load(); }
    catch (e: any) { toast(e.message, 'err'); }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Open orders" value={k.open_orders ?? 0} sub="In production or awaiting proof" accent="#00AEEF" />
        <KpiCard label="Due in 7 days" value={k.due_this_week ?? 0} sub="Promised delivery this week" accent="#EC008C" />
        <KpiCard label="Revenue this month" value={money(k.revenue_month)} sub="All sources, excl. cancelled" accent="#1F2328" />
        <KpiCard label="Unpaid balance" value={money(k.unpaid_balance)} sub="Invoices + deposits outstanding" accent="#E11D2E" />
        <KpiCard label="Rush jobs" value={k.rush_jobs ?? 0} sub="Open jobs flagged rush" accent="#D6CB00" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr] items-start">
        {/* website order feed — the bridge in action */}
        <section className="card overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-3.5 border-b border-ink-100">
            <Globe size={16} className="text-[#00AEEF]" />
            <h2 className="font-black text-[14px]">Website order feed</h2>
            <span className="label ml-1">dakotaprints.com → OS</span>
            <Link to="/orders?source=website" className="ml-auto text-[12.5px] font-bold text-ink-500 hover:text-ink">All →</Link>
          </header>
          {(d.websiteFeed || []).length === 0 ? (
            <EmptyState icon={<Globe size={20} />} title="No website orders yet"
              body="Use Settings → Send test order to fire the intake webhook — it lands here instantly." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {d.websiteFeed.map((o: any) => (
                <li key={o.id}>
                  <Link to={`/orders/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper-50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-bold truncate">{o.company || o.contact_name}</p>
                      <p className="text-[12px] text-ink-500 tnum">{o.order_number} · {shortDate(o.created_at)}</p>
                    </div>
                    {o.rush ? <Zap size={14} className="text-[#D6CB00] shrink-0" /> : null}
                    <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                    <span className="text-[13.5px] font-black tnum w-[86px] text-right">{money(o.total)}</span>
                    <ArrowRight size={15} className="text-ink-300 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* today's tasks */}
        <section className="card overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-3.5 border-b border-ink-100">
            <CheckSquare size={16} className="text-[#EC008C]" />
            <h2 className="font-black text-[14px]">Due today &amp; overdue</h2>
            <Link to="/tasks" className="ml-auto text-[12.5px] font-bold text-ink-500 hover:text-ink">All →</Link>
          </header>
          {(d.tasksToday || []).length === 0 ? (
            <EmptyState icon={<CheckSquare size={20} />} title="Nothing overdue" body="Every task on the floor is scheduled ahead." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {d.tasksToday.map((t: any) => (
                <li key={t.id} className="px-4 py-3 flex items-start gap-3">
                  <button className="mt-0.5 h-[18px] w-[18px] rounded border-2 border-ink-300 hover:border-ink shrink-0"
                    onClick={() => completeTask(t.id)} aria-label={`Complete ${t.title}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-bold leading-snug">{t.title}</p>
                    <p className="text-[12px] text-ink-500 tnum">
                      {t.order_number || 'Shop task'} · due {dayDate(t.due_date)} · {t.assigned_to || 'unassigned'}
                    </p>
                  </div>
                  <Badge tone={new Date(t.due_date) < new Date(new Date().toDateString()) ? 'bg-[#E11D2E]/8 text-[#A5121F] border-[#E11D2E]/25' : ''}>
                    {t.type}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr] items-start">
        <section className="card p-4">
          <h2 className="font-black text-[14px]">Revenue by week</h2>
          <p className="label mt-0.5">Last 10 weeks · all sources</p>
          <div className="mt-4 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeks} margin={{ left: -18, right: 4, top: 6, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#E3E5E8" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#5C636D' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#5C636D' }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: any) => money(v)} contentStyle={{ borderRadius: 10, border: '1px solid #E3E5E8', fontSize: 12 }} />
                <Bar dataKey="total" fill="#00AEEF" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="font-black text-[14px]">Revenue by department</h2>
          <p className="label mt-0.5">All time</p>
          <div className="mt-2 h-[190px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={d.byCategory || []} dataKey="total" nameKey="category" innerRadius={44} outerRadius={72} paddingAngle={2}>
                  {(d.byCategory || []).map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => money(v)} contentStyle={{ borderRadius: 10, border: '1px solid #E3E5E8', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-1 space-y-1.5">
            {(d.byCategory || []).map((c: any, i: number) => (
              <li key={c.category} className="flex items-center gap-2 text-[12.5px]">
                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="flex-1 truncate">{c.category}</span>
                <span className="font-bold tnum">{money(c.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr] items-start">
        <section className="card p-4 min-w-0">
          <h2 className="font-black text-[14px]">Board snapshot</h2>
          <p className="label mt-0.5">Orders per stage</p>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(d.boardCounts || {}).map(([s, n]: any) => (
              <Link key={s} to="/board" className="min-w-0 rounded-lg border border-ink-100 px-3 py-2.5 hover:border-ink-300 transition-colors">
                <p className="text-[19px] font-black tnum leading-none">{n}</p>
                <p className="mt-1 label truncate">{STATUS_LABEL[s]}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="card p-4 min-w-0">
          <h2 className="font-black text-[14px] flex items-center gap-2">
            <AlertTriangle size={15} className="text-[#D6CB00]" /> Blank stock watch
          </h2>
          <p className="label mt-0.5">Reorder point {d.threshold}</p>
          <ul className="mt-3 divide-y divide-ink-100">
            {(d.lowStock || []).slice(0, 6).map((p: any) => (
              <li key={p.id} className="py-2 flex items-center gap-2.5 min-w-0">
                <span className="min-w-0 flex-1 text-[13px] font-bold truncate">{p.name}</span>
                <span className="text-[12px] text-ink-500 tnum shrink-0">{p.sku}</span>
                <Badge className="shrink-0 whitespace-nowrap" tone={p.stock <= d.threshold ? 'bg-[#E11D2E]/8 text-[#A5121F] border-[#E11D2E]/25' : ''}>{p.stock} on hand</Badge>
              </li>
            ))}
            {(d.lowStock || []).length === 0 && <li className="py-4 text-[13px] text-ink-500">Every blank is above its reorder point.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
