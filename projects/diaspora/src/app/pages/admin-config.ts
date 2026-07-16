import { Component, ChangeDetectionStrategy, WritableSignal, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import * as XLSX from 'xlsx';
import { OnbSectionCard } from '../ui/section-card';
import { OnbFormField, OnbInput, OnbSelect, OnbCheckbox } from '../ui/form-field';
import { DiasporaApi } from '../core/diaspora-api.service';
import { AdminAuth } from '../core/admin-auth';
import { siblingUrl } from '../core/nav';
import { Agency, LookupKind, LookupOption, PackageOffer, Subsector } from '../core/application.model';

/** Même normalisation qu'en promote (projects/promote/src/app/pages/admin.ts) — accents,
 *  espaces/tirets/points ignorés pour matcher l'en-tête d'une colonne quelle que soit sa graphie. */
function normHeader(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s._-]/g, '');
}
function pickCol(row: Record<string, unknown>, keys: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    const orig = keys[c];
    if (orig != null && row[orig] != null && String(row[orig]).trim() !== '') return String(row[orig]).trim();
  }
  return '';
}
function slugCode(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

interface LookupSection {
  kind: LookupKind;
  title: string;
  subtitle: string;
  rows: WritableSignal<LookupOption[]>;
}

const CURRENCIES = ['XAF', 'EUR', 'USD'];

/**
 * Paramétrage des listes utilisées par le formulaire d'ouverture de compte diaspora (secteurs,
 * sous-secteurs, tranches/types de revenu, origine des fonds, objet du compte, formules de
 * compte). Aucun backend admin n'existe pour l'instant dans ce dépôt : les sauvegardes passent
 * par /api/lookups/* et sont interceptées par mock-api.interceptor.ts (persistées en
 * localStorage) tant que le vrai backend FastAPI n'expose pas ces routes.
 */
@Component({
  selector: 'diaspora-admin-config',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OnbSectionCard, OnbFormField, OnbInput, OnbSelect, OnbCheckbox],
  template: `
    <div style="min-height:100vh;background:#F7F2EC;font-family:'Inter',system-ui,sans-serif;">
      <div style="max-width:900px;margin:0 auto;padding:32px 20px 60px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;gap:16px;">
          <div>
            <div style="font-size:10px;font-weight:700;letter-spacing:1.8px;color:#C8102E;text-transform:uppercase;margin-bottom:6px;">
              Diaspora · Paramétrage admin
            </div>
            <h1 style="font-family:'Source Serif 4',Georgia,serif;font-size:26px;font-weight:500;color:#151821;letter-spacing:-0.5px;margin:0;">
              Listes & formules du formulaire
            </h1>
          </div>
          <button type="button" (click)="logout()" style="flex:0 0 auto;padding:9px 14px;border:1px solid rgba(20,20,30,0.14);background:#fff;color:#151821;border-radius:8px;cursor:pointer;font-size:12.5px;">
            Se déconnecter
          </button>
        </div>

        @if (sessionError()) {
          <div style="padding:12px 16px;border-radius:8px;background:rgba(200,16,46,0.06);border:1px solid rgba(200,16,46,0.2);margin-bottom:24px;">
            <p style="font-size:12px;color:#8a0d24;line-height:1.5;margin:0;">{{ sessionError() }}</p>
          </div>
        } @else {
          <div style="padding:12px 16px;border-radius:8px;background:rgba(20,20,30,0.04);border:1px solid rgba(20,20,30,0.08);margin-bottom:24px;">
            <p style="font-size:12px;color:#6B7280;line-height:1.5;margin:0;">
              Session admin (connexion mockée en dev — cf. core/admin-auth.ts — tant qu'aucun vrai backend
              d'authentification n'est branché pour ce projet).
            </p>
          </div>
        }

        <onb-section-card title="Agences" subtitle="Liste affichée à l’étape « Formule & agence ». Champs réseau/région alignés sur le modèle promote (AgencyDto), pour une réconciliation future sans migration.">
          <div style="padding:12px 14px;border-radius:8px;background:rgba(20,20,30,0.03);margin-bottom:16px;">
            <p style="font-size:12px;font-weight:600;color:#151821;margin:0 0 8px;">Importer un fichier (.xlsx, .xls, .csv)</p>
            <p style="font-size:11.5px;color:#6B7280;margin:0 0 10px;">
              Colonnes reconnues : nom (obligatoire), code, ville, réseau, région. Les agences importées s'ajoutent à la
              liste ci-dessous — relisez/ajustez puis cliquez sur « Enregistrer » pour les persister.
            </p>
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
              <input type="file" accept=".xlsx,.xls,.csv" (change)="onAgencyFile($event)" style="font-size:12.5px;" />
              <button type="button" (click)="downloadAgencyTemplate()" style="padding:8px 12px;border:1px solid rgba(20,20,30,0.14);background:#fff;color:#151821;border-radius:8px;cursor:pointer;font-size:12px;">
                Télécharger un modèle
              </button>
              @if (agencyImportCount() != null) {
                <span style="font-size:12px;color:#16A34A;font-weight:600;">{{ agencyImportCount() }} agence(s) ajoutée(s) — pensez à Enregistrer.</span>
              }
            </div>
            @if (agencyImportError()) { <p style="font-size:12px;color:#C8102E;margin:10px 0 0;">{{ agencyImportError() }}</p> }
          </div>
          <div style="display:flex;flex-direction:column;gap:14px;">
            @for (row of agencies(); track $index) {
              <div style="padding:12px;border:1px solid rgba(20,20,30,0.08);border-radius:10px;display:flex;flex-direction:column;gap:10px;">
                <div style="display:grid;grid-template-columns:140px 1fr auto;gap:10px;align-items:end;">
                  <onb-form-field label="Code">
                    <input onbInput type="text" [value]="row.code" (input)="updateAgency($index, 'code', $any($event.target).value)" />
                  </onb-form-field>
                  <onb-form-field label="Nom">
                    <input onbInput type="text" [value]="row.name" (input)="updateAgency($index, 'name', $any($event.target).value)" />
                  </onb-form-field>
                  <button type="button" (click)="removeAgency($index)" style="padding:10px 14px;border:1px solid rgba(200,16,46,0.3);background:#fff;color:#C8102E;border-radius:8px;cursor:pointer;font-size:12.5px;">
                    Supprimer
                  </button>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:10px;align-items:end;">
                  <onb-form-field label="Ville">
                    <input onbInput type="text" [value]="row.city ?? ''" (input)="updateAgency($index, 'city', $any($event.target).value)" />
                  </onb-form-field>
                  <onb-form-field label="Réseau">
                    <input onbInput type="text" [value]="row.reseau ?? ''" (input)="updateAgency($index, 'reseau', $any($event.target).value)" />
                  </onb-form-field>
                  <onb-form-field label="Région">
                    <input onbInput type="text" [value]="row.region ?? ''" (input)="updateAgency($index, 'region', $any($event.target).value)" />
                  </onb-form-field>
                  <onb-checkbox [checked]="row.active !== false" [changeFn]="setAgencyActive($index)" label="Active" />
                </div>
              </div>
            }
          </div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:14px;">
            <button type="button" (click)="addAgency()" style="padding:9px 14px;border:1px solid rgba(20,20,30,0.14);background:#fff;color:#151821;border-radius:8px;cursor:pointer;font-size:12.5px;">
              + Ajouter
            </button>
            <button type="button" (click)="saveAgenciesClick()" [disabled]="savingKind() === 'agencies'"
              style="padding:9px 16px;border:none;background:#C8102E;color:#fff;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:600;">
              {{ savingKind() === 'agencies' ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
            @if (savedKind() === 'agencies') { <span style="font-size:12px;color:#16A34A;">Enregistré.</span> }
          </div>
        </onb-section-card>

        @for (section of lookupSections; track section.kind) {
          <onb-section-card [title]="section.title" [subtitle]="section.subtitle">
            <div style="display:flex;flex-direction:column;gap:10px;">
              @for (row of section.rows(); track $index) {
                <div style="display:grid;grid-template-columns:160px 1fr auto;gap:10px;align-items:end;">
                  <onb-form-field label="Code">
                    <input onbInput type="text" [value]="row.code" (input)="updateRow(section.rows, $index, 'code', $any($event.target).value)" />
                  </onb-form-field>
                  <onb-form-field label="Libellé">
                    <input onbInput type="text" [value]="row.name" (input)="updateRow(section.rows, $index, 'name', $any($event.target).value)" />
                  </onb-form-field>
                  <button type="button" (click)="removeRow(section.rows, $index)" style="padding:10px 14px;border:1px solid rgba(200,16,46,0.3);background:#fff;color:#C8102E;border-radius:8px;cursor:pointer;font-size:12.5px;">
                    Supprimer
                  </button>
                </div>
              }
            </div>
            <div style="display:flex;gap:10px;align-items:center;margin-top:14px;">
              <button type="button" (click)="addRow(section.rows)" style="padding:9px 14px;border:1px solid rgba(20,20,30,0.14);background:#fff;color:#151821;border-radius:8px;cursor:pointer;font-size:12.5px;">
                + Ajouter
              </button>
              <button type="button" (click)="saveSection(section)" [disabled]="savingKind() === section.kind"
                style="padding:9px 16px;border:none;background:#C8102E;color:#fff;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:600;">
                {{ savingKind() === section.kind ? 'Enregistrement…' : 'Enregistrer' }}
              </button>
              @if (savedKind() === section.kind) { <span style="font-size:12px;color:#16A34A;">Enregistré.</span> }
            </div>
          </onb-section-card>
        }

        <onb-section-card title="Sous-secteurs d'activité" subtitle="Rattachés à un secteur ci-dessus par son code. Retiré du formulaire client (rempli par le GFC en back-office).">
          <div style="display:flex;flex-direction:column;gap:10px;">
            @for (row of subsectors(); track $index) {
              <div style="display:grid;grid-template-columns:140px 1fr 160px auto;gap:10px;align-items:end;">
                <onb-form-field label="Code">
                  <input onbInput type="text" [value]="row.code" (input)="updateSubsector($index, 'code', $any($event.target).value)" />
                </onb-form-field>
                <onb-form-field label="Libellé">
                  <input onbInput type="text" [value]="row.name" (input)="updateSubsector($index, 'name', $any($event.target).value)" />
                </onb-form-field>
                <onb-form-field label="Secteur (code)">
                  <input onbInput type="text" [value]="row.sector_code ?? ''" (input)="updateSubsector($index, 'sector_code', $any($event.target).value)" />
                </onb-form-field>
                <button type="button" (click)="removeSubsector($index)" style="padding:10px 14px;border:1px solid rgba(200,16,46,0.3);background:#fff;color:#C8102E;border-radius:8px;cursor:pointer;font-size:12.5px;">
                  Supprimer
                </button>
              </div>
            }
          </div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:14px;">
            <button type="button" (click)="addSubsector()" style="padding:9px 14px;border:1px solid rgba(20,20,30,0.14);background:#fff;color:#151821;border-radius:8px;cursor:pointer;font-size:12.5px;">
              + Ajouter
            </button>
            <button type="button" (click)="saveSubsectorsClick()" [disabled]="savingKind() === 'subsectors'"
              style="padding:9px 16px;border:none;background:#C8102E;color:#fff;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:600;">
              {{ savingKind() === 'subsectors' ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
            @if (savedKind() === 'subsectors') { <span style="font-size:12px;color:#16A34A;">Enregistré.</span> }
          </div>
        </onb-section-card>

        <onb-section-card title="Packages / formules de compte" subtitle="Nom, description, fonctionnalités et tarifs — affichés tels quels à l'étape « Formule & agence ».">
          <div style="display:flex;flex-direction:column;gap:18px;">
            @for (pkg of packagesSig(); track $index) {
              <div style="padding:14px;border:1px solid rgba(20,20,30,0.1);border-radius:10px;display:flex;flex-direction:column;gap:12px;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                  <onb-form-field label="Code">
                    <input onbInput type="text" [value]="pkg.code" (input)="updatePackage($index, 'code', $any($event.target).value)" />
                  </onb-form-field>
                  <onb-form-field label="Nom">
                    <input onbInput type="text" [value]="pkg.name" (input)="updatePackage($index, 'name', $any($event.target).value)" />
                  </onb-form-field>
                </div>
                <onb-form-field label="Accroche">
                  <input onbInput type="text" [value]="pkg.tagline ?? ''" (input)="updatePackage($index, 'tagline', $any($event.target).value)" />
                </onb-form-field>
                <onb-form-field label="Fonctionnalités (séparées par des virgules)">
                  <input onbInput type="text" [value]="featuresText(pkg)" (input)="updatePackageFeatures($index, $any($event.target).value)" />
                </onb-form-field>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">
                  <onb-form-field label="Devise">
                    <onb-select [value]="pkg.currency" [changeFn]="setPackageCurrency($index)">
                      @for (c of currencies; track c) { <option [value]="c">{{ c }}</option> }
                    </onb-select>
                  </onb-form-field>
                  <onb-form-field label="Frais d'ouverture">
                    <input onbInput type="number" [value]="pkg.opening_fee" (input)="updatePackageNumber($index, 'opening_fee', $any($event.target).value)" />
                  </onb-form-field>
                  <onb-form-field label="Frais d'abonnement">
                    <input onbInput type="number" [value]="pkg.subscription_fee" (input)="updatePackageNumber($index, 'subscription_fee', $any($event.target).value)" />
                  </onb-form-field>
                  <onb-form-field label="Frais mensuels">
                    <input onbInput type="number" [value]="pkg.monthly_fee" (input)="updatePackageNumber($index, 'monthly_fee', $any($event.target).value)" />
                  </onb-form-field>
                </div>
                <onb-checkbox [checked]="pkg.payment_required" [changeFn]="setPackagePaymentRequired($index)" label="Paiement en ligne requis avant validation du dossier" />
                <div>
                  <button type="button" (click)="removePackage($index)" style="padding:9px 14px;border:1px solid rgba(200,16,46,0.3);background:#fff;color:#C8102E;border-radius:8px;cursor:pointer;font-size:12.5px;">
                    Supprimer ce package
                  </button>
                </div>
              </div>
            }
          </div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:14px;">
            <button type="button" (click)="addPackage()" style="padding:9px 14px;border:1px solid rgba(20,20,30,0.14);background:#fff;color:#151821;border-radius:8px;cursor:pointer;font-size:12.5px;">
              + Ajouter un package
            </button>
            <button type="button" (click)="savePackagesClick()" [disabled]="savingKind() === 'packages'"
              style="padding:9px 16px;border:none;background:#C8102E;color:#fff;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:600;">
              {{ savingKind() === 'packages' ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
            @if (savedKind() === 'packages') { <span style="font-size:12px;color:#16A34A;">Enregistré.</span> }
          </div>
        </onb-section-card>
      </div>
    </div>
  `,
})
export class DiasporaAdminConfigPage {
  private api = inject(DiasporaApi);
  private auth = inject(AdminAuth);
  private router = inject(Router);
  readonly currencies = CURRENCIES;
  sessionError = signal<string | null>(null);
  agencyImportCount = signal<number | null>(null);
  agencyImportError = signal<string | null>(null);

