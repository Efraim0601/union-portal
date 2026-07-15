import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { OnbSectionCard } from '../ui/section-card';
import { OnbFormField, OnbInput } from '../ui/form-field';
import { DiasporaApi } from '../core/diaspora-api.service';
import { siblingUrl } from '../core/nav';

type SearchMode = 'reference' | 'email' | 'whatsapp';

const MODES: { value: SearchMode; label: string; placeholder: string }[] = [
  { value: 'reference', label: 'Référence du dossier', placeholder: 'ex. AFR-XXXXXX' },
  { value: 'email', label: 'Adresse e-mail', placeholder: 'ex. vous@exemple.com' },
  { value: 'whatsapp', label: 'Numéro WhatsApp', placeholder: 'ex. +237 6XX XX XX XX' },
];

/** Suivi de dossier — visuel digital-onboarding (beige, serif, rouge). Recherche par référence,
 *  email ou numéro WhatsApp (les trois identifiants collectés pendant le parcours). */
@Component({
  selector: 'diaspora-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JsonPipe, OnbSectionCard, OnbFormField, OnbInput],
  template: `
    <div style="min-height:100vh;background:#F7F2EC;font-family:'Inter',system-ui,sans-serif;">
      <header style="border-bottom:1px solid rgba(20,20,30,0.10);">
        <div style="max-width:640px;margin:0 auto;padding:16px 20px;">
          <a (click)="goHome($event)" style="cursor:pointer;text-decoration:none;display:flex;align-items:center;gap:10px;">
            <span style="display:inline-flex;width:30px;height:30px;border-radius:7px;background:#C8102E;color:#fff;align-items:center;justify-content:center;font-weight:700;">A</span>
            <span style="font-family:'Source Serif 4',Georgia,serif;font-size:16px;color:#151821;">Compte Diaspora</span>
          </a>
        </div>
      </header>

      <main style="max-width:640px;margin:0 auto;padding:32px 20px 60px;">
        <onb-section-card [section]="1" title="Suivre ma demande" subtitle="Retrouvez votre dossier par référence, e-mail ou numéro WhatsApp.">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
            @for (m of modes; track m.value) {
              <button type="button" (click)="setMode(m.value)"
                [style.background]="mode() === m.value ? '#C8102E' : '#fff'"
                [style.color]="mode() === m.value ? '#fff' : '#151821'"
                [style.border-color]="mode() === m.value ? '#C8102E' : 'rgba(20,20,30,0.14)'"
                style="padding:8px 14px;border-radius:999px;border-width:1px;border-style:solid;font-size:12px;font-weight:600;cursor:pointer;">
                {{ m.label }}
              </button>
            }
          </div>

          <onb-form-field [label]="activeMode().label">
            <input onbInput type="text" [value]="query()" (input)="query.set($any($event.target).value)" [placeholder]="activeMode().placeholder" />
          </onb-form-field>
          <div style="margin-top:16px;">
            <button type="button" (click)="lookup()" [disabled]="loading() || !query()"
              [style.background]="loading() || !query() ? '#ccc' : '#C8102E'"
              style="display:inline-flex;align-items:center;gap:8px;padding:12px 28px;color:#fff;border:none;font-size:12px;font-weight:600;letter-spacing:1.3px;text-transform:uppercase;cursor:pointer;">
              {{ loading() ? 'Recherche…' : 'Rechercher' }}
            </button>
          </div>
          @if (result()) {
            <pre style="margin-top:16px;background:#F7F2EC;border:1px solid rgba(20,20,30,0.08);border-radius:8px;padding:12px;font-size:11.5px;overflow:auto;color:#151821;">{{ result() | json }}</pre>
          }
          @if (error()) { <p style="font-size:12px;color:#C8102E;margin-top:12px;">{{ error() }}</p> }
        </onb-section-card>
      </main>
    </div>
  `,
})
export class DiasporaStatusPage {
  private api = inject(DiasporaApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly modes = MODES;
  readonly mode = signal<SearchMode>('reference');
  readonly activeMode = computed(() => this.modes.find((m) => m.value === this.mode())!);
  readonly query = signal(this.route.snapshot.queryParamMap.get('reference') ?? '');
  readonly loading = signal(false);
  readonly result = signal<unknown>(null);
  readonly error = signal<string | null>(null);

  setMode(m: SearchMode): void {
    this.mode.set(m);
    this.query.set('');
    this.result.set(null);
    this.error.set(null);
  }

  goHome(e: Event): void {
    e.preventDefault();
    this.router.navigateByUrl(siblingUrl(this.router, '/status', '/home'));
  }

  lookup(): void {
    const q = this.query();
    if (!q) return;
    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);
    const request$ = this.mode() === 'email'
      ? this.api.statusByEmail(q)
      : this.mode() === 'whatsapp'
        ? this.api.statusByContact(q)
        : this.api.statusByReference(q);
    request$.subscribe({
      next: (r) => { this.result.set(r); this.loading.set(false); },
      error: () => { this.error.set('Dossier introuvable.'); this.loading.set(false); },
    });
  }
}
