import { Component, Input } from '@angular/core';

/** Small inline SVG icon subset needed by the capture components (subset of promote's ICONS map). */
export const CAPTURE_ICONS: Record<string, string | string[]> = {
  check: 'M20 6L9 17l-5-5',
  alert: ['M12 3l9 16H3L12 3z', 'M12 10v4', 'M12 17h.01'],
  camera: ['M4 8h3l2-2.5h6L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z', 'M12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z'],
  refresh: ['M3 12a9 9 0 0115.5-6.3L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 01-15.5 6.3L3 16', 'M3 21v-5h5'],
  image: ['M3 5h18v14H3z', 'M8.5 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3z', 'M21 16l-5-5L5 19'],
  user: ['M20 21a8 8 0 10-16 0', 'M12 11a4 4 0 100-8 4 4 0 000 8z'],
  idcard: ['M3 5h18v14H3z', 'M7 10a2 2 0 104 0 2 2 0 00-4 0z', 'M6 16c0-1.7 1.6-3 3-3s3 1.3 3 3', 'M15 9h4', 'M15 13h4', 'M15 16h2'],
};

@Component({
  selector: 'dsp-ic',
  standalone: true,
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" [attr.stroke-width]="sw" stroke-linecap="round" stroke-linejoin="round">
      @for (p of paths; track $index) { <path [attr.d]="p"></path> }
    </svg>`,
  styles: [':host{display:inline-flex;line-height:0}'],
})
export class DspIcon {
  @Input() name = '';
  @Input() size = 22;
  @Input() sw = 1.8;

  get paths(): string[] {
    const d = CAPTURE_ICONS[this.name];
    return Array.isArray(d) ? d : d ? [d] : [];
  }
}
