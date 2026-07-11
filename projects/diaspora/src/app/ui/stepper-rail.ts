import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

export interface StepDef { label: string; desc: string }

/**
 * StepperRail vertical — reproduction À L'IDENTIQUE de
 * apps/digital-onboarding/src/components/Stepper.tsx (StepperRail).
 */
@Component({
  selector: 'onb-stepper-rail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="display:flex;flex-direction:column;gap:0;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.8px;color:#6B7280;text-transform:uppercase;margin-bottom:20px;">
        Progression
      </div>
      @for (step of steps; track $index; let i = $index; let last = $last) {
        <div style="display:flex;gap:14px;position:relative;" [style.padding-bottom]="last ? '0' : '22px'">
          @if (!last) {
            <div style="position:absolute;left:11px;top:26px;bottom:0;width:2px;transition:background 0.3s;"
                 [style.background]="i < currentStep ? '#C8102E' : 'rgba(20,20,30,0.10)'"></div>
          }
          <div style="flex-shrink:0;width:24px;height:24px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;transition:all 0.25s;"
               [style.background]="i < currentStep ? '#C8102E' : (i === currentStep ? '#fff' : '#F7F2EC')"
               [style.border]="i === currentStep ? '2px solid #C8102E' : (i < currentStep ? 'none' : '1.5px solid rgba(20,20,30,0.14)')"
               [style.color]="i < currentStep ? '#fff' : (i === currentStep ? '#C8102E' : '#6B7280')"
               [style.box-shadow]="i === currentStep ? '0 0 0 4px rgba(200,16,46,0.12)' : 'none'">
            @if (i < currentStep) {
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6 L5 8.5 L9.5 3.5"/></svg>
            } @else { <span>{{ i + 1 }}</span> }
          </div>
          <div style="padding-top:2px;min-width:0;">
            <div style="font-size:9.5px;font-weight:700;letter-spacing:1.3px;color:#9CA3AF;text-transform:uppercase;margin-bottom:2px;">
              Étape {{ pad(i + 1) }}
            </div>
            <div [style.font-weight]="i === currentStep ? 600 : 500"
                 [style.color]="i === currentStep ? '#151821' : (i < currentStep ? '#1F242E' : '#6B7280')"
                 style="font-size:13px;letter-spacing:-0.1px;">
              {{ step.label }}
            </div>
            @if (i === currentStep && step.desc) {
              <div style="font-size:11px;color:#9CA3AF;margin-top:2px;">{{ step.desc }}</div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class OnbStepperRail {
  @Input() steps: StepDef[] = [];
  @Input() currentStep = 0;
  pad(n: number): string { return String(n).padStart(2, '0'); }
}
