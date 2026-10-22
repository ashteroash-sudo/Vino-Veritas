// Fond sonore discret : bouton marche/arrêt, préférence retenue par navigateur.
// Les navigateurs interdisent le son avant toute interaction : si la musique était allumée,
// elle reprend au premier clic sur la page.
export function installerMusique(fichier, conteneur, { flottant = false } = {}) {
  const audio = new Audio(fichier);
  audio.loop = true;
  audio.volume = 0.3;
  audio.preload = "none";
  const cle = "vv-musique";
  let pref = null;
  try { pref = localStorage.getItem(cle); } catch {}

  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = flottant ? "musique musique-flottante" : "musique";
  const maj = () => {
    const joue = !audio.paused;
    bouton.textContent = joue ? "♪ Musique : on" : "♪ Musique : off";
    bouton.setAttribute("aria-pressed", String(joue));
    bouton.title = joue ? "Couper la musique" : "Lancer la musique d'ambiance";
  };
  const jouer = () => audio.play().then(maj).catch(maj);
  bouton.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (audio.paused) { jouer(); try { localStorage.setItem(cle, "on"); } catch {} }
    else { audio.pause(); maj(); try { localStorage.setItem(cle, "off"); } catch {} }
  });
  maj();
  conteneur.appendChild(bouton);

  if (pref === "on") {
    const reprise = () => { jouer(); document.removeEventListener("pointerdown", reprise, true); document.removeEventListener("keydown", reprise, true); };
    document.addEventListener("pointerdown", reprise, true);
    document.addEventListener("keydown", reprise, true);
  }
}
