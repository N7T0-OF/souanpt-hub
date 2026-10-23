/* ══════════════════════════════════════════════════════════════════════════
   SiteTheme — palettes, contraste et import/export du thème du site public.

   Un « thème » = les seuls réglages visuels de SiteConfig (jamais le contenu) :
   accentColor, theme (fond), layout, layoutStyle, font, radius, animLevel, fx.
   sanitize() n'accepte que des valeurs connues et bornées : un JSON collé ne
   peut ni injecter de CSS ni toucher au contenu du site.

   Le générateur distingue sombre/clair par `theme === '#f8f8f8'` : les
   palettes n'emploient donc que ces deux fonds.
   ══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  const DARK = '#060606', LIGHT = '#f8f8f8';
  const KEYS = ['accentColor', 'theme', 'layout', 'layoutStyle', 'font', 'radius', 'animLevel', 'fx'];
  const FONTS = ['syne', 'inter', 'grotesk', 'serif', 'mono', 'system'];
  const RADII = ['default', 'sharp', 'soft', 'round'];
  const STYLES = ['float', 'sidebar', 'bento'];
  const ANIMS = ['none', 'light', 'smooth', 'premium'];
  const FX = ['tilt', 'shine', 'lift', 'glow', 'mouseglow'];

  const PRESETS = [
    { id: 'lime',   label: 'Néon',    accentColor: '#C8FF00', theme: DARK },
    { id: 'ocean',  label: 'Océan',   accentColor: '#38BDF8', theme: DARK },
    { id: 'coral',  label: 'Corail',  accentColor: '#FF6B6B', theme: DARK },
    { id: 'violet', label: 'Violet',  accentColor: '#A78BFA', theme: DARK },
    { id: 'gold',   label: 'Or',      accentColor: '#E4B24A', theme: DARK },
    { id: 'paper',  label: 'Papier',  accentColor: '#FF5A1F', theme: LIGHT },
    { id: 'mint',   label: 'Menthe',  accentColor: '#10B981', theme: LIGHT },
  ];

  /** Luminance relative WCAG d'une couleur #rrggbb. */
  function lum(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255]
      .map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  }
  /** Rapport de contraste WCAG (1 à 21), ou null si une couleur est invalide. */
  function contrast(a, b) {
    const la = lum(a), lb = lum(b);
    if (la === null || lb === null) return null;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /**
   * Ce qui compte sur le site généré : l'accent sert de COULEUR DE TEXTE sur le
   * fond (tags, liens) et de FOND des boutons, écrits en #060606.
   * Seuil 3:1 = éléments d'interface et gros texte (WCAG 1.4.11 / 1.4.3).
   */
  function checkContrast(cfg) {
    const accent = cfg && cfg.accentColor, bg = (cfg && cfg.theme) || DARK;
    const onBg = contrast(accent, bg), onBtn = contrast(accent, DARK);
    return {
      onBg, onBtn,
      ok: onBg !== null && onBtn !== null && onBg >= 3 && onBtn >= 3,
    };
  }

  /** Garde uniquement les réglages visuels valides. Retourne {} si rien n'est exploitable. */
  function sanitize(input) {
    const src = input && typeof input === 'object' ? input : {};
    const out = {};
    if (/^#[0-9a-f]{6}$/i.test(String(src.accentColor || ''))) out.accentColor = src.accentColor;
    if (src.theme === DARK || src.theme === LIGHT) out.theme = src.theme;
    if (['2', '3', '4'].includes(String(src.layout))) out.layout = String(src.layout);
    if (STYLES.includes(src.layoutStyle)) out.layoutStyle = src.layoutStyle;
    if (FONTS.includes(src.font)) out.font = src.font;
    if (RADII.includes(src.radius)) out.radius = src.radius;
    if (ANIMS.includes(src.animLevel)) out.animLevel = src.animLevel;
    if (src.fx && typeof src.fx === 'object') {
      const fx = {};
      FX.forEach(k => { if (typeof src.fx[k] === 'boolean') fx[k] = src.fx[k]; });
      const i = Number(src.fx.intensity);
      if (Number.isFinite(i)) fx.intensity = Math.min(16, Math.max(3, Math.round(i)));
      if (Object.keys(fx).length) out.fx = fx;
    }
    return out;
  }

  /** Texte JSON → thème validé. Lève une erreur lisible si le JSON est illisible ou vide. */
  function parse(text) {
    let data;
    try { data = JSON.parse(String(text || '')); } catch { throw new Error('JSON illisible'); }
    const theme = sanitize(data && data.theme && typeof data.theme === 'object' ? data.theme : data);
    if (!Object.keys(theme).length) throw new Error('Aucun réglage de thème reconnu');
    return theme;
  }

  /** Thème courant → JSON partageable (aucun contenu du site). */
  function serialize(cfg) {
    const picked = {};
    KEYS.forEach(k => { if (cfg && cfg[k] !== undefined) picked[k] = cfg[k]; });
    return JSON.stringify({ kind: 'souanpt-theme', version: 1, theme: sanitize(picked) }, null, 2);
  }

  root.SiteTheme = { DARK, LIGHT, KEYS, FONTS, RADII, PRESETS, contrast, checkContrast, sanitize, parse, serialize };
})(typeof window !== 'undefined' ? window : globalThis);
