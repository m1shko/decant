<div align="center">

<img src="build/icon.png" width="128" height="128" alt="Siphon" />

# Siphon

**Colle un lien, choisis audio ou vidéo, c'est téléchargé.**
YouTube, Instagram, TikTok et des centaines d'autres sites — sur Mac et Windows, sans pub, sans compte, sans limite.

[![Build](https://github.com/m1shko/siphon/actions/workflows/build.yml/badge.svg)](https://github.com/m1shko/siphon/actions/workflows/build.yml)
[![Dernière version](https://img.shields.io/github/v/release/m1shko/siphon?label=version&color=6d4aff)](https://github.com/m1shko/siphon/releases/latest)
![Plateformes](https://img.shields.io/badge/macOS%20%7C%20Windows-lightgrey)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

[**Télécharger**](#-installation) · [Fonctionnalités](#-fonctionnalités) · [FAQ](#-questions-fréquentes) · [Développer](#-développement)

<br />

<img src="docs/screenshots/audio-dark.png" width="760" alt="Siphon : un lien YouTube analysé, prêt à être téléchargé en MP3 320 kbps" />

</div>

## ✨ Fonctionnalités

|                       |                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| 🎵 **Audio**           | MP3 (320 / 192 / 128 kbps), M4A (son d'origine, sans perte de qualité), WAV, FLAC                               |
| 🎬 **Vidéo**           | MP4 de 360p à 4K, en H.264 dès que possible pour être lisible partout (QuickTime, Windows, téléphone)           |
| ✂️ **Extrait**         | Ne récupère qu'un passage : « de 12:30 à 16:05 »                                                                 |
| 📃 **Playlists**       | Coche les éléments que tu veux, ils partent dans la file d'attente                                               |
| ⏬ **File d'attente**  | Plusieurs téléchargements à la suite, deux en parallèle, avec vitesse et temps restant                          |
| 🖼️ **Pochette & tags** | Titre, artiste et miniature intégrés au fichier : ta bibliothèque musicale reste propre                         |
| 📋 **Collage auto**    | Copie un lien dans ton navigateur, reviens sur Siphon : il est déjà analysé. Le glisser-déposer marche aussi    |
| 🔎 **Recherche**       | Pas de lien ? Tape quelques mots, Siphon cherche sur YouTube                                                     |
| 🕘 **Historique**      | Retrouve, rouvre ou retélécharge ce que tu as déjà récupéré                                                      |
| 🍪 **Cookies**         | Utilise la session de ton navigateur pour Instagram, les vidéos privées ou avec limite d'âge                    |
| 🔄 **Toujours à jour** | Le moteur se met à jour tout seul chaque jour, parce que les sites changent souvent                              |

<div align="center">
<img src="docs/screenshots/video-dark.png" width="400" alt="Choix de la qualité vidéo et d'un extrait" />
<img src="docs/screenshots/playlist-dark.png" width="400" alt="Sélection des éléments d'une playlist" />
</div>

## 📦 Installation

Va dans les [**Releases**](https://github.com/m1shko/siphon/releases/latest) et prends le fichier pour ton ordinateur :

| Système                            | Fichier                         |
| ---------------------------------- | ------------------------------- |
| macOS (Apple Silicon : M1, M2, M3…) | `Siphon-x.y.z-arm64.dmg`        |
| Windows 10 / 11 (installeur)        | `Siphon Setup x.y.z.exe`        |
| Windows (sans installation)         | `Siphon x.y.z.exe` (portable)   |

Rien d'autre à installer : tout ce qu'il faut est inclus dans l'app.

> [!NOTE]
> Siphon n'est pas signé auprès d'Apple ni de Microsoft (ça coûte cher pour un projet gratuit), donc ton système va râler au premier lancement :
>
> - **macOS** : fais un clic droit sur Siphon → **Ouvrir** → **Ouvrir**. Si macOS dit que l'app est « endommagée », lance une fois dans le Terminal :
>   ```bash
>   xattr -cr /Applications/Siphon.app
>   ```
> - **Windows** : sur l'écran bleu SmartScreen, clique sur **Informations complémentaires** → **Exécuter quand même**.

## 🚀 Utilisation

1. **Copie un lien** (vidéo YouTube, Reel Instagram, TikTok, playlist…) et colle-le dans Siphon. Si Siphon était ouvert, le lien apparaît tout seul.
2. **Choisis** *Audio* ou *Vidéo*, puis le format et la qualité. Coche *Extrait seulement* pour ne garder qu'un passage.
3. **Clique sur Télécharger.** Le fichier arrive dans ton dossier *Téléchargements* (tu peux le changer avec le bouton **Changer**, juste sous l'aperçu).

## ❓ Questions fréquentes

<details>
<summary><b>Quels sites sont compatibles ?</b></summary>

YouTube (vidéos, Shorts, playlists), Instagram (Reels, posts), TikTok, X/Twitter, Facebook, Vimeo, Dailymotion, Twitch, SoundCloud… et [plus d'un millier d'autres](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), puisque Siphon s'appuie sur yt-dlp.
</details>

<details>
<summary><b>Instagram (ou YouTube) me dit de me connecter</b></summary>

Certains contenus ne sont visibles que connecté. En bas de la fenêtre, choisis dans **Cookies** le navigateur où tu es connecté (Chrome, Firefox, Safari, Edge…). Siphon lit alors ta session, comme si tu regardais la vidéo dans ce navigateur. Rien n'est envoyé ailleurs.

Sur macOS, Chrome peut demander l'accès au trousseau (clique sur *Toujours autoriser*), et Safari demande l'**accès complet au disque** pour Siphon (Réglages Système → Confidentialité et sécurité).
</details>

<details>
<summary><b>Ma vidéo en 4K ne s'ouvre pas dans QuickTime</b></summary>

Au-delà de 1080p, YouTube ne propose que les formats VP9 ou AV1. Le fichier MP4 se lit très bien avec [VLC](https://www.videolan.org/) ou [IINA](https://iina.io/), et avec QuickTime sur les Mac récents. En 1080p et en dessous, Siphon choisit le H.264, lisible partout.
</details>

<details>
<summary><b>MP3, M4A, WAV ou FLAC ?</b></summary>

- **MP3 320 kbps** : le choix par défaut, lisible partout.
- **M4A** : le son tel que YouTube le diffuse, sans réencodage. Plus léger et aussi bon que le MP3.
- **FLAC / WAV** : formats sans perte, utiles pour le montage ou le DJing. Attention : ils ne rendent pas le son meilleur que la source.
</details>

<details>
<summary><b>Un téléchargement échoue alors qu'il marchait avant</b></summary>

Les sites changent régulièrement. Siphon met son moteur à jour tout seul une fois par jour, mais tu peux forcer la mise à jour avec **Mettre à jour le moteur**, en bas à droite. Si ça ne marche toujours pas, [ouvre une issue](https://github.com/m1shko/siphon/issues) avec le lien et le message d'erreur.
</details>

<details>
<summary><b>Et sur Mac Intel ou Linux ?</b></summary>

Pas encore de version prête à l'emploi, mais Siphon fonctionne depuis le code source (voir ci-dessous) : `npm run dist:mac` sur un Mac Intel produit une version Intel.
</details>

## 🛠️ Développement

Siphon est une app [Electron](https://www.electronjs.org/) qui pilote [yt-dlp](https://github.com/yt-dlp/yt-dlp) pour récupérer les médias et [FFmpeg](https://ffmpeg.org/) pour les convertir.

```bash
git clone https://github.com/m1shko/siphon.git
cd siphon
npm install   # récupère aussi yt-dlp, ffmpeg et ffprobe dans bin/
npm start     # lance l'app
npm test      # tests unitaires
```

Construire l'app :

```bash
npm run dist:mac   # → dist/Siphon-x.y.z-arm64.dmg  (sur un Mac)
npm run dist:win   # → dist/Siphon Setup x.y.z.exe  (sur Windows)
```

Chaque push sur `main` construit les deux versions avec GitHub Actions (onglet *Actions* → artefacts). Pousser un tag `vX.Y.Z` publie une release.

```
src/
├── main/        processus principal : file d'attente, appels à yt-dlp, réglages
├── preload.js   pont sécurisé entre l'interface et le processus principal
└── renderer/    interface (HTML, CSS, JS sans framework)
```

Les captures d'écran de ce README se régénèrent avec `node scripts/screenshots.mjs`.

## ⚖️ Utilisation responsable

Siphon sert à conserver des contenus que tu as le droit de télécharger : tes propres vidéos, des œuvres libres de droits ou sous licence Creative Commons, ou une copie privée quand la loi de ton pays l'autorise. Respecte le droit d'auteur et les conditions d'utilisation des sites. Siphon n'est affilié à aucun des sites cités.

## 🙏 Remerciements

Tout le travail difficile est fait par [yt-dlp](https://github.com/yt-dlp/yt-dlp) et [FFmpeg](https://ffmpeg.org/). Merci à leurs contributeurs.

<details>
<summary>🇬🇧 English</summary>

**Siphon** is a free desktop app (macOS & Windows) to download audio or video from YouTube, Instagram, TikTok and 1000+ other sites. Paste a link, pick MP3/M4A/WAV/FLAC or MP4 (360p to 4K), optionally keep only a clip, and download. It supports playlists, a download queue, embedded cover art and tags, browser cookies for login-only content, and keeps its yt-dlp engine up to date automatically. Grab it from the [Releases](https://github.com/m1shko/siphon/releases/latest). The interface is in French for now.
</details>

## Licence

[MIT](LICENSE) © m1shko
