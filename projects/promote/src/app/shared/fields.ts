import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { CountryCode, getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { IconComponent } from './icon';
import { I18n } from '../core/i18n';

/** Labelled field wrapper with optional hint / error line. */
@Component({
  selector: 'field',
  standalone: true,
  template: `
    <div class="field">
      @if (label) { <label>{{ label }}</label> }
      <ng-content></ng-content>
      @if (err) { <div class="err">{{ err }}</div> }
      @else if (hint) { <div class="hint">{{ hint }}</div> }
    </div>`,
})
export class FieldComponent {
  @Input() label = '';
  @Input() hint = '';
  @Input() err: string | null = null;
}

/** ISO flag emoji from a 2-letter country code (regional-indicator symbols). */
const flagEmoji = (iso: string) =>
  iso.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

interface CountryOption { iso: CountryCode; name: string; dial: string; flag: string; }

/** Build the country list (flag · localized name · dial code), sorted by name. */
function buildCountries(lang: string): CountryOption[] {
  let namer: Intl.DisplayNames | null = null;
  try { namer = new Intl.DisplayNames([lang], { type: 'region' }); } catch { namer = null; }
  return getCountries()
    .map((iso) => ({ iso, dial: getCountryCallingCode(iso), flag: flagEmoji(iso), name: namer?.of(iso) ?? iso }))
    .sort((a, b) => a.name.localeCompare(b.name, lang));
}

/**
 * International phone input: country selector (flag + dial code) + national number.
 * Emits the full E.164 string (e.g. "+237699000000"). Defaults to Cameroon.
 */
@Component({
  selector: 'phone-field',
  standalone: true,
  imports: [FieldComponent],
  template: `
    <field [label]="label" [hint]="hint" [err]="err">
      <div style="position:relative">
        <div class="input-prefix">
          <button type="button" class="phone-cc" (click)="toggleOpen($event)" [attr.aria-expanded]="open" [attr.aria-label]="i18n.t('cc_label')">
            <span style="font-size:15px;line-height:1">{{ selectedFlag }}</span>
            <span>+{{ dial }}</span>
            <span style="opacity:.55;font-size:11px">▾</span>
          </button>
          <input inputmode="tel" [attr.maxlength]="maxLen" [placeholder]="placeholder" [value]="national" (input)="onInput($event)" />
        </div>
        @if (open) {
          <div class="cc-menu" (click)="$event.stopPropagation()">
            <input class="cc-search" [placeholder]="i18n.t('cc_search')" [value]="filter"
                   (input)="filter = $any($event.target).value" autofocus />
            <div class="cc-list">
              @for (c of filteredCountries; track c.iso) {
                <button type="button" (click)="choose(c.iso)" [class.cc-active]="c.iso === country">
                  <span style="font-size:15px;line-height:1">{{ c.flag }}</span>
                  <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ c.name }}</span>
                  <span class="cc-dial">+{{ c.dial }}</span>
                </button>
              }
            </div>
          </div>
        }
      </div>
    </field>`,
})
export class PhoneFieldComponent implements OnChanges {
  i18n = inject(I18n);
  @Input() label = '';
  @Input() hint = '';
  @Input() err: string | null = null;
  @Input() value = '';
  @Input() defaultCountry: CountryCode = 'CM';
  @Output() valueChange = new EventEmitter<string>();

  countries = buildCountries(this.i18n.lang());
  country: CountryCode = 'CM';
  national = '';
  open = false;
  filter = '';
  private lastEmitted = '';

  get dial() { return getCountryCallingCode(this.country); }
  get selectedFlag() { return flagEmoji(this.country); }
  get placeholder() { return this.country === 'CM' ? '6 99 00 00 00' : '000 000 000'; }
  /** National number length cap (E.164 max 15 digits minus country code). */
  get maxLen() { return Math.max(6, 15 - this.dial.length); }
  get filteredCountries(): CountryOption[] {
    const q = this.filter.trim().toLowerCase();
    if (!q) return this.countries;
    return this.countries.filter((c) =>
      c.name.toLowerCase().includes(q) || c.dial.includes(q) || c.iso.toLowerCase().includes(q));
  }

  ngOnChanges(ch: SimpleChanges) {
    if (ch['defaultCountry'] && !this.value) this.country = this.defaultCountry;
    if (ch['value'] && this.value !== this.lastEmitted) this.parse(this.value);
  }

  private parse(v: string) {
    if (!v) { this.national = ''; return; }
    const p = parsePhoneNumberFromString(v);
    if (p) { if (p.country) this.country = p.country; this.national = p.nationalNumber as string; }
    else { this.national = v.replace(/\D/g, ''); }
  }

  toggleOpen(e: Event) { e.stopPropagation(); this.open = !this.open; this.filter = ''; }
  choose(iso: string) { this.country = iso as CountryCode; this.open = false; this.filter = ''; this.emit(); }

  @HostListener('document:click')
  closeMenu() { this.open = false; }

  onInput(e: Event) {
    this.national = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, this.maxLen);
    this.emit();
  }

  private emit() {
    const v = this.national ? '+' + getCountryCallingCode(this.country) + this.national : '';
    this.lastEmitted = v;
    this.value = v;
    this.valueChange.emit(v);
  }
}
