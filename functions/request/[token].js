/**
 * /request/<token> (servi aussi via /c/<token>) — FORMULAIRE DE DEMANDE public.
 *
 * Le client, SANS COMPTE, décrit son besoin et dépose ses références AVANT
 * qu'une estimation existe. Le lien ne change jamais : ce même /c/<token>
 * deviendra l'estimation, puis la mission.
 *
 * OÙ VONT LES FICHIERS. Un client anonyme n'a pas de jeton GitHub, il ne peut
 * donc pas écrire dans le Stockage GitHub du créateur. Les dépôts passent par
 * Firebase Storage (offre gratuite, 5 Go), sous requests/<token>/… , encadrés
 * par des règles. Si Firebase Storage n'est pas activé, l'upload se désactive
 * proprement et le client ajoute ses références par LIEN (le plus courant).
 *
 * La soumission écrit dans le document requests/<token> via l'API REST
 * Firestore ; les règles n'autorisent le public qu'à compléter SA demande tant
 * qu'elle est ouverte, jamais à toucher un prix, un statut ou un autre dossier.
 */

const PROJECT = 'souanpt-hub';
const API_KEY = 'AIzaSyCBe6IUWsTBJ0H29KNxw5qU3YiC32Nenvk';   // clé Web publique par conception
const DOCS    = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const STORAGE_BUCKET = 'souanpt-hub.firebasestorage.app';

// Limites (côté client + revalidées par les règles Storage/Firestore).
const MAX_FILES = 10, MAX_MB = 20;
const OK_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'pdf', 'txt', 'md', 'doc', 'docx', 'odt', 'zip'];
const BLOCK_EXT = ['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'vbs', 'ps1', 'js', 'jar', 'apk', 'dll', 'sh'];

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function val(v) {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.arrayValue) return (v.arrayValue.values || []).map(val);
  if (v.mapValue) { const o = {}; const f = v.mapValue.fields || {}; for (const k in f) o[k] = val(f[k]); return o; }
  return undefined;
}

/* ── Registre du questionnaire : UNE source, pas dupliquée par service. ── */
const SERVICES = [
  ['miniature_youtube', 'Miniature YouTube'], ['logo', 'Logo'], ['banniere', 'Bannière'],
  ['identite_visuelle', 'Identité visuelle'], ['affiche', 'Affiche'], ['montage_video', 'Montage vidéo'],
  ['modelisation_3d', 'Création 3D'], ['photo', 'Photographie'], ['minecraft', 'Projet Minecraft'],
  ['site_web', 'Site web'], ['autre', 'Autre'],
];
// q: { k, label, type: 'num'|'text'|'bool'|'select', options? }
const QUESTIONS = {
  miniature_youtube: [
    { k: 'nb', label: 'Combien de miniatures ?', type: 'num' },
    { k: 'plateforme', label: 'Plateforme', type: 'text' },
    { k: 'assets', label: 'As-tu déjà les images à utiliser ?', type: 'bool' },
    { k: 'texte', label: 'Texte à afficher', type: 'text' },
    { k: 'style', label: 'Style souhaité', type: 'text' },
    { k: 'sources', label: 'Fichiers sources (PSD) souhaités ?', type: 'bool' },
  ],
  logo: [
    { k: 'nb', label: 'Nombre de pistes/propositions', type: 'num' },
    { k: 'style', label: 'Style', type: 'text' },
    { k: 'couleurs', label: 'Couleurs souhaitées', type: 'text' },
    { k: 'symbole', label: 'Symbole, texte, ou les deux ?', type: 'text' },
    { k: 'declinaisons', label: 'Déclinaisons (réseaux, favicon…) ?', type: 'bool' },
    { k: 'vectoriel', label: 'Fichiers vectoriels souhaités ?', type: 'bool' },
    { k: 'commercial', label: 'Usage commercial ?', type: 'bool' },
  ],
  banniere: [
    { k: 'nb', label: 'Combien de bannières ?', type: 'num' },
    { k: 'plateforme', label: 'Où sera-t-elle utilisée ?', type: 'text' },
    { k: 'style', label: 'Style souhaité', type: 'text' },
    { k: 'sources', label: 'Fichiers sources souhaités ?', type: 'bool' },
  ],
  montage_video: [
    { k: 'duree_rushs', label: 'Durée des rushs (min)', type: 'num' },
    { k: 'duree_finale', label: 'Durée finale visée (min)', type: 'num' },
    { k: 'soustitres', label: 'Sous-titres ?', type: 'bool' },
    { k: 'format', label: 'Format (vertical / horizontal)', type: 'text' },
    { k: 'style', label: 'Style / références', type: 'text' },
  ],
};
// Questions génériques quand le service n'a pas de bloc dédié.
const QUESTIONS_DEFAULT = [
  { k: 'nb', label: 'Quantité souhaitée', type: 'num' },
  { k: 'style', label: 'Style souhaité', type: 'text' },
  { k: 'assets', label: 'As-tu déjà des éléments à fournir ?', type: 'bool' },
];

