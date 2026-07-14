import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { Component, computed, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { I18n } from '../core/i18n';
import {
  CommissionEntryDto, CommissionRuleDto, HierarchyStatsDto, MemberStatsDto, OrgViewDto, ProductCategoryDto,
  ProductComponentDto, ProductDto, ProductRequest, PromotionDto, PromotionRequest, TeamMemberDto,
} from '../core/models';
import { StaffSidebar } from '../shared/staff-sidebar';

type Tab = 'catalogue' | 'commissions' | 'hierarchy' | 'team';
type TreeNode = TeamMemberDto & { depth: number; movable: boolean };
const fcfa = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)) + ' F';

@Component({
  selector: 'app-manager',
  imports: [StaffSidebar, DragDropModule],
  template: `
    <app-staff-sidebar active="manager" />
    <div style="flex:1;padding:16px 16px 40px;padding-top:48px;max-width:900px;margin:0 auto;width:100%">
      <div style="padding-left:36px">
        <div class="tabs">
          @for (t of tabs; track t) { <button (click)="setTab(t)" class="tab" [class.tab-on]="tab() === t">{{ i18n.t('mgr_' + t) }}</button> }
        </div>

        <!-- CATALOGUE -->
        @if (tab() === 'catalogue') {
          <div class="fade-in" style="display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-size:12px;color:var(--muted)">{{ liveProducts().length }} {{ i18n.t('cat_products') }}</span>
              <div style="display:flex;gap:6px">
                <button (click)="showCatMgr.set(!showCatMgr()); catErr.set('')" class="btn-soft" style="width:auto;padding:8px 14px;border-radius:10px">{{ i18n.t('cat_categories') }} ({{ categories().length }})</button>
                <button (click)="newProduct()" class="btn btn-primary" style="width:auto;padding:8px 14px;border-radius:10px">+ {{ i18n.t('cat_new') }}</button>
              </div>
            </div>

            <!-- CATEGORY MANAGEMENT -->
            @if (showCatMgr()) {
              <div class="panel" style="margin-bottom:4px">
                <div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:10px">{{ i18n.t('cat_categories') }}</div>
                <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
                  @for (c of categories(); track c.id) {
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                      <span style="font-size:13px;font-weight:700;color:var(--navy)">{{ c.label }}</span>
                      <span class="codechip">{{ c.code }}</span>
                      <span style="font-size:11px;color:var(--muted)">{{ c.productCount }} {{ i18n.t('cat_products') }}</span>
                      @if (c.builtin) { <span class="off" style="background:#EFF6FF;color:#2563EB">système</span> }
                      <span style="flex:1"></span>
                      @if (!c.builtin) { <button (click)="removeCategory(c)" [disabled]="c.productCount > 0" class="mini" style="color:#DC2626;border-color:#FECACA">{{ i18n.t('cat_delete') }}</button> }
                    </div>
                  }
                  @if (!categories().length) { <div style="font-size:11px;color:var(--muted)">{{ i18n.t('cat_no_category') }}</div> }
                </div>
                <div style="display:flex;gap:6px;align-items:flex-start">
                  <input class="in" [value]="catLabel()" (input)="catLabel.set(val($event))" [placeholder]="i18n.t('cat_cat_label_ph')" (keyup.enter)="addCategory()">
                  <button (click)="addCategory()" [disabled]="catBusy()" class="btn btn-primary" style="width:auto;padding:10px 16px;border-radius:10px;white-space:nowrap">+ {{ i18n.t('cat_cat_new') }}</button>
                </div>
                @if (catErr()) { <div class="alert-error" style="margin-top:8px">{{ catErr() }}</div> }
              </div>
            }

            @if (showForm()) {
              <div class="panel" style="border:2px solid var(--primary)">
                <div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:12px">{{ editId() ? i18n.t('cat_edit') : i18n.t('cat_new') }}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                  <div class="fld"><label class="lab">{{ i18n.t('cat_label') }} *</label><input class="in" [value]="fLabel()" (input)="fLabel.set(val($event))"></div>
                  <div class="fld"><label class="lab">{{ i18n.t('cat_code') }} *</label><input class="in" [value]="fCode()" (input)="fCode.set(val($event))" [disabled]="!!editId()" placeholder="ex: carte_promote"></div>
                  <div class="fld">
                    <label class="lab">{{ i18n.t('cat_kind') }} *</label>
                    <select class="in" [value]="fKind()" (change)="fKind.set(val($event))"><option value="CARD">CARD</option><option value="BANK">BANK</option></select>
                  </div>
                  <div class="fld">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                      <label class="lab" style="margin:0">{{ i18n.t('cat_group') }}</label>
                      <button type="button" (click)="catQuick.set(!catQuick()); catErr.set('')" class="mini" style="padding:2px 6px">+ {{ i18n.t('cat_cat_new') }}</button>
                    </div>
                    <select class="in" [value]="fGroup()" (change)="fGroup.set(val($event))">
                      <option value="">{{ i18n.t('cat_no_category') }}</option>
                      @for (c of categories(); track c.id) { <option [value]="c.code">{{ c.label }}</option> }
                    </select>
                    @if (catQuick()) {
                      <div style="display:flex;gap:6px;margin-top:6px">
                        <input class="in" [value]="catLabel()" (input)="catLabel.set(val($event))" [placeholder]="i18n.t('cat_cat_label_ph')" (keyup.enter)="saveQuickCategory()">
                        <button type="button" (click)="saveQuickCategory()" [disabled]="catBusy()" class="btn btn-primary" style="width:auto;padding:6px 12px;border-radius:10px;white-space:nowrap">{{ i18n.t('cat_cat_create') }}</button>
                      </div>
                      @if (catErr()) { <div class="alert-error" style="margin-top:6px">{{ catErr() }}</div> }
                    }
                  </div>
                  <div class="fld"><label class="lab">{{ i18n.t('cat_price') }} (F) *</label><input class="in" type="number" inputmode="numeric" [value]="fPrice()" (input)="fPrice.set(val($event))"></div>
                  <div class="fld" style="display:flex;align-items:flex-end;padding-bottom:10px"><label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--label);cursor:pointer"><input type="checkbox" [checked]="fActive()" (change)="fActive.set(chk($event))"> {{ i18n.t('cat_active') }}</label></div>
                  <div class="fld"><label class="lab">{{ i18n.t('cat_max_per_client') }}</label><input class="in" type="number" inputmode="numeric" min="0" [value]="fMaxPerClient()" (input)="fMaxPerClient.set(val($event))" [placeholder]="i18n.t('cat_max_per_client_ph')"><div style="font-size:11px;color:var(--muted);margin-top:3px">{{ i18n.t('cat_max_per_client_hint') }}</div></div>
                </div>
                <div class="fld"><label class="lab">{{ i18n.t('cat_desc') }}</label><textarea class="in" rows="2" [value]="fDesc()" (input)="fDesc.set(val($event))"></textarea></div>

                <!-- Image du produit / package -->
                <div class="fld">
                  <label class="lab">{{ i18n.t('cat_image') }}</label>
                  <div style="display:flex;align-items:center;gap:12px">
                    <div style="width:64px;height:64px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface-3);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center">
                      @if (fImagePreview()) {
                        <img [src]="fImagePreview()" alt="" style="width:100%;height:100%;object-fit:cover">
                      } @else {
                        <svg width="24" height="24" fill="none" stroke="var(--muted-2)" stroke-width="1.6" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                      }
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px">
                      <label class="mini" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;width:fit-content">
                        {{ fImagePreview() ? i18n.t('cat_img_change') : i18n.t('cat_img_add') }}
                        <input type="file" accept="image/*" (change)="onImagePick($event)" hidden>
                      </label>
                      @if (fImagePreview()) {
                        <button type="button" (click)="clearImage()" class="mini" style="color:#DC2626;border-color:#FECACA;width:fit-content">{{ i18n.t('cat_img_remove') }}</button>
                      }
                      <div style="font-size:11px;color:var(--muted)">{{ i18n.t('cat_img_hint') }}</div>
                    </div>
                  </div>
                </div>

                <div style="margin:6px 0 10px">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                    <label class="lab" style="margin:0">{{ i18n.t('cat_components') }}</label>
                    <button (click)="addComponent()" class="mini">+ {{ i18n.t('cat_add_comp') }}</button>
                  </div>
                  @for (c of fComponents(); track $index) {
                    <div style="display:grid;grid-template-columns:1fr 1.4fr 1fr auto;gap:6px;margin-bottom:6px">
                      <input class="in" [value]="c.ckey" (input)="updateComponent($index, 'ckey', val($event))" [placeholder]="i18n.t('cat_comp_key')">
                      <input class="in" [value]="c.label" (input)="updateComponent($index, 'label', val($event))" [placeholder]="i18n.t('cat_comp_label')">
                      <input class="in" type="number" [value]="c.amount" (input)="updateComponent($index, 'amount', val($event))" [placeholder]="i18n.t('cat_price')">
                      <button (click)="removeComponent($index)" class="mini" style="color:#DC2626;border-color:#FECACA">✕</button>
                    </div>
                  }
                  @if (fComponents().length) { <div style="font-size:11px;color:var(--muted)">{{ i18n.t('cat_comp_hint') }}</div> }
                </div>

                @if (formErr()) { <div class="alert-error" style="margin-bottom:10px">{{ formErr() }}</div> }
                <div style="display:flex;gap:8px">
                  <button (click)="saveProduct()" [disabled]="formBusy()" class="btn btn-primary" style="width:auto;padding:10px 18px;border-radius:10px">{{ i18n.t('cat_save') }}</button>
                  <button (click)="cancelForm()" class="btn-soft" style="border-radius:10px">{{ i18n.t('cat_cancel') }}</button>
                </div>
              </div>
            }

            @for (p of liveProducts(); track p.id) {
              <div class="row">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
                  <div style="min-width:0">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                      <span style="font-size:14px;font-weight:700;color:var(--navy)">{{ p.label }}</span>
                      <span class="codechip">{{ p.code }}</span>
                      @if (p.builtin) { <span class="off" style="background:#EFF6FF;color:#2563EB">système</span> }
                    </div>
                    <div style="font-size:11px;color:var(--muted);margin-top:2px">
                      {{ kindLabel(p.kind) }} · {{ p.groupCode ? categoryLabel(p.groupCode) : '—' }} ·
                      <span [style.color]="p.active ? '#059669' : 'var(--muted)'" style="font-weight:700">{{ p.active ? i18n.t('cat_active') : i18n.t('cat_inactive') }}</span>
                    </div>
                  </div>
                  <div style="text-align:right;white-space:nowrap">
                    @if (hasPromo(p)) { <span style="font-size:12px;color:var(--muted-2);text-decoration:line-through;margin-right:6px">{{ money(p.basePrice) }}</span> }
                    <span style="font-size:15px;font-weight:800;color:var(--primary)">{{ money(p.effectivePrice) }}</span>
                  </div>
                </div>

                <!-- PROMOTIONS -->
                <div style="margin-top:10px;border-top:1px solid var(--surface-3);padding-top:8px">
                  <div style="font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.5px;margin-bottom:6px">{{ i18n.t('cat_promotions') }}</div>
                  @for (pr of p.promotions; track pr.id) {
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
                      <span class="badge" [style.background]="pr.active ? '#DCFCE7' : 'var(--surface-3)'" [style.color]="pr.active ? '#059669' : 'var(--muted)'">{{ pr.active ? i18n.t('cat_active') : 'off' }}</span>
                      <span style="font-weight:700;color:var(--primary);font-size:12px">{{ promoValue(pr) }}</span>
                      <span style="font-size:12px;color:var(--navy)">{{ pr.label }}</span>
                      @if (pr.startDate || pr.endDate) { <span style="font-size:11px;color:var(--muted)">({{ pr.startDate || '…' }} → {{ pr.endDate || '…' }})</span> }
                      <span style="flex:1"></span>
                      <button (click)="togglePromo(pr)" class="mini">on/off</button>
                      <button (click)="removePromo(pr)" class="mini" style="color:#DC2626;border-color:#FECACA">×</button>
                    </div>
                  }
                  @if (!p.promotions?.length) { <div style="font-size:11px;color:var(--muted)">{{ i18n.t('cat_no_promo') }}</div> }
                </div>

                <!-- PROMO FORM -->
                @if (promoFor() === p.id) {
                  <div class="panel" style="margin-top:8px;background:var(--surface-2)">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                      <div class="fld"><label class="lab">{{ i18n.t('cat_promo_type') }}</label><select class="in" [value]="pType()" (change)="pType.set(val($event))"><option value="PERCENT">{{ i18n.t('cat_percent') }}</option><option value="PRICE">{{ i18n.t('cat_promo_price') }}</option></select></div>
                      <div class="fld"><label class="lab">{{ pType() === 'PERCENT' ? i18n.t('cat_discount') : i18n.t('cat_promo_price') }}</label><input class="in" type="number" [value]="pValue()" (input)="pValue.set(val($event))"></div>
                      <div class="fld" style="grid-column:1/3"><label class="lab">{{ i18n.t('cat_promo_label') }}</label><input class="in" [value]="pLabel()" (input)="pLabel.set(val($event))" [placeholder]="i18n.t('cat_promo_label_ph')"></div>
                      <div class="fld"><label class="lab">{{ i18n.t('cat_promo_start') }}</label><input class="in" type="date" [value]="pStart()" (input)="pStart.set(val($event))"></div>
                      <div class="fld"><label class="lab">{{ i18n.t('cat_promo_end') }}</label><input class="in" type="date" [value]="pEnd()" (input)="pEnd.set(val($event))"></div>
                    </div>
                    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--label);margin-bottom:10px;cursor:pointer"><input type="checkbox" [checked]="pActive()" (change)="pActive.set(chk($event))"> {{ i18n.t('cat_active') }}</label>
                    @if (promoErr()) { <div class="alert-error" style="margin-bottom:8px">{{ promoErr() }}</div> }
                    <div style="display:flex;gap:8px">
                      <button (click)="savePromo(p)" [disabled]="promoBusy()" class="btn btn-primary" style="width:auto;padding:8px 16px;border-radius:10px">{{ i18n.t('cat_promo_save') }}</button>
                      <button (click)="promoFor.set(null)" class="btn-soft" style="border-radius:10px">{{ i18n.t('cat_cancel') }}</button>
                    </div>
                  </div>
                }

                <!-- ACTIONS -->
                <div style="display:flex;gap:6px;margin-top:10px;align-items:center;flex-wrap:wrap">
                  <button (click)="toggleActive(p)" class="mini">{{ p.active ? i18n.t('cat_deactivate') : i18n.t('cat_activate') }}</button>
                  <button (click)="editProduct(p)" class="mini">✎ {{ i18n.t('adm_edit') }}</button>
                  <button (click)="openPromo(p)" class="mini">+ {{ i18n.t('cat_promo') }}</button>
                  <span style="flex:1"></span>
                  <button (click)="archiveProduct(p)" class="mini" style="color:#B45309;border-color:#FDE68A">{{ i18n.t('cat_archive') }}</button>
                  @if (!p.builtin) { <button (click)="removeProduct(p)" class="mini" style="color:#DC2626;border-color:#FECACA">{{ i18n.t('cat_delete') }}</button> }
                </div>
              </div>
            }

            <!-- ARCHIVED PRODUCTS -->
            @if (archivedProducts().length) {
              <button (click)="showArchived.set(!showArchived())" class="mini" style="align-self:flex-start;margin-top:6px">
                {{ showArchived() ? '▾' : '▸' }} {{ i18n.t('cat_archived') }} ({{ archivedProducts().length }})
              </button>
              @if (showArchived()) {
                @for (p of archivedProducts(); track p.id) {
                  <div class="row" style="opacity:.75;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
                    <div style="min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                      <span style="font-size:13px;font-weight:700;color:var(--navy)">{{ p.label }}</span>
                      <span class="codechip">{{ p.code }}</span>
                      <span class="off" style="background:#FEF3C7;color:#B45309">{{ i18n.t('cat_archived_badge') }}</span>
                      @if (p.builtin) { <span class="off" style="background:#EFF6FF;color:#2563EB">système</span> }
                    </div>
                    <div style="display:flex;gap:6px;align-items:center">
                      <button (click)="unarchiveProduct(p)" class="mini" style="color:#059669;border-color:#A7F3D0">{{ i18n.t('cat_unarchive') }}</button>
                      @if (!p.builtin) { <button (click)="removeProduct(p)" class="mini" style="color:#DC2626;border-color:#FECACA">{{ i18n.t('cat_delete') }}</button> }
                    </div>
                  </div>
                }
              }
            }
          </div>
        }

        <!-- COMMISSIONS -->
        @if (tab() === 'commissions') {
          <div class="fade-in">
            <div style="display:flex;gap:2px;margin-bottom:14px;border-bottom:2px solid var(--surface-3)">
              <button (click)="commSub.set('rules')" class="tab" [class.tab-on]="commSub() === 'rules'">{{ i18n.t('mgr_rules') }} ({{ rules().length }})</button>
              <button (click)="commSub.set('entries'); loadEntries()" class="tab" [class.tab-on]="commSub() === 'entries'">{{ i18n.t('mgr_entries') }}</button>
            </div>
            @if (commSub() === 'rules') {
              <div style="display:flex;flex-direction:column;gap:6px">
                @for (r of rules(); track r.id) {
                  <div class="row">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                      <div><div style="font-size:13px;font-weight:700;color:var(--navy)">{{ r.scopeType }} {{ r.scopeCode }}</div><div style="font-size:11px;color:var(--muted)">{{ r.targetType }} {{ r.targetValue }}</div></div>
                      <div style="text-align:right"><span style="font-size:15px;font-weight:800;color:var(--primary)">{{ r.rateType === 'percent' ? r.rateValue + '%' : money(r.rateValue) }}</span>@if (!r.active) { <span class="off">off</span> }</div>
                    </div>
                  </div>
                }
                @if (rules().length === 0) { <div class="empty">{{ i18n.t('adm_no_data') }}</div> }
              </div>
            } @else {
              <div style="display:flex;flex-direction:column;gap:6px">
                @for (e of entries(); track e.id) {
                  <div class="row">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                      <div><span class="mono" style="font-size:12px;font-weight:700;color:var(--navy)">{{ e.saleRef }}</span><div style="font-size:11px;color:var(--muted)">{{ e.beneficiaryName }} · {{ e.productCode }}</div></div>
                      <span style="font-size:14px;font-weight:800;color:#059669">{{ money(e.amount) }}</span>
                    </div>
                  </div>
                }
                @if (entries().length === 0) { <div class="empty">{{ i18n.t('adm_no_data') }}</div> }
              </div>
            }
          </div>
        }

        <!-- HIERARCHY -->
        @if (tab() === 'hierarchy') {
          <div class="fade-in">
            @if (hier()) {
              <div class="kpis">
                <div class="kpi"><div class="kv">{{ hier()!.totalSubscriptions }}</div><div class="kl">{{ i18n.t('mgr_total_subs') }}</div></div>
                <div class="kpi"><div class="kv" style="color:var(--primary)">{{ money(hier()!.totalSubscriptionsAmount) }}</div><div class="kl">{{ i18n.t('mgr_total_amount') }}</div></div>
                <div class="kpi"><div class="kv" style="color:#2563EB">{{ hier()!.totalCollectes }}</div><div class="kl">{{ i18n.t('mgr_total_collectes') }}</div></div>
                <div class="kpi"><div class="kv" style="color:#059669">{{ money(hier()!.totalCommissions) }}</div><div class="kl">{{ i18n.t('mgr_total_comm') }}</div></div>
              </div>
            }
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 4px">
              <div style="display:flex;align-items:center;gap:10px">
                <div style="font-size:16px;font-weight:800;color:var(--navy)">{{ i18n.t('mgr_org') }}</div>
                @if (assignFlash()) { <span class="alert-success" style="margin:0;padding:4px 10px;font-size:12px">✓ {{ i18n.t('team_reassigned') }}</span> }
              </div>
              @if (editable()) { <button (click)="openTeamForm()" class="btn btn-primary" style="width:auto;padding:8px 14px;border-radius:10px">+ {{ i18n.t('mgr_new_team') }}</button> }
            </div>
            @if (editable()) { <div style="font-size:12px;color:var(--muted);margin-bottom:14px">{{ i18n.t('mgr_org_build_hint') }}</div> }

            <!-- CREATE TEAM -->
            @if (showTeamForm()) {
              <div class="panel" style="border:2px solid var(--primary);margin-bottom:14px">
                <div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:12px">{{ i18n.t('mgr_new_team') }}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                  <div class="fld">
                    <label class="lab">{{ i18n.t('mgr_team_lead') }} *</label>
                    <select class="in" [value]="tLead()" (change)="tLead.set(val($event))">
                      <option value="">—</option>
                      @for (m of pool(); track m.id) { <option [value]="m.id">{{ m.name }} · {{ roleLabel(m.role) }}</option> }
                    </select>
                  </div>
                  <div class="fld">
                    <label class="lab">{{ i18n.t('mgr_attach_under') }}</label>
                    <select class="in" [value]="tParent()" (change)="tParent.set(val($event))">
                      <option value="">{{ i18n.t('mgr_top_level') }}</option>
                      @for (n of parentCandidates(); track n.id) { <option [value]="n.id">{{ n.name }} · {{ roleLabel(n.role) }}</option> }
                    </select>
                  </div>
                </div>
                <div class="fld">
                  <label class="lab">{{ i18n.t('mgr_members') }} ({{ tMembers().length }})</label>
                  <div style="max-height:180px;overflow:auto;border:1.5px solid var(--border);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:4px">
                    @for (m of pool(); track m.id) {
                      @if (m.id !== tLead()) {
                        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--navy);cursor:pointer">
                          <input type="checkbox" [checked]="tMembers().includes(m.id)" (change)="toggleMember(m.id)">
                          {{ m.name }} <span style="color:var(--muted);font-size:11px">· {{ roleLabel(m.role) }}</span>
                        </label>
                      }
                    }
                    @if (pool().length === 0) { <div style="font-size:11px;color:var(--muted)">{{ i18n.t('mgr_no_pool') }}</div> }
                  </div>
                </div>
                @if (teamErr()) { <div class="alert-error" style="margin-bottom:10px">{{ teamErr() }}</div> }
                <div style="display:flex;gap:8px">
                  <button (click)="createTeam()" [disabled]="teamBusy()" class="btn btn-primary" style="width:auto;padding:10px 18px;border-radius:10px">{{ i18n.t('mgr_create_team') }}</button>
                  <button (click)="showTeamForm.set(false)" class="btn-soft" style="border-radius:10px">{{ i18n.t('cat_cancel') }}</button>
                </div>
              </div>
            }

            <div cdkDropListGroup style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
              <!-- ORG TREE (drop targets) -->
              <div style="flex:1;min-width:280px;display:flex;flex-direction:column;gap:6px">
                @for (n of treeNodes(); track n.id) {
                  <div cdkDropList [cdkDropListData]="n" (cdkDropListDropped)="onDrop($event)"
                       (cdkDropListEntered)="onEnter(n.id)" (cdkDropListExited)="onLeave(n.id)"
                       class="orgnode dropzone" [class.dropover]="hoverId() === n.id"
                       [style.marginLeft.px]="n.depth * 24" [style.borderLeftColor]="roleColor(n.role)">
                    @if (n.movable) {
                      <div cdkDrag [cdkDragData]="n" class="nodecard">
                        <div class="ava" [style.background]="roleColor(n.role)">{{ initial(n.name) }}</div>
                        <div style="min-width:0;flex:1">
                          <div style="font-size:13px;font-weight:700;color:var(--navy)">{{ n.name }}</div>
                          <div style="font-size:11px;color:var(--muted)">{{ roleLabel(n.role) }}{{ isLead(n) ? ' · ' + i18n.t('mgr_team_badge') : '' }}</div>
                          @if (hasRollup(n.id)) { <div class="rollup">{{ rollupLine(n.id) }}</div> }
                        </div>
                        @if (isLead(n)) {
                          <button (click)="dissolveTeam(n)" [disabled]="busyAssign()" class="mini" style="color:#B45309;border-color:#FDE68A" [title]="i18n.t('mgr_dissolve')">✕ {{ i18n.t('mgr_team_short') }}</button>
                        }
                        <button (click)="detachMember(n)" [disabled]="busyAssign()" class="mini" style="color:#DC2626;border-color:#FECACA" [title]="i18n.t('mgr_detach')">{{ i18n.t('mgr_detach_short') }}</button>
                        <span class="grip">⠿</span>
                      </div>
                    } @else {
                      <div class="nodecard">
                        <div class="ava" [style.background]="roleColor(n.role)">{{ initial(n.name) }}</div>
                        <div style="min-width:0;flex:1">
                          <div style="font-size:13px;font-weight:700;color:var(--navy)">{{ n.name }}</div>
                          <div style="font-size:11px;color:var(--muted)">{{ roleLabel(n.role) }}</div>
                          @if (hasRollup(n.id)) { <div class="rollup">{{ rollupLine(n.id) }}</div> }
                        </div>
                      </div>
                    }
                  </div>
                }
                @if (treeNodes().length === 0) { <div class="empty">{{ i18n.t('adm_no_data') }}</div> }
              </div>

              <!-- POOL (unassigned staff, drag source + detach target) -->
              @if (editable()) {
                <div style="width:250px;flex-shrink:0">
                  <div style="font-size:12px;font-weight:800;color:var(--navy);margin-bottom:8px">{{ i18n.t('team_pool') }} ({{ pool().length }})</div>
                  <div cdkDropList [cdkDropListData]="null" (cdkDropListDropped)="onDrop($event)"
                       (cdkDropListEntered)="onEnter('__pool__')" (cdkDropListExited)="onLeave('__pool__')"
                       class="pool dropzone" [class.dropover]="hoverId() === '__pool__'">
                    @for (m of pool(); track m.id) {
                      <div cdkDrag [cdkDragData]="m" class="poolcard">
                        <div class="ava" [style.background]="roleColor(m.role)">{{ initial(m.name) }}</div>
                        <div style="min-width:0">
                          <div style="font-size:12px;font-weight:700;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ m.name }}</div>
                          <div style="font-size:10px;color:var(--muted)">{{ roleLabel(m.role) }}</div>
                        </div>
                      </div>
                    }
                    @if (pool().length === 0) { <div style="font-size:11px;color:var(--muted);text-align:center;padding:18px 6px">{{ i18n.t('team_pool_empty') }}</div> }
                  </div>
                </div>
              }
            </div>
          </div>
        }

        <!-- TEAM -->
        @if (tab() === 'team') {
          <div class="fade-in">
            <div class="panel" style="margin-bottom:16px">
              <div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:12px">{{ i18n.t('team_message') }}</div>
              <div class="fld"><label class="lab">{{ i18n.t('team_subject') }}</label><input class="in" [value]="msgTitle()" (input)="msgTitle.set(val($event))"></div>
              <div class="fld"><label class="lab">{{ i18n.t('team_body') }}</label><textarea class="in" rows="3" [value]="msgBody()" (input)="msgBody.set(val($event))"></textarea></div>
              @if (msgSent()) { <div class="alert-success" style="margin-bottom:10px">✓ {{ i18n.t('team_sent') }}</div> }
              <button (click)="sendMsg()" class="btn btn-primary" style="width:auto;padding:10px 18px;border-radius:10px">{{ i18n.t('team_send') }}</button>
            </div>
            <div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:8px">{{ i18n.t('team_roster') }} ({{ roster().length }})</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              @for (m of roster(); track m.id) {
                <div class="row"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:13px;font-weight:700;color:var(--navy)">{{ m.name }}</div><div style="font-size:11px;color:var(--muted)">{{ m.agency }}</div></div><span class="rolechip">{{ m.role }}</span></div></div>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display:flex;flex:1;flex-direction:column }
    .tabs { display:flex;gap:2px;margin-bottom:20px;border-bottom:2px solid var(--surface-3);overflow-x:auto }
    .tab { padding:10px 12px;border:none;background:none;font-size:12px;font-weight:700;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-2px;white-space:nowrap }
    .tab-on { color:var(--primary);border-bottom-color:var(--primary) }
    .row { background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .kpis { display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:20px }
    .kpi { background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .kv { font-size:20px;font-weight:800;color:var(--navy) }
    .kl { font-size:11px;color:var(--muted);margin-top:2px }
    .panel { background:#fff;border-radius:14px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.04);border:1px solid var(--surface-3) }
    .fld { margin-bottom:12px } .lab { display:block;font-size:12px;font-weight:600;color:var(--label);margin-bottom:4px }
    .in { width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;background:var(--surface-2);font-family:inherit }
    .promo { padding:2px 6px;border-radius:4px;background:#FEF2F2;color:var(--primary);font-size:10px;font-weight:700 }
    .off { padding:2px 6px;border-radius:4px;background:var(--surface-3);color:var(--muted);font-size:10px;font-weight:700;margin-left:4px }
    .rolechip { padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;background:var(--surface-3);color:var(--label) }
    .empty { text-align:center;color:var(--muted);padding:24px }
    .mini { padding:4px 10px;border-radius:8px;border:1.5px solid var(--border);background:#fff;font-size:12px;font-weight:700;cursor:pointer;color:var(--navy) }
    .btn-soft { padding:10px 16px;border:1.5px solid var(--border);background:#fff;font-size:13px;font-weight:700;cursor:pointer;color:var(--navy) }
    .codechip { font-family:ui-monospace,monospace;font-size:10px;font-weight:700;background:var(--surface-3);color:var(--muted);padding:2px 6px;border-radius:4px }
    .badge { padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700 }
    .orgnode { display:flex;align-items:center;gap:10px;background:#fff;border-radius:12px;padding:10px 14px;box-shadow:0 1px 3px rgba(0,0,0,.04);border:1px solid var(--surface-3);border-left:4px solid var(--primary) }
    .dropzone { transition:box-shadow .12s ease, background .12s ease }
    .dropover { box-shadow:0 0 0 2px var(--primary) inset, 0 4px 12px rgba(0,0,0,.08); background:var(--surface-2) }
    .nodecard { display:flex;align-items:center;gap:10px;width:100%;min-width:0 }
    .rollup { font-size:10.5px;font-weight:700;color:#475569;margin-top:3px;letter-spacing:.2px }
    .nodecard.cdk-drag { cursor:grab } .nodecard.cdk-drag:active { cursor:grabbing }
    .ava { width:30px;height:30px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff }
    .grip { margin-left:auto;color:var(--muted-2);font-size:15px;line-height:1;flex-shrink:0 }
    .pool { display:flex;flex-direction:column;gap:6px;min-height:90px;padding:10px;border:1.5px dashed var(--border);border-radius:12px;background:var(--surface-2) }
    .poolcard { display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--surface-3);border-radius:10px;padding:8px 10px;cursor:grab }
    .poolcard.cdk-drag:active { cursor:grabbing }
    .cdk-drag-preview { box-shadow:0 8px 22px rgba(0,0,0,.20);border-radius:12px;background:#fff;padding:10px 14px;display:flex;align-items:center;gap:10px;border:1px solid var(--surface-3) }
    .cdk-drag-placeholder { opacity:.35 }
    .cdk-drag-animating { transition:transform .2s cubic-bezier(0,0,.2,1) }
    .cdk-drop-list-dragging .cdk-drag:not(.cdk-drag-placeholder) { transition:transform .2s cubic-bezier(0,0,.2,1) }
  `],
})
export class ManagerPage {
  protected i18n = inject(I18n);
  private api = inject(Api);
  private auth = inject(Auth);
  tabs: Tab[] = ['catalogue', 'commissions', 'hierarchy', 'team'];

