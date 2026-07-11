import {
  Component, Directive, Input, HostListener, ElementRef, inject,
  ChangeDetectionStrategy, booleanAttribute,
} from '@angular/core';

/**
 * FormField / Input / Select / Checkbox — reproduction À L'IDENTIQUE de
 * apps/digital-onboarding/src/components/ui/FormField.tsx (styles inline banque).
 */

@Component({
  selector: 'onb-form-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="display:flex;flex-direction:column;gap:6px;">
      <label style="font-size:11px;font-weight:600;letter-spacing:0.4px;color:#6B7280;text-transform:uppercase;">
        {{ label }}@if (required) {<span style="color:#C8102E;margin-left:3px;">*</span>}
      </label>
      <ng-content />
      @if (hint && !error) { <p style="font-size:11.5px;color:#9CA3AF;margin:0;">{{ hint }}</p> }
      @if (error) { <p style="font-size:11.5px;color:#C8102E;margin:0;">{{ error }}</p> }
    </div>
  `,
})
export class OnbFormField {
  @Input() label = '';
  @Input({ transform: booleanAttribute }) required = false;
  @Input() hint?: string;
  @Input() error?: string;
}

const BASE =
  'width:100%;padding:10px 12px;border:1px solid rgba(20,20,30,0.14);border-radius:8px;background:#FFFFFF;font-size:13.5px;color:#151821;outline:none;font-family:\'Inter\',system-ui,sans-serif;box-sizing:border-box;transition:border 0.15s,box-shadow 0.15s;';

/** Directive de style pour <input onbInput> avec focus rouge (comme la banque). */
@Directive({ selector: 'input[onbInput]', standalone: true })
export class OnbInput {
  @Input({ transform: booleanAttribute }) hasError = false;
  private el = inject(ElementRef<HTMLInputElement>).nativeElement;

  ngOnInit() { this.el.setAttribute('style', this.base()); }
  private base() {
    return this.hasError
      ? BASE + 'border-color:rgba(200,16,46,0.4);background:rgba(200,16,46,0.03);'
      : BASE;
  }
  @HostListener('focus') onFocus() {
    this.el.style.borderColor = '#C8102E';
    this.el.style.boxShadow = '0 0 0 3px rgba(200,16,46,0.08)';
  }
  @HostListener('blur') onBlur() {
    this.el.style.borderColor = this.hasError ? 'rgba(200,16,46,0.4)' : 'rgba(20,20,30,0.14)';
    this.el.style.boxShadow = 'none';
  }
}

@Component({
  selector: 'onb-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="position:relative;">
      <select [value]="value" (change)="onChange($event)"
        [style]="selectStyle"
        style="appearance:none;padding-right:32px;cursor:pointer;">
        <ng-content />
      </select>
      <svg width="12" height="12" viewBox="0 0 12 12" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);pointer-events:none;color:#9CA3AF;" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 4.5 L6 7.5 L9 4.5"/></svg>
    </div>
  `,
})
export class OnbSelect {
  @Input() value: string | null = '';
  @Input({ transform: booleanAttribute }) hasError = false;
  @Input() changeFn?: (v: string) => void;
  get selectStyle() {
    return this.hasError
      ? BASE + 'border-color:rgba(200,16,46,0.4);background:rgba(200,16,46,0.03);'
      : BASE;
  }
  onChange(e: Event) { this.changeFn?.((e.target as HTMLSelectElement).value); }
}

@Component({
  selector: 'onb-checkbox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;user-select:none;">
      <input type="checkbox" [checked]="checked" (change)="toggle($event)" style="display:none;" />
      <div [style.border]="'1.5px solid ' + (checked ? '#C8102E' : 'rgba(20,20,30,0.18)')"
           [style.background]="checked ? '#C8102E' : '#fff'"
           style="flex-shrink:0;width:18px;height:18px;border-radius:4px;display:flex;align-items:center;justify-content:center;margin-top:1px;transition:all 0.15s;">
        @if (checked) {
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6 L5 8.5 L9.5 3.5"/></svg>
        }
      </div>
      <span style="font-size:13px;color:#151821;line-height:1.5;">{{ label }}</span>
    </label>
  `,
})
export class OnbCheckbox {
  @Input() label = '';
  @Input({ transform: booleanAttribute }) checked = false;
  @Input() changeFn?: (v: boolean) => void;
  toggle(e: Event) { this.changeFn?.((e.target as HTMLInputElement).checked); }
}
