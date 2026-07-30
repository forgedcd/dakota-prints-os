import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ClipboardList, KanbanSquare, Users, Package, CheckSquare,
  MessageSquare, BarChart3, Settings as SettingsIcon, Menu, X, Bell, LogOut, Webhook,
} from 'lucide-react';
import { DakotaLockup, DakotaMark } from '../components/brand';
import { get, post, shortDate } from '../lib/api';
import { useAuth } from '../lib/store';
import { Badge } from '../components/kit';

const NAV: { to: string; label: string; icon: any; end?: boolean }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/orders', label: 'Orders', icon: ClipboardList },
  { to: '/board', label: 'Fulfillment', icon: KanbanSquare },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/messages', label: 'Messages', icon: MessageSquare },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export default function OSLayout() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<any[]>([]);
  const [bell, setBell] = useState(false);

  useEffect(() => { setOpen(false); setBell(false); }, [pathname]);
  useEffect(() => {
    const load = () => get('/api/os/notifications').then(setNotes).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  const unread = notes.filter((n) => !n.read).length;
  const title = NAV.find((n) => pathname.startsWith(n.to))?.label || 'Dashboard';

  const NavList = ({ onClick }: { onClick?: () => void }) => (
    <nav className="px-2 py-3 space-y-0.5">
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end ?? false} onClick={onClick}
          className={({ isActive }) => `relative flex items-center gap-2.5 min-h-[44px] px-3 rounded-lg text-[13.5px] font-bold transition-colors
            ${isActive ? 'bg-paper-100 text-ink' : 'text-ink-500 hover:text-ink hover:bg-paper-50'}`}>
          {({ isActive }: any) => (
            <>
              {isActive && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-dpred" />}
              <n.icon size={17} className="shrink-0" />
              {n.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-paper-50 flex">
      {/* desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-[232px] shrink-0 bg-white border-r border-ink-100 sticky top-0 h-screen">
        <div className="px-4 pt-5 pb-4 border-b border-ink-100 bg-white">
          {/* real lockup, 168px wide on a white surface */}
          <Link to="/dashboard" className="block" aria-label="Dakota Prints OS — dashboard">
            <DakotaLockup width={168} priority />
          </Link>
          <p className="mt-2.5 label">Operating System</p>
        </div>
        <div className="flex-1 overflow-y-auto"><NavList /></div>
        <div className="p-3 border-t border-ink-100">
          <Link to="/settings" className="btn-ghost btn-sm w-full justify-start"><Webhook size={14} /> Website integration</Link>
          <div className="mt-2 flex items-center gap-2.5 px-1 py-2">
            <span className="h-8 w-8 rounded-full bg-ink text-white grid place-items-center text-[12px] font-black shrink-0">
              {(user?.name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('')}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold truncate">{user?.name}</p>
              <p className="text-[11px] text-ink-500 uppercase tracking-[0.1em]">{user?.role}</p>
            </div>
            <button className="btn-ghost btn-sm px-2" aria-label="Sign out"
              onClick={async () => { await signOut(); nav('/login', { replace: true }); }}>
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-[70] flex">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="relative bg-white w-[260px] h-full flex flex-col animate-in">
            <div className="px-4 pt-4 pb-3 border-b border-ink-100 flex items-center justify-between">
              <DakotaLockup width={132} />
              <button className="btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close menu"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto"><NavList onClick={() => setOpen(false)} /></div>
            <div className="p-3 border-t border-ink-100 space-y-2">
              <Link to="/settings" className="btn-ghost btn-sm w-full justify-start"><Webhook size={14} /> Website integration</Link>
              <button className="btn-ghost btn-sm w-full justify-start"
                onClick={async () => { await signOut(); nav('/login', { replace: true }); }}><LogOut size={14} /> Sign out</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-ink-100">
          <div className="h-[60px] px-3 sm:px-5 flex items-center gap-3">
            <button className="lg:hidden btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
            <div className="lg:hidden shrink-0"><DakotaMark width={88} /></div>
            <h1 className="font-black text-[15px] sm:text-[17px] truncate">{title}</h1>
            <div className="flex-1" />
            <div className="relative">
              <button className="btn-ghost btn-sm relative" onClick={() => setBell((v) => !v)} aria-label="Notifications" aria-expanded={bell}>
                <Bell size={16} />
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-dpred text-white text-[10px] font-bold grid place-items-center tnum">
                    {unread}
                  </span>
                )}
              </button>
              {bell && (
                <div className="absolute right-0 mt-2 w-[min(92vw,360px)] card p-0 overflow-hidden shadow-pop animate-in z-50">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100">
                    <p className="label">Notifications</p>
                    <button className="text-[12px] font-bold text-ink-500 hover:text-ink"
                      onClick={async () => { await post('/api/os/notifications/read', {}); setNotes((n) => n.map((x) => ({ ...x, read: 1 }))); }}>
                      Mark all read
                    </button>
                  </div>
                  <ul className="max-h-[60vh] overflow-y-auto divide-y divide-ink-100">
                    {notes.length === 0 && <li className="px-4 py-6 text-[13px] text-ink-500">Nothing new — the shop floor is quiet.</li>}
                    {notes.slice(0, 12).map((n) => (
                      <li key={n.id} className={`px-4 py-3 ${n.read ? '' : 'bg-paper-50'}`}>
                        <div className="flex items-start gap-2 justify-between">
                          <p className="text-[13.5px] font-bold leading-snug">{n.title}</p>
                          {!n.read && <span className="mt-1 h-2 w-2 rounded-full bg-dpred shrink-0" />}
                        </div>
                        {n.body && <p className="mt-0.5 text-[12.5px] text-ink-500">{n.body}</p>}
                        <p className="mt-1 text-[11px] text-ink-300">{shortDate(n.created_at)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <Badge className="hidden sm:inline-flex">{user?.role}</Badge>
          </div>
          <div className="cmyk-rule cmyk-rule-thin" />
        </header>

        <main className="flex-1 p-3 sm:p-5 lg:p-6 max-w-[1400px] w-full"><Outlet /></main>
      </div>
    </div>
  );
}
