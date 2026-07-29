import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Webhook, LayoutDashboard, ClipboardCheck } from 'lucide-react';
import { CmykRule, DakotaLockup } from '../components/brand';
import { Field, Spinner, useToast } from '../components/kit';
import { useAuth } from '../lib/store';

const DEMO = [
  { label: 'Owner / admin', email: 'admin@dakotaprints.com', password: 'ForgedOS2026!' },
  { label: 'Front-counter rep', email: 'evie@dakotaprints.com', password: 'ForgedOS2026!' },
];

export default function Login() {
  const { user, signIn } = useAuth();
  const nav = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState(DEMO[0].email);
  const [password, setPassword] = useState(DEMO[0].password);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (user) nav('/dashboard', { replace: true }); }, [user, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await signIn(email.trim(), password);
      toast('Signed in to Dakota Prints OS');
      nav('/dashboard', { replace: true });
    } catch (e: any) {
      setErr(e.message || 'Sign-in failed');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <CmykRule />
      <div className="flex-1 flex items-start sm:items-center justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-[460px]">
          {/* the real lockup, large and centred on white */}
          <div className="flex justify-center">
            <div className="w-[260px] sm:w-[300px]">
              <DakotaLockup width={300} priority className="w-full" />
            </div>
          </div>

          <h1 className="mt-7 text-center text-[26px] sm:text-[30px] font-black leading-tight">Dakota Prints OS</h1>
          <p className="mt-2 text-center text-[14.5px] text-ink-500 max-w-[38ch] mx-auto">
            Private back office for the shop floor. Website orders land here, jobs move through the board, customers get notified.
          </p>

          <form onSubmit={submit} className="mt-7 card p-5 space-y-4">
            <Field label="Email">
              <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="username" autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field label="Password">
              <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            {err && <p className="text-[13px] font-bold text-dpred" role="alert">{err}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? <Spinner /> : <KeyRound size={16} />} Sign in
            </button>
          </form>

          <div className="mt-4 card p-4">
            <p className="label">Demo credentials</p>
            <ul className="mt-2.5 space-y-2.5">
              {DEMO.map((d) => (
                <li key={d.email} className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold">{d.label}</p>
                    <p className="text-[12px] text-ink-500 font-mono break-all">{d.email} · {d.password}</p>
                  </div>
                  <button type="button" className="btn-ghost btn-sm shrink-0"
                    onClick={() => { setEmail(d.email); setPassword(d.password); }}>Use</button>
                </li>
              ))}
            </ul>
          </div>

          <ul className="mt-5 grid gap-2 text-[12.5px] text-ink-500">
            {[
              [Webhook, 'Order intake webhook for dakotaprints.com'],
              [LayoutDashboard, 'Fulfillment board, tasks and customer messaging'],
              [ClipboardCheck, 'Printable job tickets and packing slips'],
            ].map(([Icon, label]: any) => (
              <li key={label} className="flex items-center gap-2"><Icon size={14} className="text-ink-300 shrink-0" />{label}</li>
            ))}
          </ul>
          <p className="mt-6 text-center text-[11.5px] text-ink-300">Dakota Prints OS · built by FORGED</p>
        </div>
      </div>
      <CmykRule className="cmyk-rule-thin" />
    </div>
  );
}
