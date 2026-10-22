import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

// Pas de verrou inter-onglets sur la session : avec plusieurs onglets ouverts, il bloquait les requêtes pendant de longues secondes.
// Certaines requêtes restent parfois bloquées en route (jusqu'à une minute et plus).
// Les lectures sont abandonnées au bout de 8 s et relancées ; les actions qui modifient ne sont jamais rejouées.
const LECTURES_RPC = ["mon_role", "etat_cercle", "faire_avancer", "mes_membres", "est_mj", "est_joueur"];
async function fetchAvecRelance(url, options = {}) {
  const methode = (options.method || "GET").toUpperCase();
  const chemin = String(url);
  const relancable = methode === "GET" || methode === "HEAD" || LECTURES_RPC.some((r) => chemin.includes(`/rpc/${r}`));
  const essais = relancable ? 4 : 1;
  const delai = relancable ? 8000 : 45000;
  let derniere;
  for (let i = 0; i < essais; i++) {
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), delai);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } catch (e) {
      derniere = e;
      if (e.name !== "AbortError") throw e;
    } finally {
      clearTimeout(minuteur);
    }
  }
  throw new Error("La Maison ne répond pas pour le moment. Réessayez dans un instant.", { cause: derniere });
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { lock: async (_nom, _delai, fn) => await fn() },
  global: { fetch: fetchAvecRelance },
});
const app = document.getElementById("app");
const btnDeco = document.getElementById("deconnexion");

const etat = { role: null, cercle: null, ongletMJ: "coulisses", sceauAAnimer: false };

/* ---------- Utilitaires ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dollars = (n) => Number(n || 0).toLocaleString("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dateLongue = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const dateCourte = (d) => new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function prochainMardi19h(depuis = new Date()) {
  const d = new Date(depuis);
  d.setHours(19, 0, 0, 0);
  let delta = (2 - d.getDay() + 7) % 7;
  if (delta === 0 && depuis >= d) delta = 7;
  d.setDate(d.getDate() + delta);
  return d;
}

function messageErreur(e) {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return "Identifiants non reconnus par la Maison.";
  if (/Email not confirmed/i.test(m)) return "Ce compte n'a pas encore été activé.";
  return m;
}

/* ---------- Données ---------- */
async function chargerCercle() {
  const { data, error } = await sb.from("cercle").select("*").eq("id", 1).single();
  if (error) throw error;
  etat.cercle = data;
}
async function chargerCatalogue() {
  const { data, error } = await sb
    .from("fournisseurs")
    .select("id, nom, origine, specialite, description, ordre, produits(id, nom, categorie, gamme, age, prix_achat, description)")
    .order("ordre");
  if (error) throw error;
  const ordreGamme = { courante: 0, premium: 1, rare: 2 };
  data.forEach((f) => f.produits.sort((a, b) => ordreGamme[a.gamme] - ordreGamme[b.gamme] || a.prix_achat - b.prix_achat));
  return data;
}
let cacheLocaux = null;
async function chargerLocaux() {
  if (cacheLocaux) return cacheLocaux;
  const { data, error } = await sb.from("locaux").select("*").order("ordre");
  if (error) throw error;
  cacheLocaux = data;
  return data;
}
const PRESTIGE = { 1: "modeste", 2: "honorable", 3: "remarquable" };
const DISCRETION = { 1: "très exposé", 2: "ordinaire", 3: "très discret" };
function blocAnnonce(l, avecChoix) {
  const photos = l.photos || [];
  const galerie = photos.length ? `
      <div class="galerie">
        <button type="button" class="galerie-principale" data-agrandir aria-label="Agrandir la photo">
          <img src="${esc(photos[0])}" alt="${esc(l.titre)}, photo 1" loading="lazy">
        </button>
        ${photos.length > 1 ? `<div class="galerie-vignettes">${photos.map((p, i) => `
          <button type="button" class="galerie-vignette" data-photo="${esc(p)}" aria-label="Photo ${i + 1}" aria-pressed="${i === 0}">
            <img src="${esc(p)}" alt="" loading="lazy">
          </button>`).join("")}</div>` : ""}
      </div>` : "";
  const corps = `${galerie}
      <div class="annonce-tete">
        <h3>${esc(l.titre)}</h3>
        <span class="loyer">${dollars(l.loyer_hebdo)} <small>par semaine</small></span>
      </div>
      <div class="origine">${esc(l.adresse)}</div>
      <p class="desc">${esc(l.description)}</p>
      <dl class="annonce-traits">
        <div><dt>Capacité</dt><dd>jusqu'à ${l.capacite} invités</dd></div>
        <div><dt>Standing</dt><dd>${PRESTIGE[l.prestige]}</dd></div>
        <div><dt>Discrétion</dt><dd>${DISCRETION[l.discretion]}</dd></div>
      </dl>`;
  return avecChoix
    ? `<label class="annonce annonce-choix"><input type="radio" name="local" value="${l.id}" required>${corps}</label>`
    : `<div class="annonce">${corps}</div>`;
}

async function chargerJournal() {
  const { data, error } = await sb.from("journal").select("*").order("cree_le", { ascending: false }).limit(50);
  if (error) throw error;
  return data;
}

/* ---------- Démarrage ---------- */
async function demarrer() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return vuePorte();
  btnDeco.hidden = false;
  const { data: role, error } = await sb.rpc("mon_role");
  if (error || !role) return vueNonRecommande();
  etat.role = role;
  await chargerCercle();
  render();
}

btnDeco.addEventListener("click", async () => {
  await sb.auth.signOut();
  etat.role = null; etat.cercle = null;
  btnDeco.hidden = true;
  vuePorte();
});

function render() {
  if (etat.role === "mj") return vueMJ();
  return vueJoueuse(app);
}

/* ---------- Porte d'entrée ---------- */
function vuePorte() {
  app.innerHTML = `
    <section class="feuille porte">
      <h1>Accès professionnel</h1>
      <p class="note">La Maison n'ouvre de compte que sur recommandation d'un de ses partenaires. Les identifiants vous ont été remis avec votre carte.</p>
      <form id="form-porte">
        <label for="email">Adresse de correspondance</label>
        <input id="email" type="email" autocomplete="username" required>
        <label for="mdp">Code d'accès</label>
        <input id="mdp" type="password" autocomplete="current-password" required>
        <div class="actions"><button class="bouton" type="submit">Entrer</button></div>
        <p class="erreur" id="erreur"></p>
      </form>
    </section>`;
  const form = document.getElementById("form-porte");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector("button");
    btn.disabled = true;
    document.getElementById("erreur").textContent = "";
    const { error } = await sb.auth.signInWithPassword({
      email: form.email.value.trim(),
      password: form.mdp.value,
    });
    btn.disabled = false;
    if (error) { document.getElementById("erreur").textContent = messageErreur(error); return; }
    demarrer().catch(afficherPanne);
  });
}

function vueNonRecommande() {
  app.innerHTML = `
    <section class="feuille porte">
      <h1>Compte non reconnu</h1>
      <p>Ce compte ne figure dans aucun de nos registres de recommandation. Si vous pensez qu'il s'agit d'une erreur, adressez-vous à la personne qui vous a remis la carte.</p>
    </section>`;
}

function afficherPanne(e) {
  console.error(e);
  app.innerHTML = `<section class="feuille porte"><h1>Registres indisponibles</h1>
    <p>La connexion avec la Maison a échoué : ${esc(messageErreur(e))}</p>
    <div class="actions"><button class="bouton" onclick="location.reload()">Réessayer</button></div></section>`;
}

/* ---------- Parcours de la joueuse ---------- */
function vueJoueuse(cible) {
  const c = etat.cercle;
  if (c.statut === "invitation") return vueInvitation(cible);
  if (c.statut === "contrat_signe") return vueFondation(cible);
  return vueCompte(cible);
}

function lettreAccueil() {
  return `
    <article class="feuille">
      <div class="en-tete-lettre">
        <span class="expediteur">Calloway &amp; Sons</span>
        <span>Gary, le ${dateLongue(new Date())}</span>
      </div>
      <p>Cher Monsieur Visconti,</p>
      <p>Il est rare que la Maison ouvre ses registres à un nouveau compte. Il est plus rare encore qu'elle le fasse sans avoir jamais rencontré la personne concernée. Vous comprendrez donc le poids que nous accordons à la recommandation de <strong>M. Victor Vance</strong>, qui a bien voulu répondre de vous.</p>
      <p>Sur sa garantie, nous sommes disposés à vous consentir une ligne de crédit destinée à constituer la cave de votre cercle. Nos fournisseurs vous proposeront chaque semaine une sélection de leurs références ; vous règlerez nos factures sur les recettes de vos soirées, au rythme qui convient à une maison sérieuse.</p>
      <p>Vous trouverez ci-dessous l'accord qui lie les trois parties. Je vous invite à le lire avec attention avant de le signer.</p>
      <div class="signature-bloc">
        <div class="plume">Thaddeus Calloway</div>
        <div class="qualite">Thaddeus Calloway III, directeur de la Maison</div>
      </div>
      <p class="post-scriptum">P.-S. M. Vance s'est permis de faire repérer trois locaux à Miller Beach, le quartier le plus fréquentable de Gary. Le choix vous appartiendra au moment de fonder votre cercle. <button type="button" class="lien-discret" id="voir-annonces" aria-expanded="false">Consulter les annonces</button></p>
      <div id="annonces-ps" hidden></div>
    </article>`;
}

function texteContrat(c, signe) {
  return `
    <article class="feuille" id="contrat">
      <h2>Accord de garantie et d'ouverture de compte</h2>
      <p class="clause-discrete">Entre Calloway &amp; Sons, négociants (« la Maison »), M. Victor Vance, de la Vance Fiduciary Trust (« le Garant »), et le titulaire du présent compte (« le Titulaire »).</p>
      <p class="article"><strong>Article 1.</strong> La Maison ouvre au nom du Titulaire une ligne de crédit fournisseur de ${dollars(c.ligne_credit)}, exclusivement destinée à l'acquisition de spiritueux auprès des fournisseurs de la Maison.</p>
      <p class="article"><strong>Article 2.</strong> Les factures sont réglées sur les recettes du cercle du Titulaire. Un relevé est arrêté chaque mardi à dix-neuf heures.</p>
      <p class="article"><strong>Article 3.</strong> Le Garant répond envers la Maison de l'ensemble des engagements du Titulaire.</p>
      <p class="article"><strong>Article 4.</strong> En reconnaissance de sa garantie, le Titulaire accorde au Garant une courtoisie, dont la nature sera précisée par le Garant en temps opportun. Le Titulaire s'engage à l'honorer de bonne grâce.</p>
      <p class="article"><strong>Article 5.</strong> En cas de manquement répété aux présentes, le Garant se réserve d'en examiner personnellement les conditions de règlement.</p>
      <p class="article"><strong>Article 6.</strong> Les parties s'engagent à la plus entière discrétion sur l'existence et les termes du présent accord.</p>
      ${signe ? `
        <div class="signature-bloc">
          <div class="plume">${esc(c.signature)}</div>
          <div class="qualite">Pour le Titulaire, signé le ${dateLongue(c.contrat_signe_le)}</div>
        </div>
        <div class="sceau ${etat.sceauAAnimer ? "appose" : ""}" aria-label="Sceau du Garant">V</div>
      ` : `
        <form id="form-signature" class="signature-bloc">
          <label for="signature">Signature du Titulaire</label>
          <input id="signature" class="saisie-plume" type="text" maxlength="120" autocomplete="off" required>
          <div class="actions"><button class="bouton" type="submit">Signer l'accord</button></div>
          <p class="erreur" id="erreur"></p>
        </form>`}
    </article>`;
}