  tab = signal<Tab>('catalogue');
  products = signal<ProductDto[]>([]);
  rules = signal<CommissionRuleDto[]>([]);
  entries = signal<CommissionEntryDto[]>([]);
  hier = signal<HierarchyStatsDto | null>(null);
  roster = signal<TeamMemberDto[]>([]);
  // hierarchy org builder (drag-and-drop)
  org = signal<OrgViewDto | null>(null);
  hoverId = signal<string | null>(null);
  busyAssign = signal(false);
  assignFlash = signal(false);
  // team-creation form (org tab)
  showTeamForm = signal(false);
  tLead = signal('');            // chosen team lead (from the pool)
  tParent = signal('');          // node to attach the team under ('' = top / caller root)
  tMembers = signal<string[]>([]); // pool members to place under the lead
  teamErr = signal(''); teamBusy = signal(false);
  commSub = signal<'rules' | 'entries'>('rules');
  msgTitle = signal(''); msgBody = signal(''); msgSent = signal(false);
  // product CRUD form state
  showForm = signal(false);
  editId = signal<number | null>(null);
  fCode = signal(''); fLabel = signal(''); fDesc = signal(''); fGroup = signal('');
  fKind = signal('CARD'); fPrice = signal('0'); fActive = signal(true);
  // Plafond d'achats par client : '' = valeur globale par défaut ; '0' = illimité ; >0 = plafond.
  fMaxPerClient = signal('');
  fComponents = signal<ProductComponentDto[]>([]);
  // Image produit : fImageData = nouvelle image (dataURL) à téléverser ; fImagePreview = aperçu affiché
  // (dataURL de la nouvelle image OU URL de l'image existante). fImageRemove = suppression demandée.
  fImageData = signal<string | null>(null);
  fImagePreview = signal<string | null>(null);
  fImageRemove = signal(false);
  formErr = signal(''); formBusy = signal(false);
  showArchived = signal(false);
  // product categories
  categories = signal<ProductCategoryDto[]>([]);
  showCatMgr = signal(false);
  catQuick = signal(false);            // inline quick-create toggle inside the product form
  catLabel = signal(''); catErr = signal(''); catBusy = signal(false);
  // promotion form state (per product)
  promoFor = signal<number | null>(null);
  pType = signal('PERCENT'); pValue = signal('10'); pLabel = signal('');
  pStart = signal(''); pEnd = signal(''); pActive = signal(true);
  promoErr = signal(''); promoBusy = signal(false);

