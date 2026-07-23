/**
 * /estimate/<code> — page d'estimation consultée par le client, SANS compte.
 *
 * La page est rendue côté serveur à partir du document public
 * `estimates/<code>`. Ce document ne contient QUE des informations destinées
 * au client. Le prix plancher, le taux horaire et la marge vivent ailleurs
 * (users/{uid}/data, illisible par autrui) et ne transitent jamais ici — ni
 * dans le HTML, ni dans le JavaScript de la page.
 *
 * La négociation écrit dans estimates/<code>/offers via l'API REST Firestore.
 * Les règles verrouillent la forme des offres et imposent status='pending' :
 * une contre-offre ne peut donc pas s'auto-accepter.
 */

const PROJECT  = 'souanpt-hub';
const API_KEY  = 'AIzaSyCBe6IUWsTBJ0H29KNxw5qU3YiC32Nenvk';   // clé Web publique par conception
const DOCS     = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Valeur Firestore → valeur JS. */
function val(v) {
  if (!v) return undefined;
  if (v.stringValue  !== undefined) return v.stringValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue  !== undefined) return Number(v.doubleValue);
  if (v.arrayValue) return (v.arrayValue.values || []).map(val);
  if (v.mapValue)   { const o = {}; const f = v.mapValue.fields || {}; for (const k in f) o[k] = val(f[k]); return o; }
  return undefined;
}

