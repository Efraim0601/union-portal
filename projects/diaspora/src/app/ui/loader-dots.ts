import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * Loader « 3 boules » — trois pastilles qui rebondissent en cascade. Utilisé sur
 * les boutons d'action du parcours (cf. OnbStepNav, étape OTP) pour matérialiser
 * le clic pendant ~1 s. La couleur des boules est réglable selon le fond du bouton.
 */
@Component({
  selector: 'onb-dots',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="onb-dots" [style.--onb-dot-color]="color" aria-hidden="true">
      <span></span><span></span><span></span>
    </span>
  `,
  styles: [`
    .onb-dots { display:inline-flex; align-items:center; gap:5px; line-height:0; }
    .onb-dots > span {
      width:7px; height:7px; border-radius:50%;
      background: var(--onb-dot-color, #fff);
      display:inline-block;
      animation: onb-dots-bounce 0.6s infinite ease-in-out both;
    }
    .onb-dots > span:nth-child(1) { animation-delay: -0.32s; }
    .onb-dots > span:nth-child(2) { animation-delay: -0.16s; }
    .onb-dots > span:nth-child(3) { animation-delay: 0s; }
    @keyframes onb-dots-bounce {
      0%, 80%, 100% { transform: scale(0.35); opacity: 0.45; }
      40%           { transform: scale(1);    opacity: 1;    }
    }
  `],
})
export class OnbDots {
  /** Couleur des boules (défaut : blanc, adapté au bouton rouge principal). */
  @Input() color = '#fff';
}
