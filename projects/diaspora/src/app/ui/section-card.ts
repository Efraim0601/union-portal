import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';

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
    <div style="background:#FFFFFF;border:1px solid rgba(20,20,30,0.12);border-radius:12px;padding:22px 24px;margin-bottom:16px;font-family:'Inter',system-ui,sans-serif;">
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
  template: `
    <div [style.justify-content]="onBack ? 'space-between' : 'flex-end'"
         style="display:flex;align-items:center;padding-top:20px;margin-top:8px;border-top:1px solid rgba(20,20,30,0.08);font-family:'Inter',system-ui,sans-serif;">
      @if (onBack) {
        <button type="button" (click)="back.emit()"
          style="display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border:1px solid rgba(20,20,30,0.12);background:#FFFFFF;font-size:13px;font-weight:500;color:#151821;cursor:pointer;letter-spacing:0.1px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7"/></svg>
          Retour
        </button>
      }
      <button type="submit" [disabled]="isLoading || disabled"
        [style.background]="isLoading || disabled ? '#ccc' : '#C8102E'"
        [style.cursor]="isLoading || disabled ? 'not-allowed' : 'pointer'"
        style="display:inline-flex;align-items:center;gap:8px;padding:12px 28px;color:#fff;border:none;font-size:12px;font-weight:600;letter-spacing:1.3px;text-transform:uppercase;">
        {{ submitLabel }}
        @if (!isLoading) {
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
        }
      </button>
    </div>
  `,
})
export class OnbStepNav {
  @Input() onBack = false;
  @Input() submitLabel = 'Continuer';
  @Input() isLoading = false;
  @Input() disabled = false;
  @Output() back = new EventEmitter<void>();
}