  sectors = signal<LookupOption[]>([]);
  incomeRanges = signal<LookupOption[]>([]);
  incomeTypes = signal<LookupOption[]>([]);
  fundsOrigins = signal<LookupOption[]>([]);
  accountObjects = signal<LookupOption[]>([]);
  professions = signal<LookupOption[]>([]);
  subsectors = signal<Subsector[]>([]);
  agencies = signal<Agency[]>([]);
  packagesSig = signal<PackageOffer[]>([]);

  savingKind = signal<string | null>(null);
  savedKind = signal<string | null>(null);
  private savedTimer: ReturnType<typeof setTimeout> | null = null;

  readonly lookupSections: LookupSection[] = [
    { kind: 'sectors', title: "Secteurs d'activité", subtitle: 'Retiré du formulaire client (rempli par le GFC en back-office) — liste conservée ici pour cet usage interne.', rows: this.sectors },
    { kind: 'professions', title: 'Professions', subtitle: 'Liste provisoire affichée à l’étape « Pièce d’identité & activité », en attendant le branchement sur Amplitude.', rows: this.professions },
    { kind: 'income-ranges', title: 'Tranches de revenu', subtitle: 'Liste provisoire affichée à l’étape « Pièce d’identité & activité », en attendant le branchement sur Amplitude.', rows: this.incomeRanges },
    { kind: 'income-types', title: 'Types de revenu', subtitle: 'Retiré du formulaire client — liste conservée pour un usage back-office éventuel.', rows: this.incomeTypes },
    { kind: 'funds-origins', title: 'Origine des fonds', subtitle: 'Liste affichée à l’étape « Formule & agence ». Prévoir un code "AUTRE" pour activer le champ libre.', rows: this.fundsOrigins },
    { kind: 'account-objects', title: 'Objet du compte', subtitle: 'Liste affichée à l’étape « Formule & agence ». Prévoir un code "AUTRE" pour activer le champ libre.', rows: this.accountObjects },
  ];

