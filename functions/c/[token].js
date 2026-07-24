/**
 * /c/<token> — LE lien unique du client, valable de la demande à la livraison.
 *
 * Ce n'est pas une nouvelle page : c'est un RÉSOLVEUR. Il regarde à quelle
 * étape se trouve le dossier et sert la vue correspondante, sans que le client
 * ait jamais à changer d'adresse. C'est le point du cahier « le lien et son
 * code d'accès restent identiques ».
 *
 * Aucune donnée n'est déplacée ni dupliquée : on lit les collections qui
 * existent déjà. Les anciennes adresses (/estimate/<code> et
 * portal.html?id=<id>) continuent de fonctionner telles quelles.
 *
 * Étapes résolues aujourd'hui :
 *   estimates/<token>  → estimation & négociation (rendu ICI, l'adresse reste /c/…)
 *   portals/<token>    → portail de production (redirection, page existante)
 */

import { onRequestGet as renderEstimate } from '../estimate/[code].js';
import { onRequestGet as renderRequest } from '../request/[token].js';

const PROJECT = 'souanpt-hub';
const API_KEY = 'AIzaSyCBe6IUWsTBJ0H29KNxw5qU3YiC32Nenvk';   // clé Web publique par conception
const DOCS    = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

function notFound(msg) {
  return new Response(`<!DOCTYPE html><html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Lien introuvable — souanpt.hub</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#060606;color:#f0ece4;
font-family:'Syne',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;
justify-content:center;padding:24px;text-align:center}h1{font-size:24px;font-weight:800;
letter-spacing:-1px;margin-bottom:12px}p{font-size:14px;color:rgba(240,236,228,.6);
line-height:1.7;max-width:420px}</style></head><body><div>
<h1>Lien introuvable</h1><p>${msg}</p></div></body></html>`,
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** Le document existe-t-il ? (lecture publique, pas de secret nécessaire) */
async function exists(collection, id) {
  try {
    const r = await fetch(`${DOCS}/${collection}/${encodeURIComponent(id)}?key=${API_KEY}`);
    return r.ok;
  } catch (e) { return false; }
}

export async function onRequestGet(ctx) {
  const token = String(ctx.params.token || '').trim();
  // Validé avant toute requête : une entrée libre ne doit pas atteindre Firestore.
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(token)) {
    return notFound('Ce lien n’est pas valide. Vérifie l’adresse que tu as reçue.');
  }

  // 1. Étape production D'ABORD : une fois la mission lancée, un portail existe
  //    avec le MÊME jeton que l'estimation. Le portail l'emporte donc — sinon
  //    le client verrait encore l'estimation après le lancement.
  if (await exists('portals', token)) {
    return Response.redirect(new URL('/portal.html?id=' + encodeURIComponent(token), ctx.request.url).toString(), 302);
  }

  // 2. Étape commerciale — rendue ICI pour que l'adresse reste /c/<token>.
  if (await exists('estimates', token)) {
    return renderEstimate({ ...ctx, params: { code: token } });
  }

  // 3. Étape AMONT : formulaire de demande. Le créateur a partagé un lien de
  //    demande (requests/<token>) → le client décrit son besoin et dépose ses
  //    références sur ce MÊME /c/, avant même qu'une estimation existe.
  if (await exists('requests', token)) {
    return renderRequest({ ...ctx, params: { token } });
  }

  return notFound('Ce dossier n’existe pas, ou il a été retiré par son auteur.');
}