function shell(title, body) {
  return new Response(`<!DOCTYPE html><html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>${body}</body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
function notFound(msg) {
  return shell('Lien introuvable', `<div class="wrap"><h1>Lien introuvable</h1><p class="sub">${esc(msg)}</p></div>`);
}

const CSS = `
:root{--bg:#060606;--s1:#0d0d0d;--s2:#131313;--a:#C8FF00;--t:#f0ece4;
  --m:rgba(240,236,228,.62);--m2:rgba(240,236,228,.38);--b:rgba(255,255,255,.09);--b2:rgba(255,255,255,.16);
  --red:#c0392b;--green:#2e9a63}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--t);font-family:'Syne',system-ui,sans-serif;min-height:100vh;padding:24px 16px 70px}
.wrap{max-width:640px;margin:0 auto}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:22px}
.brand .av{width:38px;height:38px;border-radius:11px;background:var(--a);color:#060606;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;flex-shrink:0}
.brand b{font-size:15px;font-weight:800}.brand span{display:block;font-size:11px;color:var(--m2);font-weight:400}
h1{font-size:clamp(22px,4.6vw,30px);font-weight:800;letter-spacing:-1px;margin-bottom:8px}
.sub{font-size:13px;color:var(--m);line-height:1.7;margin-bottom:22px}
.card{background:var(--s1);border:1px solid var(--b);border-radius:16px;padding:20px;margin-bottom:14px}
.sec-t{font-size:10px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:var(--a);margin-bottom:12px}
.lbl{font-size:12px;color:var(--t);margin:12px 0 5px;font-weight:600}
.lbl:first-child{margin-top:0}
.inp{width:100%;background:var(--s2);border:1px solid var(--b2);border-radius:10px;padding:11px 13px;color:var(--t);font-family:inherit;font-size:14px;outline:none}
.inp:focus{border-color:var(--a)}
textarea.inp{resize:vertical;min-height:96px;font-size:13px;line-height:1.6}
select.inp{cursor:pointer}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(max-width:520px){.two{grid-template-columns:1fr}}
.chk{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t);cursor:pointer;padding:4px 0}
.hint{font-size:11px;color:var(--m2);margin-top:5px;line-height:1.5}
.drop{border:1.5px dashed var(--b2);border-radius:12px;padding:20px;text-align:center;cursor:pointer;transition:.15s;background:var(--s2)}
.drop.over{border-color:var(--a);background:rgba(200,255,0,.06)}
.drop b{color:var(--a)}
.files{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.f{display:flex;align-items:center;gap:10px;background:var(--s2);border:1px solid var(--b);border-radius:10px;padding:9px 11px}
.f .ic{font-size:18px;flex-shrink:0}
.f .meta{flex:1;min-width:0}
.f .fn{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.f .fs{font-size:10px;color:var(--m2)}
.f .bar{height:4px;background:var(--b);border-radius:3px;overflow:hidden;margin-top:5px}
.f .bar i{display:block;height:100%;background:var(--a);width:0;transition:width .2s}
.f .st{font-size:10px;flex-shrink:0}
.f .x{background:none;border:none;color:var(--m2);cursor:pointer;font-size:13px;flex-shrink:0}
.f .x:hover{color:var(--red)}
.linkrow{display:flex;gap:8px;margin-top:8px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:5px 10px;border-radius:999px;background:var(--s2);border:1px solid var(--b)}
.chip button{background:none;border:none;color:var(--m2);cursor:pointer}
.btn{padding:13px 22px;border-radius:12px;font-size:13px;font-weight:800;font-family:inherit;border:1px solid var(--b2);background:transparent;color:var(--t);cursor:pointer;transition:.18s}
.btn:hover{border-color:var(--a);color:var(--a)}
.btn.p{background:var(--a);color:#060606;border-color:var(--a)}
.btn.p:hover{opacity:.87}
.btn:disabled{opacity:.5;cursor:not-allowed}
.small{font-size:11px;padding:8px 14px}
.draft{font-size:11px;color:var(--m2);text-align:center;margin-top:8px;min-height:14px}
.err{color:var(--red);font-size:12px;margin-top:8px;min-height:15px;line-height:1.5}
.ovl{position:fixed;inset:0;z-index:100;background:rgba(4,4,4,.72);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:16px}
.ovl.on{display:flex}
.mod{background:var(--s1);border:1px solid var(--b2);border-radius:18px;padding:22px;width:100%;max-width:400px}
.mod h2{font-size:17px;font-weight:800;margin-bottom:8px}
.mod .acts{display:flex;gap:8px;margin-top:18px}.mod .acts .btn{flex:1;text-align:center}
.foot{text-align:center;font-size:11px;color:var(--m2);margin-top:26px;line-height:1.8}
.foot a{color:var(--m)}
@media(max-width:520px){.ovl{align-items:flex-end;padding:0}.mod{max-width:none;border-radius:18px 18px 0 0}}
`;

export async function onRequestGet(ctx) {
  const token = String(ctx.params.token || '').trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(token)) return notFound('Ce lien n’est pas valide.');

  let f = null;
  try {
    const r = await fetch(`${DOCS}/requests/${encodeURIComponent(token)}?key=${API_KEY}`);
    if (r.ok) f = (await r.json()).fields || null;
  } catch (e) {}
  if (!f) return notFound('Cette demande n’existe pas ou a été retirée.');

  const d = {}; for (const k in f) d[k] = val(f[k]);
  const creator = esc(d.creatorName || 'Le créateur');
  const initial = esc(String(d.creatorName || 'S').trim().charAt(0).toUpperCase() || 'S');
  const submitted = d.status === 'submitted' || d.status === 'closed';
  const closed = d.status === 'closed';

  const brand = `<div class="brand"><div class="av">${initial}</div>
    <div><b>${esc(d.creatorName || 'Demande')}</b><span>Espace projet sécurisé</span></div></div>`;

  // ── Vue APRÈS envoi : récapitulatif + possibilité de compléter ──
  if (submitted) {
    const att = Array.isArray(d.attachments) ? d.attachments : [];
    const links = Array.isArray(d.links) ? d.links : [];
    const svc = (SERVICES.find(s => s[0] === d.service) || [null, d.service])[1] || '—';
    const body = `<div class="wrap">${brand}
      <h1>Demande envoyée ✓</h1>
      <p class="sub">${creator} va examiner ta demande et préparer une estimation. Tu pourras revenir sur cette page avec le même lien — elle deviendra ton estimation, puis ton espace mission.</p>
      <div class="card">
        <div class="sec-t">Récapitulatif</div>
        <div class="lbl">Type de projet</div><div>${esc(svc)}</div>
        ${d.deadline ? `<div class="lbl">Date souhaitée</div><div>${esc(d.deadline)}</div>` : ''}
        ${d.budget ? `<div class="lbl">Budget indiqué</div><div>${esc(d.budget)}</div>` : ''}
        <div class="lbl">Références envoyées</div><div>${att.length + links.length} élément(s)</div>
      </div>
      ${closed ? '' : `<div class="card"><div class="sec-t">Compléter</div>
        <p class="hint" style="margin:0 0 10px">Tu peux encore ajouter une précision ou une référence tant que l'estimation n'est pas préparée.</p>
        <button class="btn small" onclick="location.href='?edit=1'">Ajouter une précision</button></div>`}
      <p class="foot"><a href="/">Créé avec souanpt.hub</a></p></div>`;
    // ?edit=1 rebascule sur le formulaire pré-rempli.
    const url = new URL(ctx.request.url);
    if (url.searchParams.get('edit') !== '1' || closed) return shell('Demande envoyée — souanpt.hub', body);
  }

  // ── Formulaire ──
  const serviceOpts = SERVICES.map(([v, l]) => `<option value="${v}"${d.service === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const QJSON = JSON.stringify(QUESTIONS), QDEF = JSON.stringify(QUESTIONS_DEFAULT);

  const body = `<div class="wrap">${brand}
  <h1>Votre projet</h1>
  <p class="sub">Parlez-nous de votre besoin. Ces informations permettront de préparer une estimation plus juste — et resteront sur ce même lien tout au long du projet.</p>

  <div class="card">
    <div class="sec-t">Vos informations</div>
    <div class="two">
      <div><div class="lbl">Nom</div><input class="inp" id="q-name" autocomplete="name" value="${esc((d.contact||{}).name||'')}"></div>
      <div><div class="lbl">Email</div><input class="inp" id="q-mail" type="email" inputmode="email" autocomplete="email" value="${esc((d.contact||{}).email||'')}"></div>
    </div>
    <div class="two">
      <div><div class="lbl">Société <span class="hint" style="display:inline">facultatif</span></div><input class="inp" id="q-comp" value="${esc((d.contact||{}).company||'')}"></div>
      <div><div class="lbl">Discord / autre <span class="hint" style="display:inline">facultatif</span></div><input class="inp" id="q-disc" value="${esc((d.contact||{}).discord||'')}"></div>
    </div>
  </div>

  <div class="card">
    <div class="sec-t">Votre demande</div>
    <div class="lbl">Quel type de création souhaitez-vous ?</div>
    <select class="inp" id="q-service">${serviceOpts}</select>
    <div id="q-questions"></div>
  </div>

  <div class="card">
    <div class="sec-t">Détails du projet</div>
    <div class="lbl">Décrivez votre projet</div>
    <textarea class="inp" id="q-desc" placeholder="Expliquez le résultat attendu, le contexte, le style, les éléments à intégrer et les contraintes importantes.">${esc(d.description||'')}</textarea>
    <div class="two">
      <div><div class="lbl">Budget approximatif</div><input class="inp" id="q-budget" placeholder="ex. 30–50 € (ou « je ne sais pas »)" value="${esc(d.budget||'')}"></div>
      <div><div class="lbl">Date limite</div><input class="inp" id="q-deadline" placeholder="ex. avant le 30 juillet" value="${esc(d.deadline||'')}"></div>
    </div>
  </div>

  <div class="card">
    <div class="sec-t">Références</div>
    <p class="hint" style="margin:0 0 10px">Images, PDF, documents (max ${MAX_FILES} fichiers, ${MAX_MB} Mo chacun). Ou colle un lien (Drive, Behance, Pinterest…).</p>
    <div class="drop" id="q-drop"><b>Choisir des fichiers</b> ou glisse-les ici</div>
    <input type="file" id="q-file" multiple accept="${OK_EXT.map(e => '.' + e).join(',')}" style="display:none">
    <div class="files" id="q-files"></div>
    <div class="linkrow">
      <input class="inp" id="q-link" placeholder="https://… (lien de référence)">
      <button type="button" class="btn small" id="q-addlink">Ajouter</button>
    </div>
    <div class="chips" id="q-links"></div>
    <div class="hint" id="q-upnote"></div>
  </div>

  <div class="err" id="q-err"></div>
  <button type="button" class="btn p" id="q-send" style="width:100%">Envoyer ma demande</button>
  <div class="draft" id="q-draft"></div>
  <p class="foot">Ce même lien te suivra : demande, estimation, puis mission.<br><a href="/">Créé avec souanpt.hub</a></p>
</div>

<div class="ovl" id="q-ovl" role="dialog" aria-modal="true">
  <div class="mod">
    <h2>Envoyer votre demande ?</h2>
    <p class="sub" style="margin:0">Vous pourrez continuer à utiliser ce même espace pour consulter l'estimation et suivre le projet.</p>
    <div class="err" id="q-ovl-err"></div>
    <div class="acts"><button type="button" class="btn" id="q-back">Retour</button>
      <button type="button" class="btn p" id="q-confirm">Envoyer</button></div>
  </div>
</div>

<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-storage-compat.js"></script>
<script>
(function(){
  var TOKEN=${JSON.stringify(token)}, KEY=${JSON.stringify(API_KEY)}, BUCKET=${JSON.stringify(STORAGE_BUCKET)};
  var DOC=${JSON.stringify(DOCS)}+'/requests/'+encodeURIComponent(TOKEN);
  var QUESTIONS=${QJSON}, QDEF=${QDEF};
  var MAX_FILES=${MAX_FILES}, MAX_BYTES=${MAX_MB}*1024*1024;
  var OK=${JSON.stringify(OK_EXT)}, BLOCK=${JSON.stringify(BLOCK_EXT)};
  var PREF=${JSON.stringify(d.answers || {})};
  var el=function(id){return document.getElementById(id);};
  var files=[], links=${JSON.stringify(Array.isArray(d.links)?d.links:[])};
  var storage=null, storageReady=false;

  // Firebase Storage — activé si le projet l'a configuré. Sinon, dépôt par lien.
  try {
    firebase.initializeApp({ apiKey:KEY, projectId:'souanpt-hub', storageBucket:BUCKET });
    storage=firebase.storage(); storageReady=true;
  } catch(e){ storageReady=false; }
  if(!storageReady) el('q-upnote').textContent='Dépôt de fichiers indisponible ici — ajoute plutôt un lien vers tes références.';

  var ext=function(n){var m=String(n||'').toLowerCase().match(/\\.([a-z0-9]+)$/);return m?m[1]:'';};
  var human=function(b){b=b||0;if(b<1024)return b+' o';if(b<1048576)return (b/1024).toFixed(0)+' Ko';return (b/1048576).toFixed(1)+' Mo';};
  var iconFor=function(n){var e=ext(n);if(/^(jpg|jpeg|png|webp|gif|avif)$/.test(e))return '🖼';if(e==='pdf')return '📄';if(e==='zip')return '🗜';return '📎';};

  // ── Questionnaire adaptatif (registre, pas dupliqué) ──
  function renderQuestions(){
    var svc=el('q-service').value; var qs=QUESTIONS[svc]||QDEF; var box=el('q-questions');
    box.innerHTML=qs.map(function(q){
      var v=PREF[q.k]; var id='qq-'+q.k;
      if(q.type==='bool') return '<label class="chk"><input type="checkbox" data-q="'+q.k+'" id="'+id+'"'+(v?' checked':'')+'> '+q.label+'</label>';
      var t=q.type==='num'?'number':'text';
      return '<div class="lbl">'+q.label+'</div><input class="inp" type="'+t+'" data-q="'+q.k+'" id="'+id+'" value="'+(v!=null?String(v).replace(/"/g,'&quot;'):'')+'">';
    }).join('');
    box.querySelectorAll('[data-q]').forEach(function(i){i.addEventListener('input',saveDraft);i.addEventListener('change',saveDraft);});
  }
  el('q-service').addEventListener('change',function(){renderQuestions();saveDraft();});
  renderQuestions();

  // ── Brouillon local (survit au rechargement) ──
  var DK='hub_req_'+TOKEN;
  function collect(){
    var ans={}; el('q-questions').querySelectorAll('[data-q]').forEach(function(i){ans[i.dataset.q]=i.type==='checkbox'?i.checked:i.value;});
    return { contact:{name:el('q-name').value,email:el('q-mail').value,company:el('q-comp').value,discord:el('q-disc').value},
      service:el('q-service').value, answers:ans, description:el('q-desc').value,
      budget:el('q-budget').value, deadline:el('q-deadline').value, links:links };
  }
  var dT=null;
  function saveDraft(){ clearTimeout(dT); dT=setTimeout(function(){
    try{ localStorage.setItem(DK, JSON.stringify(collect())); el('q-draft').textContent='Brouillon enregistré'; setTimeout(function(){el('q-draft').textContent='';},1500);}catch(e){}
  },500); }
  (function restore(){ try{ var s=JSON.parse(localStorage.getItem(DK)||'null'); if(!s)return;
    if(s.contact){el('q-name').value=s.contact.name||el('q-name').value;el('q-mail').value=s.contact.email||el('q-mail').value;el('q-comp').value=s.contact.company||'';el('q-disc').value=s.contact.discord||'';}
    if(s.service){el('q-service').value=s.service;renderQuestions();}
    if(s.answers){Object.keys(s.answers).forEach(function(k){var i=el('qq-'+k);if(i){if(i.type==='checkbox')i.checked=!!s.answers[k];else i.value=s.answers[k];}});}
    if(s.description)el('q-desc').value=s.description; if(s.budget)el('q-budget').value=s.budget; if(s.deadline)el('q-deadline').value=s.deadline;
    if(Array.isArray(s.links)){links=s.links;renderLinks();}
  }catch(e){} })();
  ['q-name','q-mail','q-comp','q-disc','q-desc','q-budget','q-deadline'].forEach(function(id){el(id).addEventListener('input',saveDraft);});

  // ── Références par lien ──
  function renderLinks(){ el('q-links').innerHTML=links.map(function(l,i){
    return '<span class="chip">🔗 '+escp(l.label||l.url)+'<button data-i="'+i+'">✕</button></span>';}).join('');
    el('q-links').querySelectorAll('button').forEach(function(b){b.onclick=function(){links.splice(+b.dataset.i,1);renderLinks();saveDraft();};});
  }
  function escp(s){return String(s).replace(/[<>&"]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c];});}
  el('q-addlink').onclick=function(){ var v=el('q-link').value.trim(); if(!v)return;
    if(/\\s/.test(v)){ el('q-err').textContent='Un lien ne contient pas d\\'espace.'; return; }
    if(!/^https?:\\/\\//i.test(v)) v='https://'+v;
    var u; try{ u=new URL(v); }catch(e){ u=null; }
    if(!u || !/\\./.test(u.hostname) || u.hostname.length<3){ el('q-err').textContent='Lien invalide.'; return; }
    links.push({type:'external_link',url:v,label:v.replace(/^https?:\\/\\//,'').slice(0,48),category:'client_reference',visibility:'client_visible'});
    el('q-link').value=''; el('q-err').textContent=''; renderLinks(); saveDraft();
  };
  renderLinks();

  // ── Dépôt de fichiers ──
  function renderFiles(){ el('q-files').innerHTML=''; files.forEach(function(f,i){
    var row=document.createElement('div'); row.className='f';
    row.innerHTML='<span class="ic">'+iconFor(f.name)+'</span><div class="meta"><div class="fn">'+escp(f.name)+'</div>'
      +'<div class="fs">'+human(f.size)+' · '+(f.state==='done'?'✓ envoyé':f.state==='error'?'erreur':f.state==='up'?'envoi…':'en attente')+'</div>'
      +(f.state==='up'?'<div class="bar"><i style="width:'+(f.pct||0)+'%"></i></div>':'')+'</div>'
      +(f.state==='error'?'<button class="x" data-r="'+i+'" title="Réessayer">↻</button>':'')
      +'<button class="x" data-x="'+i+'">✕</button>';
    el('q-files').appendChild(row);
  });
    el('q-files').querySelectorAll('[data-x]').forEach(function(b){b.onclick=function(){var f=files[+b.dataset.x];if(f&&f.task)try{f.task.cancel();}catch(e){}files.splice(+b.dataset.x,1);renderFiles();};});
    el('q-files').querySelectorAll('[data-r]').forEach(function(b){b.onclick=function(){uploadOne(files[+b.dataset.r]);};});
  }
  function addFiles(list){
    var err='', added=0;
    for(var i=0;i<list.length;i++){ var file=list[i];
      if(files.length>=MAX_FILES){ err='Maximum '+MAX_FILES+' fichiers.'; break; }
      var e=ext(file.name);
      if(BLOCK.indexOf(e)>=0){ err='Type interdit : .'+e; continue; }
      if(OK.indexOf(e)<0){ err='Format non accepté : .'+e; continue; }
      if(file.size>MAX_BYTES){ err='« '+file.name+' » dépasse '+${MAX_MB}+' Mo.'; continue; }
      // Doublon (nom+taille) — on ne ré-ajoute pas.
      if(files.some(function(x){return x.name===file.name&&x.size===file.size;})) continue;
      var rec={ name:file.name, size:file.size, type:file.type||'', raw:file, state:storageReady?'wait':'link', pct:0 };
      files.push(rec); added++; if(storageReady) uploadOne(rec);
    }
    // On ne vide le message QUE si tout est passé — sinon on garde le motif du rejet.
    el('q-err').textContent = err;
    renderFiles();
  }
  function uploadOne(rec){
    if(!storageReady){ rec.state='link'; renderFiles(); return; }
    var fid=Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    var safe=rec.name.replace(/[^\\w.\\-]+/g,'_').slice(0,80);
    rec.storagePath='requests/'+TOKEN+'/'+fid+'/'+safe; rec.state='up'; rec.pct=0; renderFiles();
    var ref=storage.ref(rec.storagePath);
    rec.task=ref.put(rec.raw,{contentType:rec.type||'application/octet-stream'});
    rec.task.on('state_changed',
      function(s){ rec.pct=Math.round(s.bytesTransferred/s.totalBytes*100); renderFiles(); },
      function(err){ rec.state='error'; renderFiles(); },
      function(){ ref.getDownloadURL().then(function(url){ rec.downloadUrl=url; rec.state='done'; rec.pct=100; renderFiles(); }); });
  }
  el('q-drop').onclick=function(){el('q-file').click();};
  el('q-file').onchange=function(){addFiles(this.files);this.value='';};
  ['dragover','dragenter'].forEach(function(ev){el('q-drop').addEventListener(ev,function(e){e.preventDefault();el('q-drop').classList.add('over');});});
  ['dragleave','drop'].forEach(function(ev){el('q-drop').addEventListener(ev,function(e){e.preventDefault();el('q-drop').classList.remove('over');});});
  el('q-drop').addEventListener('drop',function(e){ if(e.dataTransfer&&e.dataTransfer.files) addFiles(e.dataTransfer.files); });

  // ── Envoi ──
  var ovl=el('q-ovl');
  el('q-send').onclick=function(){
    var name=el('q-name').value.trim(), mail=el('q-mail').value.trim();
    if(name.length<2){ el('q-err').textContent='Indique ton nom.'; el('q-name').focus(); return; }
    if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(mail)){ el('q-err').textContent='Email invalide.'; el('q-mail').focus(); return; }
    var uploading=files.some(function(f){return f.state==='up'||f.state==='wait';});
    if(uploading){ el('q-err').textContent='Attends la fin de l\\'envoi des fichiers.'; return; }
    el('q-err').textContent=''; ovl.classList.add('on'); el('q-confirm').focus();
  };
  el('q-back').onclick=function(){ovl.classList.remove('on');};
  ovl.addEventListener('click',function(e){if(e.target===ovl)ovl.classList.remove('on');});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&ovl.classList.contains('on'))ovl.classList.remove('on');});

  function fsVal(v){
    if(v===null||v===undefined)return {nullValue:null};
    if(typeof v==='boolean')return {booleanValue:v};
    if(typeof v==='number')return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
    if(Array.isArray(v))return {arrayValue:{values:v.map(fsVal)}};
    if(typeof v==='object'){var f={};for(var k in v)f[k]=fsVal(v[k]);return {mapValue:{fields:f}};}
    return {stringValue:String(v)};
  }
  el('q-confirm').onclick=function(){
    var btn=el('q-confirm'); if(btn.disabled)return; btn.disabled=true; btn.textContent='Envoi…'; el('q-ovl-err').textContent='';
    var data=collect();
    var attachments=files.filter(function(f){return f.state==='done';}).map(function(f){
      return { id:'req_'+Math.random().toString(36).slice(2,9), name:f.name, mimeType:f.type, size:f.size,
        storagePath:f.storagePath||'', downloadUrl:f.downloadUrl||'', url:f.downloadUrl||'',
        category:'client_reference', visibility:'client_visible', uploadedBy:'client', createdAt:Date.now() };
    });
    var fields={
      status:{stringValue:'submitted'}, submittedAt:{integerValue:String(Date.now())},
      contact:fsVal(data.contact), service:{stringValue:data.service}, answers:fsVal(data.answers),
      description:{stringValue:data.description.slice(0,5000)},
      budget:{stringValue:data.budget.slice(0,120)}, deadline:{stringValue:data.deadline.slice(0,120)},
      links:fsVal(data.links), attachments:fsVal(attachments)
    };
    var mask=Object.keys(fields).map(function(k){return 'updateMask.fieldPaths='+k;}).join('&');
    fetch(DOC+'?key='+KEY+'&'+mask,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({fields:fields})})
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(){ try{localStorage.removeItem(DK);}catch(e){} location.href=location.pathname; })
      .catch(function(){ btn.disabled=false; btn.textContent='Envoyer'; el('q-ovl-err').textContent='Envoi impossible. Vérifie ta connexion et réessaie.'; });
  };
})();
</script>`;

  return shell('Votre projet — souanpt.hub', body);
}
