import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
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

async function vueCompte(cible) {
  const c = etat.cercle;
  cible.innerHTML = `<p class="chargement">Ouverture du compte…</p>`;
  const [catalogue, journal, locaux] = await Promise.all([chargerCatalogue(), chargerJournal(), chargerLocaux()]);
  const local = locaux.find((l) => l.id === c.local_id);
  const disponible = Number(c.ligne_credit) - Number(c.credit_utilise);
  const journalPublic = journal.filter((j) => j.visible_gerante);
  cible.innerHTML = `
    <section class="feuille">
      <div class="en-tete-lettre">
        <span class="expediteur">${esc(c.nom)}</span>
        <span>Compte ouvert le ${dateLongue(c.fonde_le)}</span>
      </div>
      ${c.devise ? `<p><em>${esc(c.devise)}</em></p>` : ""}
      ${local ? `<p class="adresse-cercle">${esc(local.titre)}, ${esc(local.adresse)}</p>` : ""}
      <div class="solde">
        <div><span class="valeur">${dollars(disponible)}</span><span class="intitule">Crédit disponible chez la Maison</span></div>
        <div><span class="valeur">${dollars(c.tresorerie)}</span><span class="intitule">Trésorerie du cercle</span></div>
        ${local ? `<div><span class="valeur">${dollars(local.loyer_hebdo)}</span><span class="intitule">Loyer hebdomadaire</span></div>` : ""}
        <div><span class="valeur">0</span><span class="intitule">Bouteilles en cave</span></div>
      </div>
      <p class="avis">Votre première allocation sera proposée le ${prochainMardi19h().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} à 19 h. D'ici là, vous pouvez consulter les références de nos fournisseurs.</p>
      ${journalPublic.length ? `<h2>Correspondance</h2><ul class="journal">${journalPublic.map((j) => `<li><time>${dateCourte(j.cree_le)}</time>${esc(j.message)}</li>`).join("")}</ul>` : ""}
    </section>
    <section class="feuille" id="vitrine-admin"></section>
    <section class="feuille">
      <h2>Nos fournisseurs</h2>
      ${catalogue.map(blocFournisseur).join("")}
      <p class="clause-discrete">Prix d'achat à la bouteille, hors frais de transport. Les références rares ne sont proposées qu'aux comptes de confiance.</p>
    </section>`;
  adminVitrine(cible.querySelector("#vitrine-admin"), catalogue);
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
      <button class="onglet" role="tab" data-onglet="personnel" aria-selected="${etat.ongletMJ === "personnel"}">Personnel</button>
    </div>
    <div id="contenu-mj"></div>`;
  app.querySelectorAll(".onglet").forEach((b) => b.addEventListener("click", async () => {
    etat.ongletMJ = b.dataset.onglet;
    await chargerCercle();
    vueMJ();
  }));
  const cible = app.querySelector("#contenu-mj");
  if (etat.ongletMJ === "joueuse") return vueJoueuse(cible);
  if (etat.ongletMJ === "personnel") return vuePersonnelMJ(cible);

  const c = etat.cercle;
  const [journal, locaux] = await Promise.all([chargerJournal(), chargerLocaux()]);
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
      </dl>
      <h2>Journal complet</h2>
      ${journal.length ? `<ul class="journal">${journal.map((j) => `<li><time>${dateCourte(j.cree_le)}</time>${esc(j.message)}${j.visible_gerante ? "" : ` <span class="badge-mj">(MJ seulement)</span>`}</li>`).join("")}</ul>` : `<p class="clause-discrete">Rien pour l'instant : la joueuse n'a pas encore agi.</p>`}
      <div class="actions" style="margin-top:24px">
        <button class="bouton-second" id="actualiser">Actualiser</button>
        <button class="bouton-second" id="reinit">Remettre à zéro (tests)</button>
      </div>
      <p class="erreur" id="erreur"></p>
    </section>`;
  cible.querySelector("#actualiser").addEventListener("click", async () => { await chargerCercle(); vueMJ(); });
  cible.querySelector("#reinit").addEventListener("click", async () => {
    if (!confirm("Effacer la signature, le nom du cercle, le bail et toute la vitrine pour revenir à l'invitation ?")) return;
    const { data, error } = await sb.rpc("reinitialiser_cercle");
    if (!error) {
      const tout = "00000000-0000-0000-0000-000000000000";
      await Promise.all([
        sb.from("evenements").delete().neq("id", tout),
        sb.from("vitrine_produits").delete().neq("produit_id", tout),
        sb.from("vitrine_photos").delete().neq("id", tout),
      ]);
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
  const [{ data: evts }, { data: mises }, { data: photos }] = await Promise.all([
    sb.from("evenements").select("*").order("date_evt"),
    sb.from("vitrine_produits").select("*").order("ordre"),
    sb.from("vitrine_photos").select("*").order("ordre").order("cree_le"),
  ]);
  const produits = catalogue.flatMap((f) => f.produits.map((p) => ({ ...p, fournisseur: f.nom })));
  const parId = Object.fromEntries(produits.map((p) => [p.id, p]));
  const dejaMis = new Set(mises.map((m) => m.produit_id));

  boite.innerHTML = `
    <div class="en-tete-lettre">
      <span class="expediteur">La vitrine du cercle</span>
      <a href="/cercle" target="_blank" rel="noopener">Voir la vitrine publique</a>
    </div>
    <p class="clause-discrete">Ce que vous publiez ici est visible par toute personne qui connaît l'adresse de votre vitrine.</p>

    <details class="volet" open>
      <summary>Présentation</summary>
      <form id="f-textes">
        <label for="accroche">Phrase d'accueil</label>
        <input id="accroche" type="text" maxlength="160" value="${esc(c.accroche)}" placeholder="Une phrase qui donne le ton">
        <label for="presentation">L'esprit du cercle</label>
        <textarea id="presentation" maxlength="2000" rows="6" placeholder="Qui vous recevez, ce qu'on y boit, ce qu'on y trouve. Laissez une ligne vide pour changer de paragraphe.">${esc(c.presentation)}</textarea>
        <div class="actions"><button class="bouton" type="submit">Enregistrer la présentation</button><span class="statut" aria-live="polite"></span></div>
      </form>
    </details>

    <details class="volet" ${evts.length ? "" : "open"}>
      <summary>Soirées (${evts.length})</summary>
      <ul class="liste-admin">${evts.map((e) => `
        <li>
          ${e.image ? `<img src="${esc(urlImage(e.image))}" alt="">` : `<span class="vignette-vide"></span>`}
          <div><strong>${esc(e.titre)}</strong><br><span class="clause-discrete">${dateCourte(e.date_evt)}, ${Number(e.prix_participation) > 0 ? dollars(e.prix_participation) : "gratuit pour les membres"}</span></div>
          <button type="button" class="lien-discret" data-retirer-evt="${e.id}">Retirer</button>
        </li>`).join("") || `<li class="clause-discrete">Aucune soirée annoncée.</li>`}</ul>
      <form id="f-soiree" class="sous-form">
        <h3>Annoncer une soirée</h3>
        <label for="s-titre">Titre</label>
        <input id="s-titre" type="text" maxlength="100" required placeholder="Ex. : Les cognacs de l'après-guerre">
        <div class="deux-col">
          <div><label for="s-date">Date et heure</label><input id="s-date" type="datetime-local" required></div>
          <div><label for="s-prix">Participation ($)</label><input id="s-prix" type="number" min="0" step="5" value="0"></div>
        </div>
        <label for="s-desc">Description</label>
        <textarea id="s-desc" maxlength="800" rows="3" placeholder="Ce qui sera servi, l'ambiance, la tenue attendue…"></textarea>
        <label for="s-image">Affiche ou visuel (facultatif)</label>
        <input id="s-image" type="file" accept="image/*">
        <div class="actions"><button class="bouton" type="submit">Publier la soirée</button><span class="statut" aria-live="polite"></span></div>
      </form>
    </details>

    <details class="volet">
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

    <details class="volet">
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

  boite.querySelector("#f-soiree").addEventListener("submit", async (ev) => {
    ev.preventDefault(); const f = ev.target; occupe(f, "Publication…");
    try {
      const image = f["s-image"].files[0] ? await envoyerImage(f["s-image"].files[0]) : null;
      const { error } = await sb.from("evenements").insert({
        titre: f["s-titre"].value.trim(), date_evt: new Date(f["s-date"].value).toISOString(),
        prix_participation: Number(f["s-prix"].value) || 0, description: f["s-desc"].value.trim() || null, image,
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
