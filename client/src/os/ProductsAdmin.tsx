// Catalog manager — the OS is the single source of truth for what
// dakotaprints.com sells. Publishing here changes the website instantly
// (the site reads /api/public/products); no deploy, no code.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, Image as ImageIcon,
  Layers, Palette, Plus, Search, Sparkles, Star, Tag, Trash2, Upload, X,
} from 'lucide-react';
import { asset, CATEGORIES, del, get, money, patch, post, put } from '../lib/api';
import { Badge, ConfirmDialog, Drawer, EmptyState, Field, SkeletonRows, Spinner, useToast } from '../components/kit';

type P = any;

const TABS = ['Details', 'Pricing', 'Sizes & options', 'Images', 'Design service'] as const;
type Tab = typeof TABS[number];

const APPAREL_PRESET = [
  { label: 'S', upcharge: 0 }, { label: 'M', upcharge: 0 }, { label: 'L', upcharge: 0 },
  { label: 'XL', upcharge: 0 }, { label: '2XL', upcharge: 2 }, { label: '3XL', upcharge: 3 }, { label: '4XL', upcharge: 4 },
];

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);

// -------------------------------------------------------------------- switch
function Switch({ on, onChange, label, busy = false }:
  { on: boolean; onChange: (v: boolean) => void; label: string; busy?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00AEEF]
        ${on ? 'bg-[#059669] border-[#046B4D]' : 'bg-ink-100 border-ink-100'} ${busy ? 'opacity-60' : ''}`}
    >
      <span className={`inline-block h-4.5 w-4.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform
        ${on ? 'translate-x-[23px]' : 'translate-x-[3px]'}`} />
    </button>
  );
}

function LiveChip({ published, active }: { published: boolean; active: boolean }) {
  if (published && active) {
    return <Badge tone="bg-[#059669]/10 text-[#046B4D] border-[#059669]/25"><Eye size={11} className="mr-1" />Live on site</Badge>;
  }
  return <Badge tone="bg-ink-100 text-ink-500 border-ink-100"><EyeOff size={11} className="mr-1" />Hidden</Badge>;
}

const numOrEmpty = (v: any) => (v === null || v === undefined || v === '' ? '' : String(v));

// =============================================================== product editor
function ProductEditor({ initial, onSaved, onClose }:
  { initial: P; onSaved: (p?: P) => void; onClose: () => void }) {
  const isNew = !initial?.id;
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('Details');
  const [busy, setBusy] = useState(false);
  const [product, setProduct] = useState<P>(initial);
  const [f, setF] = useState<P>(() => ({
    sku: initial.sku || '', name: initial.name || '', slug: initial.slug || '',
    category: initial.category || CATEGORIES[0], badge: initial.badge || '',
    short_description: initial.short_description || '', long_description: initial.long_description || '',
    description: initial.description || '',
    base_price: numOrEmpty(initial.base_price ?? 0), unit: initial.unit || 'each',
    min_qty: numOrEmpty(initial.min_qty ?? 1), turnaround_days: numOrEmpty(initial.turnaround_days ?? 7),
    stock: numOrEmpty(initial.stock), active: initial.active ?? 1, published: initial.published ?? 1,
    design_service_enabled: initial.design_service_enabled ?? 0,
    design_service_fee: numOrEmpty(initial.design_service_fee ?? 0),
    design_service_help: initial.design_service_help || '',
    allow_artwork_upload: initial.allow_artwork_upload ?? 1,
    options_json: initial.options_json || '{}',
  }));
  const set = (k: string, v: any) => setF((s: P) => ({ ...s, [k]: v }));

  // sub-collections (loaded once the product exists)
  const [images, setImages] = useState<P[]>(initial.images || []);
  const [variants, setVariants] = useState<P[]>(initial.variants || []);
  const [tiers, setTiers] = useState<P[]>(initial.price_tiers || []);
  const [quote, setQuote] = useState<P | null>(null);
  const [quoteQty, setQuoteQty] = useState<number>(Number(initial.min_qty) || 1);
  const [quoteVariant, setQuoteVariant] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const dragImg = useRef<number | null>(null);

  const id = product?.id;

  const refresh = useCallback(async () => {
    if (!id) return;
    const [imgs, vars, ts] = await Promise.all([
      get(`/api/os/products/${id}/images`),
      get(`/api/os/products/${id}/variants`),
      get(`/api/os/products/${id}/price-tiers`),
    ]);
    setImages(imgs); setVariants(vars); setTiers(ts);
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  // live example price
  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ qty: String(quoteQty || 1) });
      if (quoteVariant) qs.set('variant', quoteVariant);
      if (f.design_service_enabled) qs.set('design', '1');
      get(`/api/os/products/${id}/quote?${qs}`).then(setQuote).catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(t);
  }, [id, quoteQty, quoteVariant, f.design_service_enabled, tiers, variants, f.base_price]);

  async function saveDetails(extra: P = {}, quiet = false) {
    setBusy(true);
    try {
      JSON.parse(f.options_json || '{}');
      const payload: P = {
        ...f, ...extra,
        slug: f.slug || slugify(f.name),
        base_price: Number(f.base_price) || 0,
        min_qty: Number(f.min_qty) || 1,
        turnaround_days: Number(f.turnaround_days) || 0,
        stock: f.stock === '' ? null : Number(f.stock),
        design_service_fee: Number(f.design_service_fee) || 0,
        badge: f.badge || null,
      };
      const saved = id ? await patch(`/api/os/products/${id}`, payload) : await post('/api/os/products', payload);
      setProduct(saved);
      if (!quiet) toast(id ? 'Saved — live on the website now' : 'Product created');
      onSaved(saved);
      return saved;
    } catch (e: any) {
      toast(e.message?.includes('JSON') ? 'Options JSON is not valid' : e.message, 'err');
      return null;
    } finally { setBusy(false); }
  }

  // ------------------------------------------------------------------ images
  async function uploadImages(files: FileList | File[]) {
    let target = id;
    if (!target) { const saved = await saveDetails({}, true); target = saved?.id; if (!target) return; }
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).slice(0, 12).forEach((file) => fd.append('files', file));
      const r = await post(`/api/os/products/${target}/images`, fd);
      setImages(r.images);
      onSaved();
      toast(`${r.added} image${r.added === 1 ? '' : 's'} added`);
    } catch (e: any) { toast(e.message, 'err'); } finally { setUploading(false); }
  }

  const setPrimary = async (imgId: number) => {
    setImages(await patch(`/api/os/products/${id}/images/${imgId}`, { is_primary: true })); onSaved();
    toast('Primary image updated');
  };
  const saveAlt = async (imgId: number, alt: string) => {
    setImages(await patch(`/api/os/products/${id}/images/${imgId}`, { alt }));
  };
  const removeImage = async (imgId: number) => {
    setImages(await del(`/api/os/products/${id}/images/${imgId}`)); onSaved(); toast('Image removed');
  };
  const commitImageOrder = async (list: P[]) => {
    setImages(list);
    setImages(await post(`/api/os/products/${id}/images/reorder`, { ids: list.map((i) => i.id) }));
    onSaved();
  };

  // ---------------------------------------------------------------- variants
  const addVariant = (kind = 'size') =>
    setVariants((v) => [...v, { label: '', kind, price: null, upcharge: 0, sku_suffix: '', stock: null, active: 1 }]);
  const setVariant = (i: number, k: string, v: any) =>
    setVariants((list) => list.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  const moveVariant = (i: number, dir: -1 | 1) =>
    setVariants((list) => {
      const j = i + dir; if (j < 0 || j >= list.length) return list;
      const copy = [...list]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
    });

  async function saveVariants(list = variants) {
    let target = id;
    if (!target) { const saved = await saveDetails({}, true); target = saved?.id; if (!target) return; }
    setBusy(true);
    try {
      const payload = list.map((v) => ({
        label: v.label, kind: v.kind || 'size',
        price: v.price === '' || v.price === null || v.price === undefined ? null : Number(v.price),
        upcharge: v.upcharge === '' || v.upcharge === null || v.upcharge === undefined ? null : Number(v.upcharge),
        sku_suffix: v.sku_suffix || null,
        stock: v.stock === '' || v.stock === null || v.stock === undefined ? null : Number(v.stock),
        active: v.active ? 1 : 0,
      }));
      setVariants(await put(`/api/os/products/${target}/variants`, { variants: payload }));
      onSaved();
      toast('Sizes & options saved');
    } catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); }
  }

  async function quickAddApparel() {
    let target = id;
    if (!target) { const saved = await saveDetails({}, true); target = saved?.id; if (!target) return; }
    try {
      const r = await post(`/api/os/products/${target}/variants/apparel`);
      setVariants(r.variants || []); onSaved();
      toast(`Standard apparel sizes added (${r.added})`);
    } catch (e: any) { toast(e.message, 'err'); }
  }

  // ------------------------------------------------------------------- tiers
  const addTier = () => setTiers((t) => [...t, { min_qty: '', unit_price: '' }]);
  const setTier = (i: number, k: string, v: any) =>
    setTiers((list) => list.map((row, j) => (j === i ? { ...row, [k]: v } : row)));

  const tierError = useMemo(() => {
    const rows = tiers.filter((t) => t.min_qty !== '' && t.unit_price !== '')
      .map((t) => ({ min_qty: Number(t.min_qty), unit_price: Number(t.unit_price) }))
      .sort((a, b) => a.min_qty - b.min_qty);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].min_qty === rows[i - 1].min_qty) return `Two breaks both start at ${rows[i].min_qty}.`;
      if (rows[i].unit_price > rows[i - 1].unit_price) return `The ${rows[i].min_qty}+ break costs more than the ${rows[i - 1].min_qty}+ break.`;
    }
    return null;
  }, [tiers]);

  async function saveTiers() {
    if (tierError) return toast(tierError, 'err');
    let target = id;
    if (!target) { const saved = await saveDetails({}, true); target = saved?.id; if (!target) return; }
    setBusy(true);
    try {
      const payload = tiers.filter((t) => t.min_qty !== '' && t.unit_price !== '')
        .map((t) => ({ min_qty: Number(t.min_qty), unit_price: Number(t.unit_price) }));
      setTiers(await put(`/api/os/products/${target}/price-tiers`, { price_tiers: payload }));
      onSaved();
      toast('Quantity breaks saved');
    } catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); }
  }

  const needsSave = <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-300">unsaved</span>;

  return (
    <div className="space-y-4">
      {/* header state */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <LiveChip published={!!f.published} active={!!f.active} />
          {product?.updated_at && <span className="text-[11.5px] text-ink-500">updated {String(product.updated_at).replace(' ', ' · ')}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="label">Published</span>
          <Switch on={!!f.published} label="Published to website"
            onChange={async (v) => {
              set('published', v ? 1 : 0);
              if (!id) return;
              try { await post(`/api/os/products/${id}/publish`, { published: v }); onSaved(); toast(v ? 'Live on the website' : 'Hidden from the website', v ? 'ok' : 'info'); }
              catch (e: any) { set('published', v ? 0 : 1); toast(e.message, 'err'); }
            }} />
        </div>
      </div>

      {/* tabs */}
      <div className="scroll-x -mx-1 px-1">
        <div role="tablist" aria-label="Product sections" className="flex gap-1.5 pb-1">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`chip ${tab === t ? 'chip-active' : ''}`}
              onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------ details */}
      {tab === 'Details' && (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name *"><input className="field" value={f.name}
              onChange={(e) => { set('name', e.target.value); if (isNew) set('slug', slugify(e.target.value)); }} /></Field>
            <Field label="SKU *"><input className="field tnum" value={f.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} /></Field>
            <Field label="Website slug" hint="Used in the product URL: /shop/<slug>">
              <input className="field" value={f.slug} onChange={(e) => set('slug', e.target.value)} placeholder={slugify(f.name)} />
            </Field>
            <Field label="Category">
              <select className="field" value={f.category} onChange={(e) => set('category', e.target.value)}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Badge" hint='Shows on the website card, e.g. "Best seller"'>
              <input className="field" value={f.badge} onChange={(e) => set('badge', e.target.value)} placeholder="none" />
            </Field>
            <Field label="Unit label"><input className="field" value={f.unit} onChange={(e) => set('unit', e.target.value)} /></Field>
            <Field label="Turnaround (days)"><input className="field tnum" type="number" min="0" value={f.turnaround_days} onChange={(e) => set('turnaround_days', e.target.value)} /></Field>
            <Field label="Minimum qty"><input className="field tnum" type="number" min="1" value={f.min_qty} onChange={(e) => set('min_qty', e.target.value)} /></Field>
            <Field label="Blank stock" hint="Blank = made to order"><input className="field tnum" type="number" value={f.stock} onChange={(e) => set('stock', e.target.value)} /></Field>
          </div>
          <Field label="Short description" hint="One line on the shop grid (max ~140 characters)">
            <input className="field" maxLength={180} value={f.short_description} onChange={(e) => set('short_description', e.target.value)} />
          </Field>
          <Field label="Long description" hint="Full product page copy">
            <textarea className="field min-h-[120px] py-2.5" value={f.long_description} onChange={(e) => set('long_description', e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-4 items-center pt-1">
            <label className="flex items-center gap-2 text-[13px] font-bold">
              <input type="checkbox" className="h-4 w-4 accent-[#1F2328]" checked={!!f.active} onChange={(e) => set('active', e.target.checked ? 1 : 0)} />
              Active in the OS
            </label>
            <label className="flex items-center gap-2 text-[13px] font-bold">
              <input type="checkbox" className="h-4 w-4 accent-[#1F2328]" checked={!!f.allow_artwork_upload} onChange={(e) => set('allow_artwork_upload', e.target.checked ? 1 : 0)} />
              Let customers upload artwork
            </label>
          </div>
          <details className="card p-3">
            <summary className="label cursor-pointer">Legacy options JSON (colors, placements)</summary>
            <textarea className="field mt-2 min-h-[110px] py-2.5 font-mono text-[12px]" value={f.options_json}
              onChange={(e) => set('options_json', e.target.value)} />
            <p className="mt-1.5 text-[12px] text-ink-500">Kept for garment colors, ink colors and placements. Sizes now live in the Sizes &amp; options tab.</p>
          </details>
          <button className="btn-primary w-full" disabled={busy} onClick={() => saveDetails()}>
            {busy ? <Spinner /> : null} {isNew ? 'Create product' : 'Save details'}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------ pricing */}
      {tab === 'Pricing' && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Base price" hint="Used when no quantity break or variant price applies">
              <input className="field tnum" type="number" step="0.01" value={f.base_price} onChange={(e) => set('base_price', e.target.value)} />
            </Field>
            <Field label="Unit label"><input className="field" value={f.unit} onChange={(e) => set('unit', e.target.value)} /></Field>
          </div>
          <button className="btn-ghost btn-sm" disabled={busy} onClick={() => saveDetails()}>Save base price</button>

          <div className="card p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-bold text-[13.5px]">Quantity breaks</p>
                <p className="text-[12px] text-ink-500">The highest break at or below the order quantity wins.</p>
              </div>
              <button className="btn-ghost btn-sm" onClick={addTier}><Plus size={14} /> Add break</button>
            </div>
            <div className="mt-3 space-y-2">
              {tiers.length === 0 && <p className="text-[13px] text-ink-500">No breaks — every quantity pays the base price.</p>}
              {tiers.map((t, i) => (
                <div key={i} className="flex items-end gap-2">
                  <label className="flex-1"><span className="label block mb-1">Min qty</span>
                    <input className="field tnum" type="number" min="1" value={numOrEmpty(t.min_qty)} onChange={(e) => setTier(i, 'min_qty', e.target.value)} /></label>
                  <label className="flex-1"><span className="label block mb-1">Unit price</span>
                    <input className="field tnum" type="number" step="0.01" value={numOrEmpty(t.unit_price)} onChange={(e) => setTier(i, 'unit_price', e.target.value)} /></label>
                  <button className="btn-ghost btn-sm text-dpred mb-[1px]" aria-label={`Remove break ${i + 1}`}
                    onClick={() => setTiers((list) => list.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            {tierError && (
              <p className="mt-2.5 flex items-start gap-1.5 text-[12.5px] font-semibold text-[#A5121F]">
                <AlertTriangle size={14} className="mt-[1px] shrink-0" />{tierError}
              </p>
            )}
            <button className="btn-primary btn-sm mt-3" disabled={busy || !!tierError} onClick={saveTiers}>Save breaks</button>
          </div>

          <div className="card p-3.5">
            <p className="font-bold text-[13.5px]">Example price</p>
            <div className="mt-2.5 flex flex-wrap items-end gap-2">
              <label className="w-28"><span className="label block mb-1">Quantity</span>
                <input className="field tnum" type="number" min="1" value={quoteQty} onChange={(e) => setQuoteQty(Number(e.target.value) || 1)} /></label>
              <label className="flex-1 min-w-[140px]"><span className="label block mb-1">Size / option</span>
                <select className="field" value={quoteVariant} onChange={(e) => setQuoteVariant(e.target.value)}>
                  <option value="">— none —</option>
                  {variants.filter((v) => v.label).map((v) => <option key={v.id || v.label} value={v.label}>{v.label}</option>)}
                </select></label>
            </div>
            {quote ? (
              <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-[13px]">
                <dt className="text-ink-500">Unit price</dt><dd className="text-right font-bold tnum">{money(quote.unit_price)}</dd>
                {quote.tier_applied && (<><dt className="text-ink-500">Break applied</dt><dd className="text-right tnum">{quote.tier_applied.min_qty}+ @ {money(quote.tier_applied.unit_price)}</dd></>)}
                {quote.design_fee > 0 && (<><dt className="text-ink-500">Design service</dt><dd className="text-right tnum">{money(quote.design_fee)}</dd></>)}
                <dt className="text-ink-500">Subtotal</dt><dd className="text-right font-bold tnum">{money(quote.subtotal)}</dd>
                <dt className="text-ink-500">With tax</dt><dd className="text-right tnum">{money(quote.total)}</dd>
              </dl>
            ) : <p className="mt-3 text-[13px] text-ink-500">Save the product to see live pricing.</p>}
            {quote?.below_min_qty && (
              <p className="mt-2 text-[12.5px] font-semibold text-[#7A6A00]">Below the {f.min_qty} piece minimum — the website will block this quantity.</p>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ sizes/options */}
      {tab === 'Sizes & options' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost btn-sm" onClick={() => addVariant('size')}><Plus size={14} /> Size</button>
            <button className="btn-ghost btn-sm" onClick={() => addVariant('dimension')}><Plus size={14} /> Dimension</button>
            <button className="btn-ghost btn-sm" onClick={() => addVariant('option')}><Plus size={14} /> Option</button>
            <button className="btn-ghost btn-sm" onClick={quickAddApparel}><Sparkles size={14} /> Quick add apparel sizes</button>
          </div>
          <p className="text-[12px] text-ink-500">
            Set an <strong>absolute price</strong> or an <strong>upcharge</strong> — not both. Upcharges stack on top of the
            quantity-break price ({APPAREL_PRESET.filter((p) => p.upcharge).map((p) => `${p.label} +$${p.upcharge}`).join(', ')} in the preset).
          </p>

          {variants.length === 0 ? (
            <div className="card"><EmptyState icon={<Layers size={18} />} title="No sizes or options yet"
              body="Add rows, or use the apparel preset to seed S–4XL with standard upcharges." /></div>
          ) : (
            <div className="space-y-2">
              {variants.map((v, i) => (
                <div key={v.id || `n${i}`} className={`card p-3 ${v.active ? '' : 'opacity-60'}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-1 pt-1">
                      <button className="btn-ghost btn-sm px-1.5 py-1" aria-label="Move up" onClick={() => moveVariant(i, -1)}><ArrowUp size={13} /></button>
                      <button className="btn-ghost btn-sm px-1.5 py-1" aria-label="Move down" onClick={() => moveVariant(i, 1)}><ArrowDown size={13} /></button>
                    </div>
                    <div className="flex-1 grid grid-cols-2 sm:grid-cols-6 gap-2">
                      <label className="col-span-2 sm:col-span-2"><span className="label block mb-1">Label</span>
                        <input className="field" value={v.label || ''} onChange={(e) => setVariant(i, 'label', e.target.value)} placeholder="2XL" /></label>
                      <label><span className="label block mb-1">Kind</span>
                        <select className="field" value={v.kind || 'size'} onChange={(e) => setVariant(i, 'kind', e.target.value)}>
                          <option value="size">size</option><option value="dimension">dimension</option><option value="option">option</option>
                        </select></label>
                      <label><span className="label block mb-1">Price</span>
                        <input className="field tnum" type="number" step="0.01" value={numOrEmpty(v.price)}
                          onChange={(e) => setVariant(i, 'price', e.target.value === '' ? null : e.target.value)} placeholder="—" /></label>
                      <label><span className="label block mb-1">Upcharge</span>
                        <input className="field tnum" type="number" step="0.01" value={numOrEmpty(v.upcharge)}
                          onChange={(e) => setVariant(i, 'upcharge', e.target.value === '' ? null : e.target.value)} placeholder="0" /></label>
                      <label><span className="label block mb-1">Stock</span>
                        <input className="field tnum" type="number" value={numOrEmpty(v.stock)}
                          onChange={(e) => setVariant(i, 'stock', e.target.value === '' ? null : e.target.value)} placeholder="—" /></label>
                    </div>
                    <div className="flex flex-col items-center gap-2 pt-5">
                      <Switch on={!!v.active} label={`${v.label || 'variant'} active`} onChange={(on) => setVariant(i, 'active', on ? 1 : 0)} />
                      <button className="btn-ghost btn-sm text-dpred px-2" aria-label={`Remove ${v.label || 'variant'}`}
                        onClick={() => setVariants((list) => list.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {v.price != null && v.upcharge != null && Number(v.upcharge) !== 0 && (
                    <p className="mt-2 text-[12px] font-semibold text-[#A5121F]">Pick either a price or an upcharge for this row.</p>
                  )}
                </div>
              ))}
            </div>
          )}
          <button className="btn-primary w-full" disabled={busy} onClick={() => saveVariants()}>Save sizes &amp; options</button>
        </div>
      )}

      {/* ------------------------------------------------------------- images */}
      {tab === 'Images' && (
        <div className="space-y-3">
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) uploadImages(e.dataTransfer.files); }}
            className="block cursor-pointer rounded-xl border-2 border-dashed border-ink-100 hover:border-[#00AEEF] bg-white px-4 py-7 text-center transition-colors"
          >
            <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-paper-100 text-ink-500">
              {uploading ? <Spinner className="h-4 w-4" /> : <Upload size={18} />}
            </span>
            <span className="block font-bold text-[13.5px]">{uploading ? 'Uploading…' : 'Drop images here or click to choose'}</span>
            <span className="mt-1 block text-[12px] text-ink-500">JPG, PNG, WEBP, GIF or AVIF · up to 8 MB each · resized to 1600px and converted to WEBP</span>
            <input type="file" accept="image/*" multiple className="sr-only"
              onChange={(e) => e.target.files?.length && uploadImages(e.target.files)} />
          </label>

          {images.length === 0 ? (
            <div className="card"><EmptyState icon={<ImageIcon size={18} />} title="No images yet"
              body="The website shows the primary image on the shop grid and the rest in the product gallery." /></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {images.map((img, i) => (
                <div key={img.id} draggable
                  onDragStart={() => { dragImg.current = i; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    const from = dragImg.current; dragImg.current = null;
                    if (from === null || from === i) return;
                    const copy = [...images]; const [row] = copy.splice(from, 1); copy.splice(i, 0, row);
                    commitImageOrder(copy);
                  }}
                  className="card overflow-hidden">
                  <div className="relative h-36 bg-paper-100">
                    <img src={asset(img.url)} alt={img.alt || ''} className="h-full w-full object-cover" />
                    <span className="absolute top-2 left-2 flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] font-bold">
                      <GripVertical size={12} className="text-ink-300" />{i + 1}
                    </span>
                    {img.is_primary
                      ? <span className="absolute top-2 right-2"><Badge tone="bg-[#FFF200] text-ink border-[#D6CB00]"><Star size={11} className="mr-1" />Primary</Badge></span>
                      : (
                        <button className="absolute top-2 right-2 btn-ghost btn-sm bg-white/90" onClick={() => setPrimary(img.id)}>
                          <Star size={13} /> Set primary
                        </button>
                      )}
                  </div>
                  <div className="p-2.5 space-y-2">
                    <input className="field" defaultValue={img.alt || ''} placeholder="Alt text"
                      onBlur={(e) => e.target.value !== (img.alt || '') && saveAlt(img.id, e.target.value)} aria-label="Alt text" />
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex gap-1">
                        <button className="btn-ghost btn-sm px-2" aria-label="Move earlier" disabled={i === 0}
                          onClick={() => { const c = [...images]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; commitImageOrder(c); }}><ArrowUp size={13} /></button>
                        <button className="btn-ghost btn-sm px-2" aria-label="Move later" disabled={i === images.length - 1}
                          onClick={() => { const c = [...images]; [c[i + 1], c[i]] = [c[i], c[i + 1]]; commitImageOrder(c); }}><ArrowDown size={13} /></button>
                      </div>
                      <button className="btn-ghost btn-sm text-dpred" onClick={() => removeImage(img.id)}><Trash2 size={13} /> Remove</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ----------------------------------------------------- design service */}
      {tab === 'Design service' && (
        <div className="space-y-3">
          <div className="card p-3.5 flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#EC008C]/10 text-[#B00A6C]"><Palette size={17} /></span>
            <div className="flex-1">
              <p className="font-bold text-[13.5px]">Offer “Design it for me” on this product</p>
              <p className="mt-1 text-[12.5px] text-ink-500">
                Adds a brief box at checkout. Orders that use it get a <strong>Create design from customer brief</strong> task
                at the front of the job chain and a design-request notification.
              </p>
            </div>
            <Switch on={!!f.design_service_enabled} label="Design service enabled"
              onChange={(v) => set('design_service_enabled', v ? 1 : 0)} />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Design fee" hint="Charged once per line item. 0 = free.">
              <input className="field tnum" type="number" step="0.01" value={f.design_service_fee}
                onChange={(e) => set('design_service_fee', e.target.value)} disabled={!f.design_service_enabled} />
            </Field>
          </div>
          <Field label="Help text shown on the website" hint="Leave blank to use the shop default from Settings">
            <textarea className="field min-h-[90px] py-2.5" value={f.design_service_help}
              onChange={(e) => set('design_service_help', e.target.value)} disabled={!f.design_service_enabled} />
          </Field>
          <button className="btn-primary w-full" disabled={busy} onClick={() => saveDetails()}>Save design service</button>
        </div>
      )}

      <div className="pt-1 flex justify-between items-center border-t border-ink-100 mt-2 pt-3">
        <button className="btn-ghost btn-sm" onClick={onClose}>Close</button>
        {isNew ? needsSave : <span className="text-[12px] text-ink-500">Every save publishes to the website immediately.</span>}
      </div>
    </div>
  );
}

// ==================================================================== list page
export default function ProductsAdmin() {
  const [rows, setRows] = useState<P[] | null>(null);
  const [summary, setSummary] = useState<P | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [vis, setVis] = useState<'all' | 'live' | 'hidden'>('all');
  const [sel, setSel] = useState<number[]>([]);
  const [edit, setEdit] = useState<P | null>(null);
  const [confirm, setConfirm] = useState<P | null>(null);
  const [pending, setPending] = useState<number[]>([]);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([get('/api/os/products'), get('/api/os/catalog/summary')]);
      setRows(list); setSummary(sum);
    } catch { setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => (rows || []).filter((p) =>
    (cat === 'All' || p.category === cat) &&
    (vis === 'all' || (vis === 'live' ? p.published && p.active : !(p.published && p.active))) &&
    (!q.trim() || `${p.name} ${p.sku} ${p.slug || ''}`.toLowerCase().includes(q.toLowerCase()))), [rows, q, cat, vis]);

  // optimistic publish toggle
  async function togglePublish(p: P, next: boolean) {
    setRows((r) => (r || []).map((x) => (x.id === p.id ? { ...x, published: next ? 1 : 0 } : x)));
    setPending((s) => [...s, p.id]);
    try {
      await post(`/api/os/products/${p.id}/publish`, { published: next });
      toast(next ? `${p.name} is live on the website` : `${p.name} is hidden from the website`, next ? 'ok' : 'info');
      load();
    } catch (e: any) {
      setRows((r) => (r || []).map((x) => (x.id === p.id ? { ...x, published: next ? 0 : 1 } : x)));
      toast(e.message, 'err');
    } finally { setPending((s) => s.filter((id) => id !== p.id)); }
  }

  async function bulk(action: string, category?: string) {
    if (!sel.length) return;
    try {
      const r = await post('/api/os/products/bulk', { ids: sel, action, category });
      toast(`${r.updated} product${r.updated === 1 ? '' : 's'} ${action === 'category' ? `moved to ${category}` : action === 'archive' ? 'archived' : action + 'ed'}`);
      setSel([]); load();
    } catch (e: any) { toast(e.message, 'err'); }
  }

  async function nudge(p: P, direction: 'up' | 'down') {
    try { await post('/api/os/products/reorder', { id: p.id, direction }); load(); }
    catch (e: any) { toast(e.message, 'err'); }
  }

  async function duplicate(p: P) {
    try { const copy = await post(`/api/os/products/${p.id}/duplicate`); toast('Duplicated — the copy starts hidden'); await load(); setEdit(copy); }
    catch (e: any) { toast(e.message, 'err'); }
  }

  const allSelected = list.length > 0 && sel.length === list.length;

  return (
    <div className="space-y-4">
      {/* summary */}
      <div className="card p-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div>
            <p className="label">Live catalog</p>
            <p className="mt-1 text-[19px] font-black leading-none tnum">
              {summary ? `${summary.published_count} of ${summary.product_count}` : '—'}
              <span className="ml-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-ink-500">published</span>
            </p>
          </div>
          <div className="hidden sm:block h-9 w-px bg-ink-100" />
          <div>
            <p className="label">Design service</p>
            <p className="mt-1 text-[19px] font-black leading-none tnum">{summary ? summary.design_service_products : '—'}
              <span className="ml-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-ink-500">products</span></p>
          </div>
          <div className="hidden sm:block h-9 w-px bg-ink-100" />
          <div>
            <p className="label">Catalog version</p>
            <p className="mt-1 font-mono text-[13px]">{summary?.version || '—'}</p>
          </div>
        </div>
        <p className="text-[12px] text-ink-500 max-w-xs">
          The website reads <code className="font-mono">/api/public/products</code>. Toggling Published changes the shop instantly.
        </p>
      </div>

      {/* filters */}
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
            <input className="field pl-9" placeholder="Search name, SKU or slug" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
          </div>
          <button className="btn-primary btn-sm" onClick={() => setEdit({})}><Plus size={15} /> New product</button>
        </div>
        <div className="scroll-x sm:overflow-visible -mx-1 px-1"><div className="flex sm:flex-wrap gap-1.5 pb-1">
          {['All', ...CATEGORIES].map((c) => (
            <button key={c} className={`chip ${cat === c ? 'chip-active' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
          <span className="mx-1 w-px bg-ink-100 shrink-0" />
          {(['all', 'live', 'hidden'] as const).map((v) => (
            <button key={v} className={`chip ${vis === v ? 'chip-active' : ''}`} onClick={() => setVis(v)}>
              {v === 'all' ? 'Any status' : v === 'live' ? 'Live on site' : 'Hidden'}
            </button>
          ))}
        </div></div>
      </div>

      {/* bulk bar */}
      {sel.length > 0 && (
        <div className="card p-3 flex flex-wrap items-center gap-2 animate-in">
          <span className="font-bold text-[13px]">{sel.length} selected</span>
          <button className="btn-ghost btn-sm" onClick={() => bulk('publish')}><Eye size={14} /> Publish</button>
          <button className="btn-ghost btn-sm" onClick={() => bulk('unpublish')}><EyeOff size={14} /> Unpublish</button>
          <button className="btn-ghost btn-sm" onClick={() => bulk('archive')}>Archive</button>
          <label className="flex items-center gap-1.5 text-[13px] font-bold">
            <Tag size={14} />
            <select className="field h-9 py-0 w-[170px]" defaultValue="" onChange={(e) => e.target.value && bulk('category', e.target.value)} aria-label="Move to category">
              <option value="">Move to category…</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <button className="btn-ghost btn-sm ml-auto" onClick={() => setSel([])}><X size={14} /> Clear</button>
        </div>
      )}

      {/* list */}
      {rows === null ? <SkeletonRows rows={6} /> : list.length === 0 ? (
        <div className="card"><EmptyState title="No products match" body="Adjust the filters or add a new product."
          action={<button className="btn-primary btn-sm" onClick={() => setEdit({})}><Plus size={15} /> New product</button>} /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="hidden lg:grid grid-cols-[32px_52px_minmax(0,1fr)_88px_92px_76px_182px_100px] gap-2.5 px-4 py-2.5 border-b border-ink-100 bg-paper-100">
            <label className="grid place-items-center">
              <input type="checkbox" className="h-4 w-4 accent-[#1F2328]" checked={allSelected} aria-label="Select all"
                onChange={(e) => setSel(e.target.checked ? list.map((p) => p.id) : [])} />
            </label>
            <span className="label">Img</span><span className="label">Product</span><span className="label">SKU</span>
            <span className="label">Category</span><span className="label text-right">Price</span>
            <span className="label">Website</span><span className="label text-right">Actions</span>
          </div>

          <ul className="divide-y divide-ink-100">
            {list.map((p, i) => {
              const live = !!(p.published && p.active);
              return (
                <li key={p.id} className="px-3 sm:px-4 py-3 hover:bg-paper-100/60">
                  {/* desktop row */}
                  <div className="hidden lg:grid grid-cols-[32px_52px_minmax(0,1fr)_88px_92px_76px_182px_100px] gap-2.5 items-center">
                    <label className="grid place-items-center">
                      <input type="checkbox" className="h-4 w-4 accent-[#1F2328]" checked={sel.includes(p.id)} aria-label={`Select ${p.name}`}
                        onChange={(e) => setSel((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                    </label>
                    <div className="h-11 w-14 rounded-md overflow-hidden bg-paper-100 shrink-0">
                      {p.primary_image ? <img src={asset(p.primary_image)} alt="" className="h-full w-full object-cover" loading="lazy" />
                        : <span className="grid h-full place-items-center text-[10px] text-ink-300">none</span>}
                    </div>
                    <button className="min-w-0 text-left" onClick={() => setEdit(p)}>
                      <span className="block font-bold text-[13.5px] truncate">{p.name}</span>
                      <span className="block text-[11.5px] text-ink-500 truncate" title={`/${p.slug}`}>
                        {p.variant_count} size{p.variant_count === 1 ? '' : 's'} · {p.image_count} img
                        {p.price_tiers?.length ? ` · ${p.price_tiers.length} breaks` : ''}
                        <span className="mx-1.5 text-ink-300">·</span>
                        <span className="font-mono">/{p.slug}</span>
                      </span>
                    </button>
                    <span className="text-[12.5px] tnum truncate">{p.sku}</span>
                    <span className="text-[12.5px] truncate">{p.category}</span>
                    <span className="text-[13px] font-bold tnum text-right">{money(p.base_price)}</span>
                    <div className="flex items-center gap-2 min-w-0">
                      <Switch on={!!p.published} busy={pending.includes(p.id)} label={`Publish ${p.name}`}
                        onChange={(v) => togglePublish(p, v)} />
                      <LiveChip published={!!p.published} active={!!p.active} />
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <button className="btn-ghost btn-sm px-1.5" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => nudge(p, 'up')}><ArrowUp size={13} /></button>
                      <button className="btn-ghost btn-sm px-1.5" aria-label={`Move ${p.name} down`} disabled={i === list.length - 1} onClick={() => nudge(p, 'down')}><ArrowDown size={13} /></button>
                      <button className="btn-ghost btn-sm px-1.5" aria-label={`Duplicate ${p.name}`} onClick={() => duplicate(p)}><Copy size={13} /></button>
                      <button className="btn-ghost btn-sm px-1.5 text-dpred" aria-label={`Delete ${p.name}`} onClick={() => setConfirm(p)}><Trash2 size={13} /></button>
                    </div>
                  </div>

                  {/* mobile card */}
                  <div className="lg:hidden flex gap-3">
                    <label className="pt-1">
                      <input type="checkbox" className="h-4 w-4 accent-[#1F2328]" checked={sel.includes(p.id)} aria-label={`Select ${p.name}`}
                        onChange={(e) => setSel((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                    </label>
                    <div className="h-14 w-16 rounded-md overflow-hidden bg-paper-100 shrink-0">
                      {p.primary_image ? <img src={asset(p.primary_image)} alt="" className="h-full w-full object-cover" loading="lazy" />
                        : <span className="grid h-full place-items-center text-[10px] text-ink-300">none</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <button className="min-w-0 text-left" onClick={() => setEdit(p)}>
                          <span className="block font-bold text-[13.5px] leading-snug">{p.name}</span>
                          <span className="block text-[11.5px] text-ink-500 tnum">{p.sku} · {p.category}</span>
                        </button>
                        <Switch on={!!p.published} busy={pending.includes(p.id)} label={`Publish ${p.name}`} onChange={(v) => togglePublish(p, v)} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <LiveChip published={!!p.published} active={!!p.active} />
                        <Badge>{money(p.base_price)}</Badge>
                        <Badge>{p.variant_count} sizes</Badge>
                        <Badge>{p.image_count} img</Badge>
                        {p.low_stock && <Badge tone="bg-[#E11D2E]/8 text-[#A5121F] border-[#E11D2E]/25"><AlertTriangle size={11} className="mr-1" />low stock</Badge>}
                      </div>
                      <div className="mt-2.5 flex gap-1.5">
                        <button className="btn-ghost btn-sm flex-1" onClick={() => setEdit(p)}>Edit</button>
                        <button className="btn-ghost btn-sm px-2" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => nudge(p, 'up')}><ArrowUp size={13} /></button>
                        <button className="btn-ghost btn-sm px-2" aria-label={`Move ${p.name} down`} disabled={i === list.length - 1} onClick={() => nudge(p, 'down')}><ArrowDown size={13} /></button>
                        <button className="btn-ghost btn-sm px-2" aria-label={`Duplicate ${p.name}`} onClick={() => duplicate(p)}><Copy size={13} /></button>
                        <button className="btn-ghost btn-sm px-2 text-dpred" aria-label={`Delete ${p.name}`} onClick={() => setConfirm(p)}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Drawer open={edit !== null} onClose={() => { setEdit(null); load(); }} wide
        title={<>
          <p className="label">Catalog</p>
          <p className="font-black text-[15px]">{edit?.id ? edit.name : 'New product'}</p>
        </>}>
        {edit !== null && (
          <ProductEditor key={edit.id || 'new'} initial={edit}
            onSaved={(p) => { load(); if (p) setEdit((e: P) => ({ ...e, ...p })); }}
            onClose={() => { setEdit(null); load(); }} />
        )}
      </Drawer>

      <ConfirmDialog open={confirm !== null} title={`Delete ${confirm?.name}?`}
        body="This removes it from the OS and the website. Archive instead if you might sell it again."
        confirmLabel="Delete forever"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          try { await del(`/api/os/products/${confirm.id}`); toast('Product deleted'); }
          catch (e: any) { toast(e.message, 'err'); }
          setConfirm(null); load();
        }} />
    </div>
  );
}
