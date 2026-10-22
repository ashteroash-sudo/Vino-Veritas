# 8 thèmes de soirée : annonces pré-rédigées + descriptions d'images (3 par thème).
import json
STYLE = ("Moody editorial photograph for an exclusive private tasting club, warm candlelight, "
         "dark wood and leather, shallow depth of field, cinematic, muted warm tones, realistic, "
         "no people's faces in focus, no text, no logo, no watermark.")
T = [
("cognac", "Cognacs et armagnacs", 300, [
  ("Les cognacs de l'après-guerre", "Trois cognacs charentais, du VSOP soyeux au XO patiné par les décennies. Une soirée lente, au coin du feu, pour ceux qui aiment ce qui a pris son temps."),
  ("Charente et Gascogne", "Cognac contre armagnac : deux voisins, deux caractères. Nos membres départageront à l'aveugle, verre après verre."),
  ("Une soirée rancio", "Noix, cuir, pruneau, vieux bois : le rancio est le parfum des grandes eaux-de-vie. Nous servirons celles qui en ont le plus."),
  ("Millésimes de naissance", "Chaque membre est invité à retrouver dans notre sélection un armagnac de son année. Une soirée pour se souvenir, et pour comparer."),
 ], ["a snifter of amber cognac beside a crackling fireplace, antique crystal decanter, leather armchair",
     "row of old cognac and armagnac bottles with faded labels on a dark oak table, candles, vintage tasting glasses",
     "close-up of a hand-blown glass of aged armagnac catching firelight, walnut shells and a cigar box nearby"]),
("ecosse", "Whiskies d'Écosse", 280, [
  ("Les Highlands au coin du feu", "Une traversée de l'Écosse en quatre single malts, des douceurs du Speyside aux tourbes de l'ouest. Tweed bienvenu."),
  ("Fûts de xérès", "Fruits secs, chocolat noir, figue : nos single malts élevés en fûts de xérès, pour les palais qui aiment la richesse."),
  ("Tourbe et brume", "Pour les amateurs de fumée et de iode. Une soirée qui sent le feu de camp et la mer du Nord."),
  ("Single malt et vieux livres", "Quatre whiskies, quatre histoires de distilleries perdues dans la lande. On lit, on goûte, on écoute."),
 ], ["glass of single malt scotch on an old leather-bound book, tartan blanket, rainy window in the background",
     "copper pot still detail glowing in dim light, whisky casks stacked in a dark warehouse",
     "four tulip tasting glasses of whisky of increasing color on a slate board, peat smoke, candlelight"]),
("bourbon", "Bourbon, rye et cigares", 180, [
  ("Bourbon et cigares", "Bourbons du Kentucky et cigares roulés à la main, dans la plus pure tradition des salons américains. Fumoir ouvert jusqu'à l'aube."),
  ("Nuit de la Prohibition", "En hommage aux années 1920, une soirée de bourbons et de rye servis comme on les servait alors : sans faire de bruit."),
  ("Le grand rye", "Poivré, sec, nerveux : le rye whiskey, l'autre fierté de l'Amérique. Pour ceux qui trouvent le bourbon trop sage."),
  ("Single barrel", "Des bourbons mis en bouteille fût par fût, à leur degré naturel. Chaque verre est unique, et ne se reverra pas."),
 ], ["glass of bourbon on the rocks next to a smoking cigar in a heavy crystal ashtray, dark leather, low light",
     "1920s speakeasy bar counter with bourbon bottles, brass fittings, warm lamp light, jazz era atmosphere",
     "oak barrel head with charred wood and a bottle of bourbon, amber light through the glass"]),
("rhum", "Rhums des îles", 160, [
  ("Escale aux Antilles", "Rhums agricoles de Martinique, vieux rhums ambrés, et le parfum de la canne fraîche. Un été en plein hiver."),
  ("Rhums vieux et épices", "Cacao, tabac blond, vanille : nos vieux rhums dévoilent leur côté le plus sombre. À déguster lentement."),
  ("Planteur et ti-punch", "Une soirée plus légère autour des grands classiques des îles, préparés devant vous."),
  ("La route des épices", "De la canne au fût : quatre rhums pour suivre le chemin des navires marchands d'autrefois."),
 ], ["glass of dark aged rum with a cinnamon stick and orange peel on a weathered wooden table, candlelight",
     "old rum bottles and a nautical brass compass, map of the Caribbean, dim lantern light",
     "ti-punch with lime and cane sugar in a heavy glass, tropical leaves in shadow, moody evening light"]),
("japon", "Whiskies japonais", 450, [
  ("Le rituel japonais", "Glace taillée à la main, verres fins, silence : les whiskies japonais demandent une attention particulière. Nous la leur accordons."),
  ("Chêne mizunara", "Encens, santal, bois précieux : le rare chêne japonais donne à ces whiskies une âme à part. Places très limitées."),
  ("Highball et sérénité", "Une soirée plus douce autour du highball, la manière japonaise de boire le whisky au quotidien."),
  ("Collection Hakuro", "Une dégustation exceptionnelle de la maison Hakuro, en quantités allouées. Pour les membres les plus curieux."),
 ], ["hand-carved ice sphere in a crystal glass of Japanese whisky, black lacquer tray, minimalist dark setting",
     "Japanese whisky highball with long ice spear, bamboo, soft lantern light, elegant and calm",
     "bottle of Japanese whisky beside a bonsai and incense smoke, dark wood, moody light"]),
("gin", "Gin et cocktails classiques", 150, [
  ("Le temps des cocktails", "Martini, Negroni, Gimlet : les grands classiques, préparés dans les règles. Une soirée plus vive que d'habitude."),
  ("Le gin et le jardin", "Genièvre, agrumes, herbes fraîches : une soirée botanique autour des gins les plus aromatiques."),
  ("L'heure du Martini", "Sec, très sec, ou à la façon de chacun : le Martini en cinq variations, et leurs histoires."),
  ("Années folles", "Cocktails d'époque et musique de jazz pour une soirée qui ressemble aux années 1920, en plus discret."),
 ], ["classic dry martini with an olive in a coupe glass on a polished bar, low warm light, art deco details",
     "negroni with orange peel on a marble counter, bitters bottles, candlelight",
     "bartender's tools, shaker and jigger, with botanicals juniper and citrus on dark wood"]),
("decouverte", "Soirée découverte (mixte)", 220, [
  ("Tour du monde en cinq verres", "Écosse, Kentucky, Charente, Antilles, Japon : un voyage complet pour les membres qui aiment comparer."),
  ("Dégustation à l'aveugle", "Les étiquettes restent cachées jusqu'au dernier verre. Saurez-vous reconnaître ce que vous buvez ?"),
  ("Les préférés de la maison", "Chaque bouteille servie ce soir a été choisie parce qu'elle a convaincu nos membres. Une soirée de valeurs sûres."),
  ("Soirée des nouveaux venus", "Une dégustation accessible, pensée pour accueillir nos nouveaux membres et leurs parrains."),
 ], ["five tasting glasses of different spirits from pale to dark arranged in a row, notebook and pen, candlelight",
     "blind tasting with bottles wrapped in dark cloth, numbered glasses, leather table",
     "cozy private club lounge with leather sofas, fireplace and a tray of assorted spirits, inviting"]),
("prestige", "Soirée prestige (bouteilles rares)", 900, [
  ("Une soirée d'exception", "Nous ouvrirons ce soir des bouteilles que peu de gens auront l'occasion de goûter. Le nombre de places est volontairement réduit."),
  ("Les fûts murés", "Une dégustation autour d'une pièce unique, retrouvée dans des caves murées depuis la Prohibition. Il n'en reste presque plus."),
  ("Le cercle des collectionneurs", "Une soirée réservée aux membres qui ont le goût des pièces rares, des millésimes et des éditions numérotées."),
  ("Trente ans d'âge", "Rien en dessous de trente ans ce soir. Une soirée pour ceux qui savent ce que vaut le temps."),
 ], ["single rare whisky bottle on a velvet pedestal under a spotlight, dark luxurious room, gold reflections",
     "dusty antique bottle being opened by gloved hands, wax seal, candlelight",
     "crystal decanter and two glasses on a silver tray in a wood-paneled library, exclusive atmosphere"]),
]
def q(s): return "'" + s.replace("'", "''") + "'"
rows = []
for i,(slug,nom,cout,ann,imgs) in enumerate(T):
    a = json.dumps([{"titre":t,"description":d} for t,d in ann], ensure_ascii=False)
    p = "array[" + ",".join(q(x) for x in imgs) + "]"
    im = "array[" + ",".join(q(f"img/soirees/{slug}-{n}.jpg") for n in (1,2,3)) + "]"
    rows.append(f"({q(slug)},{q(nom)},{cout},{q(a)}::jsonb,{p},{im},{i})")
print("insert into public.themes_soiree (slug,nom,cout_alcool,annonces,prompts,images,ordre) values\n" + ",\n".join(rows) + ";")
