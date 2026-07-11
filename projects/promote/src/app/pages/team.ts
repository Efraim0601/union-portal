import { Component, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { I18n } from '../core/i18n';
import { TeamMemberDto } from '../core/models';
import { StaffSidebar } from '../shared/staff-sidebar';

@Component({
  selector: 'app-team',
  imports: [StaffSidebar],
  template: `
    <app-staff-sidebar active="team" />
    <div style="flex:1;padding:16px 16px 40px;padding-top:48px;max-width:720px;margin:0 auto;width:100%">
      <div style="padding-left:36px">
        <div style="font-size:22px;font-weight:800;color:var(--navy);margin-bottom:16px">{{ i18n.t('team_title_view') }}</div>

        <div class="panel" style="margin-bottom:20px">
          <div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:12px">{{ i18n.t('team_message') }}</div>
          <div class="fld"><label class="lab">{{ i18n.t('team_subject') }}</label><input class="in" [value]="title()" (input)="title.set(val($event))"></div>
          <div class="fld"><label class="lab">{{ i18n.t('team_body') }}</label><textarea class="in" rows="3" [value]="body()" (input)="body.set(val($event))"></textarea></div>
          @if (sent()) { <div class="alert-success" style="margin-bottom:10px">✓ {{ i18n.t('team_sent') }}</div> }
          <button (click)="send()" class="btn btn-primary" style="width:auto;padding:10px 18px;border-radius:10px">{{ i18n.t('team_send') }}</button>
        </div>

        <div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:8px">{{ i18n.t('team_roster') }} ({{ roster().length }})</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          @for (m of roster(); track m.id) {
            <div class="row"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:13px;font-weight:700;color:var(--navy)">{{ m.name }}</div><div style="font-size:11px;color:var(--muted)">{{ m.agency }}</div></div><span class="rolechip">{{ m.role }}</span></div></div>
          }
          @if (roster().length === 0) { <div style="text-align:center;color:var(--muted);padding:24px">{{ i18n.t('adm_no_data') }}</div> }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display:flex;flex:1;flex-direction:column }
    .panel { background:#fff;border-radius:14px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .row { background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .fld { margin-bottom:12px } .lab { display:block;font-size:12px;font-weight:600;color:var(--label);margin-bottom:4px }
    .in { width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;background:var(--surface-2);font-family:inherit }
    .rolechip { padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;background:var(--surface-3);color:var(--label) }
  `],
})
export class TeamPage {
  protected i18n = inject(I18n);
  private api = inject(Api);
  roster = signal<TeamMemberDto[]>([]);
  title = signal(''); body = signal(''); sent = signal(false);
  constructor() { this.api.teamRoster().subscribe({ next: (l) => this.roster.set(l), error: () => {} }); }
  val(e: Event) { return (e.target as HTMLInputElement | HTMLTextAreaElement).value; }
  send() { this.api.sendTeamMessage(this.title().trim(), this.body().trim(), []).subscribe({ next: () => { this.sent.set(true); this.title.set(''); this.body.set(''); } }); }
}
