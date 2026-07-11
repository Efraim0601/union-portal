import { Component, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { I18n } from '../core/i18n';
import { StaffSidebar } from '../shared/staff-sidebar';

interface Report { hours: number; scanned: number; updated: number; unchanged: number; errors: number; }

@Component({
  selector: 'app-recon',
  imports: [StaffSidebar],
  template: `
    <app-staff-sidebar active="recon" />
    <div style="flex:1;padding:16px 16px 40px;padding-top:48px;max-width:600px;margin:0 auto;width:100%">
      <div style="padding-left:36px">
        <div style="font-size:22px;font-weight:800;color:var(--navy);margin-bottom:6px">{{ i18n.t('recon_title') }}</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:20px">{{ i18n.t('recon_desc') }}</div>

        <div class="panel" style="margin-bottom:20px">
          <label class="lab">{{ i18n.t('recon_hours') }}</label>
          <div style="display:flex;gap:10px;align-items:center">
            <input class="in" type="number" min="1" max="72" style="width:100px" [value]="hours()" (input)="hours.set(+val($event) || 1)">
            <button (click)="run()" class="btn btn-primary" style="width:auto;padding:12px 20px;border-radius:10px" [disabled]="running()">
              {{ running() ? i18n.t('recon_running') : i18n.t('recon_run') }}
            </button>
          </div>
        </div>

        @if (running()) {
          <div style="text-align:center;padding:24px">
            <svg width="56" height="56" viewBox="0 0 56 56" style="animation:spinRing 1.5s linear infinite"><circle cx="28" cy="28" r="24" stroke="#F3F4F6" stroke-width="5" fill="none"></circle><circle cx="28" cy="28" r="24" stroke="#C8102E" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="150" stroke-dashoffset="60"></circle></svg>
          </div>
        }

        @if (report(); as r) {
          <div class="slide-up">
            <div class="alert-success" style="margin-bottom:14px">✓ {{ i18n.t('recon_done') }}</div>
            <div class="kpis">
              <div class="kpi"><div style="font-size:24px;font-weight:800;color:var(--navy)">{{ r.scanned }}</div><div class="kl">{{ i18n.t('recon_scanned') }}</div></div>
              <div class="kpi"><div style="font-size:24px;font-weight:800;color:#059669">{{ r.updated }}</div><div class="kl">{{ i18n.t('recon_updated') }}</div></div>
              <div class="kpi"><div style="font-size:24px;font-weight:800;color:var(--muted)">{{ r.unchanged }}</div><div class="kl">{{ i18n.t('recon_unchanged') }}</div></div>
              <div class="kpi"><div style="font-size:24px;font-weight:800;color:#DC2626">{{ r.errors }}</div><div class="kl">{{ i18n.t('recon_errors') }}</div></div>
            </div>
          </div>
        }
        @if (error()) { <div class="alert-error" style="margin-top:12px">{{ error() }}</div> }
      </div>
    </div>
  `,
  styles: [`
    :host { display:flex;flex:1;flex-direction:column }
    .panel { background:#fff;border-radius:14px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .lab { display:block;font-size:12px;font-weight:600;color:var(--label);margin-bottom:8px }
    .in { padding:10px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:15px;background:var(--surface-2) }
    .kpis { display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px }
    .kpi { background:#fff;border-radius:12px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .kl { font-size:11px;color:var(--muted);margin-top:2px }
  `],
})
export class ReconPage {
  protected i18n = inject(I18n);
  private api = inject(Api);

  hours = signal(1);
  running = signal(false);
  report = signal<Report | null>(null);
  error = signal('');

  val(e: Event) { return (e.target as HTMLInputElement).value; }

  run() {
    this.running.set(true); this.error.set(''); this.report.set(null);
    this.api.reconcile(this.hours()).subscribe({
      next: (r) => { this.running.set(false); this.report.set(r); },
      error: (e) => { this.running.set(false); this.error.set(e?.error?.error || e?.error?.message || 'Erreur'); },
    });
  }
}
