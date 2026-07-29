// Transactional email stubs. Every outbound template is rendered with the real
// Dakota Prints lockup in the header and the CMYK stripe as the divider motif.
// TODO(resend): pass this HTML to Resend (or SES) in services.js → logMessage().

export function renderEmail({ origin = '', heading = '', body = '', shop = {}, cta = null }) {
  const logo = `${origin}/brand/logo-lockup-transparent.png`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escape(shop.name || 'Dakota Prints')} — ${escape(heading)}</title></head>
<body style="margin:0;background:#FAFAF9;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1F2328;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF9;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #E3E5E8;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:28px 32px 18px;text-align:center;background:#FFFFFF;">
          <img src="${logo}" width="240" alt="Dakota Prints" style="display:block;margin:0 auto;width:240px;max-width:70%;height:auto;" />
        </td></tr>
        <tr><td style="height:4px;padding:0;background:linear-gradient(to right,#00AEEF 0 25%,#EC008C 25% 50%,#FFF200 50% 75%,#1F2328 75% 100%);">&nbsp;</td></tr>
        <tr><td style="padding:26px 32px 8px;">
          <p style="margin:0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#5C636D;font-weight:700;">${escape(heading)}</p>
          <p style="margin:12px 0 0;font-size:16px;line-height:1.6;">${escape(body)}</p>
          ${cta ? `<p style="margin:22px 0 0;"><a href="${cta.href}" style="display:inline-block;background:#1F2328;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:8px;">${escape(cta.label)}</a></p>` : ''}
        </td></tr>
        <tr><td style="padding:24px 32px 28px;">
          <div style="height:2px;background:linear-gradient(to right,#00AEEF 0 25%,#EC008C 25% 50%,#FFF200 50% 75%,#1F2328 75% 100%);"></div>
          <p style="margin:16px 0 0;font-size:12.5px;line-height:1.7;color:#5C636D;">
            <strong style="color:#1F2328;">${escape(shop.name || 'Dakota Prints')}</strong><br />
            ${escape(shop.address || '')}<br />
            ${escape(shop.phone || '')} · ${escape(shop.email || '')}
          </p>
        </td></tr>
      </table>
      <p style="margin:14px 0 0;font-size:11px;color:#9AA1AA;">Sent by Dakota Prints OS · stub template (Resend drops in here)</p>
    </td></tr>
  </table>
</body></html>`;
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
