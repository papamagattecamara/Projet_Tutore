# Projet_Tutore — TV Monde 📺

Lecteur local pour regarder des chaînes de télévision du monde entier
(plus de 10 000 flux, environ 200 pays), directement dans le navigateur.

Les chaînes viennent de la base publique [iptv-org](https://github.com/iptv-org/iptv),
qui ne recense que des flux diffusés **gratuitement et publiquement** par les chaînes elles-mêmes.

## Lancer l'appli

Il faut seulement **Python 3** (aucune installation de paquet) et une connexion Internet.

| Système        | Commande                                  |
|----------------|-------------------------------------------|
| Windows        | double-clic sur `lancer.bat`              |
| macOS / Linux  | `./lancer.sh` (ou `python3 server.py`)    |

Le navigateur s'ouvre tout seul sur <http://localhost:8000>.
Autre port : `python3 server.py 9000`. Sans ouvrir le navigateur : `--no-browser`.

> On peut aussi ouvrir `index.html` directement, mais beaucoup de chaînes ne
> marcheront pas : le petit serveur local sert de relais (proxy) pour les flux
> bloqués par le navigateur (CORS) ou qui exigent un en-tête `Referer`.

## Fonctionnalités

- Liste de toutes les chaînes avec logo, pays (drapeau) et catégorie
- Recherche instantanée (sans tenir compte des accents)
- Filtres par **pays** et par **catégorie** (infos, sport, musique, enfants…)
- **Favoris** ★ et reprise de la dernière chaîne regardée (mémorisés dans le navigateur)
- **Import de playlists M3U** (fichier ou URL) avec le bouton `＋ M3U`
- Repli automatique via le proxy local si une chaîne ne se charge pas ;
  les chaînes hors ligne sont barrées dans la liste
- Raccourcis clavier :

| Touche   | Action                         |
|----------|--------------------------------|
| `↓` `↑`  | chaîne suivante / précédente   |
| `F`      | plein écran                    |
| `M`      | couper / remettre le son       |
| `/`      | rechercher                     |

## Fichiers

- `index.html`, `style.css`, `app.js` — l'interface (lecture HLS via [hls.js](https://github.com/video-dev/hls.js))
- `server.py` — serveur local + proxy de flux (bibliothèque standard Python)
- `lancer.sh`, `lancer.bat` — lanceurs

## Bon à savoir

Les flux sont fournis par les chaînes et changent souvent : certaines peuvent être
hors ligne, ou réservées à leur pays d'origine (géo-blocage). Ce n'est pas un bug
de l'appli — passe simplement à la chaîne suivante avec `↓`.
