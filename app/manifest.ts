import type { MetadataRoute } from "next";

/** Permet d'installer MatchScores sur l'écran d'accueil du téléphone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MatchScores — Conseils Bet261",
    short_name: "MatchScores",
    description: "Les paris les moins risqués sur Bet261 : sports et virtuels.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#060912",
    theme_color: "#060912",
    lang: "fr",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