function shell(title, body, code) {
  return new Response(`<!DOCTYPE html><html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>${body}</body></html>`,
    { status: code || 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

const CSS = `
:root{--bg:#060606;--s1:#0d0d0d;--s2:#131313;--a:#C8FF00;--t:#f0ece4;
  --m:rgba(240,236,228,.62);--m2:rgba(240,236,228,.38);--b:rgba(255,255,255,.09);--b2:rgba(255,255,255,.16);
  --red:#c0392b;--green:#2e9a63}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--t);font-family:'Syne',system-ui,sans-serif;min-height:100vh;padding:24px 16px 60px}
.wrap{max-width:620px;margin:0 auto}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:26px}
.brand .av{width:38px;height:38px;border-radius:11px;background:var(--a);color:#060606;display:flex;
  align-items:center;justify-content:center;font-weight:800;font-size:16px;flex-shrink:0}
.brand b{font-size:15px;font-weight:800}
.brand span{display:block;font-size:11px;color:var(--m2);font-weight:400}
h1{font-size:clamp(22px,4.6vw,30px);font-weight:800;letter-spacing:-1px;margin-bottom:8px}
.sub{font-size:13px;color:var(--m);line-height:1.7;margin-bottom:24px}
.card{background:var(--s1);border:1px solid var(--b);border-radius:16px;padding:20px;margin-bottom:14px}
.row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--b);font-size:13px}
.row:last-child{border-bottom:none}
.row .l{color:var(--t)}.row .v{font-weight:700;white-space:nowrap}
.row.neg .v{color:var(--a)}
.total{display:flex;justify-content:space-between;align-items:baseline;margin-top:14px;padding-top:14px;
  border-top:1px solid var(--b2);font-size:20px;font-weight:800}
.total small{font-size:11px;color:var(--m2);font-weight:400;display:block}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.tag{font-size:10px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.05);
  border:1px solid var(--b);color:var(--m)}
.tag.warn{color:#e4b24a;border-color:rgba(228,178,74,.34)}
.acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}
.btn{padding:13px 22px;border-radius:12px;font-size:13px;font-weight:800;font-family:inherit;
  border:1px solid var(--b2);background:transparent;color:var(--t);cursor:pointer;transition:.18s}
.btn:hover{border-color:var(--a);color:var(--a)}
.btn.p{background:var(--a);color:#060606;border-color:var(--a)}
.btn.p:hover{opacity:.87}
.btn:disabled{opacity:.5;cursor:not-allowed}
.hist{margin-top:6px}
.off{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--b);font-size:12px}
.off:last-child{border-bottom:none}
.off .who{font-weight:800;flex-shrink:0;width:74px}
.off .who.c{color:var(--a)}
.off .amt{font-weight:800;margin-left:auto;white-space:nowrap}
.off .msg{color:var(--m);display:block;margin-top:3px;line-height:1.5}
.foot{text-align:center;font-size:11px;color:var(--m2);margin-top:30px;line-height:1.8}
.foot a{color:var(--m)}
/* ── Fenêtre de négociation ── */
.ovl{position:fixed;inset:0;z-index:100;background:rgba(4,4,4,.72);backdrop-filter:blur(6px);
  display:none;align-items:center;justify-content:center;padding:16px}
.ovl.on{display:flex}
.mod{background:var(--s1);border:1px solid var(--b2);border-radius:18px;padding:22px;width:100%;max-width:420px;
  max-height:92vh;overflow:auto}
.mod h2{font-size:17px;font-weight:800;margin-bottom:4px}
.mod .cur{font-size:12px;color:var(--m);margin-bottom:18px}
.lbl{font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--m2);margin:14px 0 7px}
.opts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.opt{padding:12px 6px;border-radius:11px;border:1px solid var(--b2);background:var(--s2);color:var(--t);
  font-family:inherit;font-size:13px;font-weight:800;cursor:pointer;transition:.15s}
.opt:hover{border-color:var(--a)}
.opt[aria-pressed="true"]{border-color:var(--a);background:rgba(200,255,0,.12);color:var(--a)}
.opt[aria-pressed="true"]::before{content:'✓ '}
.opt.full{grid-column:1/-1;font-size:12px;font-weight:700}
.inp{width:100%;background:var(--s2);border:1px solid var(--b2);border-radius:11px;padding:12px 14px;
  color:var(--t);font-family:inherit;font-size:14px;outline:none}
.inp:focus{border-color:var(--a)}
textarea.inp{resize:vertical;min-height:64px;font-size:12px;line-height:1.6}
.calc{background:var(--s2);border:1px solid var(--b);border-radius:12px;padding:14px;margin-top:14px}
.calc .r{display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:var(--m)}
.calc .r.big{font-size:16px;font-weight:800;color:var(--t);padding-top:8px;margin-top:6px;border-top:1px solid var(--b)}
.chk{display:flex;align-items:flex-start;gap:9px;margin-top:14px;font-size:12px;line-height:1.5;color:var(--t);cursor:pointer}
.chk input{margin-top:2px;flex-shrink:0}
.err{color:var(--red);font-size:11px;margin-top:8px;min-height:14px;line-height:1.5}
.ok{color:var(--green);font-size:12px;margin-top:10px;line-height:1.6}
.mod .acts{margin-top:18px}
.mod .acts .btn{flex:1;text-align:center}
@media(max-width:520px){
  /* Sur mobile la fenêtre remonte du bas : plus atteignable au pouce. */
  .ovl{align-items:flex-end;padding:0}
  .mod{max-width:none;border-radius:18px 18px 0 0;max-height:88vh}
}
`;

export async function onRequestGet({ params }) {
  const code = String(params.code || '').trim();
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(code)) {
    return shell('Lien invalide', `<div class="wrap"><h1>Lien invalide</h1>
      <p class="sub">Ce lien d'estimation n'est pas valide. Vérifie l'adresse reçue.</p></div>`, 404);
  }

  let f = null;
  try {
    const r = await fetch(`${DOCS}/estimates/${encodeURIComponent(code)}?key=${API_KEY}`);
    if (r.ok) f = (await r.json()).fields || null;
  } catch (e) { /* traité ci-dessous */ }

  if (!f) {
    return shell('Estimation introuvable', `<div class="wrap"><h1>Estimation introuvable</h1>
      <p class="sub">Ce lien n'existe pas ou a été retiré par son auteur.</p></div>`, 404);
  }

  const d = {};
  for (const k in f) d[k] = val(f[k]);

  const expired = d.expiresAt && Date.now() > Number(d.expiresAt);
  const status  = String(d.status || 'sent');
  const cur     = esc(d.currency || '€');
  const lines   = Array.isArray(d.lines) ? d.lines : [];
  const extras  = Array.isArray(d.extras) ? d.extras : [];
  const total   = Number(d.total) || 0;
  const initial = esc(String(d.creatorName || 'S').trim().charAt(0).toUpperCase() || 'S');

  // Offres déjà échangées — lecture publique, pour que le client voie l'historique.
  let offers = [];
  try {
    const r = await fetch(`${DOCS}/estimates/${encodeURIComponent(code)}/offers?key=${API_KEY}&pageSize=40`);
    if (r.ok) {
      const j = await r.json();
      offers = (j.documents || []).map(doc => {
        const o = {}; for (const k in (doc.fields || {})) o[k] = val(doc.fields[k]);
        return o;
      }).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }
  } catch (e) {}

  // Le client a-t-il DÉJÀ accepté ? Son acceptation est un engagement, en
  // attente de confirmation du créateur (le client n'a pas de compte, il ne
  // peut donc pas changer le statut lui-même). Tant que c'est le cas, on
  // masque Accepter/Négocier : sinon la page dit « accepté » ET propose encore
  // d'accepter — l'incohérence signalée.
  const clientAccepted = offers.some(o => o.author === 'client' && o.kind === 'acceptance');
  const creatorName = esc(d.creatorName || 'Le créateur');
  const closed  = expired || status === 'accepted' || status === 'refused';
  const canAct  = !closed && !clientAccepted;

  const stateBanner = expired
      ? { t: 'Offre expirée', s: 'Cette offre a expiré. Reprends contact avec le créateur pour en obtenir une nouvelle.' }
    : status === 'refused'
      ? { t: 'Offre close', s: 'Cette offre a été close par le créateur.' }
    : status === 'accepted'
      ? { t: 'Offre acceptée ✓', s: 'C\'est confirmé — ta mission est lancée. ' + creatorName + ' va démarrer le travail.' }
    : clientAccepted
      ? { t: 'Tu as accepté cette offre ✓', s: creatorName + ' va confirmer et lancer ta mission. Tu suivras tout depuis ce même lien — inutile d\'en attendre un autre.' }
      : null;

  const body = `<div class="wrap">
  <div class="brand">
    <div class="av">${initial}</div>
    <div><b>${esc(d.creatorName || 'Estimation')}</b><span>Estimation${d.projectName ? ' · ' + esc(d.projectName) : ''}</span></div>
  </div>

  <h1>${esc(d.title || 'Ton estimation')}</h1>
  <p class="sub">${d.intro ? esc(d.intro)
      : canAct ? 'Voici le détail de ta demande. Tu peux accepter, proposer un autre montant, ou poser une question.'
      : 'Voici le détail de ta demande.'}</p>

  <div class="card">
    ${lines.map(l => `<div class="row"><span class="l">${esc(l.label)}${Number(l.qty) > 1 ? ' × ' + esc(l.qty) : ''}</span>
      <span class="v">${esc(l.total)} ${cur}</span></div>`).join('')}
    ${extras.map(x => `<div class="row${Number(x.amount) < 0 ? ' neg' : ''}"><span class="l">${esc(x.label)}</span>
      <span class="v">${Number(x.amount) > 0 ? '+' : ''}${esc(x.amount)} ${cur}</span></div>`).join('')}
    <div class="total"><span>Prix proposé</span><span>${total} ${cur}</span></div>
    <div class="meta">
      ${d.deadline ? `<span class="tag">Délai : ${esc(d.deadline)}</span>` : ''}
      ${d.revisions !== undefined ? `<span class="tag">${esc(d.revisions)} retour(s) inclus</span>` : ''}
      ${d.expiresAt ? `<span class="tag${expired ? ' warn' : ''}">${expired ? 'Offre expirée' : 'Valable jusqu\'au ' + new Date(Number(d.expiresAt)).toLocaleDateString('fr-FR')}</span>` : ''}
      ${status === 'accepted' ? '<span class="tag">Offre acceptée ✓</span>' : ''}
    </div>
  </div>

  ${offers.length ? `<div class="card"><div class="lbl" style="margin-top:0">Historique</div><div class="hist">
    ${offers.map(o => {
      const mine = o.author === 'client';
      // « Vous » côté client (page publique), le nom du créateur sinon (§16).
      const who = mine ? 'Vous' : creatorName;
      const label = o.kind === 'acceptance'
        ? (mine ? 'a accepté l\'offre' : 'a confirmé l\'offre')
        : (o.message ? esc(o.message) : 'a proposé un montant');
      return `<div class="off">
        <span class="who ${mine ? 'c' : ''}">${who}</span>
        <span><span class="msg">${label}</span></span>
        <span class="amt">${esc(o.amount)} ${cur}</span>
      </div>`;
    }).join('')}
  </div></div>` : ''}

  ${stateBanner ? `<div class="card"><h2 style="font-size:15px;margin-bottom:6px">${stateBanner.t}</h2>
      <p class="sub" style="margin:0">${stateBanner.s}</p></div>` : ''}

  ${canAct ? `<div class="acts">
      <button class="btn p" id="acc">Accepter ${total} ${cur}</button>
      <button class="btn" id="neg">Négocier</button>
    </div>` : ''}

  <p class="foot">Estimation non contractuelle tant qu'elle n'est pas acceptée par les deux parties.<br>
    <a href="/">Créé avec souanpt.hub</a></p>
</div>

<!-- ══ Fenêtre de négociation ══ -->
<div class="ovl" id="ovl" role="dialog" aria-modal="true" aria-labelledby="mt">
  <div class="mod">
    <h2 id="mt">Négocier le prix</h2>
    <div class="cur">Prix actuel : <b>${total} ${cur}</b></div>

    <div class="lbl">Choisis une proposition</div>
    <div class="opts">
      <button type="button" class="opt" data-d="5"  aria-pressed="false">−5 %</button>
      <button type="button" class="opt" data-d="10" aria-pressed="false">−10 %</button>
      <button type="button" class="opt" data-d="15" aria-pressed="false">−15 %</button>
      <button type="button" class="opt full" id="custom" aria-pressed="false">Proposer un autre montant</button>
    </div>

    <div id="cwrap" style="display:none">
      <div class="lbl">Ta proposition</div>
      <!-- type="text" et NON "number" : avec type="number", le navigateur rejette
           la virgule AVANT que le code la voie, et « 79,50 » — l'écriture
           française d'un montant — arrivait comme une chaîne vide, sans
           explication. inputmode="decimal" garde le pavé numérique sur mobile. -->
      <input class="inp" id="camt" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00">
    </div>

    <div class="calc" id="calc" style="display:none">
      <div class="r"><span>Prix actuel</span><span>${total} ${cur}</span></div>
      <div class="r"><span>Économie demandée</span><span id="save">—</span></div>
      <div class="r big"><span>Ta proposition</span><span id="prop">—</span></div>
    </div>

    <div class="lbl">Message (facultatif)</div>
    <textarea class="inp" id="msg" maxlength="600" placeholder="Ex. : mon budget maximum est de… Est-il possible de retirer les fichiers sources ?"></textarea>

    <div class="err" id="err"></div>
    <div class="ok" id="ok" style="display:none"></div>

    <div class="acts">
      <button type="button" class="btn" id="cancel">Annuler</button>
      <button type="button" class="btn p" id="send" disabled>Envoyer la proposition</button>
    </div>
  </div>
</div>

<!-- ══ Fenêtre d'acceptation (remplace le confirm() natif — §3) ══ -->
<div class="ovl" id="accOvl" role="dialog" aria-modal="true" aria-labelledby="at">
  <div class="mod">
    <h2 id="at">Accepter cette estimation ?</h2>
    <div class="cur">${esc(d.projectName || d.title || 'Projet')} · <b>${total} ${cur}</b>${d.revisions !== undefined ? ' · ' + esc(d.revisions) + ' retour(s)' : ''}</div>
    <p class="sub" style="margin:2px 0 4px;font-size:12px">En acceptant, tu confirmes le périmètre et le tarif. ${creatorName} recevra ta validation et lancera la mission — tu suivras tout depuis ce même lien.</p>

    <div class="lbl">Ton nom</div>
    <input class="inp" id="acName" type="text" autocomplete="name" placeholder="Prénom Nom">
    <div class="lbl">Ton email</div>
    <input class="inp" id="acMail" type="email" inputmode="email" autocomplete="email" placeholder="toi@exemple.fr">
    <label class="chk"><input type="checkbox" id="acOk"> <span>J'accepte l'estimation et les conditions associées.</span></label>

    <div class="err" id="acErr"></div>
    <div class="ok" id="acOkMsg" style="display:none"></div>

    <div class="acts">
      <button type="button" class="btn" id="acCancel">Annuler</button>
      <button type="button" class="btn p" id="acConfirm" disabled>Confirmer l'acceptation</button>
    </div>
  </div>
</div>

<script>
(function(){
  var TOTAL = ${JSON.stringify(total)}, CUR = ${JSON.stringify(d.currency || '€')};
  var CODE = ${JSON.stringify(code)}, KEY = ${JSON.stringify(API_KEY)};
  var URL_ = ${JSON.stringify(DOCS)} + '/estimates/' + encodeURIComponent(CODE) + '/offers?key=' + KEY;

  var ovl = document.getElementById('ovl'), err = document.getElementById('err'),
      okB = document.getElementById('ok'),  send = document.getElementById('send'),
      calc = document.getElementById('calc'), cwrap = document.getElementById('cwrap'),
      camt = document.getElementById('camt'), msg = document.getElementById('msg'),
      negBtn = document.getElementById('neg'), accBtn = document.getElementById('acc');
  var opts = [].slice.call(document.querySelectorAll('.opt'));
  var mode = null, discount = null, amount = null, sending = false, lastFocus = null;

  function money(n){ return (Math.round(n * 100) / 100).toFixed(2).replace(/\\.00$/, '') + ' ' + CUR; }

  function setErr(t){ err.textContent = t || ''; }

  /* Recalcule et met à jour l'affichage. Le bouton d'envoi n'est actif que si
     la proposition est réellement valide : pas d'envoi accidentel. */
  function refresh(){
    var valid = amount !== null && amount > 0 && amount < TOTAL;
    calc.style.display = amount === null ? 'none' : 'block';
    if (amount !== null) {
      document.getElementById('prop').textContent = money(amount);
      document.getElementById('save').textContent = money(Math.max(0, TOTAL - amount));
    }
    send.disabled = !valid || sending;
  }

  function select(el, d){
    opts.forEach(function(o){ o.setAttribute('aria-pressed', String(o === el)); });
    mode = 'percentage'; discount = d;
    cwrap.style.display = 'none';
    amount = Math.round(TOTAL * (1 - d / 100) * 100) / 100;
    setErr(''); refresh();
  }

  opts.forEach(function(o){
    if (!o.dataset.d) return;
    o.addEventListener('click', function(){ select(o, Number(o.dataset.d)); });
  });

  document.getElementById('custom').addEventListener('click', function(){
    opts.forEach(function(o){ o.setAttribute('aria-pressed', String(o === this)); }, this);
    mode = 'custom'; discount = null;
    cwrap.style.display = 'block';
    camt.focus();
    amount = camt.value ? Number(camt.value) : null;
    validateCustom(); refresh();
  });

  function validateCustom(){
    if (mode !== 'custom') return true;
    // Virgule OU point, espaces et symbole monétaire tolérés : on accepte ce
    // que les gens écrivent réellement (« 79,50 », « 79.50 », « 79 € »).
    var raw = camt.value.trim().replace(/\\s|€|eur/gi, '').replace(',', '.');
    if (raw === '') { amount = null; setErr(''); return false; }
    if (!/^\\d+(\\.\\d{1,2})?$/.test(raw)) {
      amount = null;
      setErr(/[^\\d.,\\s€]/i.test(camt.value) ? 'Veuillez saisir un montant valide (chiffres uniquement).'
                                             : 'Deux décimales maximum.');
      return false;
    }
    var n = Number(raw);
    if (!isFinite(n) || n <= 0) { amount = null; setErr('Veuillez saisir un montant valide.'); return false; }
    if (n >= TOTAL) { amount = null; setErr('Le montant doit être inférieur au prix proposé.'); return false; }
    amount = Math.round(n * 100) / 100;
    setErr(''); return true;
  }
  camt.addEventListener('input', function(){ validateCustom(); refresh(); });

  /* On mémorise le bouton DÉCLENCHEUR explicitement, sans se fier à
     document.activeElement : un clic ne le focalise pas toujours, et le focus
     revenait alors sur <body> — la navigation au clavier repartait du haut. */
  function open(trigger){
    lastFocus = (trigger && trigger.focus) ? trigger : document.activeElement;
    ovl.classList.add('on');
    setTimeout(function(){ opts[0].focus(); }, 0);
  }
  function close(){
    ovl.classList.remove('on');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  if (negBtn) negBtn.addEventListener('click', function(){ open(negBtn); });
  document.getElementById('cancel').addEventListener('click', close);
  // Clic sur le fond, mais PAS pendant un envoi : on ne perd pas une saisie.
  ovl.addEventListener('click', function(e){ if (e.target === ovl && !sending) close(); });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && ovl.classList.contains('on') && !sending) close();
  });

  /* Envoi réel de la contre-offre. En cas d'erreur la fenêtre RESTE ouverte
     et la saisie est conservée : rien de plus frustrant que de tout retaper. */
  function submitOffer(){
    if (sending) return;
    if (mode === 'custom' && !validateCustom()) { refresh(); return; }
    if (amount === null || amount <= 0 || amount >= TOTAL) { setErr('Choisis d\\'abord une proposition.'); return; }
    sending = true; send.disabled = true; send.textContent = 'Envoi…'; setErr('');

    var fields = {
      author: { stringValue: 'client' },
      amount: { doubleValue: amount },
      kind: { stringValue: 'counter' },
      status: { stringValue: 'pending' },
      createdAt: { integerValue: String(Date.now()) }
    };
    if (discount !== null) fields.discountPercent = { integerValue: String(discount) };
    if (msg.value.trim()) fields.message = { stringValue: msg.value.trim().slice(0, 600) };

    fetch(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fields: fields })
    }).then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(){
      okB.style.display = 'block';
      okB.textContent = 'Ta proposition de ' + money(amount) + ' a été envoyée. Le créateur va la recevoir.';
      send.textContent = 'Envoyée ✓';
      setTimeout(function(){ location.reload(); }, 1800);
    }).catch(function(){
      sending = false;
      send.disabled = false; send.textContent = 'Envoyer la proposition';
      setErr('La proposition n\\'a pas pu être envoyée. Vérifie ta connexion et réessaie.');
    });
  }
  send.addEventListener('click', submitOffer);

  // ── Acceptation : fenêtre intégrée, jamais de confirm()/alert() natif ──
  var accOvl = document.getElementById('accOvl'),
      acName = document.getElementById('acName'), acMail = document.getElementById('acMail'),
      acOk = document.getElementById('acOk'), acErr = document.getElementById('acErr'),
      acOkMsg = document.getElementById('acOkMsg'),
      acConfirm = document.getElementById('acConfirm'),
      acCancel = document.getElementById('acCancel');
  var accSending = false, accFocus = null;

  function mailOk(v){ return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v); }
  function accRefresh(){
    acConfirm.disabled = accSending
      || acName.value.trim().length < 2 || !mailOk(acMail.value.trim()) || !acOk.checked;
  }
  [acName, acMail].forEach(function(e){ e.addEventListener('input', function(){ acErr.textContent=''; accRefresh(); }); });
  acOk.addEventListener('change', accRefresh);

  function accOpen(){ accFocus = accBtn; accOvl.classList.add('on'); setTimeout(function(){ acName.focus(); }, 0); }
  function accClose(){ accOvl.classList.remove('on'); if (accFocus && accFocus.focus) accFocus.focus(); }
  if (accBtn) accBtn.addEventListener('click', accOpen);
  acCancel.addEventListener('click', accClose);
  accOvl.addEventListener('click', function(e){ if (e.target === accOvl && !accSending) accClose(); });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && accOvl.classList.contains('on') && !accSending) accClose();
  });

  acConfirm.addEventListener('click', function(){
    if (accSending) return;
    if (acConfirm.disabled) return;
    accSending = true; acConfirm.disabled = true; acConfirm.textContent = 'Envoi…'; acErr.textContent = '';
    // kind:'acceptance' → la page saura, au rechargement, que le client s'est
    // engagé, et masquera Accepter/Négocier. Le statut reste 'pending' : c'est
    // au créateur de CONFIRMER (modèle à deux parties). L'estimation ne peut
    // donc pas s'auto-accepter côté client.
    fetch(URL_, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fields: {
        author: { stringValue: 'client' }, amount: { doubleValue: TOTAL },
        kind: { stringValue: 'acceptance' }, status: { stringValue: 'pending' },
        createdAt: { integerValue: String(Date.now()) },
        message: { stringValue: (acName.value.trim() + ' · ' + acMail.value.trim()).slice(0, 600) }
      }})
    }).then(function(r){
      if (!r.ok) throw new Error();
      acOkMsg.style.display = 'block';
      acOkMsg.textContent = 'Estimation acceptée ✓ ' + ${JSON.stringify(creatorName)} + ' va lancer ta mission.';
      acConfirm.textContent = 'Acceptée ✓';
      setTimeout(function(){ location.reload(); }, 1600);
    }).catch(function(){
      accSending = false; acConfirm.disabled = false; acConfirm.textContent = "Confirmer l'acceptation";
      acErr.textContent = "L'acceptation n'a pas pu être enregistrée. Vérifie ta connexion et réessaie.";
    });
  });
})();
</script>`;

  return shell(`Estimation ${d.projectName ? '· ' + d.projectName : ''} — souanpt.hub`, body);
}