function vueInvitation(cible) {
  cible.innerHTML = lettreAccueil() + texteContrat(etat.cercle, false);
  const btnPS = cible.querySelector("#voir-annonces");
  const boitePS = cible.querySelector("#annonces-ps");
  btnPS.addEventListener("click", async () => {
    if (!boitePS.innerHTML) {
      try { boitePS.innerHTML = (await chargerLocaux()).map((l) => blocAnnonce(l, false)).join(""); }
      catch (e) { boitePS.innerHTML = `<p class="erreur">${esc(messageErreur(e))}</p>`; }
    }
    boitePS.hidden = !boitePS.hidden;
    btnPS.setAttribute("aria-expanded", String(!boitePS.hidden));
    btnPS.textContent = boitePS.hidden ? "Consulter les annonces" : "Masquer les annonces";
  });
  const form = cible.querySelector("#form-signature");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector("button");
    btn.disabled = true;
    const { data, error } = await sb.rpc("signer_contrat", { p_signature: form.signature.value });
    btn.disabled = false;
    if (error) { form.querySelector("#erreur").textContent = messageErreur(error); return; }
    etat.cercle = data;
    vueContratSigne(cible);
  });
}

function vueContratSigne(cible) {
  etat.sceauAAnimer = true;
  cible.innerHTML = texteContrat(etat.cercle, true) + `
    <section class="feuille">
      <p>L'accord est enregistré. Le Garant en a été informé.</p>
      <p>Il vous reste à choisir le local de votre cercle et à lui donner un nom : c'est sous ce nom que la Maison établira vos factures.</p>
      <div class="actions"><button class="bouton" id="vers-fondation">Fonder le cercle</button></div>
    </section>`;
  etat.sceauAAnimer = false;
  cible.querySelector("#vers-fondation").addEventListener("click", () => {
    vueFondation(cible);
    window.scrollTo({ top: 0 });
  });
  cible.querySelector("#contrat").scrollIntoView({ block: "end" });
}

async function vueFondation(cible) {
  cible.innerHTML = `<p class="chargement">Préparation des annonces…</p>`;
  const locaux = await chargerLocaux();
  cible.innerHTML = `
    <section class="feuille">
      <h1>Fondation du cercle</h1>
      <p>Choisissez le local de votre cercle, puis le nom sous lequel il sera connu de ses membres et de la Maison. Une devise est facultative.</p>
      <form id="form-fondation">
        <fieldset class="choix-local">
          <legend>Le local, à Miller Beach</legend>
          <p class="clause-discrete">Le loyer est prélevé sur la trésorerie du cercle à chaque relevé du mardi.</p>
          ${locaux.map((l) => blocAnnonce(l, true)).join("")}
        </fieldset>
        <div class="etiquette" aria-hidden="true">
          <div class="nom-cercle" id="apercu-nom"><span class="vide">Nom du cercle</span></div>
          <div class="devise-cercle" id="apercu-devise"></div>
        </div>
        <label for="nom">Nom du cercle</label>
        <input id="nom" type="text" maxlength="80" required autocomplete="off">
        <label for="devise">Devise (facultative)</label>
        <input id="devise" type="text" maxlength="160" autocomplete="off">
        <p class="clause-discrete">Le nom figurera sur vos factures et sur la vitrine du cercle. Il ne pourra plus être modifié sans l'accord de la Maison.</p>
        <div class="actions"><button class="bouton" type="submit">Fonder le cercle</button></div>
        <p class="erreur" id="erreur"></p>
      </form>
    </section>`;
  const form = cible.querySelector("#form-fondation");
  const apNom = cible.querySelector("#apercu-nom");
  const apDev = cible.querySelector("#apercu-devise");
  form.nom.addEventListener("input", () => {
    apNom.innerHTML = form.nom.value.trim() ? esc(form.nom.value) : `<span class="vide">Nom du cercle</span>`;
  });
  form.devise.addEventListener("input", () => { apDev.textContent = form.devise.value; });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const choix = form.querySelector("input[name=local]:checked");
    if (!choix) { form.querySelector("#erreur").textContent = "Choisissez d'abord un local."; return; }
    const local = locaux.find((l) => l.id === choix.value);
    if (!confirm(`Fonder le cercle « ${form.nom.value.trim()} » et signer le bail de ${local.titre} (${dollars(local.loyer_hebdo)} par semaine) ?`)) return;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    const { data, error } = await sb.rpc("fonder_cercle", { p_nom: form.nom.value, p_devise: form.devise.value, p_local: choix.value });
    btn.disabled = false;
    if (error) { form.querySelector("#erreur").textContent = messageErreur(error); return; }
    etat.cercle = data;
    vueCompte(cible);
    window.scrollTo({ top: 0 });
  });
}

const ONGLETS_GERANT = [["compte", "Compte"], ["membres", "Membres"], ["personnel", "Personnel"], ["cave", "Cave"], ["amenagements", "Aménagements"], ["vitrine", "Vitrine"]];
const LIBELLE_POSTE = { hote: "Hôte d'accueil", serveur: "Service en salle", barman: "Bar et sommellerie", portier: "Porte et sécurité" };
const jourHeure = (d) => new Date(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) + " à 19 h";
const portrait = (dossier, slug, nom) =>
  `<img src="img/${dossier}/${esc(slug)}.jpg" alt="Portrait de ${esc(nom)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'portrait-vide',textContent:'Pas de photographie'}))">`;

