// Réveil quotidien du projet Supabase (vino-veritas).
// Vercel l'appelle une fois par jour (voir "crons" dans vercel.json) :
// Supabase voit de l'activité et ne met jamais le projet gratuit en pause.
const SUPABASE_URL = 'https://wbqwivpjdiqucmqbfrja.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UVzf4NAwvrS0diJP0rjnSQ_5l-rSn1C';

module.exports = async (req, res) => {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/ping', {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: '{}'
    });
    res.status(r.ok ? 200 : 502).json({ projet: 'vino-veritas', ok: r.ok, statut: r.status, heure: await r.text() });
  } catch (e) {
    res.status(500).json({ projet: 'vino-veritas', ok: false, erreur: String(e) });
  }
};
