import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Upload, Trash2, AlertTriangle } from 'lucide-react';
import { asset, del, get, money, patch, post } from '../lib/api';
import { Badge, ConfirmDialog, Drawer, EmptyState, Field, SkeletonRows, useToast } from '../components/kit';

const CATS = ['Apparel', 'Signage & Banners', 'Vinyl & Decals', 'Business Print', 'Blueprints', 'Promo'];
const BLANK = { sku: '', name: '', category: CATS[0], description: '', base_price: 0, unit: 'each', min_qty: 1, turnaround_days: 7, stock: '', image_url: '', options_json: '{}', active: 1 };

function ProductForm({ initial, onDone }: { initial: any; onDone: () => void }) {
  const [f, setF] = useState<any>({ ...BLANK, ...initial, options_json: initial?.options_json || JSON.stringify(initial?.options || {}, null, 2) });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      JSON.parse(f.options_json || '{}');
      const payload = { ...f, stock: f.stock === '' ? null : Number(f.stock) };
      if (initial?.id) await patch(`/api/os/products/${initial.id}`, payload);
      else await post('/api/os/products', payload);
      toast(initial?.id ? 'Product updated' : 'Product created');
      onDone();
    } catch (e: any) { toast(e.message?.includes('JSON') ? 'Options must be valid JSON' : e.message, 'err'); }
    finally { setBusy(false); }
  }

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await post('/api/os/uploads', fd);
      set('image_url', r.url);
      toast('Image uploaded');
    } catch (e: any) { toast(e.message, 'err'); } finally { setUploading(false); }
  }

  return (
    <div className="space-y-3">
      {f.image_url && <img src={asset(f.image_url)} alt="" className="h-40 w-full object-cover rounded-lg border border-ink-100" />}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="SKU *"><input className="field" value={f.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} /></Field>
        <Field label="Name *"><input className="field" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Category">
          <select className="field" value={f.category} onChange={(e) => set('category', e.target.value)}>
            {CATS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Unit label"><input className="field" value={f.unit} onChange={(e) => set('unit', e.target.value)} /></Field>
        <Field label="Base price"><input className="field tnum" type="number" step="0.01" value={f.base_price} onChange={(e) => set('base_price', e.target.value)} /></Field>
        <Field label="Minimum qty"><input className="field tnum" type="number" value={f.min_qty} onChange={(e) => set('min_qty', e.target.value)} /></Field>
        <Field label="Turnaround (days)"><input className="field tnum" type="number" value={f.turnaround_days} onChange={(e) => set('turnaround_days', e.target.value)} /></Field>
        <Field label="Blank stock" hint="Leave blank for made-to-order"><input className="field tnum" type="number" value={f.stock ?? ''} onChange={(e) => set('stock', e.target.value)} /></Field>
      </div>
      <Field label="Description"><textarea className="field min-h-[80px] py-2.5" value={f.description || ''} onChange={(e) => set('description', e.target.value)} /></Field>
      <Field label="Options JSON" hint='e.g. {"sizes":["S","M","2XL (+$2.00)"],"ink_colors":["Black"]}'>
        <textarea className="field min-h-[120px] py-2.5 font-mono text-[12px]" value={f.options_json} onChange={(e) => set('options_json', e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2 items-center">
        <label className="btn-ghost btn-sm cursor-pointer">
          <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload image'}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
        </label>
        <label className="flex items-center gap-2 text-[13px] font-bold">
          <input type="checkbox" className="h-4 w-4 accent-[#1F2328]" checked={!!f.active} onChange={(e) => set('active', e.target.checked ? 1 : 0)} />
          Active / synced to website
        </label>
      </div>
      <button className="btn-primary w-full" disabled={busy} onClick={save}>{initial?.id ? 'Save product' : 'Create product'}</button>
    </div>
  );
}

export default function ProductsAdmin() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [edit, setEdit] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const { toast } = useToast();

  const load = () => get('/api/os/products').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const list = useMemo(() => (rows || []).filter((p) =>
    (cat === 'All' || p.category === cat) &&
    (!q.trim() || `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase()))), [rows, q, cat]);

  return (
    <div className="space-y-4">
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
            <input className="field pl-9" placeholder="Search products or SKUs" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
          </div>
          <button className="btn-primary btn-sm" onClick={() => setEdit({})}><Plus size={15} /> New product</button>
        </div>
        <div className="scroll-x -mx-1 px-1"><div className="flex gap-1.5 pb-1">
          {['All', ...CATS].map((c) => (
            <button key={c} className={`chip ${cat === c ? 'chip-active' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div></div>
      </div>

      {rows === null ? <SkeletonRows rows={6} /> : list.length === 0 ? (
        <div className="card"><EmptyState title="No products match" body="Adjust the filters or add a new product." /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <article key={p.id} className="card overflow-hidden flex flex-col">
              <div className="h-[132px] bg-paper-100 overflow-hidden">
                {p.image_url ? <img src={asset(p.image_url)} alt="" className="w-full h-full object-cover" loading="lazy" />
                  : <div className="h-full grid place-items-center text-ink-300 text-[12px]">No image</div>}
              </div>
              <div className="p-3.5 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="label">{p.category}</p>
                    <p className="mt-1 font-bold text-[13.5px] leading-snug">{p.name}</p>
                    <p className="text-[11.5px] text-ink-500 tnum">{p.sku}</p>
                  </div>
                  {!p.active && <Badge tone="bg-ink-100 text-ink-500 border-ink-100">Hidden</Badge>}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Badge>{money(p.base_price)} {p.unit}</Badge>
                  <Badge>min {p.min_qty}</Badge>
                  <Badge>{p.turnaround_days}d</Badge>
                  {p.stock != null && (
                    <Badge tone={p.low_stock ? 'bg-[#E11D2E]/8 text-[#A5121F] border-[#E11D2E]/25' : ''}>
                      {p.low_stock && <AlertTriangle size={11} className="mr-1" />}{p.stock} on hand
                    </Badge>
                  )}
                </div>
                <div className="mt-auto pt-3 flex gap-2">
                  <button className="btn-ghost btn-sm flex-1" onClick={() => setEdit(p)}>Edit</button>
                  <button className="btn-ghost btn-sm text-dpred px-2.5" onClick={() => setConfirm(p)} aria-label={`Delete ${p.name}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Drawer open={edit !== null} onClose={() => setEdit(null)} wide
        title={<><p className="label">Catalog</p><p className="font-black text-[15px]">{edit?.id ? edit.name : 'New product'}</p></>}>
        {edit !== null && <ProductForm initial={edit} onDone={() => { setEdit(null); load(); }} />}
      </Drawer>

      <ConfirmDialog open={confirm !== null} title={`Delete ${confirm?.name}?`}
        body="It stops syncing to the website catalog immediately."
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          try { await del(`/api/os/products/${confirm.id}`); toast('Product deleted'); }
          catch (e: any) { toast(e.message, 'err'); }
          setConfirm(null); load();
        }} />
    </div>
  );
}