async function vueCompte(cible) {
  cible.innerHTML = `<p class="chargement">Ouverture du compte…</p>`;
  // un seul appel : fait passer les mardis écoulés et renvoie l'état du cercle
  const { data: ec, error: eerr } = await sb.rpc("etat_cercle");
  if (eerr) throw eerr;
  etat.cercle = ec;
  const c = etat.cercle;
  const locaux = await chargerLocaux();
  const local = locaux.find((l) => l.id === c.local_id);
  const disponible = Number(c.ligne_credit) - Number(c.credit_utilise);
  etat.ongletGerant ??= "compte";
  cible.innerHTML = `
    <section class="feuille entete-compte">
      <div class="en-tete-lettre">
        <span class="expediteur">${esc(c.nom)}</span>
        <span>${c.semaine_courante > 0 ? `Semaine ${c.semaine_courante}` : `Compte ouvert le ${dateLongue(c.fonde_le)}`}</span>
      </div>
      ${c.devise ? `<p><em>${esc(c.devise)}</em></p>` : ""}
      ${local ? `<p class="adresse-cercle">${esc(local.titre)}, ${esc(local.adresse)}</p>` : ""}
      <div class="solde">
        <div><span class="valeur">${dollars(c.tresorerie)}</span><span class="intitule">Trésorerie du cercle</span></div>
        <div><span class="valeur">${dollars(disponible)}</span><span class="intitule">Crédit encore disponible</span></div>
        ${local ? `<div><span class="valeur">${dollars(local.loyer_hebdo)}</span><span class="intitule">Loyer hebdomadaire</span></div>` : ""}
      </div>
    </section>
    <div id="lettre-vance"></div>
    <div id="incident"></div>
    <div class="onglets onglets-gerant" role="tablist">
      ${ONGLETS_GERANT.map(([k, t]) => `<button class="onglet" role="tab" data-onglet-g="${k}" aria-selected="${etat.ongletGerant === k}">${t}</button>`).join("")}
    </div>
    <section class="feuille" id="contenu-gerant"></section>`;
  const boite = cible.querySelector("#contenu-gerant");
  const actualiser = () => vueCompte(cible);
  // changer d'onglet ne recharge que le contenu de l'onglet
  cible.querySelectorAll("[data-onglet-g]").forEach((b) => b.addEventListener("click", () => {
    etat.ongletGerant = b.dataset.ongletG;
    cible.querySelectorAll("[data-onglet-g]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    afficherOngletGerant(boite, c, actualiser);
  }));
  await Promise.all([afficherOngletGerant(boite, c, actualiser), lettreVance(cible.querySelector("#lettre-vance"), c, actualiser),
    blocIncident(cible.querySelector("#incident"), actualiser)]);
}

async function blocIncident(boite, actualiser) {
  const { data: inc } = await sb.rpc("incident_ouvert");
  if (!inc) { boite.innerHTML = ""; return; }
  boite.innerHTML = `
    <article class="feuille incident">
      <div class="en-tete-lettre"><span class="expediteur">${esc(inc.titre)}</span><span>À régler avant le prochain relevé</span></div>
      <p>${esc(inc.texte)}</p>
      <h3>Comment réagissez-vous ?</h3>
      <div class="choix-incident">
        ${inc.aides.map((a) => `
          <button class="bouton-second" data-inc="membre" data-membre="${a.slug}" data-nom="${esc(a.nom)}">
            Faire appel à ${esc(a.nom)}<br><span class="clause-discrete">${esc(a.atout)}${a.lasse ? ". Vous l'avez sollicité récemment" : ""}</span>
          </button>`).join("")}
        <button class="bouton-second" data-inc="jet">Vous en charger vous-même<br><span class="clause-discrete">Gratuit si tout se passe bien, coûteux sinon</span></button>
        <button class="bouton-second" data-inc="payer">${esc(inc.libelle_payer)}<br><span class="clause-discrete">${dollars(inc.cout_payer)}, c'est réglé</span></button>
      </div>
      ${inc.aides.length ? "" : `<p class="clause-discrete">Aucun de vos membres n'a les relations qu'il faudrait pour cette affaire.</p>`}
      <p class="clause-discrete">Sans réponse au prochain relevé, l'affaire s'aggravera d'elle-même.</p>
      <p class="erreur" id="erreur-inc"></p>
    </article>`;
  boite.onclick = async (ev) => {
    const b = ev.target.closest("[data-inc]");
    if (!b) return;
    const mode = b.dataset.inc;
    const q = mode === "membre" ? `Demander à ${b.dataset.nom} de s'en occuper ? Il attendra sans doute un geste en retour.`
      : mode === "jet" ? "Vous en charger vous-même ? Si cela tourne mal, la note sera plus salée." : `Payer ${dollars(inc.cout_payer)} pour régler l'affaire ?`;
    if (!confirm(q)) return;
    boite.querySelectorAll("button").forEach((x) => { x.disabled = true; });
    const { data, error } = await sb.rpc("resoudre_incident", { p_id: inc.id, p_mode: mode, p_membre: b.dataset.membre || null });
    if (error) { boite.querySelector("#erreur-inc").textContent = messageErreur(error); boite.querySelectorAll("button").forEach((x) => { x.disabled = false; }); return; }
    alert(data);
    actualiser();
  };
}

// Le texte des lettres de Vance : le MJ peut écrire le sien, sinon une formule selon la situation
function texteVance(d, nomMembre, patience) {
  const debut = d.premiere
    ? `<p>Vous n'aurez pas oublié l'article 4 de notre accord. Le moment est venu de préciser la nature de la courtoisie que vous me devez.</p>`
    : `<p>Je reviens vers vous pour une petite affaire.</p>`;
  const corps = d.message
    ? `<p>${esc(d.message).replace(/\n/g, "<br>")}</p>`
    : d.type === "presentation"
      ? `<p>J'ai appris que ${esc(nomMembre)} fréquente votre cercle. J'aimerais beaucoup faire sa connaissance. Je compte sur vous pour me le présenter, et pour veiller à ce qu'il trouve désormais auprès de moi ce qu'il venait chercher chez vous.</p>`
      : `<p>J'attends de vous un service, dont je vous entretiendrai de vive voix.</p>`;
  const ton = patience <= 1 ? `<p>Je ne doute pas que, cette fois, vous saurez vous montrer à la hauteur de la confiance que je vous ai accordée.</p>` : "";
  return `<p>Cher Monsieur Visconti,</p>${debut}${corps}${ton}`;
}

async function lettreVance(boite, c, actualiser) {
  const { data: demandes } = await sb.from("demandes_vance").select("*").eq("statut", "en_attente").limit(1);
  const d = demandes?.[0];
  if (!d) { boite.innerHTML = ""; return; }
  let nomMembre = "", autres = [];
  const { data: liste } = await sb.rpc("mes_membres");
  const membres = (liste || []).filter((m) => m.statut === "membre");
  if (d.type === "presentation") {
    nomMembre = membres.find((m) => m.slug === d.membre_slug)?.nom || "l'un de vos membres";
    autres = membres.filter((m) => m.slug !== d.membre_slug);
  }
  boite.innerHTML = `
    <article class="feuille lettre-vance">
      <div class="en-tete-lettre"><span class="expediteur">Vance Fiduciary Trust</span><span>Par porteur</span></div>
      ${texteVance(d, nomMembre, c.patience_vance)}
      <div class="signature-bloc"><div class="plume">V. V.</div></div>
      <p class="clause-discrete">Une réponse est attendue avant le prochain relevé du mardi.</p>
      <div class="actions">
        ${d.type === "presentation" ? `
          <button class="bouton" data-vance="accepter">Présenter ${esc(nomMembre)} à M. Vance</button>
          ${autres.length ? `<span class="substitut"><select id="vance-substitut" aria-label="Présenter quelqu'un d'autre">
            <option value="">… ou présenter quelqu'un d'autre</option>
            ${autres.map((m) => `<option value="${m.slug}">${esc(m.nom)}</option>`).join("")}
          </select><button class="bouton-second" data-vance="substituer">Présenter cette personne</button></span>` : ""}`
        : `<button class="bouton" data-vance="accepter">Accepter</button>`}
        <button class="lien-discret" data-vance="refuser">Décliner poliment</button>
      </div>
      <p class="erreur" id="erreur-vance"></p>
    </article>`;
  boite.onclick = async (ev) => {
    const b = ev.target.closest("[data-vance]");
    if (!b) return;
    const action = b.dataset.vance;
    let sub = null;
    if (action === "substituer") {
      sub = boite.querySelector("#vance-substitut").value;
      if (!sub) { boite.querySelector("#erreur-vance").textContent = "Choisissez qui présenter."; return; }
    }
    const msg = action === "refuser" ? "Décliner la demande de M. Vance ? Il pourrait s'en souvenir."
      : d.type === "presentation" ? "Le membre présenté quittera le cercle pour l'entourage de M. Vance : sa cotisation et ses dépenses ne vous reviendront plus. Confirmer ?"
      : "Accepter de rendre ce service à M. Vance ?";
    if (!confirm(msg)) return;
    const { error } = await sb.rpc("repondre_vance", { p_id: d.id, p_accepter: action !== "refuser", p_substitut: sub });
    if (error) { boite.querySelector("#erreur-vance").textContent = messageErreur(error); return; }
    actualiser();
  };
}

async function afficherOngletGerant(boite, c, actualiser) {
  boite.onclick = null; boite.onsubmit = null;
  boite.innerHTML = `<p class="chargement">Un instant…</p>`;
  try {
    if (etat.ongletGerant === "compte") await ongletReleve(boite, c);
    else if (etat.ongletGerant === "membres") await ongletMembres(boite, c, actualiser);
    else if (etat.ongletGerant === "personnel") await ongletPersonnel(boite, c, actualiser);
    else if (etat.ongletGerant === "vitrine") await adminVitrine(boite, await chargerCatalogue());
    else if (etat.ongletGerant === "amenagements") await ongletAmenagements(boite, c, actualiser);
    else await ongletCave(boite, c, actualiser);
  } catch (e) { boite.innerHTML = `<p class="erreur">${esc(messageErreur(e))}</p>`; }
}

function prochaineCloture(c) {
  if (!c.date_debut) return null;
  const d = new Date(c.date_debut);
  d.setDate(d.getDate() + c.semaine_courante * 7);   // en jours calendaires : reste à 19 h malgré le changement d'heure
  return d;
}

async function ongletReleve(boite, c) {
  const [{ data: semaines }, journal] = await Promise.all([
    sb.from("semaines").select("*").not("cloturee_le", "is", null).order("numero", { ascending: false }).limit(8),
    chargerJournal(),
  ]);
  const nums = (semaines || []).map((x) => x.numero);
  const { data: lignes } = nums.length
    ? await sb.from("releve").select("*").in("semaine", nums).order("id")
    : { data: [] };
  const prochain = prochaineCloture(c);
  const parSemaine = {};
  (lignes || []).forEach((l) => (parSemaine[l.semaine] ??= []).push(l));
  boite.innerHTML = `
    ${c.en_pause ? `<p class="avis">La Maison a suspendu les relevés pour le moment.</p>`
      : c.semaine_courante === 0 ? `<p class="avis">Votre première semaine d'activité commencera le ${jourHeure(c.date_debut)}. Les premières candidatures de membres et de personnel arriveront ce jour-là.</p>`
      : `<p class="avis">Prochain relevé : le ${jourHeure(prochain)}. Le loyer, les salaires et l'alcool des soirées seront débités à ce moment-là.</p>`}
    ${await blocEngagements(c)}
    <h2>Relevés hebdomadaires</h2>
    ${semaines?.length ? semaines.map((s, i) => `
      <details class="releve-semaine" ${i === 0 ? "open" : ""}>
        <summary><span>Semaine ${s.numero}</span><span class="${Number(s.resume?.resultat) >= 0 ? "positif" : "negatif"}">${Number(s.resume?.resultat) >= 0 ? "+" : ""}${dollars(s.resume?.resultat)}</span></summary>
        ${bilan(parSemaine[s.numero] || [])}
        <p class="sous-titre-detail">Détail des opérations</p>
        <table class="table-releve">
          ${(parSemaine[s.numero] || []).map((l) => `<tr><td>${esc(l.libelle)}</td><td class="${Number(l.montant) >= 0 ? "positif" : "negatif"}">${Number(l.montant) > 0 ? "+" : ""}${dollars(l.montant)}</td></tr>`).join("")}
          <tr class="total"><td>Trésorerie après relevé</td><td>${dollars(s.resume?.tresorerie)}</td></tr>
        </table>
      </details>`).join("") : `<p class="clause-discrete">Aucun relevé pour l'instant.</p>`}
    ${journal.filter((j) => j.visible_gerante).length ? `<h2>Correspondance</h2><ul class="journal">${journal.filter((j) => j.visible_gerante).slice(0, 20).map((j) => `<li><time>${dateCourte(j.cree_le)}</time>${esc(j.message)}</li>`).join("")}</ul>` : ""}`;
}

// Regroupe les lignes du relevé en entrées et sorties
const CAT_ENTREES = [["cotisations", "Cotisations des membres"], ["bar", "Consommations au bar"], ["soiree", "Soirées"], ["plus", "Bonnes surprises"]];
const CAT_SORTIES = [["loyer", "Loyer (coût fixe)"], ["salaires", "Personnel"], ["amenagements", "Aménagements et fournitures"], ["achats", "Achats de bouteilles"], ["alcool", "Alcool des soirées"], ["moins", "Imprévus"]];
function bilan(lignes) {
  const t = {};
  let credit = 0;
  for (const l of lignes) {
    const m = Number(l.montant);
    let cat = l.poste;
    if (cat === "credit") { credit += m; continue; }
    if (cat === "imprevu" || cat === "divers" || cat === "incident") cat = m >= 0 ? "plus" : "moins";
    t[cat] = (t[cat] || 0) + Math.abs(m);
  }
  const ent = CAT_ENTREES.reduce((s, [k]) => s + (t[k] || 0), 0);
  const sor = CAT_SORTIES.reduce((s, [k]) => s + (t[k] || 0), 0);
  const ligne = ([k, lib]) => `<tr><td>${lib}</td><td>${t[k] ? dollars(t[k]) : "—"}</td></tr>`;
  return `
    <div class="bilan">
      <table class="table-releve"><caption>Entrées</caption>${CAT_ENTREES.map(ligne).join("")}<tr class="total"><td>Total</td><td class="positif">${dollars(ent)}</td></tr></table>
      <table class="table-releve"><caption>Sorties</caption>${CAT_SORTIES.map(ligne).join("")}<tr class="total"><td>Total</td><td class="negatif">${dollars(sor)}</td></tr></table>
    </div>
    <p class="clause-discrete">Résultat de la semaine : <strong class="${ent - sor >= 0 ? "positif" : "negatif"}">${ent - sor >= 0 ? "+" : ""}${dollars(ent - sor)}</strong>${credit ? `. Avance prise sur la ligne de crédit : ${dollars(credit)}` : ""}.</p>`;
}

async function blocEngagements(c) {
  if (!c.semaine_courante) return "";
  const prochain = prochaineCloture(c);
  const [{ data: achats }, { data: evts }] = await Promise.all([
    sb.from("achats").select("montant").eq("semaine", c.semaine_courante),
    sb.from("evenements").select("cout_alcool, date_evt").lt("date_evt", prochain.toISOString()).gte("date_evt", new Date(prochain.getTime() - 7 * 864e5).toISOString()),
  ]);
  const fact = (achats || []).reduce((s, a) => s + Number(a.montant), 0);
  const alc = (evts || []).reduce((s, e) => s + Number(e.cout_alcool), 0);
  if (!fact && !alc) return "";
  return `<p class="clause-discrete">Déjà engagé pour ce relevé : ${dollars(fact)} de factures de bouteilles et ${dollars(alc)} d'alcool pour les soirées prévues, en plus du loyer et des salaires.</p>`;
}

