import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, signal } from '@angular/core';
import { OnbDots } from './loader-dots';

/**
 * SectionCard + StepNav — reproduction À L'IDENTIQUE de
 * portal-client-firstpay/apps/digital-onboarding/src/components/ui/SectionCard.tsx
 * (styles inline, mêmes valeurs : rouge #C8102E, titres serif, bordures rgba(20,20,30,…)).
 */
@Component({
  selector: 'onb-section-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="onb-card" style="background:#FFFFFF;border:1px solid rgba(20,20,30,0.12);border-radius:12px;padding:22px 24px;margin-bottom:16px;font-family:'Inter',system-ui,sans-serif;">
      <div style="margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid rgba(20,20,30,0.08);">
        @if (section != null) {
          <div style="font-size:9.5px;font-weight:700;letter-spacing:1.6px;color:#C8102E;text-transform:uppercase;margin-bottom:5px;">
            § {{ pad(section) }}
          </div>
        }
        <div style="font-family:'Source Serif 4',Georgia,serif;font-size:17px;font-weight:500;color:#151821;letter-spacing:-0.3px;line-height:1.2;">
          {{ title }}
        </div>
        @if (subtitle) {
          <div style="font-size:12px;color:#6B7280;margin-top:4px;line-height:1.5;">{{ subtitle }}</div>
        }
      </div>
      <ng-content />
    </div>
    <style>
      /* Sur petit écran, la carte rend sa marge intérieure au contenu (cadres caméra). */
      @media (max-width: 640px) { .onb-card { padding: 18px 14px !important; } }
    </style>
  `,
})
export class OnbSectionCard {
  @Input() section?: number;
  @Input() title = '';
  @Input() subtitle?: string;
  pad(n: number): string { return String(n).padStart(2, '0'); }
}

@Component({
  selector: 'onb-step-nav',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OnbDots],
  template: `
    <div [style.justify-content]="onBack ? 'space-between' : 'flex-end'"
         class="onb-nav"
         style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding-top:20px;margin-top:8px;border-top:1px solid rgba(20,20,30,0.08);font-family:'Inter',system-ui,sans-serif;">
      @if (onBack) {
        <button type="button" (click)="back.emit()"
          style="display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:11px 20px;border:1px solid rgba(20,20,30,0.12);background:#FFFFFF;font-size:13px;font-weight:500;color:#151821;cursor:pointer;letter-spacing:0.1px;touch-action:manipulation;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7"/></svg>
          Retour
        </button>
      }
      <button type="submit" [disabled]="isLoading || disabled || busy()" (click)="onSubmitClick($event)"
        [style.background]="isLoading || disabled || busy() ? '#ccc' : '#C8102E'"
        [style.cursor]="isLoading || disabled || busy() ? 'not-allowed' : 'pointer'"
        style="display:inline-flex;align-items:center;justify-content:center;gap:8px;min-width:150px;min-height:44px;padding:12px 28px;color:#fff;border:none;font-size:12px;font-weight:600;letter-spacing:1.3px;text-transform:uppercase;touch-action:manipulation;">
        @if (busy() || isLoading) {
          <onb-dots color="#fff" />
        } @else {
          {{ submitLabel }}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
        }
      </button>
    </div>
    <style>
      /* Boutons pleine largeur sur très petit écran : cible tactile large, pas de débordement. */
      @media (max-width: 480px) { .onb-nav button { flex: 1 1 auto; } }
    </style>
  `,
})
export class OnbStepNav {
  @Input() onBack = false;
  @Input() submitLabel = 'Continuer';
  @Input() isLoading = false;
  @Input() disabled = false;
  @Output() back = new EventEmitter<void>();

  /** Loader « 3 boules » affiché ~1 s au clic, avant la soumission réelle du formulaire. */
  busy = signal(false);

  onSubmitClick(e: Event): void {
    if (this.isLoading || this.disabled || this.busy()) return;
    // On diffère la soumission d'1 s en montrant le loader, puis on re-soumet le
    // formulaire parent (tous les onb-step-nav sont dans un <form> — cf. étapes).
    e.preventDefault();
    const form = (e.currentTarget as HTMLElement).closest('form') as HTMLFormElement | null;
    this.busy.set(true);
    setTimeout(() => {
      this.busy.set(false);
      form?.requestSubmit();
    }, 1000);
  }
}