  constructor() {
    this.reload();
  }

  private reload(): void {
    for (const section of this.lookupSections) {
      this.api.lookup(section.kind).subscribe({ next: (l) => section.rows.set(l ?? []), error: () => {} });
    }
    this.api.lookupSubsectors().subscribe({ next: (l) => this.subsectors.set(l ?? []), error: () => {} });
    this.api.agencies().subscribe({ next: (l) => this.agencies.set(l ?? []), error: () => {} });
    this.api.packages().subscribe({ next: (l) => this.packagesSig.set(l ?? []), error: () => {} });
  }

  private flashSaved(kind: string): void {
    this.savedKind.set(kind);
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => this.savedKind.set(null), 2000);
  }

  /** Session expirée/invalide pendant l'édition (401 sur une écriture) : on renvoie vers la connexion. */
  private handleSaveError(err: unknown): void {
    this.savingKind.set(null);
    if ((err as { status?: number })?.status === 401) {
      this.auth.logout();
      this.sessionError.set('Session expirée — reconnectez-vous pour continuer.');
      // Les deux chemins partagent le même préfixe de montage ('' en standalone, '/diaspora' en
      // fédération) — on le calcule une seule fois depuis l'URL courante (encore '.../admin/parametrage').
      const returnUrl = this.router.url.split('?')[0];
      const loginUrl = siblingUrl(this.router, '/admin/parametrage', '/admin/login');
      this.router.navigateByUrl(`${loginUrl}?returnUrl=${encodeURIComponent(returnUrl)}`);
    }
  }

  logout(): void {
    this.auth.logout();
    this.router.navigateByUrl(siblingUrl(this.router, '/admin/parametrage', '/admin/login'));
  }

  addRow(rows: WritableSignal<LookupOption[]>): void {
    rows.update((list) => [...list, { code: '', name: '' }]);
  }
  removeRow(rows: WritableSignal<LookupOption[]>, i: number): void {
    rows.update((list) => list.filter((_, idx) => idx !== i));
  }
  updateRow(rows: WritableSignal<LookupOption[]>, i: number, field: 'code' | 'name', v: string): void {
    rows.update((list) => list.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  }
  saveSection(section: LookupSection): void {
    this.savingKind.set(section.kind);
    this.api.saveLookup(section.kind, section.rows()).subscribe({
      next: () => { this.savingKind.set(null); this.flashSaved(section.kind); },
      error: (err) => this.handleSaveError(err),
    });
  }

  addSubsector(): void {
    this.subsectors.update((l) => [...l, { code: '', name: '', sector_code: '' }]);
  }
  removeSubsector(i: number): void {
    this.subsectors.update((l) => l.filter((_, idx) => idx !== i));
  }
  updateSubsector(i: number, field: 'code' | 'name' | 'sector_code', v: string): void {
    this.subsectors.update((l) => l.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  }
  saveSubsectorsClick(): void {
    this.savingKind.set('subsectors');
    this.api.saveLookupSubsectors(this.subsectors()).subscribe({
      next: () => { this.savingKind.set(null); this.flashSaved('subsectors'); },
      error: (err) => this.handleSaveError(err),
    });
  }

  addAgency(): void {
    this.agencies.update((l) => [...l, { code: '', name: '', city: '', reseau: '', region: '', active: true }]);
  }
  removeAgency(i: number): void {
    this.agencies.update((l) => l.filter((_, idx) => idx !== i));
  }
  updateAgency(i: number, field: 'code' | 'name' | 'city' | 'reseau' | 'region', v: string): void {
    this.agencies.update((l) => l.map((a, idx) => (idx === i ? { ...a, [field]: v } : a)));
  }
  setAgencyActive(i: number) {
    return (v: boolean) => this.agencies.update((l) => l.map((a, idx) => (idx === i ? { ...a, active: v } : a)));
  }

  async onAgencyFile(e: Event): Promise<void> {
    this.agencyImportError.set(null);
    this.agencyImportCount.set(null);
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      if (!raw.length) { this.agencyImportError.set('Fichier vide ou aucune ligne de données.'); input.value = ''; return; }

      const keys: Record<string, string> = {};
      for (const h of Object.keys(raw[0])) keys[normHeader(h)] = h;
      const existingCodes = new Set(this.agencies().map((a) => a.code));
      const imported: Agency[] = [];
      for (const r of raw) {
        const name = pickCol(r, keys, ['name', 'nom', 'agence', 'libelle', 'libellé', 'nomagence']);
        if (!name) continue;
        let code = pickCol(r, keys, ['code']) || slugCode(name);
        while (existingCodes.has(code)) code += '_2';
        existingCodes.add(code);
        imported.push({
          code, name,
          city: pickCol(r, keys, ['city', 'ville', 'localite', 'localité']),
          reseau: pickCol(r, keys, ['reseau', 'réseau', 'network']),
          region: pickCol(r, keys, ['region', 'région']),
          active: true,
        });
      }
      if (!imported.length) { this.agencyImportError.set('Aucune ligne avec un nom exploitable.'); input.value = ''; return; }
      this.agencies.update((l) => [...l, ...imported]);
      this.agencyImportCount.set(imported.length);
    } catch {
      this.agencyImportError.set('Lecture du fichier impossible. Vérifiez le format (.xlsx, .xls ou .csv).');
    }
    input.value = '';
  }

  downloadAgencyTemplate(): void {
    const ws = XLSX.utils.aoa_to_sheet([
      ['nom', 'code', 'ville', 'reseau', 'region'],
      ['FIRST BANK Akwa', 'AKWA', 'Douala', 'Réseau Littoral', 'Littoral'],
      ['FIRST BANK Bastos', 'BASTOS', 'Yaoundé', 'Réseau Centre-Sud-Est', 'Centre'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Agences');
    XLSX.writeFile(wb, 'modele-import-agences.xlsx');
  }
  saveAgenciesClick(): void {
    this.savingKind.set('agencies');
    this.api.saveAgencies(this.agencies()).subscribe({
      next: () => { this.savingKind.set(null); this.flashSaved('agencies'); },
      error: (err) => this.handleSaveError(err),
    });
  }

  featuresText(pkg: PackageOffer): string { return pkg.features.join(', '); }
  addPackage(): void {
    this.packagesSig.update((l) => [...l, {
      code: '', name: '', tagline: '', currency: 'XAF',
      opening_fee: 0, subscription_fee: 0, monthly_fee: 0, payment_required: false, features: [],
    }]);
  }
  removePackage(i: number): void {
    this.packagesSig.update((l) => l.filter((_, idx) => idx !== i));
  }
  updatePackage(i: number, field: 'code' | 'name' | 'tagline', v: string): void {
    this.packagesSig.update((l) => l.map((p, idx) => (idx === i ? { ...p, [field]: v } : p)));
  }
  updatePackageNumber(i: number, field: 'opening_fee' | 'subscription_fee' | 'monthly_fee', v: string): void {
    const n = Number(v) || 0;
    this.packagesSig.update((l) => l.map((p, idx) => (idx === i ? { ...p, [field]: n } : p)));
  }
  updatePackageFeatures(i: number, v: string): void {
    const features = v.split(',').map((s) => s.trim()).filter(Boolean);
    this.packagesSig.update((l) => l.map((p, idx) => (idx === i ? { ...p, features } : p)));
  }
  setPackageCurrency(i: number) {
    return (v: string) => this.packagesSig.update((l) => l.map((p, idx) => (idx === i ? { ...p, currency: v } : p)));
  }
  setPackagePaymentRequired(i: number) {
    return (v: boolean) => this.packagesSig.update((l) => l.map((p, idx) => (idx === i ? { ...p, payment_required: v } : p)));
  }
  savePackagesClick(): void {
    this.savingKind.set('packages');
    this.api.savePackages(this.packagesSig()).subscribe({
      next: () => { this.savingKind.set(null); this.flashSaved('packages'); },
      error: (err) => this.handleSaveError(err),
    });
  }
}