async function ongletCave(boite, c, actualiser) {
  const [{ data: promos }, { data: cave }, { data: achats }, catalogue] = await Promise.all([
    sb.from("offres_produits").select("*").eq("semaine", c.semaine_courante).not("promo", "is", null),
    sb.from("cave").select("quantite, produits(nom, categorie, gamme, prix_achat)").gt("quantite", 0),
    sb.from("achats").select("quantite").eq("semaine", c.semaine_courante),
    chargerCatalogue(),
  ]);
  const promo = Object.fromEntries((promos || []).map((o) => [o.produit_id, o]));
  const deja = (achats || []).reduce((s, a) => s + a.quantite, 0);
  const reste = 15 - deja;
  const confiance = c.standing >= 30;
  const totalCave = (cave || []).reduce((s, x) => s + x.quantite, 0);
  const prixDe = (p) => promo[p.id]?.promo === "remise" ? Number(promo[p.id].prix) : Number(p.prix_achat);
  const ligneProduit = (p) => {
    const o = promo[p.id];
    const bloque = p.gamme === "rare" && !confiance;
    return `
      <div class="offre">
        <div>
          <strong>${esc(p.nom)}</strong>${p.age ? `, ${esc(p.age)}` : ""}
          ${o?.promo === "remise" ? `<span class="promo">Prix spécial cette semaine</span>` : o?.promo === "un_offert" ? `<span class="promo">Une bouteille offerte pour une achetée</span>` : ""}<br>
          <span class="clause-discrete">${esc(p.categorie)}. ${esc(p.description)}</span>
        </div>
        <div class="offre-achat">
          <span class="prix">${dollars(prixDe(p))}${o?.promo === "remise" ? ` <s>${dollars(p.prix_achat)}</s>` : ""}</span>
          ${bloque ? `<span class="clause-discrete">Réservé aux comptes de confiance</span>`
            : `<input type="number" class="q-panier" data-produit="${p.id}" data-prix="${prixDe(p)}" data-nom="${esc(p.nom)}" min="0" max="15" value="0" aria-label="Bouteilles de ${esc(p.nom)}">`}
        </div>
      </div>`;
  };
  boite.innerHTML = `
    <h2>Bon de commande de la semaine</h2>
    ${c.semaine_courante === 0 ? `<p class="clause-discrete">Les commandes ouvriront le ${jourHeure(c.date_debut)}.</p>` : `
      <p class="clause-discrete">La Maison livre de 5 à 15 bouteilles par semaine, à choisir dans tout son catalogue. Livraison immédiate, facture réglée au relevé du mardi. Le bar entame environ une bouteille pour trois passages ; ce qui n'est pas bu reste en cave.</p>
      <p class="avis">Déjà commandé cette semaine : ${deja} bouteille${deja > 1 ? "s" : ""}. ${reste >= 5 ? `Vous pouvez encore en commander jusqu'à ${reste}.` : "Le plafond hebdomadaire est atteint."}</p>
      ${reste >= 5 ? `
      <form id="f-panier">
        ${catalogue.map((f) => `<h3 class="fournisseur-titre">${esc(f.nom)}</h3>${f.produits.map(ligneProduit).join("")}`).join("")}
        <div class="panier-recap" aria-live="polite"><span id="panier-total">0 bouteille, 0 $</span>
          <button class="bouton" type="submit">Passer commande</button></div>
        <p class="erreur" id="erreur-cave"></p>
      </form>` : ""}`}
    <h2>Votre cave (${totalCave} bouteille${totalCave > 1 ? "s" : ""})</h2>
    ${(cave || []).length ? `<table class="table-releve">${cave.sort((a, b) => b.quantite - a.quantite).map((x) => `<tr><td>${esc(x.produits.nom)}<br><span class="clause-discrete">${esc(x.produits.categorie)}${x.produits.gamme === "rare" ? ", pièce rare" : x.produits.gamme === "premium" ? ", haut de gamme" : ""}</span></td><td>${x.quantite}</td></tr>`).join("")}</table>
      <p class="clause-discrete">Les références haut de gamme et rares en cave rehaussent le prestige du cercle, et les membres dépensent davantage au bar.</p>`
      : `<p class="clause-discrete">Votre cave est vide.</p>`}`;

  const form = boite.querySelector("#f-panier");
  if (!form) return;
  const recalcul = () => {
    let n = 0, m = 0;
    form.querySelectorAll(".q-panier").forEach((i) => { const q = Math.max(0, Number(i.value) || 0); n += q; m += q * Number(i.dataset.prix); });
    const ok = n >= 5 && n <= reste;
    form.querySelector("#panier-total").textContent = `${n} bouteille${n > 1 ? "s" : ""}, ${dollars(m)}${n > 0 && n < 5 ? " (minimum 5)" : n > reste ? ` (maximum ${reste})` : ""}`;
    form.querySelector("button[type=submit]").disabled = !ok;
    return { n, m };
  };
  form.addEventListener("input", recalcul);
  recalcul();
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const { n, m } = recalcul();
    const lignes = [...form.querySelectorAll(".q-panier")].filter((i) => Number(i.value) > 0)
      .map((i) => ({ produit: i.dataset.produit, quantite: Number(i.value) }));
    if (!confirm(`Commander ${n} bouteilles pour ${dollars(m)} ? La facture sera réglée au relevé du mardi.`)) return;
    const { error } = await sb.rpc("commander_panier", { p_lignes: lignes });
    if (error) { form.querySelector("#erreur-cave").textContent = messageErreur(error); return; }
    actualiser();
  });
}

