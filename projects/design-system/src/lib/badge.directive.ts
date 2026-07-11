import { Directive, computed, input } from '@angular/core';
import { cn } from './cn';

/** Port Angular de ui-components/src/lib/badge.tsx. */
export type UiBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const BASE =
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2';

const VARIANTS: Record<UiBadgeVariant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
  secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
  destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
  outline: 'text-foreground',
};

@Directive({
  selector: '[uiBadge]',
  standalone: true,
  host: { '[class]': '_classes()' },
})
export class UiBadgeDirective {
  readonly variant = input<UiBadgeVariant>('default');
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly _classes = computed(() =>
    cn(BASE, VARIANTS[this.variant()], this.userClass())
  );
}
