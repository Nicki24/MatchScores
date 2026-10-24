/**
 * Ligne « Pays - Compétition » : bet261 l'affiche sous les équipes de chaque match (« Suède - D1 Suède »,
 * « Italie - Serie A »), d'autres sites en en-tête de liste. Elle a la forme « A - B » d'un match :
 * on la reconnaît à son premier terme, un pays ou une région, quand le second n'en est pas un
 * (« Suède - Norvège » est un match de sélections nationales).
 */
import { cleanName, teamKey } from "./util";

const REGIONS = new Set(
  [
    // Français
    "Afrique du Sud", "Albanie", "Algérie", "Allemagne", "Andorre", "Angleterre", "Angola", "Arabie Saoudite", "Argentine", "Arménie",
    "Australie", "Autriche", "Azerbaïdjan", "Bahreïn", "Bangladesh", "Belgique", "Bénin", "Biélorussie", "Bolivie", "Bosnie",
    "Bosnie-Herzégovine", "Botswana", "Brésil", "Bulgarie", "Burkina Faso", "Burundi", "Cambodge", "Cameroun", "Canada", "Cap-Vert",
    "Chili", "Chine", "Chypre", "Colombie", "Comores", "Congo", "RD Congo", "Corée du Sud", "Corée du Nord", "Costa Rica", "Côte d'Ivoire",
    "Croatie", "Cuba", "Danemark", "Écosse", "Égypte", "Émirats Arabes Unis", "Équateur", "Espagne", "Estonie", "Eswatini", "États-Unis",
    "Éthiopie", "Finlande", "France", "Gabon", "Gambie", "Géorgie", "Ghana", "Gibraltar", "Grèce", "Guatemala", "Guinée",
    "Guinée équatoriale", "Haïti", "Honduras", "Hong Kong", "Hongrie", "Îles Féroé", "Inde", "Indonésie", "Irak", "Iran", "Irlande",
    "Irlande du Nord", "Islande", "Israël", "Italie", "Jamaïque", "Japon", "Jordanie", "Kazakhstan", "Kenya", "Kirghizistan", "Kosovo",
    "Koweït", "Laos", "Lettonie", "Liban", "Liberia", "Libye", "Liechtenstein", "Lituanie", "Luxembourg", "Macédoine",
    "Macédoine du Nord", "Madagascar", "Malaisie", "Malawi", "Mali", "Malte", "Maroc", "Maurice", "Mauritanie", "Mexique", "Moldavie",
    "Monaco", "Mongolie", "Monténégro", "Mozambique", "Myanmar", "Namibie", "Népal", "Nicaragua", "Niger", "Nigeria", "Norvège",
    "Nouvelle-Zélande", "Oman", "Ouganda", "Ouzbékistan", "Pakistan", "Palestine", "Panama", "Paraguay", "Pays de Galles", "Pays-Bas",
    "Pérou", "Philippines", "Pologne", "Portugal", "Qatar", "République tchèque", "Tchéquie", "Roumanie", "Russie", "Rwanda",
    "Saint-Marin", "Salvador", "Sénégal", "Serbie", "Singapour", "Slovaquie", "Slovénie", "Somalie", "Soudan", "Sri Lanka", "Suède",
    "Suisse", "Syrie", "Tadjikistan", "Tanzanie", "Tchad", "Thaïlande", "Togo", "Trinité-et-Tobago", "Tunisie", "Turkménistan",
    "Turquie", "Ukraine", "Uruguay", "Venezuela", "Vietnam", "Yémen", "Zambie", "Zimbabwe",
    // English
    "South Africa", "Albania", "Algeria", "Germany", "England", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahrain",
    "Belgium", "Belarus", "Bosnia and Herzegovina", "Brazil", "Cameroon", "China", "Cyprus", "Colombia", "South Korea",
    "Korea Republic", "Ivory Coast", "Croatia", "Denmark", "Scotland", "Egypt", "United Arab Emirates", "UAE", "Ecuador", "Spain",
    "Estonia", "USA", "United States", "Ethiopia", "Finland", "Georgia", "Greece", "Hungary", "Faroe Islands", "India", "Indonesia",
    "Iraq", "Ireland", "Republic of Ireland", "Northern Ireland", "Iceland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kuwait",
    "Latvia", "Lebanon", "Lithuania", "North Macedonia", "Malaysia", "Malta", "Morocco", "Mexico", "Moldova", "Montenegro", "Norway",
    "New Zealand", "Wales", "Netherlands", "Holland", "Peru", "Poland", "Czech Republic", "Czechia", "Romania", "Russia",
    "Saudi Arabia", "Senegal", "Serbia", "Slovakia", "Slovenia", "Sweden", "Switzerland", "Thailand", "Tunisia", "Turkey", "Türkiye",
    "Uzbekistan",
    // Régions et compétitions entre pays
    "International", "Internationale", "Internationaux", "Clubs internationaux", "International Clubs", "Monde", "Mondial", "World",
    "Europe", "Afrique", "Africa", "Asie", "Asia", "Amérique", "Amérique du Sud", "Amérique du Nord", "Amérique centrale",
    "South America", "North America", "Océanie", "Oceania", "UEFA", "FIFA", "CAF", "AFC", "CONCACAF", "CONMEBOL", "OFC",
  ].map(teamKey),
);

export const isRegion = (s: string) => REGIONS.has(teamKey(s));

/** « Suède - D1 Suède » → { country: "Suède", league: "D1 Suède" } ; « IK Sirius FK - AIK Solna », « Suède - Norvège » → undefined. */
export function competitionOf(line: string): { country: string; league: string } | undefined {
  // Séparateur entouré d'espaces : « Bosnie-Herzégovine » et « Pays-Bas » sont des noms entiers
  const m = line.match(/^(.{2,40}?)\s+[-–·/|›>]\s+(.{2,60})$/);
  if (!m) return undefined;
  const country = cleanName(m[1]);
  const league = cleanName(m[2]);
  return isRegion(country) && !isRegion(league) && /[a-zà-ÿ]{2,}/i.test(league) ? { country, league } : undefined;
}
