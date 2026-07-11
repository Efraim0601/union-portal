import { Component, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { I18n } from '../core/i18n';
import { NotificationDto } from '../core/models';

@Component({
  selector: 'app-notif-bell',
  template: `
    @if (auth.isLoggedIn()) {
      <button (click)="toggle()" class="bell" aria-label="notifications">
        <svg width="18" height="18" fill="none" stroke="#374151" stroke-width="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
        @if (unread() > 0) { <div class="badge">{{ unread() }}</div> }
      </button>

      @if (open()) {
        <div class="back" (click)="open.set(false)"></div>
        <div class="drop">
          <div class="head">
            <span style="font-size:15px;font-weight:700;color:var(--navy)">{{ i18n.t('notif_title') }}</span>
            <button (click)="markAll()" style="font-size:11px;color:var(--primary);font-weight:600;background:none;border:none;cursor:pointer">{{ i18n.t('notif_mark_all') }}</button>
          </div>
          <div style="flex:1;overflow-y:auto;padding:8px">
            @for (n of items(); track n.id) {
              <button (click)="read(n)" class="item" [style.background]="n.read ? '#fff' : '#FEF2F2'">
                <div style="display:flex;justify-content:space-between;gap:8px"><span style="font-size:13px;font-weight:700;color:var(--navy)">{{ n.title }}</span><span style="font-size:10px;color:var(--muted-2);flex-shrink:0">{{ ago(n.createdAt) }}</span></div>
                <div style="font-size:12px;color:var(--muted);margin-top:2px">{{ n.body }}</div>
                <div style="font-size:10px;color:var(--muted-2);margin-top:2px">{{ n.senderName }}</div>
              </button>
            }
            @if (items().length === 0) { <div style="text-align:center;color:var(--muted);padding:20px;font-size:13px">{{ i18n.t('notif_empty') }}</div> }
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .bell { position:fixed;top:44px;right:12px;z-index:80;width:36px;height:36px;border-radius:10px;border:1.5px solid var(--border);background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.06) }
    .badge { position:absolute;top:-2px;right:-2px;min-width:16px;height:16px;padding:0 3px;border-radius:8px;background:var(--primary);color:#fff;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff }
    .back { position:fixed;inset:0;z-index:85 }
    .drop { position:fixed;top:84px;right:12px;z-index:90;width:320px;max-width:calc(100vw - 24px);background:#fff;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.12);border:1px solid var(--surface-3);max-height:400px;display:flex;flex-direction:column;animation:slideUp .2s ease }
    .head { padding:14px 16px;border-bottom:1px solid var(--surface-3);display:flex;justify-content:space-between;align-items:center }
    .item { width:100%;text-align:left;padding:10px 12px;border-radius:10px;margin-bottom:4px;border:1px solid var(--surface-3);cursor:pointer;display:block }
  `],
})
export class NotifBell {
  protected i18n = inject(I18n);
  protected auth = inject(Auth);
  private api = inject(Api);

  open = signal(false);
  items = signal<NotificationDto[]>([]);
  unread = signal(0);

  constructor() {
    if (this.auth.isLoggedIn()) this.api.unreadCount().subscribe({ next: (r) => this.unread.set(r.count), error: () => {} });
  }

  toggle() {
    const next = !this.open();
    this.open.set(next);
    if (next) this.api.notificationsMine().subscribe({ next: (l) => this.items.set(l), error: () => {} });
  }
  read(n: NotificationDto) {
    if (n.read) return;
    this.api.markNotifRead(n.id).subscribe({ next: () => { this.items.set(this.items().map((x) => (x.id === n.id ? { ...x, read: true } : x))); this.unread.set(Math.max(0, this.unread() - 1)); } });
  }
  markAll() {
    this.api.markAllNotifRead().subscribe({ next: () => { this.items.set(this.items().map((x) => ({ ...x, read: true }))); this.unread.set(0); } });
  }
  ago(iso: string) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'j';
  }
}
