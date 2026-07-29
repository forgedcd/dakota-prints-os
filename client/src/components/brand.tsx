// Dakota Prints brand furniture. These wrap the REAL supplied logo files in
// client/public/brand — never substitute a drawn SVG for the lockup.
//
//   logo-lockup-transparent.png  pheasant + CMYK streak + DAKOTA PRINTS wordmark
//   logo-mark-transparent.png    pheasant + streak only (small sizes / collapsed nav)
//   *-knockout.png               light versions for dark surfaces
//
// Paths are relative ("./brand/...") so the app works both at a domain root on
// Render and inside a nested preview path.

type LogoProps = { width?: number; className?: string; knockout?: boolean; priority?: boolean };

const LOCKUP_RATIO = 536 / 791; // intrinsic height / width
const MARK_RATIO = 258 / 686;

/** Full lockup — login, sidebar, job ticket, packing slip, print + email headers. */
export function DakotaLockup({ width = 180, className = '', knockout = false, priority = false }: LogoProps) {
  return (
    <img
      src={`./brand/logo-lockup-${knockout ? 'knockout' : 'transparent'}.png`}
      alt="Dakota Prints"
      width={width}
      height={Math.round(width * LOCKUP_RATIO)}
      style={{ width, height: 'auto', maxWidth: '100%' }}
      className={`block object-contain ${className}`}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}

/** Pheasant + CMYK streak only — mobile top bar, collapsed nav, favicons, avatars. */
export function DakotaMark({ width = 40, className = '', knockout = false }: LogoProps) {
  return (
    <img
      src={`./brand/logo-mark-${knockout ? 'knockout' : 'transparent'}.png`}
      alt="Dakota Prints"
      width={width}
      height={Math.round(width * MARK_RATIO)}
      style={{ width, height: 'auto' }}
      className={`block object-contain ${className}`}
      loading="eager"
      decoding="async"
    />
  );
}

/** The signature 4-colour process stripe. Thin and deliberate — used as a divider. */
export function CmykRule({ className = '' }: { className?: string }) {
  return <div className={`cmyk-rule ${className}`} aria-hidden="true" />;
}
