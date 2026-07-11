import { Directive, computed, input } from '@angular/core';
import { cn } from './cn';

/**
 * Directive bouton — port Angular de ui-components/src/lib/button.tsx.
 * Classes CVA reproduites À L'IDENTIQUE. Usage: <button uiBtn variant="outline" size="lg">
 */
export type UiButtonVariant =
  | 'default'
  | 'destructive'
  | 'outline'
  | 'secondary'
  | 'ghost'
  | 'link';
export type UiButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0';

const VARIANTS: Record<UiButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary underline-offset-4 hover:underline',
};

const SIZES: Record<UiButtonSize, string> = {
  default: 'h-10 px-4 py-2',
  sm: 'h-9 rounded-md px-3',
  lg: 'h-11 rounded-md px-8',
  icon: 'h-10 w-10',
};

export function buttonVariants(opts?: {
  variant?: UiButtonVariant;
  size?: UiButtonSize;
  class?: string;
}): string {
  return cn(BASE, VARIANTS[opts?.variant ?? 'default'], SIZES[opts?.size ?? 'default'], opts?.class);
}

@Directive({
  selector: 'button[uiBtn], a[uiBtn]',
  standalone: true,
  host: { '[class]': '_classes()' },
})
export class UiButtonDirective {
  readonly variant = input<UiButtonVariant>('default');
  readonly size = input<UiButtonSize>('default');
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly _classes = computed(() =>
    buttonVariants({ variant: this.variant(), size: this.size(), class: this.userClass() })
  );
}
