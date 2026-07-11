import { Directive, computed, input } from '@angular/core';
import { cn } from './cn';

/** Port Angular de ui-components/src/lib/input.tsx (accent focus rouge Afriland). */
const INPUT_CLASSES =
  'flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-gray-700 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600/20 focus-visible:ring-offset-2 focus-visible:border-red-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-gray-50 hover:border-gray-300 transition-colors duration-200 md:text-sm';

@Directive({
  selector: 'input[uiInput]',
  standalone: true,
  host: { '[class]': '_classes()' },
})
export class UiInputDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly _classes = computed(() => cn(INPUT_CLASSES, this.userClass()));
}

/** Port Angular de ui-components/src/lib/textarea.tsx. */
const TEXTAREA_CLASSES =
  'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

@Directive({
  selector: 'textarea[uiTextarea]',
  standalone: true,
  host: { '[class]': '_classes()' },
})
export class UiTextareaDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly _classes = computed(() => cn(TEXTAREA_CLASSES, this.userClass()));
}

/** Port Angular de ui-components/src/lib/label.tsx. */
const LABEL_CLASSES =
  'flex items-center gap-2 text-sm leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50';

@Directive({
  selector: 'label[uiLabel]',
  standalone: true,
  host: { '[class]': '_classes()' },
})
export class UiLabelDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly _classes = computed(() => cn(LABEL_CLASSES, this.userClass()));
}
