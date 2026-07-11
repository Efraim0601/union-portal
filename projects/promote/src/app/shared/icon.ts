import { Component, Input } from '@angular/core';

/** Inline SVG icon set, ported verbatim from the prototype's components.jsx ICONS map. */
export const ICONS: Record<string, string | string[]> = {
  chevR: 'M9 6l6 6-6 6',
  chevL: 'M15 6l-6 6 6 6',
  chevD: 'M6 9l6 6 6-6',
  arrowR: ['M5 12h14', 'M13 6l6 6-6 6'],
  check: 'M20 6L9 17l-5-5',
  phone: 'M5 4h3l2 5-2.5 1.5a11 11 0 005 5L14 13l5 2v3a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  user: ['M20 21a8 8 0 10-16 0', 'M12 11a4 4 0 100-8 4 4 0 000 8z'],
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2v2h-2z', 'M18 14h2v2h-2z', 'M14 18h2v2h-2z', 'M18 18h2v2h-2z'],
  scan: ['M4 8V5a1 1 0 011-1h3', 'M16 4h3a1 1 0 011 1v3', 'M20 16v3a1 1 0 01-1 1h-3', 'M8 20H5a1 1 0 01-1-1v-3', 'M4 12h16'],
  shield: ['M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z', 'M9 12l2 2 4-4'],
  lock: ['M6 10h12v10H6z', 'M9 10V7a3 3 0 116 0v3'],
  gear: ['M12 15a3 3 0 100-6 3 3 0 000 6z', 'M19.4 13a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H11a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V11a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z'],
  refresh: ['M3 12a9 9 0 0115.5-6.3L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 01-15.5 6.3L3 16', 'M3 21v-5h5'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  globe: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M3 12h18', 'M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18'],
  copy: ['M9 9h11v11H9z', 'M5 15V4h11'],
  clock: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 7v5l3 2'],
  alert: ['M12 3l9 16H3L12 3z', 'M12 10v4', 'M12 17h.01'],
  plus: ['M12 5v14', 'M5 12h14'],
  pencil: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  camera: ['M4 8h3l2-2.5h6L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z', 'M12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z'],
  idcard: ['M3 5h18v14H3z', 'M7 10a2 2 0 104 0 2 2 0 00-4 0z', 'M6 16c0-1.7 1.6-3 3-3s3 1.3 3 3', 'M15 9h4', 'M15 13h4', 'M15 16h2'],
  calendar: ['M4 5h16v15H4z', 'M4 9h16', 'M8 3v4', 'M16 3v4'],
  store: ['M4 9l1-4h14l1 4', 'M4 9a2 2 0 004 0 2 2 0 004 0 2 2 0 004 0 2 2 0 004 0', 'M5 9v10h14V9', 'M9 19v-5h4v5'],
  search: ['M11 18a7 7 0 100-14 7 7 0 000 14z', 'M21 21l-4.3-4.3'],
  printer: ['M7 8V3h10v5', 'M5 8h14a2 2 0 012 2v6h-4v4H7v-4H3v-6a2 2 0 012-2z', 'M9 16h6'],
  hash: ['M5 9h14', 'M5 15h14', 'M10 4l-2 16', 'M16 4l-2 16'],
  link: ['M9 15l6-6', 'M11 7l1-1a4 4 0 016 6l-1 1', 'M13 17l-1 1a4 4 0 01-6-6l1-1'],
  logout: ['M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3', 'M10 17l5-5-5-5', 'M15 12H3'],
  award: ['M12 15a6 6 0 100-12 6 6 0 000 12z', 'M8.5 13.5L7 21l5-3 5 3-1.5-7.5'],
  image: ['M3 5h18v14H3z', 'M8.5 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3z', 'M21 16l-5-5L5 19'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z', 'M12 15a3 3 0 100-6 3 3 0 000 6z'],
  download: ['M12 3v12', 'M7 12l5 5 5-5', 'M5 21h14'],
  eyeOff: ['M9.9 5.1A9.8 9.8 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.1 3.9', 'M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.8 9.8 0 004.2-.9', 'M3 3l18 18', 'M9.5 9.5a3 3 0 004.2 4.2'],
  mail: ['M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z', 'M3 7l9 6 9-6'],
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  pin: ['M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z', 'M12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z'],
  more: ['M12 5h.01', 'M12 12h.01', 'M12 19h.01'],
  bell: ['M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 01-3.46 0'],
  send: ['M22 2L11 13', 'M22 2L15 22l-4-9-9-4 20-7z'],
};

@Component({
  selector: 'ic',
  standalone: true,
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" [attr.stroke-width]="sw" stroke-linecap="round" stroke-linejoin="round">
      @for (p of paths; track $index) { <path [attr.d]="p"></path> }
    </svg>`,
  styles: [':host{display:inline-flex;line-height:0}'],
})
export class IconComponent {
  @Input() name = '';
  @Input() size = 22;
  @Input() sw = 1.8;

  get paths(): string[] {
    const d = ICONS[this.name];
    return Array.isArray(d) ? d : d ? [d] : [];
  }
}