const CATEGORIES_AMEN = [["mobilier", "Mobilier"], ["service", "Service et éclairage"], ["tenues", "Tenues du personnel"]];
async function ongletAmenagements(boite, c, actualiser) {
  const [{ data: articles, error }, { data: achetes }] = await Promise.all([
    sb.from("amenagements").select("*").order("ordre"),
    sb.from("amenagements_achetes").select("*"),
  ]);
  if (error) throw error;
  const possede = Object.fromEntries((achetes || []).map((a) => [a.slug, a]));
  const dispo = Number(c.tresorerie) + Number(c.ligne_credit) - Number(c.credit_utilise);
  const fiche = (a) => {
    const p = possede[a.slug];
    const bloque = c.standing < a.standing_requis;
    return `
      <article class="article-amen ${p ? "possede" : ""} ${bloque ? "bloque" : ""}">
        <div class="modeles">
          ${[1, 2].map((m) => `
            <label class="modele">
              <input type="radio" name="m-${a.slug}" value="${m}" ${(p ? p.modele === m : m === 1) ? "checked" : ""} ${p || bloque ? "disabled" : ""}>
              <img src="img/amenagements/${a.slug}-${m}.jpg" alt="${esc(a.nom)}, modèle ${m}" loading="lazy">
            </label>`).join("")}
        </div>
        <h3>${esc(a.nom)}</h3>
        <p class="clause-discrete">${esc(a.description)}</p>
        <div class="actions">
          ${p ? `<span class="acquis">Acquis${p.semaine ? `, semaine ${p.semaine}` : ""}</span>`
            : bloque ? `<span class="clause-discrete">Ce fournisseur ne travaille qu'avec des établissements mieux établis.</span>`
            : `<span class="prix">${dollars(a.prix)}</span><button class="bouton-second" data-acheter="${a.slug}" data-nom="${esc(a.nom)}" data-prix="${a.prix}">Acquérir</button>`}
        </div>
      </article>`;
  };
  boite.innerHTML = `
    <h2>Aménager le cercle</h2>
    <p class="clause-discrete">Chaque pièce existe en deux modèles : choisissez celui qui vous plaît avant d'acquérir. Le paiement est immédiat, sur la trésorerie puis sur la ligne de crédit si nécessaire (disponible : ${dollars(dispo)}). Les pièces acquises apparaissent dans le salon de votre vitrine.</p>
    ${CATEGORIES_AMEN.map(([k, t]) => `<h3 class="fournisseur-titre">${t}</h3><div class="grille-amen">${articles.filter((a) => a.categorie === k).map(fiche).join("")}</div>`).join("")}
    <p class="erreur" id="erreur-amen" aria-live="polite"></p>`;
  boite.onclick = async (ev) => {
    const b = ev.target.closest("[data-acheter]");
    if (!b) return;
    const modele = Number(boite.querySelector(`input[name="m-${b.dataset.acheter}"]:checked`)?.value || 1);
    if (!confirm(`Acquérir « ${b.dataset.nom} » (modèle ${modele}) pour ${dollars(b.dataset.prix)} ?`)) return;
    b.disabled = true;
    const { error } = await sb.rpc("acheter_amenagement", { p_slug: b.dataset.acheter, p_modele: modele });
    if (error) { b.disabled = false; boite.querySelector("#erreur-amen").textContent = messageErreur(error); return; }
    actualiser();
  };
}

async function ongletMembres(boite, c, actualiser) {
  const { data: liste, error } = await sb.rpc("mes_membres");
  if (error) throw error;
  const candidats = liste.filter((m) => m.statut === "candidat");
  const membres = liste.filter((m) => m.statut === "membre");
  const chezVance = liste.filter((m) => m.statut === "vance");
  boite.innerHTML = `
    <form id="f-cotisation" class="ligne-cotisation">
      <label for="cotisation">Cotisation mensuelle ($), prélevée le premier mardi du mois</label>
      <div class="actions"><input id="cotisation" type="number" min="0" step="10" value="${Number(c.cotisation_mensuelle)}">
      <button class="bouton-second" type="submit">Modifier</button><span class="statut" aria-live="polite"></span></div>
      <p class="clause-discrete">Le montant décide de qui frappe à votre porte : trop élevé, les bourses modestes renoncent ; trop modeste, les grandes fortunes jugent le cercle indigne d'elles.</p>
    </form>
    <h2>Candidatures de la semaine</h2>
    ${c.semaine_courante === 0 ? `<p class="clause-discrete">Les premières candidatures arriveront le ${jourHeure(c.date_debut)}.</p>`
      : candidats.length ? candidats.map((m) => ficheCandidat(m)).join("")
      : `<p class="clause-discrete">Aucune candidature en attente. De nouveaux noms vous seront proposés au prochain relevé.</p>`}
    <p class="clause-discrete">Vous pouvez prendre des renseignements deux fois par semaine. Une candidature sans réponse au relevé suivant est retirée.</p>
    <h2>Membres du cercle (${membres.length})</h2>
    ${membres.length ? membres.map((m) => ficheMembre(m)).join("") : `<p class="clause-discrete">Le cercle n'a pas encore de membres.</p>`}
    ${chezVance.length ? `<h2>Dans l'entourage de M. Vance</h2><p class="clause-discrete">${chezVance.map((m) => esc(m.nom)).join(", ")}. Ils ne fréquentent plus le cercle.</p>` : ""}
    <p class="erreur" id="erreur-membres" aria-live="polite"></p>`;

  const erreur = boite.querySelector("#erreur-membres");
  boite.querySelector("#f-cotisation").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const { error } = await sb.rpc("maj_cotisation", { p_montant: Number(ev.target.cotisation.value) });
    ev.target.querySelector(".statut").textContent = error ? messageErreur(error) : "Enregistré.";
  });
  boite.onclick = async (ev) => {
    const b = ev.target.closest("[data-action]");
    if (!b) return;
    const slug = b.dataset.slug, nom = b.dataset.nom;
    erreur.textContent = "";
    let r;
    if (b.dataset.action === "observer") r = await sb.rpc("observer_candidat", { p_slug: slug });
    else if (b.dataset.action === "accepter") r = await sb.rpc("repondre_candidat", { p_slug: slug, p_accepter: true });
    else if (b.dataset.action === "decliner") { if (!confirm(`Décliner la candidature de ${nom} ?`)) return; r = await sb.rpc("repondre_candidat", { p_slug: slug, p_accepter: false }); }
    else if (b.dataset.action === "exclure") { if (!confirm(`Exclure ${nom} du cercle ? Les autres membres le remarqueront, et il ne reviendra pas.`)) return; r = await sb.rpc("exclure_membre", { p_slug: slug }); }
    else if (b.dataset.action === "nourrir") { if (!confirm(`Vous nourrir sur ${nom} ? Il ne pourra plus venir au cercle pendant deux semaines.`)) return; r = await sb.rpc("se_nourrir", { p_slug: slug }); }
    if (r?.error) { erreur.textContent = messageErreur(r.error); return; }
    if (b.dataset.action === "nourrir") {
      const { data: apres } = await sb.rpc("mes_membres");
      const lui = apres?.find((x) => x.slug === slug);
      alert(lui?.anemie
        ? `Vous vous êtes nourri sur ${nom}. Il se sentira faible et ne viendra pas au cercle pendant deux semaines.`
        : `Le sang de ${nom} ne passe pas : il ne correspond pas à ce que votre sang exige.`);
    }
    if (b.dataset.action === "observer" && r?.data) alert(r.data);
    actualiser();
  };
}

function ficheCandidat(m) {
  return `
    <article class="fiche-perso">
      <div class="portrait">${portrait("membres", m.slug, m.nom)}</div>
      <div class="fiche-texte">
        <h3>${esc(m.nom)}, ${m.age} ans</h3>
        <div class="origine">${esc(m.metier)}. ${esc(m.parrain)}</div>
        <p>${esc(m.presentation)}</p>
        ${m.indices?.length ? `<ul class="indices">${m.indices.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
        <div class="actions">
          <button class="bouton" data-action="accepter" data-slug="${m.slug}" data-nom="${esc(m.nom)}">Admettre</button>
          <button class="bouton-second" data-action="observer" data-slug="${m.slug}" data-nom="${esc(m.nom)}">Se renseigner</button>
          <button class="lien-discret" data-action="decliner" data-slug="${m.slug}" data-nom="${esc(m.nom)}">Décliner</button>
        </div>
      </div>
    </article>`;
}

function ficheMembre(m) {
  return `
    <article class="fiche-perso fiche-membre">
      <div class="portrait">${portrait("membres", m.slug, m.nom)}</div>
      <div class="fiche-texte">
        <h3>${esc(m.nom)}, ${m.age} ans</h3>
        <div class="origine">${esc(m.metier)}. Humeur : ${esc(m.humeur)}${m.anemie ? ". Souffrant, absent pour le moment" : ""}</div>
        ${m.avertissement ? `<p class="secret">Semble sur le point de quitter le cercle.</p>` : ""}
        ${m.atout ? `<p><strong>Peut vous rendre service :</strong> ${esc(m.atout)}</p>` : ""}
        ${m.indices?.length ? `<ul class="indices">${m.indices.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
        <div class="actions">
          ${m.anemie ? "" : `<button class="bouton-second" data-action="nourrir" data-slug="${m.slug}" data-nom="${esc(m.nom)}">Se nourrir</button>`}
          <button class="lien-discret" data-action="exclure" data-slug="${m.slug}" data-nom="${esc(m.nom)}">Exclure du cercle</button>
        </div>
      </div>
    </article>`;
}

async function ongletPersonnel(boite, c, actualiser) {
  const [{ data: offres }, { data: equipe }] = await Promise.all([
    sb.from("offres_personnel").select("slug, personnel(*)").eq("semaine", c.semaine_courante),
    sb.from("personnel").select("*").eq("statut", "embauche").order("ordre"),
  ]);
  const disponibles = (offres || []).map((o) => o.personnel).filter((p) => p && p.statut === "disponible");
  const masse = (equipe || []).reduce((t, p) => t + Number(p.salaire_hebdo), 0);
  boite.innerHTML = `
    <h2>Candidatures transmises par Lakeshore Staffing</h2>
    ${c.semaine_courante === 0 ? `<p class="clause-discrete">L'agence vous transmettra ses premiers dossiers le ${jourHeure(c.date_debut)}.</p>`
      : disponibles.length ? disponibles.map((p) => `
        <article class="fiche-perso">
          <div class="portrait">${portrait("personnel", p.slug, p.nom)}</div>
          <div class="fiche-texte">
            <h3>${esc(p.nom)}, ${p.age} ans</h3>
            <div class="origine">${LIBELLE_POSTE[p.poste]}. Salaire demandé : ${dollars(p.salaire_hebdo)} par semaine</div>
            <p>${esc(p.presentation)}</p>
            <div class="actions"><button class="bouton" data-embaucher="${p.slug}" data-nom="${esc(p.nom)}">Embaucher</button></div>
          </div>
        </article>`).join("")
      : `<p class="clause-discrete">Aucun dossier cette semaine. L'agence vous en transmettra d'autres au prochain relevé.</p>`}
    <h2>Votre équipe (${(equipe || []).length})</h2>
    ${(equipe || []).length ? `<p class="clause-discrete">Masse salariale : ${dollars(masse)} par semaine.</p>` + equipe.map((p) => `
      <article class="fiche-perso">
        <div class="portrait">${portrait("personnel", p.slug, p.nom)}</div>
        <div class="fiche-texte">
          <h3>${esc(p.nom)}</h3>
          <div class="origine">${LIBELLE_POSTE[p.poste]}, ${dollars(p.salaire_hebdo)} par semaine</div>
          <div class="actions"><button class="lien-discret" data-congedier="${p.slug}" data-nom="${esc(p.nom)}">Congédier</button></div>
        </div>
      </article>`).join("") : `<p class="clause-discrete">Personne ne travaille encore au cercle. Sans barman, le bar rapporte moitié moins ; sans serveur, une soirée ne peut pas accueillir plus de six invités.</p>`}
    <p class="erreur" id="erreur-perso" aria-live="polite"></p>`;
  boite.onclick = async (ev) => {
    const e = ev.target.closest("[data-embaucher]"), q = ev.target.closest("[data-congedier]");
    if (!e && !q) return;
    let r;
    if (e) { if (!confirm(`Embaucher ${e.dataset.nom} ?`)) return; r = await sb.rpc("embaucher", { p_slug: e.dataset.embaucher }); }
    else { if (!confirm(`Congédier ${q.dataset.nom} ? Il ne reviendra pas.`)) return; r = await sb.rpc("congedier", { p_slug: q.dataset.congedier }); }
    if (r.error) { boite.querySelector("#erreur-perso").textContent = messageErreur(r.error); return; }
    actualiser();
  };
}

function blocFournisseur(f) {
  return `
    <div class="fournisseur">
      <h3>${esc(f.nom)}</h3>
      <div class="origine">${esc(f.origine)}, ${esc(f.specialite?.toLowerCase())}</div>
      <p class="desc">${esc(f.description)}</p>
      ${f.produits.map((p) => `
        <div class="reference">
          <span>${esc(p.nom)}${p.age ? `, ${esc(p.age)}` : ""}${p.gamme === "rare" ? ` <span class="gamme-rare">(sur allocation)</span>` : ""}</span>
          <span class="prix">${dollars(p.prix_achat)}</span>
          <span class="detail">${esc(p.categorie)}. ${esc(p.description)}</span>
        </div>`).join("")}
    </div>`;
}

/* ---------- Vue MJ ---------- */
async function vueMJ() {
  app.innerHTML = `
    <div class="onglets" role="tablist">
      <button class="onglet" role="tab" data-onglet="coulisses" aria-selected="${etat.ongletMJ === "coulisses"}">Coulisses</button>
      <button class="onglet" role="tab" data-onglet="joueuse" aria-selected="${etat.ongletMJ === "joueuse"}">Vue de la joueuse</button>
      <button class="onglet" role="tab" data-onglet="membresmj" aria-selected="${etat.ongletMJ === "membresmj"}">Membres</button>
      <button class="onglet" role="tab" data-onglet="personnel" aria-selected="${etat.ongletMJ === "personnel"}">Personnel</button>
      <button class="onglet" role="tab" data-onglet="visuels" aria-selected="${etat.ongletMJ === "visuels"}">Visuels des soirées</button>
    </div>
    <div id="contenu-mj"></div>`;
  app.querySelectorAll(".onglet").forEach((b) => b.addEventListener("click", () => {
    etat.ongletMJ = b.dataset.onglet;
    vueMJ();
  }));
  const cible = app.querySelector("#contenu-mj");
  if (etat.ongletMJ === "joueuse") return vueJoueuse(cible);
  if (etat.ongletMJ === "personnel") return vuePersonnelMJ(cible);
  if (etat.ongletMJ === "membresmj") return vueMembresMJ(cible);
  if (etat.ongletMJ === "visuels") return vueVisuelsMJ(cible);

  if (etat.cercle.statut === "actif") {
    const { data: ec } = await sb.rpc("etat_cercle");
    if (ec) etat.cercle = ec;
  }
  const c = etat.cercle;
  const [journal, locaux, { data: soirees }, { data: derniere }, { data: lignesMJ }] = await Promise.all([chargerJournal(), chargerLocaux(),
    sb.from("evenements").select("titre, date_evt, prix_participation, cout_alcool, texte_libre, theme").order("date_evt", { ascending: false }).limit(12),
    sb.from("semaines").select("*").not("cloturee_le", "is", null).order("numero", { ascending: false }).limit(1),
    sb.from("releve").select("*").order("id", { ascending: false }).limit(40)]);
  const sem = derniere?.[0];
  const prochain = prochaineCloture(c);
  const local = locaux.find((l) => l.id === c.local_id);
  const statuts = { invitation: "Carte remise, contrat pas encore signé", contrat_signe: "Contrat signé, cercle pas encore fondé", actif: "Cercle fondé" };
  cible.innerHTML = `
    <section class="feuille coulisses">
      <h1>Coulisses</h1>
      <p class="badge-mj">Visible uniquement par le MJ.</p>
      <dl>
        <dt>Étape</dt><dd>${statuts[c.statut]}</dd>
        <dt>Signature</dt><dd>${c.signature ? esc(c.signature) + " (" + dateCourte(c.contrat_signe_le) + ")" : "—"}</dd>
        <dt>Nom du cercle</dt><dd>${esc(c.nom) || "—"}</dd>
        <dt>Devise</dt><dd>${esc(c.devise) || "—"}</dd>
        <dt>Local</dt><dd>${local ? `${esc(local.titre)} (${dollars(local.loyer_hebdo)} par semaine)` : "—"}</dd>
        <dt>Fondé le</dt><dd>${c.fonde_le ? dateCourte(c.fonde_le) : "—"}</dd>
        <dt>Ligne de crédit</dt><dd>${dollars(c.ligne_credit)} (utilisé : ${dollars(c.credit_utilise)})</dd>
        <dt>Trésorerie</dt><dd>${dollars(c.tresorerie)}</dd>
        <dt>Cotisation</dt><dd>${dollars(c.cotisation_mensuelle)} par mois</dd>
        <dt>Semaine</dt><dd>${c.statut !== "actif" ? "—" : c.semaine_courante === 0 ? `démarre le ${jourHeure(c.date_debut)}` : `${c.semaine_courante}, clôture le ${jourHeure(prochain)}`}${c.en_pause ? " (en pause)" : ""}</dd>
        <dt>Standing</dt><dd>${c.standing}</dd>
        <dt>Humeur de Vance</dt><dd>${c.patience_vance ?? 3}/3</dd>
      </dl>
      ${c.statut === "actif" ? `
      <h2>Calendrier</h2>
      <div class="actions">
        <button class="bouton-second" id="mj-avancer">Avancer d'une semaine (clôturer maintenant)</button>
        <button class="bouton-second" id="mj-pause">${c.en_pause ? "Relancer le calendrier" : "Mettre en pause"}</button>
      </div>
      <h2>Incidents</h2>
      <div id="mj-incidents"></div>
      <h2>Victor Vance</h2>
      <div id="mj-vance"></div>
      <h2>Ligne exceptionnelle</h2>
      <form id="mj-ligne" class="sous-form">
        <label for="l-libelle">Libellé (ce que verra le joueur)</label>
        <input id="l-libelle" type="text" required placeholder="Ex. : Cargaison perdue sur la I-94">
        <div class="deux-col">
          <div><label for="l-montant">Montant ($, négatif pour une dépense)</label><input id="l-montant" type="number" step="10" required></div>
          <div><label><input id="l-visible" type="checkbox" checked> Visible par le joueur</label></div>
        </div>
        <div class="actions"><button class="bouton" type="submit">Ajouter au relevé</button></div>
      </form>
      <h2>Dernier relevé${sem ? ` (semaine ${sem.numero})` : ""}</h2>
      ${sem ? `<p class="clause-discrete">Recettes ${dollars(sem.resume?.recettes)}, dépenses ${dollars(sem.resume?.depenses)}, résultat ${dollars(sem.resume?.resultat)}. Passages au bar : ${sem.resume?.passages_bar}. Membres : ${sem.resume?.membres}.</p>
        <table class="table-releve">${(lignesMJ || []).filter((l) => l.semaine === sem.numero).reverse().map((l) => `<tr><td>${esc(l.libelle)}${l.visible_gerante ? "" : " <span class=\"badge-mj\">(MJ)</span>"}${l.details?.presents ? `<br><span class="clause-discrete">${l.details.presents.map(esc).join(", ")}</span>` : ""}</td><td>${dollars(l.montant)}</td></tr>`).join("")}</table>`
        : `<p class="clause-discrete">Aucune semaine clôturée.</p>`}` : ""}
      <h2>Soirées annoncées</h2>
      ${soirees?.length ? `<ul class="journal">${soirees.map((e) => `<li><time>${dateCourte(e.date_evt)}</time>${esc(e.titre)}, participation ${dollars(e.prix_participation)}, alcool ${dollars(e.cout_alcool)}${e.texte_libre ? ` <span class="secret">(composée par le joueur : bonus possible)</span>` : ""}</li>`).join("")}</ul>` : `<p class="clause-discrete">Aucune soirée annoncée.</p>`}
      <h2>Journal complet</h2>
      ${journal.length ? `<ul class="journal">${journal.map((j) => `<li><time>${dateCourte(j.cree_le)}</time>${esc(j.message)}${j.visible_gerante ? "" : ` <span class="badge-mj">(MJ seulement)</span>`}</li>`).join("")}</ul>` : `<p class="clause-discrete">Rien pour l'instant : la joueuse n'a pas encore agi.</p>`}
      <div class="actions" style="margin-top:24px">
        <button class="bouton-second" id="actualiser">Actualiser</button>
        <button class="bouton-second" id="reinit">Remettre à zéro (tests)</button>
      </div>
      <p class="erreur" id="erreur"></p>
    </section>`;
  cible.querySelector("#actualiser").addEventListener("click", async () => { await chargerCercle(); vueMJ(); });
  const err = (e) => { cible.querySelector("#erreur").textContent = messageErreur(e); };
  if (c.statut === "actif") pupitreVance(cible.querySelector("#mj-vance"), c, () => vueMJ());
  if (c.statut === "actif") pupitreIncidents(cible.querySelector("#mj-incidents"), () => vueMJ());
  cible.querySelector("#mj-avancer")?.addEventListener("click", async () => {
    if (!confirm("Clôturer la semaine en cours maintenant ? Le relevé sera calculé et une nouvelle semaine commencera.")) return;
    const { error } = await sb.rpc("mj_avancer_semaine"); if (error) return err(error);
    await chargerCercle(); vueMJ();
  });
  cible.querySelector("#mj-pause")?.addEventListener("click", async () => {
    const { error } = await sb.rpc("mj_pause", { p_pause: !c.en_pause }); if (error) return err(error);
    await chargerCercle(); vueMJ();
  });
  cible.querySelector("#mj-ligne")?.addEventListener("submit", async (ev) => {
    ev.preventDefault(); const f = ev.target;
    const { error } = await sb.rpc("mj_ligne", { p_libelle: f["l-libelle"].value.trim(), p_montant: Number(f["l-montant"].value), p_visible: f["l-visible"].checked });
    if (error) return err(error);
    await chargerCercle(); vueMJ();
  });
  cible.querySelector("#reinit").addEventListener("click", async () => {
    if (!confirm("Tout effacer pour revenir à l'invitation : signature, nom, bail, vitrine, membres, personnel, relevés et journal ?")) return;
    const { data, error } = await sb.rpc("reinitialiser_cercle");
    if (!error) {
      const tout = "00000000-0000-0000-0000-000000000000";
      await Promise.all([
        sb.from("evenements").delete().neq("id", tout),
        sb.from("vitrine_produits").delete().neq("produit_id", tout),
        sb.from("vitrine_photos").delete().neq("id", tout),
        sb.from("semaines").delete().gte("numero", -1),
        sb.from("releve").delete().gte("id", 0),
        sb.from("observations").delete().gte("id", 0),
        sb.from("offres_personnel").delete().gte("semaine", -1),
        sb.from("offres_produits").delete().gte("semaine", -1),
        sb.from("achats").delete().gte("id", 0),
        sb.from("cave").delete().gte("quantite", 0),
        sb.from("amenagements_achetes").delete().neq("slug", ""),
        sb.from("demandes_vance").delete().gte("id", 0),
        sb.from("incidents").delete().gte("id", 0),
        sb.from("membres").update({ derniere_sollicitation: null }).neq("slug", ""),
      ]);
      await sb.from("journal").delete().gte("id", 0);
    }
    if (error) { cible.querySelector("#erreur").textContent = messageErreur(error); return; }
    etat.cercle = data;
    vueMJ();
  });
}

/* ---------- Édition de la vitrine (gérant) ---------- */
const urlImage = (chemin) =>
  !chemin ? "" : /^(img\/|https?:)/.test(chemin) ? chemin : `${SUPABASE_URL}/storage/v1/object/public/vitrine/${chemin}`;

// Réduit l'image (1600 px max) avant envoi, pour des pages légères.
async function envoyerImage(fichier) {
  const bitmap = await createImageBitmap(fichier);
  const echelle = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * echelle);
  canvas.height = Math.round(bitmap.height * echelle);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  const chemin = `${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from("vitrine").upload(chemin, blob, { contentType: "image/jpeg" });
  if (error) throw error;
  return chemin;
}

async function adminVitrine(boite, catalogue) {
  const c = etat.cercle;
  const [{ data: evts }, { data: mises }, { data: photos }, { data: themes }] = await Promise.all([
    sb.from("evenements").select("*").order("date_evt"),
    sb.from("vitrine_produits").select("*").order("ordre"),
    sb.from("vitrine_photos").select("*").order("ordre").order("cree_le"),
    sb.from("themes_soiree").select("*").order("ordre"),
  ]);
  const themeParSlug = Object.fromEntries(themes.map((t) => [t.slug, t]));
  const produits = catalogue.flatMap((f) => f.produits.map((p) => ({ ...p, fournisseur: f.nom })));
  const parId = Object.fromEntries(produits.map((p) => [p.id, p]));
  const dejaMis = new Set(mises.map((m) => m.produit_id));
  etat.volets ??= {};
  const ouvert = (cle, defaut) => ((etat.volets[cle] ?? defaut) ? "open" : "");

  boite.innerHTML = `
    <div class="en-tete-lettre">
      <span class="expediteur">La vitrine du cercle</span>
      <a href="/cercle" target="_blank" rel="noopener">Voir la vitrine publique</a>
    </div>
    <p class="clause-discrete">Ce que vous publiez ici est visible par toute personne qui connaît l'adresse de votre vitrine.</p>

    <details class="volet" data-volet="presentation" ${ouvert("presentation", !c.presentation)}>
      <summary>Présentation</summary>
      <form id="f-textes">
        <label for="accroche">Phrase d'accueil</label>
        <input id="accroche" type="text" maxlength="160" value="${esc(c.accroche)}" placeholder="Une phrase qui donne le ton">
        <label for="presentation">L'esprit du cercle</label>
        <textarea id="presentation" maxlength="2000" rows="6" placeholder="Qui vous recevez, ce qu'on y boit, ce qu'on y trouve. Laissez une ligne vide pour changer de paragraphe.">${esc(c.presentation)}</textarea>
        <div class="actions"><button class="bouton" type="submit">Enregistrer la présentation</button><span class="statut" aria-live="polite"></span></div>
      </form>
    </details>

    <details class="volet" data-volet="soirees" ${ouvert("soirees", !evts.length)}>
      <summary>Soirées (${evts.length})</summary>
      <ul class="liste-admin">${evts.map((e) => `
        <li>
          ${e.image ? `<img src="${esc(urlImage(e.image))}" alt="">` : `<span class="vignette-vide"></span>`}
          <div><strong>${esc(e.titre)}</strong><br><span class="clause-discrete">${dateCourte(e.date_evt)}, participation ${Number(e.prix_participation) > 0 ? dollars(e.prix_participation) : "offerte"}, alcool ${dollars(e.cout_alcool)}</span></div>
          <button type="button" class="lien-discret" data-retirer-evt="${e.id}">Retirer</button>
        </li>`).join("") || `<li class="clause-discrete">Aucune soirée annoncée.</li>`}</ul>
      <form id="f-soiree" class="sous-form">
        <h3>Annoncer une soirée</h3>
        <label for="s-theme">Thème</label>
        <select id="s-theme" required>
          <option value="">Choisir un thème</option>
          ${themes.map((t) => `<option value="${t.slug}">${esc(t.nom)}</option>`).join("")}
          <option value="libre">Thème libre</option>
        </select>
        <div id="s-suite"></div>
      </form>
    </details>

    <details class="volet" data-volet="produits" ${ouvert("produits", false)}>
      <summary>Bouteilles mises en avant (${mises.length})</summary>
      <ul class="liste-admin">${mises.map((m) => { const p = parId[m.produit_id]; return p ? `
        <li>
          <span class="vignette-vide"></span>
          <div><strong>${esc(p.nom)}</strong>${m.note ? `<br><em class="clause-discrete">« ${esc(m.note)} »</em>` : ""}</div>
          <button type="button" class="lien-discret" data-retirer-produit="${m.produit_id}">Retirer</button>
        </li>` : ""; }).join("") || `<li class="clause-discrete">Aucune bouteille mise en avant.</li>`}</ul>
      <form id="f-produit" class="sous-form">
        <label for="p-choix">Bouteille</label>
        <select id="p-choix" required>
          <option value="">Choisir une référence</option>
          ${produits.filter((p) => !dejaMis.has(p.id)).map((p) => `<option value="${p.id}">${esc(p.nom)} (${esc(p.categorie)})</option>`).join("")}
        </select>
        <label for="p-note">Votre mot sur cette bouteille (facultatif)</label>
        <input id="p-note" type="text" maxlength="200" placeholder="Ex. : Le compagnon idéal d'une soirée d'hiver.">
        <div class="actions"><button class="bouton" type="submit">Mettre en avant</button><span class="statut" aria-live="polite"></span></div>
      </form>
    </details>

    <details class="volet" data-volet="photos" ${ouvert("photos", false)}>
      <summary>Photos du salon (${photos.length})</summary>
      <div class="grille-photos-admin">${photos.map((p) => `
        <figure>
          <img src="${esc(urlImage(p.chemin))}" alt="${esc(p.legende || "")}">
          <figcaption>${esc(p.legende || "")} <button type="button" class="lien-discret" data-retirer-photo="${p.id}">Retirer</button></figcaption>
        </figure>`).join("")}</div>
      <form id="f-photo" class="sous-form">
        <label for="ph-fichiers">Ajouter des photos</label>
        <input id="ph-fichiers" type="file" accept="image/*" multiple required>
        <label for="ph-legende">Légende (facultative, appliquée à toutes)</label>
        <input id="ph-legende" type="text" maxlength="120">
        <div class="actions"><button class="bouton" type="submit">Envoyer</button><span class="statut" aria-live="polite"></span></div>
      </form>
    </details>`;

  boite.querySelectorAll("details[data-volet]").forEach((d) =>
    d.addEventListener("toggle", () => { etat.volets[d.dataset.volet] = d.open; }));
  const recharger = () => adminVitrine(boite, catalogue);
  const occupe = (form, msg) => { form.querySelector("button[type=submit]").disabled = !!msg; form.querySelector(".statut").textContent = msg || ""; };
  const echec = (form, e) => { form.querySelector("button[type=submit]").disabled = false; form.querySelector(".statut").textContent = messageErreur(e); };

  boite.querySelector("#f-textes").addEventListener("submit", async (ev) => {
    ev.preventDefault(); const f = ev.target; occupe(f, "Enregistrement…");
    const { error } = await sb.rpc("maj_textes_vitrine", { p_accroche: f.accroche.value, p_presentation: f.presentation.value });
    if (error) return echec(f, error);
    etat.cercle.accroche = f.accroche.value; etat.cercle.presentation = f.presentation.value;
    occupe(f, ""); f.querySelector(".statut").textContent = "Enregistré.";
  });

  const fSoiree = boite.querySelector("#f-soiree");
  const suite = fSoiree.querySelector("#s-suite");
  const vignettes = (images, nom) => images.map((src, i) => `
    <label class="choix-visuel"><input type="radio" name="s-visuel" value="${esc(src)}" ${i === 0 ? "checked" : ""}>
      <img src="${esc(src)}" alt="Visuel ${i + 1}" onerror="this.closest('label').remove()"></label>`).join("");
  const blocVisuel = (images) => `
    <fieldset class="champ-groupe">
      <legend>Visuel</legend>
      <div class="grille-visuels">
        ${vignettes(images)}
        <label class="choix-visuel choix-texte"><input type="radio" name="s-visuel" value="perso"> <span>Envoyer ma propre image</span></label>
        <label class="choix-visuel choix-texte"><input type="radio" name="s-visuel" value="" ${images.length ? "" : "checked"}> <span>Sans visuel</span></label>
      </div>
      <input id="s-image" type="file" accept="image/*" hidden>
    </fieldset>`;
  const blocDatePrix = `
    <div class="deux-col">
      <div><label for="s-date">Date et heure</label><input id="s-date" type="datetime-local" required></div>
      <div><label for="s-prix">Participation demandée ($)</label><input id="s-prix" type="number" min="0" step="5" value="0"></div>
    </div>`;

  fSoiree.querySelector("#s-theme").addEventListener("change", (ev) => {
    const slug = ev.target.value;
    if (!slug) { suite.innerHTML = ""; return; }
    if (slug === "libre") {
      suite.innerHTML = `
        <p class="avis">Une soirée entièrement à votre façon : titre, description et visuel sont libres.</p>
        <label for="s-base">Alcool principal servi (fixe le coût de la soirée)</label>
        <select id="s-base" required>${themes.map((t) => `<option value="${t.slug}">${esc(t.nom)} (${dollars(t.cout_alcool)})</option>`).join("")}</select>
        <label for="s-titre">Titre de la soirée</label>
        <input id="s-titre" type="text" maxlength="100" required placeholder="Ex. : Bal masqué d'Halloween">
        <label for="s-desc">Description</label>
        <textarea id="s-desc" maxlength="800" rows="4" required></textarea>
        ${blocVisuel(themes.flatMap((t) => t.images))}
        ${blocDatePrix}
        <div class="actions"><button class="bouton" type="submit">Publier la soirée</button><span class="statut" aria-live="polite"></span></div>`;
    } else {
      const t = themeParSlug[slug];
      suite.innerHTML = `
        <p class="avis">Coût en alcool de cette soirée : <strong>${dollars(t.cout_alcool)}</strong>, prélevé au relevé du mardi.</p>
        <fieldset class="champ-groupe">
          <legend>Annonce</legend>
          ${t.annonces.map((a, i) => `
            <label class="choix-annonce"><input type="radio" name="s-annonce" value="${i}" ${i === 0 ? "checked" : ""}>
              <span><strong>${esc(a.titre)}</strong><br>${esc(a.description)}</span></label>`).join("")}
          <label class="choix-annonce"><input type="radio" name="s-annonce" value="perso"><span><strong>J'écris ma propre annonce</strong></span></label>
          <div id="s-perso" hidden>
            <label for="s-titre">Titre</label><input id="s-titre" type="text" maxlength="100">
            <label for="s-desc">Description</label><textarea id="s-desc" maxlength="800" rows="4"></textarea>
          </div>
        </fieldset>
        ${blocVisuel(t.images)}
        ${blocDatePrix}
        <div class="actions"><button class="bouton" type="submit">Publier la soirée</button><span class="statut" aria-live="polite"></span></div>`;
    }
  });

  fSoiree.addEventListener("change", (ev) => {
    if (ev.target.name === "s-annonce") {
      const perso = ev.target.value === "perso";
      const bloc = suite.querySelector("#s-perso");
      bloc.hidden = !perso;
      bloc.querySelectorAll("input,textarea").forEach((el) => { el.required = perso; });
    }
    if (ev.target.name === "s-visuel") {
      const f = suite.querySelector("#s-image");
      f.hidden = ev.target.value !== "perso";
      f.required = ev.target.value === "perso";
    }
  });

  fSoiree.addEventListener("submit", async (ev) => {
    ev.preventDefault(); const f = fSoiree; occupe(f, "Publication…");
    try {
      const slug = f.querySelector("#s-theme").value;
      const libre = slug === "libre";
      const t = themeParSlug[libre ? f.querySelector("#s-base").value : slug];
      let titre, description, texteLibre = libre;
      const choixAnnonce = f.querySelector("input[name=s-annonce]:checked");
      if (libre || choixAnnonce?.value === "perso") {
        titre = f.querySelector("#s-titre").value.trim();
        description = f.querySelector("#s-desc").value.trim();
        texteLibre = true;
      } else {
        ({ titre, description } = t.annonces[Number(choixAnnonce.value)]);
      }
      const visuel = f.querySelector("input[name=s-visuel]:checked")?.value || "";
      const image = visuel === "perso" ? await envoyerImage(f.querySelector("#s-image").files[0]) : (visuel || null);
      const { error } = await sb.from("evenements").insert({
        titre, description, image,
        theme: libre ? null : t.slug,
        cout_alcool: t.cout_alcool,
        texte_libre: texteLibre || visuel === "perso",
        date_evt: new Date(f.querySelector("#s-date").value).toISOString(),
        prix_participation: Number(f.querySelector("#s-prix").value) || 0,
      });
      if (error) throw error;
      recharger();
    } catch (e) { echec(f, e); }
  });

  boite.querySelector("#f-produit").addEventListener("submit", async (ev) => {
    ev.preventDefault(); const f = ev.target; occupe(f, "…");
    const { error } = await sb.from("vitrine_produits").insert({ produit_id: f["p-choix"].value, note: f["p-note"].value.trim() || null, ordre: mises.length });
    if (error) return echec(f, error);
    recharger();
  });

  boite.querySelector("#f-photo").addEventListener("submit", async (ev) => {
    ev.preventDefault(); const f = ev.target;
    const fichiers = [...f["ph-fichiers"].files];
    try {
      for (const [i, fi] of fichiers.entries()) {
        occupe(f, `Envoi ${i + 1} sur ${fichiers.length}…`);
        const chemin = await envoyerImage(fi);
        const { error } = await sb.from("vitrine_photos").insert({ chemin, legende: f["ph-legende"].value.trim() || null, ordre: photos.length + i });
        if (error) throw error;
      }
      recharger();
    } catch (e) { echec(f, e); }
  });

  boite.onclick = async (ev) => {
    const b = ev.target.closest("[data-retirer-evt],[data-retirer-produit],[data-retirer-photo]");
    if (!b || !confirm("Retirer cet élément de la vitrine ?")) return;
    let r;
    if (b.dataset.retirerEvt) r = await sb.from("evenements").delete().eq("id", b.dataset.retirerEvt);
    else if (b.dataset.retirerProduit) r = await sb.from("vitrine_produits").delete().eq("produit_id", b.dataset.retirerProduit);
    else r = await sb.from("vitrine_photos").delete().eq("id", b.dataset.retirerPhoto);
    if (r.error) return alert(messageErreur(r.error));
    recharger();
  };
}

/* ---------- Fiches du personnel (MJ) ---------- */
const POSTES = { hote: "Hôtes et hôtesses d'accueil", serveur: "Serveurs et serveuses", barman: "Barmen et sommeliers", portier: "Portiers" };
const NIVEAUX = { 1: "Débutant", 2: "Confirmé", 3: "D'exception" };

async function vuePersonnelMJ(cible) {
  cible.innerHTML = `<p class="chargement">Ouverture des dossiers…</p>`;
  const [{ data: pers, error: e1 }, { data: mj, error: e2 }] = await Promise.all([
    sb.from("personnel").select("*").order("ordre"),
    sb.from("personnel_mj").select("*"),
  ]);
  if (e1 || e2) { cible.innerHTML = `<p class="erreur">${esc(messageErreur(e1 || e2))}</p>`; return; }
  const parSlug = Object.fromEntries(mj.map((m) => [m.slug, m]));
  cible.innerHTML = `
    <section class="feuille">
      <h1>Personnel</h1>
      <p class="badge-mj">Visible uniquement par le MJ. Les fiches d'exception n'apparaîtront aux candidatures de Vito qu'à partir de 60 de standing.</p>
      <p class="clause-discrete">Pour chaque portrait : copie la description dans ton générateur d'images, puis envoie-moi l'image en précisant le nom du fichier indiqué.</p>
      ${Object.entries(POSTES).map(([poste, titre]) => `
        <h2 class="poste-titre">${titre}</h2>
        ${pers.filter((p) => p.poste === poste).map((p) => ficheMJ(p, parSlug[p.slug] || {})).join("")}
      `).join("")}
    </section>`;
}

function ficheMJ(p, m) {
  return `
    <article class="fiche-perso">
      <div class="portrait">
        <img src="img/personnel/${esc(p.slug)}.jpg" alt="Portrait de ${esc(p.nom)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'portrait-vide',textContent:'Portrait à venir'}))">
      </div>
      <div class="fiche-texte">
        <h3>${esc(p.nom)}, ${p.age} ans</h3>
        <div class="origine">${NIVEAUX[p.niveau]}, ${dollars(p.salaire_hebdo)} par semaine. Trait : ${esc(p.trait)}</div>
        <p>${esc(p.presentation)}</p>
        ${m.secret ? `<p class="secret"><strong>Secret :</strong> ${esc(m.secret)}</p>` : ""}
        <details class="prompt">
          <summary>Description pour le portrait (fichier ${esc(p.slug)}.jpg)</summary>
          <p class="prompt-texte">${esc(m.prompt || "")}</p>
          <button type="button" class="bouton-second copier" data-copier="${esc(m.prompt || "")}">Copier la description</button>
        </details>
      </div>
    </article>`;
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-copier]");
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copier); b.textContent = "Copié"; }
  catch { b.textContent = "Copie impossible, sélectionne le texte"; }
  setTimeout(() => { b.textContent = "Copier la description"; }, 1800);
});

