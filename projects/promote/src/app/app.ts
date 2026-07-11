import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { I18n } from './core/i18n';
import { NotifBell } from './shared/notif-bell';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NotifBell],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected i18n = inject(I18n);
}
