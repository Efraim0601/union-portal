import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { OnbSectionCard } from '../ui/section-card';
import { OnbFormField, OnbInput } from '../ui/form-field';
import { DiasporaApi } from '../core/diaspora-api.service';
import { siblingUrl } from '../core/nav';

/** Suivi de dossier — visuel digital-onboarding (beige, serif, rouge). */
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
        <onb-section-card [section]="1" title="Suivre ma demande" subtitle="Saisissez la référence de votre dossier.">
          <onb-form-field label="Référence du dossier">
            <input onbInput type="text" [value]="reference" (input)="reference = $any($event.target).value" placeholder="ex. AFR-XXXXXX" />
          </onb-form-field>
          <div style="margin-top:16px;">
            <button type="button" (click)="lookup()" [disabled]="loading()"
              [style.background]="loading() ? '#ccc' : '#C8102E'"
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
  reference = this.route.snapshot.queryParamMap.get('reference') ?? '';
  readonly loading = signal(false);
  readonly result = signal<unknown>(null);
  readonly error = signal<string | null>(null);

  goHome(e: Event): void {
    e.preventDefault();
    this.router.navigateByUrl(siblingUrl(this.router, '/status', '/home'));
  }

  lookup(): void {
    if (!this.reference) return;
    this.loading.set(true);
    this.error.set(null);
    this.api.statusByReference(this.reference).subscribe({
      next: (r) => { this.result.set(r); this.loading.set(false); },
      error: () => { this.error.set('Dossier introuvable.'); this.loading.set(false); },
    });
  }
}