/* ---------- Pupitre des incidents (MJ) ---------- */
const ISSUE_INCIDENT = { ouvert: "en attente", membre: "réglé par un membre", jet_reussi: "réglé seul (réussi)", jet_rate: "réglé seul (raté)", paye: "réglé en payant", ignore: "ignoré" };
async function pupitreIncidents(boite, recharger) {
  const [{ data: cat }, { data: inc }] = await Promise.all([
    sb.from("incidents_catalogue").select("slug, titre, atouts, accroche_mj").order("titre"),
    sb.from("incidents").select("*").order("id", { ascending: false }).limit(8),
  ]);
  const titre = Object.fromEntries((cat || []).map((x) => [x.slug, x.titre]));
  boite.innerHTML = `
    <p class="clause-discrete">À partir de la semaine 3, un incident survient environ une semaine sur trois. Le joueur a jusqu'au relevé suivant pour le régler : faire appel à un membre qui a le bon atout, tenter sa chance ou payer.</p>
    ${(inc || []).length ? `<ul class="journal">${inc.map((i) => `<li><time>S${i.semaine}</time>${esc(titre[i.slug] || i.slug)}, ${ISSUE_INCIDENT[i.statut]}${i.membre_slug ? ` (${esc(i.membre_slug)})` : ""}</li>`).join("")}</ul>` : `<p class="clause-discrete">Aucun incident pour l'instant.</p>`}
    ${(inc || []).some((i) => i.statut === "ouvert") ? "" : `
    <form id="f-incident" class="actions">
      <select id="i-slug">${(cat || []).map((x) => `<option value="${x.slug}">${esc(x.titre)} (${x.atouts.join(", ")})${x.accroche_mj ? " *" : ""}</option>`).join("")}</select>
      <button class="bouton-second" type="submit">Déclencher maintenant</button>
    </form>
    <p class="clause-discrete">* : incident qui te remonte une accroche de scénario s'il tourne mal.</p>`}`;
  boite.querySelector("#f-incident")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const { error } = await sb.rpc("mj_incident", { p_slug: ev.target["i-slug"].value });
    if (error) { alert(messageErreur(error)); return; }
    recharger();
  });
}

/* ---------- Pupitre de Vance (MJ) ---------- */
const PATIENCE = { 3: "cordial", 2: "réservé", 1: "froid (ligne de crédit déjà réduite)", 0: "à bout : il passe en personne" };
const STATUT_DEMANDE = { en_attente: "en attente de réponse", acceptee: "acceptée", substituee: "acceptée avec un autre membre", refusee: "refusée", expiree: "ignorée (sans réponse)" };
async function pupitreVance(boite, c, recharger) {
  const [{ data: dem }, { data: ms }, { data: mj }] = await Promise.all([
    sb.from("demandes_vance").select("*").order("id", { ascending: false }).limit(10),
    sb.from("membres").select("slug, nom, statut").eq("statut", "membre"),
    sb.from("membres_mj").select("slug, fortune, reseau, nourricier"),
  ]);
  const j = Object.fromEntries((mj || []).map((x) => [x.slug, x]));
  const nom = Object.fromEntries((ms || []).map((x) => [x.slug, x.nom]));
  const tries = (ms || []).sort((a, b) => (j[b.slug].fortune + j[b.slug].reseau) - (j[a.slug].fortune + j[a.slug].reseau));
  const attente = (dem || []).some((d) => d.statut === "en_attente");
  boite.innerHTML = `
    <p class="clause-discrete">Humeur de Vance : <strong>${PATIENCE[c.patience_vance]}</strong> (${c.patience_vance}/3). Un refus ou une lettre ignorée lui coûte un cran, une demande honorée lui en rend un. À 1, Calloway réduit la ligne de crédit de 5 000 $. À 0, il « passe en personne ». La toute première lettre révèle la courtoisie de l'article 4.</p>
    ${(dem || []).length ? `<ul class="journal">${dem.map((d) => `<li><time>S${d.semaine}</time>${d.type === "presentation" ? `Présentation de ${esc(nom[d.membre_slug] || d.membre_slug)}` : `Courtoisie : ${esc(d.message || "")}`}, ${STATUT_DEMANDE[d.statut]}${d.remis_slug && d.remis_slug !== d.membre_slug ? ` (remplacé par ${esc(d.remis_slug)})` : ""}</li>`).join("")}</ul>` : `<p class="clause-discrete">Aucune lettre envoyée pour l'instant.</p>`}
    ${attente ? `<p class="clause-discrete">Une lettre attend la réponse du joueur.</p>` : `
    <form id="f-vance" class="sous-form">
      <label for="v-type">Nouvelle lettre</label>
      <select id="v-type">
        <option value="presentation">Demander à être présenté à un membre</option>
        <option value="courtoisie">Demander un autre service (à mettre en scène en jeu)</option>
      </select>
      <div id="v-bloc-membre">
        <label for="v-membre">Membre convoité (classés du plus intéressant pour Vance au moins intéressant)</label>
        <select id="v-membre">${tries.map((m) => `<option value="${m.slug}">${esc(m.nom)} (fortune ${j[m.slug].fortune}, réseau ${j[m.slug].reseau})</option>`).join("") || `<option value="">Aucun membre au cercle</option>`}</select>
      </div>
      <label for="v-message">Texte de la lettre (facultatif : sinon une formule toute prête est utilisée)</label>
      <textarea id="v-message" rows="3" placeholder="Ex. : Un de mes associés aura besoin de votre salon privé jeudi soir. Personne ne doit savoir qu'il y était."></textarea>
      <div class="actions"><button class="bouton" type="submit">Envoyer la lettre</button></div>
    </form>`}`;
  const f = boite.querySelector("#f-vance");
  if (!f) return;
  const maj = () => { boite.querySelector("#v-bloc-membre").hidden = f["v-type"].value !== "presentation"; };
  f["v-type"].addEventListener("change", maj); maj();
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (f["v-type"].value === "courtoisie" && !f["v-message"].value.trim()) { alert("Écris le service que Vance demande."); return; }
    const { error } = await sb.rpc("mj_demande_vance", { p_type: f["v-type"].value, p_membre: f["v-membre"].value || null, p_message: f["v-message"].value });
    if (error) { alert(messageErreur(error)); return; }
    recharger();
  });
}

/* ---------- Membres (MJ) ---------- */
const STATUT_MEMBRE = { vivier: "Dans le vivier", candidat: "Candidat cette semaine", membre: "Membre", refuse: "Refusé", parti: "Parti", vance: "Passé chez Vance" };
const FORTUNE = { 1: "modeste", 2: "aisé", 3: "fortuné" };
const STYLE_PORTRAIT = ". Warm low-key lighting, dark wood-paneled background, shallow depth of field, cinematic, muted warm colors, realistic, 35mm film look, no text, no watermark.";
async function vueMembresMJ(cible) {
  cible.innerHTML = `<p class="chargement">Ouverture des dossiers…</p>`;
  const [{ data: ms, error: e1 }, { data: mj, error: e2 }] = await Promise.all([
    sb.from("membres").select("*").order("ordre"), sb.from("membres_mj").select("*")]);
  if (e1 || e2) { cible.innerHTML = `<p class="erreur">${esc(messageErreur(e1 || e2))}</p>`; return; }
  const parSlug = Object.fromEntries(mj.map((m) => [m.slug, m]));
  const ordre = ["membre", "candidat", "vivier", "parti", "refuse", "vance"];
  ms.sort((a, b) => ordre.indexOf(a.statut) - ordre.indexOf(b.statut));
  cible.innerHTML = `
    <section class="feuille">
      <h1>Membres et vivier</h1>
      <p class="badge-mj">Visible uniquement par le MJ. Les profils marqués « chasse » viennent de tes lots de chasse.</p>
      ${ms.map((m) => { const j = parSlug[m.slug] || {}; const prompt = "Portrait photograph, head and shoulders, of " + (j.apparence || "") + STYLE_PORTRAIT; return `
        <article class="fiche-perso">
          <div class="portrait">${portrait("membres", m.slug, m.nom)}</div>
          <div class="fiche-texte">
            <h3>${esc(m.nom)}, ${m.age} ans</h3>
            <div class="origine">${STATUT_MEMBRE[m.statut]}${m.statut === "membre" ? `, satisfaction ${m.satisfaction}/100` : ""}. ${esc(m.metier)}</div>
            <p class="clause-discrete">Fortune ${FORTUNE[j.fortune]}, assiduité ${Math.round(j.assiduite * 100)} %, nourricier ${j.nourricier}/3, réseau ${j.reseau}/3, standing requis ${j.standing_min}. Goûts : ${(j.gouts || []).join(", ")}.${j.atout_libelle ? ` Atout : ${esc(j.atout_libelle)}.` : ""}</p>
            ${j.secret ? `<p class="secret"><strong>Secret :</strong> ${esc(j.secret)}</p>` : ""}
            <details class="prompt">
              <summary>Description pour le portrait (fichier ${esc(m.slug)}.jpg)</summary>
              <p class="prompt-texte">${esc(prompt)}</p>
              <button type="button" class="bouton-second copier" data-copier="${esc(prompt)}">Copier la description</button>
            </details>
          </div>
        </article>`; }).join("")}
    </section>`;
}

/* ---------- Visuels des soirées (MJ) ---------- */
const STYLE_VISUEL = ". Luxury vintage bar photography, rich dark mahogany wood, warm amber candlelight and brass reflections, shallow depth of field, cinematic, realistic, no people, no readable text on labels, no logo, no watermark.";
async function vueVisuelsMJ(cible) {
  const { data: themes, error } = await sb.from("themes_soiree").select("*").order("ordre");
  if (error) { cible.innerHTML = `<p class="erreur">${esc(messageErreur(error))}</p>`; return; }
  cible.innerHTML = `
    <section class="feuille">
      <h1>Visuels des soirées</h1>
      <p class="badge-mj">Visible uniquement par le MJ.</p>
      <p class="clause-discrete">Trois visuels par thème. Copie la description dans ton générateur, puis envoie-moi les images avec le nom de fichier indiqué. Format carré ou paysage.</p>
      ${themes.map((t) => `
        <h2 class="poste-titre">${esc(t.nom)}</h2>
        ${t.prompts.map((p, i) => `
          <article class="fiche-perso">
            <div class="portrait"><img src="${esc(t.images[i])}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'portrait-vide',textContent:'Visuel à venir'}))"></div>
            <div class="fiche-texte">
              <h3>Fichier ${esc(t.slug)}-${i + 1}.jpg</h3>
              <p class="prompt-texte">${esc(p + STYLE_VISUEL)}</p>
              <button type="button" class="bouton-second copier" data-copier="${esc(p + STYLE_VISUEL)}">Copier la description</button>
            </div>
          </article>`).join("")}`).join("")}
    </section>`;
}

/* ---------- Galerie photo des annonces ---------- */
const visionneuse = document.getElementById("visionneuse");
document.addEventListener("click", (ev) => {
  const vignette = ev.target.closest(".galerie-vignette");
  if (vignette) {
    ev.preventDefault();
    const galerie = vignette.closest(".galerie");
    galerie.querySelector(".galerie-principale img").src = vignette.dataset.photo;
    galerie.querySelectorAll(".galerie-vignette").forEach((v) => v.setAttribute("aria-pressed", String(v === vignette)));
    return;
  }
  const principale = ev.target.closest("[data-agrandir]");
  if (principale) {
    ev.preventDefault();
    const img = principale.querySelector("img");
    visionneuse.querySelector("img").src = img.src;
    visionneuse.querySelector("img").alt = img.alt;
    visionneuse.showModal();
    return;
  }
  if (ev.target === visionneuse || ev.target.closest("[data-fermer]")) visionneuse.close();
});

demarrer().catch(afficherPanne);