  constructor() {
    this.api.products().subscribe({ next: (l) => this.products.set(l), error: () => {} });
    this.loadCategories();
    if (!this.auth.user()) this.auth.refreshMe().subscribe({ error: () => {} });
  }

  val(e: Event) { return (e.target as HTMLInputElement | HTMLTextAreaElement).value; }
  chk(e: Event) { return (e.target as HTMLInputElement).checked; }
  money = (n: number) => fcfa(n);
  hasPromo = (p: ProductDto) => p.effectivePrice < p.basePrice || (p.promotions?.some((x) => x.active) ?? false);

  // ---- product categories (ADMIN / MANAGER) ----
  private loadCategories() {
    this.api.productCategories().subscribe({ next: (l) => this.categories.set(l), error: () => {} });
  }
  /** Create a category from a label (backend derives the code). onDone receives the new code. */
  private createCategory(label: string, onDone?: (code: string) => void) {
    const l = label.trim();
    if (!l) { this.catErr.set(this.i18n.t('cat_required')); return; }
    this.catBusy.set(true); this.catErr.set('');
    // `active`/`subscriptionVisible`/`sortOrder` doivent être envoyés explicitement : côté backend
    // ce sont des primitifs, donc absents du JSON ils valent `false`/`0` — la catégorie naîtrait
    // inactive, invisible dans le tunnel, et passerait devant toutes les autres dans les filtres.
    const sortOrder = Math.max(0, ...this.categories().map((c) => c.sortOrder)) + 1;
    this.api.createCategory({ code: l, label: l, active: true, subscriptionVisible: true, sortOrder }).subscribe({
      next: (c) => {
        this.catBusy.set(false);
        this.categories.set([...this.categories().filter((x) => x.id !== c.id), c]
          .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)));
        onDone?.(c.code);
      },
      error: (e) => { this.catBusy.set(false); this.catErr.set(this.productError(e?.error?.message || e?.error?.error)); },
    });
  }
  /** Quick-create from inside the product form, then select the new category. */
  saveQuickCategory() {
    this.createCategory(this.catLabel(), (code) => {
      this.fGroup.set(code); this.catLabel.set(''); this.catQuick.set(false);
    });
  }
  /** Create from the dedicated category-management section. */
  addCategory() {
    this.createCategory(this.catLabel(), () => this.catLabel.set(''));
  }
  removeCategory(c: ProductCategoryDto) {
    if (!confirm(this.i18n.t('cat_cat_confirm_delete').replace('{name}', c.label))) return;
    this.api.deleteCategory(c.id).subscribe({
      next: () => this.categories.set(this.categories().filter((x) => x.id !== c.id)),
      error: (e) => alert(this.productError(e?.error?.message || e?.error?.error)),
    });
  }
  categoryLabel = (code: string) => this.categories().find((c) => c.code === code)?.label || code;

  // ---- product CRUD (ADMIN / MANAGER) ----
  groupCodes = () => Array.from(new Set(this.products().map((p) => p.groupCode).filter(Boolean)));

  newProduct() {
    this.editId.set(null); this.formErr.set('');
    this.fCode.set(''); this.fLabel.set(''); this.fDesc.set(''); this.fGroup.set('');
    this.fKind.set('CARD'); this.fPrice.set('0'); this.fActive.set(true); this.fComponents.set([]);
    this.fMaxPerClient.set('');
    this.fImageData.set(null); this.fImagePreview.set(null); this.fImageRemove.set(false);
    this.showForm.set(true);
  }
  editProduct(p: ProductDto) {
    this.editId.set(p.id); this.formErr.set('');
    this.fCode.set(p.code); this.fLabel.set(p.label); this.fDesc.set(p.description || '');
    this.fGroup.set(p.groupCode || ''); this.fKind.set(p.kind); this.fPrice.set(String(p.basePrice));
    this.fActive.set(p.active); this.fComponents.set((p.components || []).map((c) => ({ ...c })));
    this.fMaxPerClient.set(p.maxPerClient == null ? '' : String(p.maxPerClient));
    this.fImageData.set(null); this.fImageRemove.set(false);
    // Aperçu de l'image existante (cache-buster = id du produit pour rafraîchir après remplacement)
    this.fImagePreview.set(p.imageKey ? this.api.productImageUrl(p.id, p.id) : null);
    this.showForm.set(true);
  }
  cancelForm() { this.showForm.set(false); this.formErr.set(''); }

  /** Sélection d'un fichier image -> dataURL base64 pour aperçu + téléversement à la sauvegarde. */
  onImagePick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { this.formErr.set(this.i18n.t('cat_img_invalid')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      this.fImageData.set(url); this.fImagePreview.set(url); this.fImageRemove.set(false);
    };
    reader.readAsDataURL(file);
  }
  clearImage() {
    this.fImageData.set(null); this.fImagePreview.set(null);
    // Si le produit édité avait déjà une image, on demande sa suppression côté backend.
    this.fImageRemove.set(this.editId() != null);
  }

  addComponent() { this.fComponents.set([...this.fComponents(), { ckey: '', label: '', amount: 0 }]); }
  removeComponent(i: number) { this.fComponents.set(this.fComponents().filter((_, idx) => idx !== i)); }
  updateComponent(i: number, field: 'ckey' | 'label' | 'amount', value: string) {
    this.fComponents.set(this.fComponents().map((c, idx) => idx !== i ? c
      : { ...c, [field]: field === 'amount' ? Math.round(+value || 0) : value }));
  }

  saveProduct() {
    this.formErr.set('');
    const label = this.fLabel().trim();
    const code = this.fCode().trim();
    if (!label || !code) { this.formErr.set(this.i18n.t('cat_required')); return; }
    const req: ProductRequest = {
      code, label,
      description: this.fDesc().trim() || undefined,
      groupCode: this.fGroup().trim() || undefined,
      kind: this.fKind(),
      basePrice: Math.round(+this.fPrice() || 0),
      active: this.fActive(),
      maxPerClient: this.parseMaxPerClient(),
      components: this.fComponents()
        .filter((c) => c.ckey.trim() || c.label.trim())
        .map((c) => ({ ckey: c.ckey.trim(), label: c.label.trim(), amount: Math.round(c.amount || 0) })),
    };
    this.formBusy.set(true);
    const id = this.editId();
    const call = id ? this.api.updateProduct(id, req) : this.api.createProduct(req);
    call.subscribe({
      next: (p) => {
        // Le backend persiste désormais les composants (contenu du package) dès le CREATE, mais on
        // garde l'enchaînement create -> update : il est idempotent et reste compatible avec un
        // backend antérieur, qui les ignorait à la création.
        const needComponents = id == null && (req.components?.length ?? 0) > 0;
        const afterComponents = needComponents ? this.api.updateProduct(p.id, req) : null;
        const proceed = (prod: ProductDto) => {
          // Puis applique l'éventuel changement d'image (upload ou suppression).
          const data = this.fImageData();
          const imgOp = data
            ? this.api.uploadProductImage(prod.id, data)
            : (this.fImageRemove() ? this.api.deleteProductImage(prod.id) : null);
          if (imgOp) {
            imgOp.subscribe({
              next: (withImg) => this.finishSave(withImg, id != null),
              error: () => this.finishSave(prod, id != null), // produit sauvé, image en échec : on garde le produit
            });
          } else {
            this.finishSave(prod, id != null);
          }
        };
        if (afterComponents) {
          afterComponents.subscribe({ next: (withComp) => proceed(withComp), error: () => proceed(p) });
        } else {
          proceed(p);
        }
      },
      error: (e) => { this.formBusy.set(false); this.formErr.set(this.productError(e?.error?.message || e?.error?.error)); },
    });
  }
  private finishSave(p: ProductDto, isEdit: boolean) {
    this.formBusy.set(false); this.showForm.set(false);
    this.fImageData.set(null); this.fImageRemove.set(false);
    if (isEdit) this.products.set(this.products().map((x) => (x.id === p.id ? p : x)));
    else this.products.set([...this.products(), p]);
  }
  /** '' (vide) → null : hérite du plafond global. Sinon un entier ≥ 0 (0 = illimité). */
  private parseMaxPerClient(): number | null {
    const raw = this.fMaxPerClient().trim();
    if (raw === '') return null;
    return Math.max(0, Math.round(+raw || 0));
  }
  removeProduct(p: ProductDto) {
    if (!confirm(this.i18n.t('cat_confirm_delete').replace('{name}', p.label))) return;
    this.api.deleteProduct(p.id).subscribe({
      next: () => this.products.set(this.products().filter((x) => x.id !== p.id)),
      error: (e) => alert(this.productError(e?.error?.message || e?.error?.error)),
    });
  }
  liveProducts = () => this.products().filter((p) => !p.archived);
  archivedProducts = () => this.products().filter((p) => p.archived);
  archiveProduct(p: ProductDto) {
    if (!confirm(this.i18n.t('cat_confirm_archive').replace('{name}', p.label))) return;
    this.api.archiveProduct(p.id).subscribe({
      next: (u) => this.products.set(this.products().map((x) => (x.id === u.id ? u : x))),
      error: (e) => alert(this.productError(e?.error?.message || e?.error?.error)),
    });
  }
  unarchiveProduct(p: ProductDto) {
    this.api.unarchiveProduct(p.id).subscribe({
      next: (u) => this.products.set(this.products().map((x) => (x.id === u.id ? u : x))),
      error: (e) => alert(this.productError(e?.error?.message || e?.error?.error)),
    });
  }
  private productError(code?: string): string {
    return {
      code_exists: 'Ce code existe déjà',
      builtin_product: 'Produit système : non modifiable/supprimable',
      product_not_found: 'Produit introuvable',
      product_in_use: 'Produit lié à des ventes/commissions : archivez-le plutôt que de le supprimer',
      unknown_category: 'Catégorie inconnue — sélectionnez une catégorie existante',
      builtin_category: 'Catégorie système : non supprimable',
      category_has_products: 'Catégorie utilisée par des produits : réaffectez-les d’abord',
      invalid_code: 'Libellé/code invalide',
      invalid_kind: 'Type invalide (CARD ou BANK)',
    }[code || ''] || code || 'Erreur';
  }
  private reloadProducts() { this.api.products().subscribe({ next: (l) => this.products.set(l), error: () => {} }); }

  kindLabel(kind: string): string {
    return { CARD: 'Carte physique', BANK: 'Produit bancaire' }[kind] || kind;
  }
  private asRequest(p: ProductDto): ProductRequest {
    return {
      code: p.code, label: p.label, description: p.description || undefined,
      groupCode: p.groupCode || undefined, kind: p.kind, basePrice: p.basePrice,
      active: p.active, maxPerClient: p.maxPerClient, components: p.components || [],
    };
  }
  toggleActive(p: ProductDto) {
    this.api.updateProduct(p.id, { ...this.asRequest(p), active: !p.active })
      .subscribe({ next: () => this.reloadProducts(), error: (e) => alert(this.productError(e?.error?.message || e?.error?.error)) });
  }

  // ---- promotions ----
  promoValue(pr: PromotionDto): string {
    return pr.type === 'PERCENT' ? `-${pr.value}%` : this.money(pr.value);
  }
  openPromo(p: ProductDto) {
    this.promoErr.set('');
    this.promoFor.set(this.promoFor() === p.id ? null : p.id);
    this.pType.set('PERCENT'); this.pValue.set('10'); this.pLabel.set('');
    this.pStart.set(''); this.pEnd.set(''); this.pActive.set(true);
  }
  savePromo(p: ProductDto) {
    this.promoErr.set('');
    const value = Math.round(+this.pValue() || 0);
    if (value <= 0) { this.promoErr.set(this.i18n.t('cat_promo_value_req')); return; }
    if (this.pType() === 'PERCENT' && value > 100) { this.promoErr.set(this.i18n.t('cat_promo_pct_max')); return; }
    if (this.pStart() && this.pEnd() && this.pStart() > this.pEnd()) { this.promoErr.set(this.i18n.t('cat_promo_dates')); return; }
    const req: PromotionRequest = {
      label: this.pLabel().trim() || undefined, type: this.pType(), value,
      startDate: this.pStart() || null, endDate: this.pEnd() || null, active: this.pActive(),
    };
    this.promoBusy.set(true);
    this.api.addPromotion(p.id, req).subscribe({
      next: () => { this.promoBusy.set(false); this.promoFor.set(null); this.reloadProducts(); },
      error: (e) => { this.promoBusy.set(false); this.promoErr.set(this.productError(e?.error?.message || e?.error?.error)); },
    });
  }
  togglePromo(pr: PromotionDto) {
    const req: PromotionRequest = {
      label: pr.label || undefined, type: pr.type, value: pr.value,
      startDate: pr.startDate || null, endDate: pr.endDate || null, active: !pr.active,
    };
    this.api.updatePromotion(pr.id, req).subscribe({ next: () => this.reloadProducts(), error: () => {} });
  }
  removePromo(pr: PromotionDto) {
    if (!confirm(this.i18n.t('cat_promo_confirm_del'))) return;
    this.api.deletePromotion(pr.id).subscribe({ next: () => this.reloadProducts(), error: () => {} });
  }

  // ---- hierarchy org builder (root = caller, sub-tree from GET /api/team/org) ----
  editable = computed(() => this.auth.hasRole('ADMIN', 'MANAGER', 'SUPERVISEUR', 'CHEF_EQUIPE'));
  pool = computed<TeamMemberDto[]>(() => this.org()?.pool ?? []);
  treeNodes = computed<TreeNode[]>(() => {
    const o = this.org();
    if (!o) return [];
    const canEdit = this.editable();
    const out: TreeNode[] = [];
    const walk = (m: TeamMemberDto, depth: number) => {
      out.push({ ...m, depth, movable: canEdit && m.id !== o.root.id });
      o.members.filter((c) => c.parentUserId === m.id)
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((c) => walk(c, depth + 1));
    };
    walk(o.root, 0);
    return out;
  });

  onEnter(id: string) { this.hoverId.set(id); }
  onLeave(id: string) { if (this.hoverId() === id) this.hoverId.set(null); }

  /** Drop of a dragged member (item.data) onto a node or the pool (container.data = node | null). */
  onDrop(e: CdkDragDrop<any>) {
    this.hoverId.set(null);
    if (e.previousContainer === e.container) return;
    const dragged = e.item.data as TeamMemberDto;
    const target = e.container.data as TeamMemberDto | null; // node member, or null for the pool
    const parentId = target ? target.id : null;
    if (target && target.id === dragged.id) return;  // onto itself
    if (parentId === (dragged.parentUserId ?? null)) return; // already there → no-op
    if (parentId && this.isDescendant(dragged.id, parentId)) return; // client cycle guard
    this.busyAssign.set(true);
    this.api.assignTeam(parentId, [dragged.id]).subscribe({
      next: () => { this.busyAssign.set(false); this.flashAssign(); this.reloadOrg(); },
      error: () => this.busyAssign.set(false),
    });
  }

  /** True when {@code nodeId} sits below {@code ancestorId} in the current tree (would-be cycle). */
  private isDescendant(ancestorId: string, nodeId: string): boolean {
    const o = this.org();
    if (!o) return false;
    const byId = new Map(o.members.map((m) => [m.id, m] as const));
    let p: string | null = byId.get(nodeId)?.parentUserId ?? null;
    let guard = 0;
    while (p && guard++ < 200) {
      if (p === ancestorId) return true;
      p = byId.get(p)?.parentUserId ?? null;
    }
    return false;
  }

  private reloadOrg() {
    this.api.teamOrg().subscribe({ next: (o) => this.org.set(o), error: () => {} });
    // refresh per-member stats too so the per-team roll-ups follow the new structure
    this.api.hierarchyStats().subscribe({ next: (h) => this.hier.set(h), error: () => {} });
  }

  // ---- per-team roll-up: each node shows its whole sub-tree's aggregated sales ----
  private statsById = computed(() => {
    const map = new Map<string, MemberStatsDto>();
    for (const m of this.hier()?.members ?? []) map.set(m.id, m);
    return map;
  });
  /** id → aggregated {subs, amount, collectes, comm} over that node and all its descendants. */
  teamRollup = computed(() => {
    const o = this.org();
    const stats = this.statsById();
    const out = new Map<string, { subs: number; amount: number; collectes: number; comm: number }>();
    if (!o) return out;
    const childrenOf = new Map<string, TeamMemberDto[]>();
    for (const m of o.members) {
      const p = m.parentUserId ?? '';
      const arr = childrenOf.get(p);
      if (arr) arr.push(m); else childrenOf.set(p, [m]);
    }
    const rollup = (id: string) => {
      const cached = out.get(id);
      if (cached) return cached;
      const own = stats.get(id);
      const acc = {
        subs: own?.subscriptions ?? 0, amount: own?.subscriptionsAmount ?? 0,
        collectes: own?.collectes ?? 0, comm: own?.commissionTotal ?? 0,
      };
      out.set(id, acc); // set before recursing → cycle-safe
      for (const c of childrenOf.get(id) ?? []) {
        const r = rollup(c.id);
        acc.subs += r.subs; acc.amount += r.amount; acc.collectes += r.collectes; acc.comm += r.comm;
      }
      return acc;
    };
    for (const n of [o.root, ...o.members]) rollup(n.id);
    return out;
  });
  rollupOf(id: string) { return this.teamRollup().get(id) ?? { subs: 0, amount: 0, collectes: 0, comm: 0 }; }
  hasRollup(id: string) { const r = this.rollupOf(id); return r.subs > 0 || r.amount > 0 || r.collectes > 0 || r.comm > 0; }
  rollupLine(id: string) {
    const r = this.rollupOf(id);
    const parts: string[] = [];
    if (r.subs > 0) parts.push(`${r.subs} ${this.i18n.t('mgr_u_subs')}`);
    if (r.amount > 0) parts.push(`${this.compactF(r.amount)} F`);
    if (r.collectes > 0) parts.push(`${r.collectes} ${this.i18n.t('mgr_u_collectes')}`);
    if (r.comm > 0) parts.push(`${this.compactF(r.comm)} ${this.i18n.t('mgr_u_comm')}`);
    return parts.join(' · ');
  }
  private compactF(n: number): string {
    n = Math.round(n || 0);
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',') + 'M';
    if (n >= 1_000) return Math.round(n / 1_000) + 'k';
    return String(n);
  }

  // ---- explicit org actions (complement the drag-and-drop) ----
  /** A node that has at least one direct report — i.e. the lead of a (sub-)team. */
  isLead = (n: TreeNode) => (this.org()?.members ?? []).some((m) => m.parentUserId === n.id);
  /** Managerial tree nodes usable as the parent of a new team (excludes leaf staff). */
  parentCandidates = () => this.treeNodes().filter((n) =>
    ['ADMIN', 'MANAGER', 'SUPERVISEUR', 'CHEF_EQUIPE'].includes(n.role));

  /** id + every descendant id, from the loaded members (client-side, cycle-safe). */
  private subtreeIds(rootId: string): string[] {
    const members = this.org()?.members ?? [];
    const out: string[] = [rootId];
    const stack = [rootId];
    let guard = 0;
    while (stack.length && guard++ < 1000) {
      const cur = stack.pop()!;
      for (const m of members) if (m.parentUserId === cur && !out.includes(m.id)) { out.push(m.id); stack.push(m.id); }
    }
    return out;
  }

  /** Remove one member from the org chart (detach) — the account stays in the database. */
  detachMember(n: TreeNode) {
    if (!confirm(this.i18n.t('mgr_confirm_detach').replace('{name}', n.name))) return;
    this.busyAssign.set(true);
    this.api.assignTeam(null, [n.id]).subscribe({
      next: () => { this.busyAssign.set(false); this.flashAssign(); this.reloadOrg(); },
      error: () => this.busyAssign.set(false),
    });
  }

  /** Dissolve a team: detach the lead and its whole sub-tree to the pool. Accounts are kept. */
  dissolveTeam(n: TreeNode) {
    if (!confirm(this.i18n.t('mgr_confirm_dissolve').replace('{name}', n.name))) return;
    this.busyAssign.set(true);
    this.api.assignTeam(null, this.subtreeIds(n.id)).subscribe({
      next: () => { this.busyAssign.set(false); this.flashAssign(); this.reloadOrg(); },
      error: () => this.busyAssign.set(false),
    });
  }

  // ---- team creation ----
  openTeamForm() {
    this.tLead.set(''); this.tParent.set(''); this.tMembers.set([]); this.teamErr.set('');
    this.showTeamForm.set(true);
  }
  toggleMember(id: string) {
    const s = new Set(this.tMembers());
    s.has(id) ? s.delete(id) : s.add(id);
    this.tMembers.set([...s]);
  }
  createTeam() {
    const lead = this.tLead();
    if (!lead) { this.teamErr.set(this.i18n.t('mgr_team_lead_required')); return; }
    const parent = this.tParent() || this.org()?.root.id || null;
    const members = this.tMembers().filter((id) => id !== lead);
    this.teamBusy.set(true); this.teamErr.set('');
    // 1) attach the lead under the chosen parent, then 2) attach the members under the lead.
    this.api.assignTeam(parent, [lead]).subscribe({
      next: () => {
        if (!members.length) return this.finishTeam();
        this.api.assignTeam(lead, members).subscribe({
          next: () => this.finishTeam(),
          error: () => { this.teamBusy.set(false); this.teamErr.set(this.i18n.t('mgr_team_error')); },
        });
      },
      error: () => { this.teamBusy.set(false); this.teamErr.set(this.i18n.t('mgr_team_error')); },
    });
  }
  private finishTeam() {
    this.teamBusy.set(false); this.showTeamForm.set(false); this.flashAssign(); this.reloadOrg();
  }

  private flashAssign() {
    this.assignFlash.set(true);
    setTimeout(() => this.assignFlash.set(false), 2500);
  }
  roleColor(role: string): string {
    return {
      ADMIN: '#C8102E', MANAGER: '#7C3AED', SUPERVISEUR: '#6D28D9', CHEF_EQUIPE: '#F59E0B',
      AGENT: '#059669', CASHIER: '#0EA5E9', PRINT_AGENT: '#64748B', COLLECTEUR: '#14B8A6',
    }[role] || '#6B7280';
  }
  roleLabel(role: string): string {
    return {
      ADMIN: 'Admin', MANAGER: 'Manager', SUPERVISEUR: 'Superviseur', CHEF_EQUIPE: "Chef d'équipe",
      AGENT: 'Commercial', CASHIER: 'Caissier', PRINT_AGENT: 'Point impression', COLLECTEUR: 'Collecteur',
    }[role] || role;
  }
  initial(name: string): string { return (name || '?').trim().charAt(0).toUpperCase(); }

  setTab(t: Tab) {
    this.tab.set(t);
    if (t === 'commissions' && this.rules().length === 0) this.api.commissionRules().subscribe({ next: (l) => this.rules.set(l), error: () => {} });
    if (t === 'hierarchy') {
      if (!this.hier()) this.api.hierarchyStats().subscribe({ next: (h) => this.hier.set(h), error: () => {} });
      if (!this.org()) this.reloadOrg();
    }
    if (t === 'team' && this.roster().length === 0) this.api.teamRoster().subscribe({ next: (l) => this.roster.set(l), error: () => {} });
  }
  loadEntries() { if (this.entries().length === 0) this.api.commissionEntries().subscribe({ next: (l) => this.entries.set(l), error: () => {} }); }
  sendMsg() {
    this.api.sendTeamMessage(this.msgTitle().trim(), this.msgBody().trim(), []).subscribe({
      next: () => { this.msgSent.set(true); this.msgTitle.set(''); this.msgBody.set(''); },
    });
  }
}
