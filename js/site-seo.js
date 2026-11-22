/* ══════════════════════════════════════════════════════════════
   RÉFÉRENCEMENT (SEO) DU SITE PUBLIÉ (v3.18)

   haunt.gg est une page de liens : elle ne se classe pas sur Google pour
   un métier. Le site, lui, peut le faire. Ce module produit :
     • <title>, description, URL canonique, robots, couleur du thème ;
     • aperçus de partage Open Graph / Twitter (Discord, X, WhatsApp…) ;
     • données structurées JSON-LD : WebSite, Person (métier, ville,
       profils liés dont haunt.gg), liste des projets, et — s'il y en a —
       les avis validés affichés sur la page avec leur note moyenne ;
     • sitemap.xml (avec les images des projets, pour Google Images) et
       robots.txt, publiés à côté de index.html ;
     • un audit avec score et conseils pour l'éditeur.
   Tout texte est échappé ; le JSON-LD a ses `<` échappés.
══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const BAD = new RegExp('[\\x00-\\x1f' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
  const txt = (v, max) => String(v == null ? '' : v).replace(BAD, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const https = v => { const s = String(v || '').trim(); return /^https:\/\/[^\s<>"']+$/i.test(s) ? s : ''; };
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const xml = s => esc(s).replace(/'/g, '&apos;');
  const hauntUrl = u => { const n = String(u || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?haunt\.gg\//i, '').split(/[/?#]/)[0]; return /^[A-Za-z0-9._-]{1,32}$/.test(n) ? 'https://haunt.gg/' + n : ''; };

  /** Réglages SEO bornés (cfg.seo) + valeurs dérivées du reste du site. */
  function sanitize(cfg) {
    cfg = cfg || {};
    const s = cfg.seo && typeof cfg.seo === 'object' ? cfg.seo : {};
    let url = https(s.siteUrl) || https(cfg.siteUrl);
    if (url && !/\/$/.test(url) && !/\.[a-z0-9]{2,5}$/i.test(url)) url += '/';
    return {
      title: txt(s.title, 70),
      description: txt(s.description, 170),
      jobTitle: txt(s.jobTitle, 80),
      city: txt(s.city, 60),
      shareImage: https(s.shareImage),
      index: s.index !== false,
      siteUrl: url,
      haunt: hauntUrl(s.haunt || cfg.hauntUser),
    };
  }

  /** Valeurs finales utilisées dans la page. */
  function resolve(cfg, projects, reviews) {
    const s = sanitize(cfg);
    const name = txt(cfg.siteName, 60) || 'Portfolio';
    const bio = txt(cfg.bio, 160);
    const title = s.title || [name, s.jobTitle || 'Portfolio', s.city].filter(Boolean).join(' — ').slice(0, 70);
    const description = s.description || txt([bio, s.jobTitle && !bio.includes(s.jobTitle) ? s.jobTitle : '', s.city ? 'Basé à ' + s.city + '.' : ''].filter(Boolean).join('. ').replace(/\.\./g, '.'), 170) || ('Portfolio de ' + name + '.');
    const covers = (projects || []).map(p => https(p && p.cover)).filter(Boolean);
    const image = s.shareImage || https(cfg.heroImage) || covers[0] || https(cfg.siteLogo) || '';
    const approved = (reviews || []).filter(r => r && r.status === 'approved' && Number(r.rating) >= 1 && Number(r.rating) <= 5);
    return { s, name, title, description, image, approved };
  }

  /** Profils liés : haunt.gg + les liens VISIBLES fournis par le générateur
      (jamais un lien masqué). */
  function sameAs(s, links) {
    const out = [];
    if (s.haunt) out.push(s.haunt);
    (links || []).forEach(l => { const u = https(l && l.url); if (u && !out.includes(u)) out.push(u); });
    return out.slice(0, 15);
  }

  function jsonLd(cfg, projects, reviews, links) {
    const r = resolve(cfg, projects, reviews), s = r.s;
    const base = s.siteUrl || undefined;
    const person = {
      '@type': 'Person', '@id': (base || '') + '#me', name: r.name,
      description: txt(cfg.bio, 300) || undefined, jobTitle: s.jobTitle || undefined,
      url: base, image: https(cfg.siteLogo) || r.image || undefined,
      address: s.city ? { '@type': 'PostalAddress', addressLocality: s.city } : undefined,
      email: /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(cfg.email || '') ? 'mailto:' + cfg.email : undefined,
      sameAs: sameAs(s, links),
    };
    const graph = [
      { '@type': 'WebSite', '@id': (base || '') + '#site', name: r.name, url: base, inLanguage: 'fr', description: r.description, publisher: { '@id': person['@id'] } },
      person,
    ];
    const works = (projects || []).slice(0, 30).map(p => ({
      '@type': 'CreativeWork', name: txt(p.title, 120) || 'Projet', image: https(p.cover) || undefined,
      url: (base && projectPath(p)) ? base + projectPath(p) : (https(p.url) || undefined), sameAs: https(p.url) || undefined, keywords: Array.isArray(p.tags) && p.tags.length ? p.tags.map(t => txt(t, 30)).join(', ') : undefined,
      creator: { '@id': person['@id'] },
    }));
    if (works.length) graph.push({ '@type': 'ItemList', name: 'Projets', itemListElement: works.map((w, i) => ({ '@type': 'ListItem', position: i + 1, item: w })) });
    if (r.approved.length) {
      const avg = r.approved.reduce((n, x) => n + Number(x.rating), 0) / r.approved.length;
      graph.push({
        '@type': 'Service', name: s.jobTitle || ('Services de ' + r.name), provider: { '@id': person['@id'] },
        areaServed: s.city || undefined,
        aggregateRating: { '@type': 'AggregateRating', ratingValue: Math.round(avg * 10) / 10, reviewCount: r.approved.length, bestRating: 5, worstRating: 1 },
        review: r.approved.slice(0, 20).map(x => ({ '@type': 'Review', author: { '@type': 'Person', name: txt(x.author, 60) || 'Client' }, reviewBody: txt(x.text, 500) || undefined, reviewRating: { '@type': 'Rating', ratingValue: Number(x.rating), bestRating: 5 } })),
      });
    }
    return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  }

  /** Balises du <head> (remplacent l'ancien <title> + description). */
  function head(cfg, projects, reviews, links) {
    const r = resolve(cfg, projects, reviews), s = r.s;
    const accent = /^#[0-9a-f]{6}$/i.test(cfg.accentColor || '') ? cfg.accentColor : '';
    const t = [
      `<title>${esc(r.title)}</title>`,
      `<meta name="description" content="${esc(r.description)}">`,
      `<meta name="robots" content="${s.index ? 'index,follow,max-image-preview:large' : 'noindex,nofollow'}">`,
      s.siteUrl ? `<link rel="canonical" href="${esc(s.siteUrl)}">` : '',
      accent ? `<meta name="theme-color" content="${accent}">` : '',
      `<meta property="og:type" content="website">`, `<meta property="og:locale" content="fr_FR">`,
      `<meta property="og:site_name" content="${esc(r.name)}">`,
      `<meta property="og:title" content="${esc(r.title)}">`, `<meta property="og:description" content="${esc(r.description)}">`,
      s.siteUrl ? `<meta property="og:url" content="${esc(s.siteUrl)}">` : '',
      r.image ? `<meta property="og:image" content="${esc(r.image)}">` : '',
      `<meta name="twitter:card" content="${r.image ? 'summary_large_image' : 'summary'}">`,
      `<meta name="twitter:title" content="${esc(r.title)}">`, `<meta name="twitter:description" content="${esc(r.description)}">`,
      r.image ? `<meta name="twitter:image" content="${esc(r.image)}">` : '',
      s.haunt ? `<link rel="me" href="${esc(s.haunt)}">` : '',
      `<script type="application/ld+json">${jsonLd(cfg, projects, reviews, links)}</script>`,
    ];
    return t.filter(Boolean).join('\n');
  }

  /* ── Une page par projet (v3.19) : projets/<titre>-<id>/ ──
     Chaque projet devient une adresse indexable et partageable (comme sur
     Contra ou Behance) : titre, description, couverture, galerie, tags,
     lien Behance, bouton contact/devis et liens vers les autres projets. */
  const DIACRITICS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
  function projectSlug(p) {
    const id = String((p && p.id) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (!id) return '';
    const base = String((p && p.title) || 'projet').normalize('NFD').replace(DIACRITICS, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'projet';
    return base + '-' + id;
  }
  /** Encre lisible sur l'accent (contraste WCAG le plus élevé). */
  function inkOn(hex) {
    const n = parseInt(String(hex).slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return (L + 0.05) / 0.0519 >= 1.05 / (L + 0.05) ? '#060606' : '#ffffff';
  }
  function projectPath(p) { const sl = projectSlug(p); return sl ? 'projets/' + sl + '/' : ''; }
  const img = v => { const s = String(v || ''); return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : https(s); };
  function galleryOf(p) {
    const g = p && p.preview && Array.isArray(p.preview.gallery) ? p.preview.gallery : [];
    return g.map(x => img(typeof x === 'string' ? x : x && x.src)).filter(Boolean).slice(0, 40);
  }

  function projectPage(cfg, p, all) {
    const s = sanitize(cfg), path = projectPath(p);
    const name = txt(cfg.siteName, 60) || 'Portfolio';
    const title = txt(p.title, 120) || 'Projet';
    const tags = (Array.isArray(p.tags) ? p.tags : []).map(t => txt(t, 30)).filter(Boolean).slice(0, 8);
    const sub = txt(p.sub || p.text, 300);
    const desc = txt(sub || [title, tags.length ? '(' + tags.join(', ') + ')' : '', 'par ' + name + (s.jobTitle ? ', ' + s.jobTitle : '') + '.'].filter(Boolean).join(' '), 170);
    const url = s.siteUrl ? s.siteUrl + path : '';
    const cover = img(p.cover), shareImg = https(p.cover) || s.shareImage || '';
    const gallery = galleryOf(p);
    const link = https(p.url);
    const dark = !/^#f/i.test(String(cfg.theme || ''));
    const accent = /^#[0-9a-f]{6}$/i.test(cfg.accentColor || '') ? cfg.accentColor : '#C8FF00';
    const bg = /^#[0-9a-f]{6}$/i.test(cfg.theme || '') ? cfg.theme : '#060606';
    const others = (all || []).filter(o => o !== p && projectPath(o)).slice(0, 6);
    const back = hauntBack(cfg);
    const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'CreativeWork', name: title, description: desc, image: shareImg || undefined, url: url || undefined, keywords: tags.join(', ') || undefined,
        creator: { '@type': 'Person', name, url: s.siteUrl || undefined, jobTitle: s.jobTitle || undefined }, sameAs: link ? [link] : undefined },
      s.siteUrl ? { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name, item: s.siteUrl },
        { '@type': 'ListItem', position: 2, name: 'Projets', item: s.siteUrl + '#projects' },
        { '@type': 'ListItem', position: 3, name: title, item: url } ] } : undefined,
    ].filter(Boolean) }).replace(/</g, '\\u003c');
    const head = [
      `<title>${esc(title + ' — ' + name)}</title>`,
      `<meta name="description" content="${esc(desc)}">`,
      `<meta name="robots" content="${s.index ? 'index,follow,max-image-preview:large' : 'noindex,nofollow'}">`,
      url ? `<link rel="canonical" href="${esc(url)}">` : '',
      `<meta name="theme-color" content="${accent}">`,
      `<meta property="og:type" content="article">`, `<meta property="og:locale" content="fr_FR">`, `<meta property="og:site_name" content="${esc(name)}">`,
      `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`,
      url ? `<meta property="og:url" content="${esc(url)}">` : '', shareImg ? `<meta property="og:image" content="${esc(shareImg)}">` : '',
      `<meta name="twitter:card" content="${shareImg ? 'summary_large_image' : 'summary'}">`,
      s.haunt ? `<link rel="me" href="${esc(s.haunt)}">` : '',
      `<script type="application/ld+json">${ld}</script>`,
    ].filter(Boolean).join('\n');
    return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${head}
