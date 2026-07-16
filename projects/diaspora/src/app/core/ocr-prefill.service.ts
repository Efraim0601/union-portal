import { Injectable, inject, signal } from '@angular/core';
import { DiasporaApi, OcrExtractResult } from './diaspora-api.service';
import { ApplicationCreate } from './application.model';

/**
 * Lecture OCR de la pièce d'identité menée EN ARRIÈRE-PLAN, indépendamment du cycle de vie des
 * composants d'étape (détruits/recréés à chaque navigation @switch). Le client valide sa capture
 * — le document est reconnu (bon type / bon côté) — puis poursuit aussitôt : la lecture des champs
 * se termine ici et vient préremplir les étapes suivantes (informations personnelles, KYC) au fur
 * et à mesure. Le client n'attend jamais la fin de l'extraction.
 *
 * Fourni au niveau de DiasporaOnboardingPage (providers) : une seule instance pour toute la durée
 * du parcours, remise à zéro naturellement quand on quitte puis revient sur l'ouverture de compte.
 */
@Injectable()
export class OcrPrefillService {
  private api = inject(DiasporaApi);

  /** Une lecture de la pièce est en cours (indicateur léger sur l'étape Documents). */
  readonly extracting = signal(false);
  /** Une lecture s'est terminée (succès ou échec) — les champs disponibles sont dans `fields`. */
  readonly extracted = signal(false);
  /** Champs lus sur la pièce (nom, prénom, dates, n°…) — fusionnés dans le modèle par le parent. */
  readonly fields = signal<Partial<ApplicationCreate>>({});
  /** Champs devinés depuis le plan de localisation (best-effort, souvent partiel). */
  readonly addressFields = signal<Partial<ApplicationCreate>>({});
  /** Alerte : le document ne correspond pas au type attendu (reconnaissance backend). */
  readonly authenticityWarning = signal<string | null>(null);
  /** Alerte : recto/verso inversé (détection de côté côté backend). */
  readonly sideWarning = signal<string | null>(null);

  /** Lance (ou relance) la lecture de la pièce. Non bloquant : retourne aussitôt, le résultat
   *  arrive de façon asynchrone dans les signaux ci-dessus. */
  extractIdentity(
    recto: File,
    identityType: string,
    verso: File | null,
    accountType: string,
    sessionId?: string,
  ): void {
    this.extracting.set(true);
    this.authenticityWarning.set(null);
    this.sideWarning.set(null);
    this.api.preOnboardingExtract(recto, identityType, verso ?? undefined, accountType, sessionId).subscribe({
      next: (res) => {
        this.fields.set({ ...res.fields });
        this.applyAuthenticitySignals(res);
        this.extracted.set(true);
        this.extracting.set(false);
      },
      error: () => {
        // OCR indisponible (backend non joignable) — le client saisira manuellement aux étapes suivantes.
        this.extracted.set(true);
        this.extracting.set(false);
      },
    });
  }

  /** Lecture best-effort de l'adresse depuis le plan de localisation (non bloquant). */
  extractAddress(file: File): void {
    this.api.preOnboardingExtractAddress(file).subscribe({
      next: (res) => {
        const extracted: Partial<ApplicationCreate> = {};
        if (res.address_location) extracted.address_location = res.address_location;
        if (res.postal_box) extracted.postal_box = res.postal_box;
        if (Object.keys(extracted).length) this.addressFields.set(extracted);
      },
      error: () => { /* best-effort — saisie manuelle en cas d'échec */ },
    });
  }

  /** Réinitialise l'état de lecture de la pièce (nouvelle capture recto/verso). */
  resetIdentity(): void {
    this.extracting.set(false);
    this.extracted.set(false);
    this.fields.set({});
    this.authenticityWarning.set(null);
    this.sideWarning.set(null);
  }

  /** Remonte les signaux d'authenticité du backend en avertissements affichables. */
  private applyAuthenticitySignals(res: OcrExtractResult): void {
    const v = res.documentValidation;
    this.authenticityWarning.set(
      v?.status === 'DOCUMENT_TYPE_MISMATCH'
        ? v.message ?? 'Ce document ne semble pas correspondre au type de pièce attendu.'
        : null,
    );
    const s = res.documentSide;
    this.sideWarning.set(
      s?.status === 'SIDE_MISMATCH'
        ? s.message ?? 'Le côté photographié ne correspond pas à celui attendu (recto/verso).'
        : null,
    );
  }
}
