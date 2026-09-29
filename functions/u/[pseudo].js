/**
 * Routage dynamique : /u/<pseudo>  →  le portfolio public du créateur.
 *
 * Cloudflare Pages Functions — inclus dans l'offre GRATUITE (100 000 appels
 * par jour). C'est ce qui rend possible une adresse propre du type
 * souanpt-hub.fr/u/souanpt, impossible avec un hébergement purement statique.
 *
 * Le pseudo est résolu via l'API REST de Firestore, SANS authentification :
 * la collection `users` est en lecture publique (firestore.rules), c'est le
 * même accès que le classement. Aucun secret n'est nécessaire ici, donc
 * aucun secret ne vit dans cette fonction.
 *
 * La page du créateur est ensuite RELAYÉE plutôt que redirigée, pour que
 * l'adresse affichée reste souanpt-hub.fr/u/<pseudo>. Une balise <base> est
 * injectée afin que les liens relatifs du site continuent de pointer vers
 * leur origine réelle.
 *
 * ⚠ P0 — relayer revient à exécuter le HTML d'AUTRUI sur NOTRE origine. Le
 * JavaScript du créateur y aurait alors lu localStorage et volé les jetons des
 * visiteurs (dont le jeton GitHub d'organisation, souanpt_auth_v2). La réponse
 * porte donc un `Content-Security-Policy: sandbox` sans `allow-same-origin` :
 * le document reçoit une ORIGINE OPAQUE, sans accès à notre localStorage, à nos
 * cookies ni à nos service workers, pendant que scripts, formulaires et liens
 * restent pleinement fonctionnels.
 */

const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/souanpt-hub/databases/(default)/documents:runQuery';
const API_KEY   = 'AIzaSyCBe6IUWsTBJ0H29KNxw5qU3YiC32Nenvk';   // clé Web publique par conception

// `sandbox` seul : aucune restriction de ressource (pas de default-src), donc
// polices, images et scripts distants du site relayé continuent de charger.
// allow-top-navigation = les liens du site peuvent naviguer l'onglet.
const RELAY_CSP = 'sandbox allow-scripts allow-popups allow-forms allow-modals '
                + 'allow-top-navigation allow-downloads';

/** Valeur Firestore → valeur JS (on ne gère que ce dont on a besoin). */
function val(v) {
  if (!v) return undefined;
  if (v.stringValue !== undefined)  return v.stringValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  return undefined;
}

/** Échappement d'attribut — la balise <base> reçoit une valeur de profil. */
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** P0 : n'accepte que des URL http(s) réellement valides, normalisées par le
 *  parseur d'URL du runtime. Tout le reste (javascript:, data:, forme
 *  cassée…) est rejeté avant d'atteindre un fetch ou une redirection. */
function safeUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch { return ''; }
}

/** URL publique du créateur : domaine perso > site déclaré > GitHub Pages. */
function siteUrl(u) {
  const dom = val(u.customDomain);
  if (dom) {
    const s = safeUrl(/^https?:\/\//.test(dom) ? dom : 'https://' + dom);
    if (s) return s;
  }
  const declared = val(u.siteUrl);
  if (declared) {
    const s = safeUrl(declared);
    if (s) return s;
  }
  const repo = val(u.repo);
  if (repo) {
    const [owner, name] = String(repo).split('/');
    if (owner && name) return safeUrl(`https://${owner.toLowerCase()}.github.io/${name}/`);
  }
  return '';
}

/** Redirection sûre : `Response.redirect` lève sur une URL non http(s). */
function redirectTo(target) {
  try { return Response.redirect(target, 302); }
  catch { return page('Site injoignable', 'Ce site ne répond pas pour le moment.', 502); }
}

function page(title, message, code) {
  return new Response(`<!DOCTYPE html><html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title} — souanpt.hub</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#060606;color:#f0ece4;
font-family:'Syne',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;
justify-content:center;padding:24px;text-align:center}h1{font-size:26px;font-weight:800;
letter-spacing:-1px;margin-bottom:12px}p{font-size:14px;color:rgba(240,236,228,.6);
line-height:1.7;max-width:420px;margin:0 auto 26px}a{display:inline-block;padding:12px 24px;
border-radius:12px;background:#C8FF00;color:#060606;font-size:13px;font-weight:800;
text-decoration:none}</style></head><body><div>
<h1>${title}</h1><p>${message}</p><a href="/">← souanpt.hub</a></div></body></html>`,
    { status: code, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestGet({ params }) {
  // Un pseudo ne contient que des caractères simples : on refuse le reste avant
  // toute requête, plutôt que de laisser une entrée libre atteindre Firestore.
  const pseudo = String(params.pseudo || '').trim().replace(/^@/, '');
  if (!pseudo || !/^[\w.-]{2,40}$/.test(pseudo)) {
    return page('Adresse invalide', 'Ce lien ne correspond à aucun créateur.', 404);
  }

  let user = null;
  try {
    const res = await fetch(`${FIRESTORE}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: { fieldFilter: { field: { fieldPath: 'pseudo' }, op: 'EQUAL', value: { stringValue: pseudo } } },
          limit: 1,
        },
      }),
      // Le couple pseudo → site bouge très rarement : on met en cache au bord
      // pour ne pas relancer une requête Firestore à chaque visite.
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    const rows = await res.json();
    const doc = Array.isArray(rows) ? rows.find(r => r && r.document) : null;
    if (doc) user = doc.document.fields || null;
  } catch (e) {
    return page('Service indisponible', 'Impossible de joindre l’annuaire des créateurs. Réessaie dans un instant.', 502);
  }

  if (!user) return page('Créateur introuvable', `Aucun créateur ne porte le pseudo « ${pseudo} ».`, 404);
  // Un profil retiré du public ne doit pas être atteignable par cette adresse.
  if (val(user.public) === false) return page('Profil privé', 'Ce créateur a choisi de ne pas apparaître publiquement.', 404);

  const target = siteUrl(user);
  if (!target) return page('Site non publié', `« ${pseudo} » n’a pas encore publié de site.`, 404);

  // Relais : l'adresse reste /u/<pseudo>. Si la page du créateur ne répond pas,
  // on redirige plutôt que d'afficher une erreur — son site reste accessible.
  try {
    const upstream = await fetch(target, { cf: { cacheTtl: 60, cacheEverything: true } });
    if (!upstream.ok) return redirectTo(target);
    let html = await upstream.text();
    // La base est construite sur l'URL FINALE (après redirections), déjà
    // normalisée par le parseur, puis échappée : une valeur de profil ne doit
    // jamais casser hors de l'attribut href. On pointe sur le répertoire de la
    // page pour que les liens relatifs restent sur l'origine du créateur —
    // sauf quand l'URL finit déjà par un fichier.
    const finalUrl = upstream.url || target;
    const lastSeg = finalUrl.split('/').pop() || '';
    const dirUrl  = (lastSeg.includes('.') || finalUrl.endsWith('/'))
      ? finalUrl
      : finalUrl + '/';
    const base = `<base href="${esc(dirUrl)}">`;
    html = html.includes('<head>') ? html.replace('<head>', '<head>' + base) : base + html;
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=60',
        // P0 : origine opaque pour ce HTML tiers (voir l'en-tête du fichier).
        'content-security-policy': RELAY_CSP,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
    });
  } catch (e) {
    return redirectTo(target);
  }
}