<style>
:root{--a:${accent};--bg:${bg};--t:${dark ? '#f2f2f2' : '#141414'};--m:${dark ? '#9a9a9a' : '#5a5a5a'};--s:${dark ? '#121212' : '#ffffff'};--b:${dark ? '#262626' : '#e3e3e3'}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:15px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif}
a{color:inherit}.w{max-width:980px;margin:0 auto;padding:22px 18px 96px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:26px;font-size:13px}
.top a{text-decoration:none;color:var(--m)}.top a:hover{color:var(--t)}.brand{font-weight:800;color:var(--t)!important;font-size:15px}
h1{font-size:clamp(28px,5vw,46px);line-height:1.1;margin:0 0 10px;letter-spacing:-.02em}
.sub{color:var(--m);font-size:16px;margin:0 0 16px;max-width:720px}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 22px;padding:0;list-style:none}.tags li{font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid var(--b);color:var(--m)}
.cta{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 26px}.btn{display:inline-flex;align-items:center;gap:6px;padding:11px 20px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none;border:1px solid var(--b)}
.btn.p{background:var(--a);border-color:var(--a);color:${inkOn(accent)}}
figure{margin:0 0 14px;border-radius:14px;overflow:hidden;border:1px solid var(--b);background:var(--s)}figure img{display:block;width:100%;height:auto}
.more{margin-top:44px;border-top:1px solid var(--b);padding-top:22px}.more h2{font-size:18px;margin:0 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.card{display:block;text-decoration:none;border:1px solid var(--b);border-radius:12px;overflow:hidden;background:var(--s)}
.card img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;background:var(--b)}.card span{display:block;padding:9px 11px;font-size:13px;font-weight:600}
footer{margin-top:40px;font-size:12px;color:var(--m)}
${back.css}
</style></head><body>
<main class="w">
  <nav class="top" aria-label="Fil d'Ariane"><a class="brand" href="../../">${esc(name)}</a><a href="../../#projects">← Tous les projets</a></nav>
  <article>
    <h1>${esc(title)}</h1>
    ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
    ${tags.length ? `<ul class="tags">${tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <div class="cta"><a class="btn p" href="../../#contact">✉ Me contacter / devis</a>${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">${/behance\.net/i.test(link) ? 'Voir sur Behance' : 'Voir le projet'} ↗</a>` : ''}</div>
    ${cover && !gallery.includes(cover) ? `<figure><img src="${esc(cover)}" alt="${esc(title)}" fetchpriority="high"></figure>` : ''}
    ${gallery.map((g, i) => `<figure><img src="${esc(g)}" alt="${esc(title + ' — image ' + (i + 1))}" loading="${i < 1 && !cover ? 'eager' : 'lazy'}" decoding="async"></figure>`).join('')}
  </article>
  ${others.length ? `<section class="more"><h2>Autres projets</h2><div class="grid">${others.map(o => { const oc = img(o.cover); return `<a class="card" href="../${esc(projectSlug(o))}/">${oc ? `<img src="${esc(oc)}" alt="" loading="lazy">` : ''}<span>${esc(txt(o.title, 80) || 'Projet')}</span></a>`; }).join('')}</div></section>` : ''}
  <footer>© ${esc(name)}${s.jobTitle ? ' · ' + esc(s.jobTitle) : ''}${s.city ? ' · ' + esc(s.city) : ''}</footer>
