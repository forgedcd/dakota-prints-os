import { useEffect, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FileDown } from 'lucide-react';
import { API_BASE, CHART_COLORS, get, money } from '../lib/api';
import { KpiCard, Skeleton } from '../components/kit';

const monthLabel = (m: string) => {
  const [y, mm] = m.split('-');
  return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

export default function Reports() {
  const [d, setD] = useState<any | null>(null);
  useEffect(() => { get('/api/os/reports').then(setD).catch(() => setD({})); }, []);

  if (!d) {
    return <div className="grid gap-4 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[240px] rounded-xl" />)}</div>;
  }

  const months = (d.byMonth || []).map((m: any) => ({ ...m, label: monthLabel(m.month) }));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Revenue booked" value={money(d.total_revenue)} sub="All time, excl. cancelled" accent="#1F2328" />
        <KpiCard label="Avg turnaround" value={`${d.avg_turnaround} d`} sub="Order placed → shipped/completed" accent="#00AEEF" />
        <KpiCard label="Rush share" value={`${d.rush_pct}%`} sub="Orders flagged rush" accent="#E11D2E" />
        <KpiCard label="Orders" value={(d.byMonth || []).reduce((a: number, b: any) => a + b.orders, 0)} sub="Lifetime order count" accent="#EC008C" />
      </div>

      <div className="flex justify-end">
        <a className="btn-ghost btn-sm" href={`${API_BASE}/api/os/reports/export.csv`} target="_blank" rel="noreferrer">
          <FileDown size={15} /> Export orders CSV
        </a>
      </div>

      <section className="card p-4">
        <h2 className="font-black text-[14px]">Revenue by month</h2>
        <div className="mt-4 h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={months} margin={{ left: -14, right: 6, top: 6, bottom: 0 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00AEEF" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#00AEEF" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="#E3E5E8" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#5C636D' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#5C636D' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: any) => money(v)} contentStyle={{ borderRadius: 10, border: '1px solid #E3E5E8', fontSize: 12 }} />
              <Area type="monotone" dataKey="revenue" stroke="#00AEEF" strokeWidth={2} fill="url(#rev)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="font-black text-[14px]">Revenue by department</h2>
          <div className="mt-3 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.byCategory || []} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#E3E5E8" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#5C636D' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                <YAxis type="category" dataKey="category" width={104} tick={{ fontSize: 11, fill: '#1F2328' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: any) => money(v)} contentStyle={{ borderRadius: 10, border: '1px solid #E3E5E8', fontSize: 12 }} />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                  {(d.byCategory || []).map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="font-black text-[14px]">Orders by source</h2>
          <div className="mt-3 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={d.bySource || []} dataKey="orders" nameKey="source" innerRadius={52} outerRadius={86} paddingAngle={2} label={(e: any) => e.source}>
                  {(d.bySource || []).map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #E3E5E8', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-1 grid grid-cols-2 gap-1.5">
            {(d.bySource || []).map((s: any, i: number) => (
              <li key={s.source} className="flex items-center gap-2 text-[12.5px]">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="flex-1 truncate">{s.source}</span>
                <span className="font-bold tnum">{money(s.revenue)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { title: 'Top products', rows: d.topProducts || [], key: 'name', extra: (r: any) => `${r.qty} pcs` },
          { title: 'Top customers', rows: d.topCustomers || [], key: 'company', extra: (r: any) => `${r.orders} orders` },
        ].map((t) => (
          <section key={t.title} className="card overflow-hidden">
            <header className="px-4 py-3 border-b border-ink-100"><h2 className="font-black text-[14px]">{t.title}</h2></header>
            <ul className="divide-y divide-ink-100">
              {t.rows.map((r: any, i: number) => (
                <li key={i} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="w-5 text-[12px] font-black text-ink-300 tnum">{i + 1}</span>
                  <span className="min-w-0 flex-1 text-[13px] font-medium truncate">{r[t.key] || r.contact_name || r.name}</span>
                  <span className="text-[11.5px] text-ink-500 tnum">{t.extra(r)}</span>
                  <span className="text-[13px] font-black tnum w-[86px] text-right">{money(r.revenue)}</span>
                </li>
              ))}
              {t.rows.length === 0 && <li className="px-4 py-6 text-[13px] text-ink-500">No data yet.</li>}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
