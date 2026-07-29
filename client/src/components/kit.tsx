import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { X, Check, AlertTriangle, Inbox, Loader2 } from 'lucide-react';

// ------------------------------------------------------------------ toasts
type Toast = { id: number; msg: string; tone: 'ok' | 'err' | 'info' };
const ToastCtx = createContext<{ toast: (msg: string, tone?: Toast['tone']) => void }>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((msg: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, msg, tone }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed z-[90] bottom-4 left-1/2 -translate-x-1/2 w-[min(94vw,420px)] flex flex-col gap-2 no-print">
        {items.map((t) => (
          <div key={t.id} role="status"
            className={`animate-in flex items-start gap-2.5 rounded-xl px-4 py-3 shadow-pop text-sm font-medium
              ${t.tone === 'err' ? 'bg-[#E11D2E] text-white' : t.tone === 'info' ? 'bg-ink text-white' : 'bg-white border border-ink-100 text-ink'}`}>
            <span className={`mt-0.5 ${t.tone === 'ok' ? 'text-[#059669]' : ''}`}>
              {t.tone === 'err' ? <AlertTriangle size={16} /> : <Check size={16} />}
            </span>
            <span className="flex-1">{t.msg}</span>
            <button aria-label="Dismiss" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}
              className="opacity-60 hover:opacity-100"><X size={15} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------------ pieces
export function Badge({ children, tone = 'bg-ink-100 text-ink-700 border-ink-100', className = '' }:
  { children: ReactNode; tone?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center h-6 px-2 rounded-md border text-[11px] font-bold uppercase tracking-[0.08em] whitespace-nowrap ${tone} ${className}`}>
      {children}
    </span>
  );
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonRows({ rows = 5, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-12 px-6">
      <div className="mx-auto mb-3 h-11 w-11 rounded-full bg-paper-100 grid place-items-center text-ink-300">
        {icon || <Inbox size={20} />}
      </div>
      <p className="font-bold">{title}</p>
      {body && <p className="mt-1 text-sm text-ink-500 max-w-sm mx-auto">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden />;
}

export function Drawer({ open, onClose, title, children, wide = false }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex justify-end no-print">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative bg-paper-50 h-full w-full ${wide ? 'sm:w-[720px]' : 'sm:w-[520px]'} shadow-pop flex flex-col animate-in`}>
        <div className="cmyk-rule cmyk-rule-thin" />
        <header className="flex items-start gap-3 justify-between px-4 sm:px-6 py-4 bg-white border-b border-ink-100">
          <div className="min-w-0">{title}</div>
          <button onClick={onClose} aria-label="Close" className="btn-ghost btn-sm shrink-0"><X size={16} /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel = 'Delete', onConfirm, onCancel }:
  { open: boolean; title: string; body?: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[95] grid place-items-center p-4 no-print">
      <div className="absolute inset-0 bg-ink/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-pop w-full max-w-sm p-5 animate-in">
        <p className="font-bold text-[15px]">{title}</p>
        {body && <p className="mt-1.5 text-sm text-ink-500">{body}</p>}
        <div className="mt-5 flex gap-2 justify-end">
          <button className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn-accent btn-sm" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label block mb-1.5">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-500">{hint}</span>}
    </label>
  );
}

export function KpiCard({ label, value, sub, accent = '#00AEEF' }:
  { label: string; value: ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="card p-4 relative overflow-hidden">
      <span className="absolute left-0 top-0 h-full w-[3px]" style={{ background: accent }} />
      <p className="label">{label}</p>
      <p className="mt-2 text-[26px] leading-none font-black tnum">{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-ink-500">{sub}</p>}
    </div>
  );
}
