/**
 * Cloudflare Worker — Premium AUTOMATIQUE via Stripe (option 100% auto & sécurisée).
 * ─────────────────────────────────────────────────────────────────────────────
 * Flux : l'utilisateur paie via un Payment Link Stripe qui contient son UID
 *        (client_reference_id) → Stripe envoie un webhook ici → ce Worker vérifie
 *        la signature et passe users/{uid}.plan = "pro" dans Firestore.
 *
 * Pourquoi un Worker ? Parce que le lien PayPal.me ne prévient aucun serveur.
 * Stripe (ou PayPal Checkout) envoie un webhook signé → seul un backend peut le
 * vérifier et débloquer le compte de façon fiable et infalsifiable.
 *
 * Secrets Cloudflare (Settings → Variables, en "Secret") :
 *   STRIPE_WEBHOOK_SECRET   (whsec_… , depuis Stripe → Developers → Webhooks)
 *   FIREBASE_PROJECT_ID     = souanpt-hub
 *   FIREBASE_CLIENT_EMAIL   (service account)
 *   FIREBASE_PRIVATE_KEY    (clé privée PEM du service account)
 *
 * Côté Stripe : crée un Payment Link (Premium 4 €). Sur ta page tarifs, redirige
 * vers ce lien en ajoutant  ?client_reference_id={UID}  (l'UID Firebase de l'acheteur).
 * Configure le webhook Stripe (checkout.session.completed) vers l'URL de ce Worker.
 */

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('ok');
    const body = await request.text();
    const sig = request.headers.get('stripe-signature') || '';
    try {
      if (!(await verifyStripe(body, sig, env.STRIPE_WEBHOOK_SECRET))) return new Response('bad signature', { status: 400 });
      const event = JSON.parse(body);
      if (event.type === 'checkout.session.completed') {
        const uid = event.data.object.client_reference_id;
        if (uid) await setPremium(env, uid);
      }
      return new Response('ok');
    } catch (e) { return new Response('err: ' + e.message, { status: 500 }); }
  },
};

/* Vérifie la signature Stripe (HMAC-SHA256) */
async function verifyStripe(payload, header, secret) {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(parts.t + '.' + payload));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === parts.v1;
}

/* Passe users/{uid}.plan = "pro" via l'API REST Firestore */
async function setPremium(env, uid) {
  const token = await googleToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=plan&updateMask.fieldPaths=premiumSince`;
  await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { plan: { stringValue: 'pro' }, premiumSince: { integerValue: String(Date.now()) } } }),
  });
}

/* Access token Google à partir du service account (JWT → OAuth2) */
async function googleToken(env) {
  const iat = Math.floor(Date.now() / 1000);
  const claim = { iss: env.FIREBASE_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 };
  const enc = o => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const data = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc(claim);
  const body = env.FIREBASE_PRIVATE_KEY.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data)));
  const jwt = data + '.' + btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt,
  });
  return (await res.json()).access_token;
}