</main>
${back.body}
</body></html>`;
  }

  /** Fichiers publiés à côté de index.html : plan du site, robots.txt et
      une page par projet visible. */
  function files(cfg, projects) {
    const s = sanitize(cfg);
    const day = new Date().toISOString().slice(0, 10);
    if (!s.siteUrl) return [];
    const ps = (projects || []).filter(p => projectPath(p));
    const imgs = ps.map(p => ({ loc: https(p && p.cover), title: txt(p && p.title, 120) })).filter(i => i.loc).slice(0, 1000);
    const pageUrl = p => `
  <url><loc>${xml(s.siteUrl + projectPath(p))}</loc><lastmod>${day}</lastmod>${https(p.cover) ? `<image:image><image:loc>${xml(https(p.cover))}</image:loc><image:title>${xml(txt(p.title, 120))}</image:title></image:image>` : ''}</url>`;
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url><loc>${xml(s.siteUrl)}</loc><lastmod>${day}</lastmod>${imgs.map(i => `
    <image:image><image:loc>${xml(i.loc)}</image:loc>${i.title ? `<image:title>${xml(i.title)}</image:title>` : ''}</image:image>`).join('')}
  </url>${ps.slice(0, 1000).map(pageUrl).join('')}
</urlset>
`;
    const robots = s.index ? `User-agent: *\nAllow: /\n\nSitemap: ${s.siteUrl}sitemap.xml\n` : 'User-agent: *\nDisallow: /\n';
    const pages = ps.slice(0, 300).map(p => ({ path: projectPath(p) + 'index.html', content: projectPage(cfg, p, ps) }));
    return [{ path: 'sitemap.xml', content: sitemap }, { path: 'robots.txt', content: robots }, ...pages];
  }

  /** Audit pour l'éditeur : [{ ok, label, tip }] + score sur 100. */
  function audit(cfg, projects, reviews) {
    const r = resolve(cfg, projects, reviews), s = r.s;
    const ps = projects || [];
    const checks = [
      [r.s.index, 'Site visible sur Google', 'Active « Autoriser Google à indexer le site ».'],
      [!!s.siteUrl, 'Adresse du site connue', 'Publie une première fois : l\'adresse sert au lien canonique et au plan du site.'],
      [r.title.length >= 25 && r.title.length <= 65, 'Titre de 25 à 65 caractères (' + r.title.length + ')', 'Mets ton nom + ton métier, ex. « Souanpt — Graphiste miniatures YouTube ».'],
      [r.description.length >= 70 && r.description.length <= 165, 'Description de 70 à 165 caractères (' + r.description.length + ')', 'Explique ce que tu fais, pour qui, et où.'],
      [!!s.jobTitle, 'Métier renseigné', 'Ajoute ton métier : c\'est ce que les gens tapent dans Google.'],
      [!!s.city, 'Ville ou région', 'Une ville aide les recherches locales (« graphiste Lyon »).'],
      [!!r.image, 'Image de partage', 'Ajoute une image (1200×630 idéalement) pour les aperçus Discord, X, WhatsApp.'],
      [ps.length >= 3, 'Au moins 3 projets (' + ps.length + ')', 'Plus de projets = plus de contenu à indexer.'],
      [ps.length > 0 && ps.filter(p => Array.isArray(p.tags) && p.tags.length).length >= Math.ceil(ps.length / 2), 'Projets avec des tags', 'Les tags servent de mots-clés aux projets.'],
      [r.approved.length >= 1, 'Avis clients validés (' + r.approved.length + ')', 'Les avis rassurent et sont décrits pour Google (note moyenne).'],
      [!!s.haunt, 'Profil haunt.gg relié', 'Indique ton pseudo haunt.gg : les deux pages se renforcent (liens « rel=me »).'],
    ].map(([ok, label, tip]) => ({ ok: !!ok, label, tip }));
    const score = Math.round(checks.filter(c => c.ok).length / checks.length * 100);
    return { score, checks, preview: { title: r.title, description: r.description, url: s.siteUrl, image: r.image } };
  }

  /* ── Liaison haunt.gg : le site est la suite du profil haunt.gg ──
     Bouton « ← haunt.gg/pseudo » : 'auto' = seulement pour un visiteur venu
     de haunt.gg (référent, ou ?from=haunt sur les liens fournis par l'éditeur),
     'always', ou 'off'. Retenu pour l'onglet (sessionStorage). */
  function hauntBack(cfg) {
    const url = hauntUrl(cfg && cfg.hauntUser);
    const mode = ['auto', 'always', 'off'].includes(cfg && cfg.hauntBack) ? cfg.hauntBack : 'auto';
    if (!url || mode === 'off') return { css: '', body: '' };
    const label = 'haunt.gg/' + url.slice('https://haunt.gg/'.length);
    const css = `
#hg-back{position:fixed;left:14px;bottom:14px;z-index:195;display:none;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;font:700 12px system-ui,sans-serif;color:var(--t);text-decoration:none;background:color-mix(in srgb,var(--bg) 72%,transparent);border:1px solid var(--a);box-shadow:0 0 14px color-mix(in srgb,var(--a) 35%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:transform .2s}
#hg-back:hover{transform:translateX(-3px)}
html.hg-on #hg-back{display:inline-flex}
html.hg-on #amb-corner{bottom:56px}
`;
    const body = `<a id="hg-back" href="${esc(url)}" rel="me noopener">← ${esc(label)}</a>
<script>(function(){var m=${JSON.stringify(mode)},on=m==='always',K='hg_from';try{var q=new URLSearchParams(location.search);if(q.get('from')==='haunt'){on=true;sessionStorage.setItem(K,'1');q.delete('from');var s=q.toString();history.replaceState(null,'',location.pathname+(s?'?'+s:'')+location.hash);}if(/(^|\\.)haunt\\.gg$/i.test(document.referrer?new URL(document.referrer).hostname:'')){on=true;sessionStorage.setItem(K,'1');}if(sessionStorage.getItem(K)==='1')on=true;}catch(e){}if(on)document.documentElement.classList.add('hg-on');})();</script>`;
    return { css, body };
  }

  /** Liens à coller sur le profil haunt.gg (tuiles Folio, Contact…). */
  function hauntLinks(cfg) {
    const s = sanitize(cfg);
    if (!s.siteUrl) return [];
    const u = (hash) => s.siteUrl + '?from=haunt' + (hash ? '#' + hash : '');
    return [
      { label: 'Accueil du site', url: u('') },
      { label: 'Folio — projets', url: u('projects') },
      { label: 'Contact / devis', url: u('contact') },
      { label: 'Avis clients', url: u('avis') },
    ];
  }

  root.SiteSEO = { sanitize, resolve, head, jsonLd, files, audit, hauntUrl, hauntBack, hauntLinks, projectSlug, projectPath, projectPage };
})(typeof window !== 'undefined' ? window : globalThis);
