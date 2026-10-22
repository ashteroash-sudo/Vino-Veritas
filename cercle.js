import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

// Page publique : aucune session, lecture via la fonction vitrine() uniquement.
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const racine = document.getElementById("vitrine");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const paragraphes = (t) => esc(t).split(/\n\s*\n/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
export const urlImage = (chemin) =>
  !chemin ? "" : /^(img\/|https?:)/.test(chemin) ? chemin : `${SUPABASE_URL}/storage/v1/object/public/vitrine/${chemin}`;
const prix = (n) => Number(n) > 0 ? `${Number(n).toLocaleString("fr-FR")} $ la soirée` : "Réservé aux membres";

async function afficher() {
  const { data: v, error } = await sb.rpc("vitrine");
  if (error || !v) { racine.innerHTML = `<div class="ferme"><p>Le cercle ne reçoit pas ce soir.</p></div>`; return; }
  if (!v.ouvert) { racine.innerHTML = `<div class="ferme"><p>Il n'y a rien ici. Pas encore.</p></div>`; return; }

  document.title = `${v.nom} — cercle privé, Miller Beach`;
  const photosLocal = (v.local?.photos || []).map((c) => ({ chemin: c, legende: null }));
  const fond = urlImage(photosLocal[0]?.chemin);
  const salon = [...(v.photos || []), ...(v.amenagements || []), ...photosLocal.slice(1)];

  racine.innerHTML = `
    <header class="ouverture">
      ${fond ? `<div class="ouverture-fond" style="background-image:url('${esc(fond)}')"></div>` : ""}
      <div class="ouverture-contenu">
        <div class="lieu-mention">Cercle privé de dégustation, Miller Beach</div>
        <h1 class="nom-cercle">${esc(v.nom)}</h1>
        ${v.devise ? `<p class="devise">${esc(v.devise)}</p>` : ""}
      </div>
    </header>

    ${v.accroche || v.presentation ? `
    <section class="bloc esprit" aria-labelledby="t-esprit">
      <h2 id="t-esprit">L'esprit du cercle</h2>
      ${v.accroche ? `<p class="accroche">${esc(v.accroche)}</p>` : ""}
      ${v.presentation ? paragraphes(v.presentation) : ""}
    </section>` : ""}

    <section class="bloc" aria-labelledby="t-soirees">
      <h2 id="t-soirees">Prochaines soirées</h2>
      ${v.evenements.length ? `<ul class="soirees">${v.evenements.map(blocSoiree).join("")}</ul>`
        : `<p class="vide">Le calendrier des prochaines soirées sera communiqué aux membres.</p>`}
      ${v.passes.length ? `<p class="passees">Ces dernières semaines : ${v.passes.map((e) => `<span>${esc(e.titre)}</span>`).join("")}.</p>` : ""}
    </section>

    ${v.produits.length ? `
    <section class="bloc" aria-labelledby="t-carte">
      <h2 id="t-carte">À la carte du cercle</h2>
      <ul class="carte-liste">${v.produits.map(blocBouteille).join("")}</ul>
    </section>` : ""}

    ${salon.length ? `
    <section class="bloc" aria-labelledby="t-salon">
      <h2 id="t-salon">Le salon</h2>
      <div class="salon-grille">${salon.slice(0, 9).map((p) => `
        <button type="button" data-agrandir="${esc(urlImage(p.chemin))}" aria-label="Agrandir${p.legende ? " : " + esc(p.legende) : ""}">
          <figure style="margin:0"><img src="${esc(urlImage(p.chemin))}" alt="${esc(p.legende || "Le salon du cercle")}" decoding="async">
          ${p.legende ? `<figcaption>${esc(p.legende)}</figcaption>` : ""}</figure>
        </button>`).join("")}</div>
    </section>` : ""}

    <footer class="adhesion">
      <p class="grand">L'admission au cercle se fait sur cooptation uniquement.</p>
      ${v.local ? `<p class="adresse">${esc(v.local.titre)}, ${esc(v.local.adresse)}, Gary, Indiana</p>` : ""}
    </footer>`;
}

function blocSoiree(e) {
  const d = new Date(e.date_evt);
  const jour = d.toLocaleDateString("fr-FR", { day: "numeric" });
  const mois = d.toLocaleDateString("fr-FR", { month: "long" });
  const jourSemaine = d.toLocaleDateString("fr-FR", { weekday: "long" });
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", " h ");
  return `
    <li class="soiree">
      <div><div class="jour">${jour}</div><div class="mois">${mois}</div></div>
      <div>
        <h3>${esc(e.titre)}</h3>
        <div class="heure-prix">${jourSemaine.charAt(0).toUpperCase() + jourSemaine.slice(1)}, à partir de ${heure}. ${prix(e.prix_participation)}</div>
        ${e.description ? `<p>${esc(e.description)}</p>` : ""}
      </div>
      ${e.image ? `<button type="button" class="visuel" data-agrandir="${esc(urlImage(e.image))}" aria-label="Agrandir l'affiche"><img src="${esc(urlImage(e.image))}" alt="Affiche : ${esc(e.titre)}" loading="lazy"></button>` : ""}
    </li>`;
}

function blocBouteille(p) {
  return `
    <li class="bouteille">
      <h3>${esc(p.nom)}</h3>
      <div class="provenance">${esc(p.categorie)}${p.age ? `, ${esc(p.age)}` : ""}, ${esc(p.origine)}</div>
      ${p.note ? `<p class="note">${esc(p.note)}</p>` : `<p class="desc">${esc(p.description)}</p>`}
    </li>`;
}

const visionneuse = document.getElementById("visionneuse");
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-agrandir]");
  if (b) { visionneuse.querySelector("img").src = b.dataset.agrandir; visionneuse.showModal(); return; }
  if (ev.target === visionneuse || ev.target.closest("[data-fermer]")) visionneuse.close();
});

afficher();
