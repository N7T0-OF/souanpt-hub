/*
 * Configuration Firebase — souanpt.hub V2
 * ────────────────────────────────────────
 * 1. Crée un projet sur https://console.firebase.google.com (gratuit, plan Spark)
 * 2. Ajoute une "application Web" (</>) → Firebase te donne ces 6 valeurs
 * 3. Copie ce fichier en `firebase-config.js`, colle tes valeurs, et c'est tout.
 *
 * Tant que ce fichier contient les placeholders "TON_…", le Hub reste en MODE LOCAL
 * (localStorage) — rien ne change. Dès que de vraies valeurs sont présentes, le mode
 * CLOUD (Firestore) pourra être activé.
 *
 * ⚠ Ces clés Web NE SONT PAS des secrets (elles sont visibles côté client par design).
 * La sécurité réelle est assurée par les règles Firestore (firestore.rules) : chaque
 * utilisateur ne peut lire/écrire que SES données.
 */
window.FIREBASE_CONFIG = {
  apiKey:            "TON_API_KEY",
  authDomain:        "ton-projet.firebaseapp.com",
  projectId:         "ton-projet",
  storageBucket:     "ton-projet.appspot.com",
  messagingSenderId: "TON_SENDER_ID",
  appId:             "TON_APP_ID",
};
