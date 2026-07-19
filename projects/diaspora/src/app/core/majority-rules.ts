/**
 * Majorité légale par pays — l'ouverture de compte exige la majorité, et l'âge de la
 * majorité CIVILE dépend du pays : 21 ans au Cameroun, 18 dans la plupart des États.
 *
 * Le pays retenu est celui de la NATIONALITÉ du demandeur (en droit international privé,
 * la capacité juridique relève du statut personnel, donc de la loi nationale) ; à défaut
 * de nationalité renseignée, on se rabat sur le pays de résidence.
 *
 * La table ne liste que les EXCEPTIONS au défaut de 18 ans, avec leur source. Valeurs à
 * faire valider/compléter par la conformité — notamment les pays fédéraux (États-Unis :
 * 18 dans la plupart des États mais 19 en Alabama/Nebraska et 21 au Mississippi ; Canada :
 * 18 ou 19 selon la province) où l'on retient 18 par défaut.
 */

export const DEFAULT_AGE_OF_MAJORITY = 18;

/** Exceptions (code ISO 3166-1 alpha-2 -> âge). */
export const AGE_OF_MAJORITY_EXCEPTIONS: Readonly<Record<string, number>> = {
  CM: 21, // Cameroun — majorité civile à 21 ans (art. 388 du Code civil applicable).
  GA: 21, // Gabon — majorité civile à 21 ans (Code civil gabonais).
  NE: 21, // Niger — majorité civile à 21 ans (Code civil).
  BF: 20, // Burkina Faso — 20 ans (Code des personnes et de la famille, art. 553).
  // Côte d'Ivoire : 18 ans DEPUIS la loi n° 2019-570 (était 21 avant 2019) — défaut correct.
};

/** Âge de majorité applicable pour un code pays ISO-2 (défaut : 18). */
export function ageOfMajority(countryCode?: string | null): number {
  const code = (countryCode ?? '').trim().toUpperCase();
  return AGE_OF_MAJORITY_EXCEPTIONS[code] ?? DEFAULT_AGE_OF_MAJORITY;
}

/** Âge révolu (années entières) à ce jour pour une date de naissance ISO (AAAA-MM-JJ).
 *  Renvoie null si la date est illisible ou dans le futur. */
export function ageFromBirthDate(birthDateIso?: string | null, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((birthDateIso ?? '').trim());
  if (!m) return null;
  const birth = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(birth.getTime()) || birth > today) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const anniversaryPassed =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  if (!anniversaryPassed) age -= 1;
  return age;
}

export interface MajorityCheck {
  /** true si la personne est majeure selon la loi du pays retenu (ou si les données manquent encore). */
  ok: boolean;
  /** Âge de majorité applicable. */
  required: number;
  /** Âge révolu calculé (null si date absente/invalide/future). */
  age: number | null;
}

/** Vérifie la majorité : `countryCode` = nationalité (repli : pays de résidence).
 *  Une date absente n'est PAS un échec ici (le champ « requis » gère ce cas) ;
 *  une date future/invalide, si. */
export function checkMajority(birthDateIso?: string | null, countryCode?: string | null): MajorityCheck {
  const required = ageOfMajority(countryCode);
  if (!(birthDateIso ?? '').trim()) return { ok: true, required, age: null };
  const age = ageFromBirthDate(birthDateIso);
  return { ok: age !== null && age >= required, required, age };
}
