/**
 * /api/behance?url=<lien d'un projet Behance> — nom d'un projet via l'oEmbed OFFICIEL (v3.29.2).
 *
 * Pourquoi : le flux RSS des profils Behance (`/feeds/user`) n'existe plus (404) ;
 * les relais CORS publics renvoyaient en plus des 403. Behance ne fournit plus
 * d'API pour LISTER les projets d'un profil, et on ne lit pas ses pages en se
 * faisant passer pour un navigateur. Il reste son point d'accès oEmbed public,
 * déclaré sur oembed.com (`https://www.behance.net/services/oembed`), fait pour
 * ça : le hub colle des liens de projets, ce relais renvoie titre et auteur.
 * L'oEmbed n'envoie aucun en-tête CORS : d'où ce relais.
 *
 * Ce n'est PAS un proxy générique : seule une adresse de projet Behance
 * (`https://www.behance.net/gallery/<numéro>/<nom>`) est acceptée, la cible est
 * reconstruite ici, l'origine doit être dans la liste blanche, et le client
 * s'annonce honnêtement (pas de faux navigateur).
 */

import { corsHeaders, originAllowed } from './auth.js';

export const OEMBED = 'https://www.behance.net/services/oembed';
const UA = 'souanpt-hub (oEmbed client; +https://souanptjub.pages.dev)';

/** Lien de projet Behance → { id, url } normalisé, ou null. */
export function galleryUrl(v) {
  const m = String(v || '').trim().match(/^https?:\/\/(?:www\.)?behance\.net\/gallery\/(\d{3,12})(?:\/([A-Za-z0-9._~%-]{0,200}))?\/?(?:[?#].*)?$/i);
  if (!m) return null;
  return { id: m[1], url: 'https://www.behance.net/gallery/' + m[1] + (m[2] ? '/' + m[2] : '') };
}
/** « Titre - Auteur » → « Titre » (l'oEmbed ajoute le nom de l'auteur). */
export function cleanTitle(title, author) {
  let t = String(title || '').replace(/[\u0000-\u001f]/g, '').trim();
  const a = String(author || '').trim();
  if (a && t.endsWith(' - ' + a)) t = t.slice(0, -(a.length + 3));
  t = t.replace(/[\s⠀]+$/, '');
  return t.slice(0, 120) || 'Projet';
}
/** Pseudo du profil depuis author_url (`https://www.behance.net/<pseudo>`). */
export function userOf(authorUrl) {
  const m = String(authorUrl || '').match(/^https?:\/\/(?:www\.)?behance\.net\/([A-Za-z0-9_-]{2,40})\/?$/i);
  return m ? m[1] : '';
}

function reply(request, env, data, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(data), {
    status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': cache }, corsHeaders(request, env)),
  });
}

export async function onRequest(context) {
  const { request } = context;
  const env = context.env || {};
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.method !== 'GET') return reply(request, env, { error: 'méthode refusée' }, 405);
  if (!originAllowed(request, env)) return reply(request, env, { error: 'origine refusée', code: 'ORIGIN' }, 403);
  const g = galleryUrl(new URL(request.url).searchParams.get('url'));
  if (!g) return reply(request, env, { error: 'lien de projet Behance attendu (behance.net/gallery/…)', code: 'URL' }, 400);
  let r;
  try {
    r = await fetch(OEMBED + '?format=json&url=' + encodeURIComponent(g.url), {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
  } catch { return reply(request, env, { error: 'Behance ne répond pas', code: 'UPSTREAM' }, 504); }
  if (r.status === 404) return reply(request, env, { error: 'projet introuvable ou privé', code: 'NOT_FOUND' }, 404);
  if (!r.ok) return reply(request, env, { error: 'Behance a répondu ' + r.status, code: 'UPSTREAM', status: r.status }, 502);
  let d; try { d = await r.json(); } catch { return reply(request, env, { error: 'réponse Behance illisible', code: 'UPSTREAM' }, 502); }
  return reply(request, env, {
    id: g.id, url: g.url,
    title: cleanTitle(d.title, d.author_name),
    author: String(d.author_name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80),
    user: userOf(d.author_url),
  }, 200, 'public, max-age=3600');
}
