import { Directive, computed, input } from '@angular/core';
import { cn } from './cn';

/** Port Angular de ui-components/src/lib/card.tsx (Card + sous-parties). */

@Directive({ selector: '[uiCard]', standalone: true, host: { '[class]': '_c()' } })
export class UiCardDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly _c = computed(() =>
    cn('rounded-lg border bg-card text-card-foreground shadow-sm', this.userClass())
  );
}

@Directive({ selector: '[uiCardHeader]', standalone: true, host: { '[class]': '_c()' } })
export class UiCardHeaderDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly _c = computed(() => cn('flex flex-col space-y-1.5 p-6', this.userClass()));
}

@Directive({ selector: '[uiCardTitle]', standalone: true, host: { '[class]': '_c()' } })
export class UiCardTitleDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly _c = computed(() =>
    cn('text-2xl font-semibold leading-none tracking-tight', this.userClass())
  );
}

@Directive({ selector: '[uiCardDescription]', standalone: true, host: { '[class]': '_c()' } })
export class UiCardDescriptionDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly _c = computed(() => cn('text-sm text-muted-foreground', this.userClass()));
}

@Directive({ selector: '[uiCardContent]', standalone: true, host: { '[class]': '_c()' } })
export class UiCardContentDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly _c = computed(() => cn('p-6 pt-0', this.userClass()));
}

@Directive({ selector: '[uiCardFooter]', standalone: true, host: { '[class]': '_c()' } })
export class UiCardFooterDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly _c = computed(() => cn('flex items-center p-6 pt-0', this.userClass()));
}

export const UI_CARD = [
  UiCardDirective,
  UiCardHeaderDirective,
  UiCardTitleDirective,
  UiCardDescriptionDirective,
  UiCardContentDirective,
  UiCardFooterDirective,
] as const;
