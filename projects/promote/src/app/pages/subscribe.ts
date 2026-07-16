import { Component, ElementRef, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { I18n } from '../core/i18n';
import {
  AgencyDto, ConfigDto, CreateSubscriptionRequest, ProductCategoryDto, ProductComponentDto, ProductDto,
} from '../core/models';
import { formatPhone, matchesOperator } from '../shared/constants';
import { PhoneFieldComponent } from '../shared/fields';
import { PhotoCaptureComponent } from '../shared/photo-capture';

const NIU_MAX = 20;

/**
 * Composants « réservés » : sur un produit CARD, le backend s'en sert pour surcharger la
 * tarification (cf. SubscriptionService.configForProduct) — ce ne sont pas des éléments de
 * package. Tout autre composant décrit le CONTENU vendu avec le produit : c'est ce qu'on
 * déroule au client. Un produit qui en possède au moins un est donc un « package ».
 */
const CONFIG_CKEYS = new Set([
  'price', 'fees', 'transport', 'rechargeMin', 'rechargeMax',
  'rechargeInitiale', 'passPremium', 'rechargeInitialeBancaire', 'passPremiumBancaire',
]);

/**
 * Catalogue de démonstration — utilisé UNIQUEMENT si le backend (/api/products)
 * est indisponible ou renvoie une liste vide, pour que le funnel reste
 * présentable et testable hors ligne (démo / déploiement Docker autonome).
 * Dès qu'un vrai backend renvoie des produits, ceux-ci prennent le dessus.
 */
const DEMO_PRODUCTS: ProductDto[] = [
  {
    id: 1, code: 'VISA_CLASSIC', label: 'Visa Classic', description: 'Carte prépayée internationale, idéale au quotidien.',
    groupCode: 'VISA', kind: 'Prépayée', basePrice: 15000, effectivePrice: 12000,
    builtin: true, active: true, archived: false, imageKey: null, maxPerClient: null, components: [], promotions: [],
  },
  {
    id: 2, code: 'VISA_GOLD', label: 'Visa Gold', description: 'Plafonds élevés et assurances voyage incluses.',
    groupCode: 'VISA', kind: 'Prépayée', basePrice: 35000, effectivePrice: 35000,
    builtin: true, active: true, archived: false, imageKey: null, maxPerClient: null, components: [], promotions: [],
  },
  {
    id: 3, code: 'MC_STANDARD', label: 'Mastercard Standard', description: 'Acceptée partout, achats en ligne sécurisés.',
    groupCode: 'MASTERCARD', kind: 'Prépayée', basePrice: 15000, effectivePrice: 15000,
    builtin: true, active: true, archived: false, imageKey: null, maxPerClient: null, components: [], promotions: [],
  },
  {
    id: 4, code: 'MC_BUSINESS', label: 'Mastercard Business', description: 'Pour les professionnels et la diaspora active.',
    groupCode: 'MASTERCARD', kind: 'Débit', basePrice: 45000, effectivePrice: 39000,
    builtin: true, active: true, archived: false, imageKey: null, maxPerClient: null, components: [], promotions: [],
  },
];

type Phase = 'funnel' | 'paying' | 'success' | 'failure';

const fcfa = (n: number) => new Intl.NumberFormat('fr-FR').format(n) + ' FCFA';

@Component({
  selector: 'app-subscribe',
  imports: [PhotoCaptureComponent, PhoneFieldComponent],
  template: `
    <!-- ════════ FUNNEL ════════ -->
    @if (phase() === 'funnel') {
      <div style="flex:1;display:flex;flex-direction:column;background:rgba(255,255,255,.82)">
        <!-- topbar -->
        <div style="padding:12px 16px;border-bottom:1px solid #F3F4F6;display:flex;align-items:center;gap:12px;background:#fff;position:sticky;top:38px;z-index:50">
          <button (click)="prev()" class="icon-sq">
            <svg width="18" height="18" fill="none" stroke="#374151" stroke-width="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"></path></svg>
          </button>
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--font-serif);font-size:15px;font-weight:500;letter-spacing:-0.2px;color:var(--navy)">{{ i18n.t('step' + step() + '_title') }}</div>
            <div style="font-size:11px;color:var(--muted-2);margin-top:1px">{{ i18n.t('step_of', { n: step() + 1, total: 6 }) }}</div>
          </div>
          <div class="brand-logo" style="width:36px;height:36px;border-radius:10px">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#fff" stroke-width="2"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"></path></svg>
          </div>
        </div>
        <!-- progress -->
        <div style="height:3px;background:#F3F4F6">
          <div style="height:100%;background:linear-gradient(90deg,#C8102E,#E8344A);border-radius:0 2px 2px 0;transition:width .4s ease" [style.width.%]="((step() + 1) / 6) * 100"></div>
        </div>

        <div #scrollArea (scroll)="onScroll()" style="flex:1;overflow-y:auto;padding:20px 16px 110px">
          <div style="max-width:520px;margin:0 auto;width:100%">

            <!-- STEP 0 -->
            @if (step() === 0) {
              <div class="fade-in">
                <div style="font-family:var(--font-serif);font-size:22px;font-weight:500;letter-spacing:-0.4px;color:var(--navy);margin-bottom:4px">{{ i18n.t('select_product') }}</div>
                <div style="font-size:13px;color:var(--muted);margin-bottom:20px">{{ i18n.t('home_subscribe_desc') }}</div>
                <div style="display:flex;gap:8px;margin-bottom:20px;overflow-x:auto;padding-bottom:4px">
                  @for (cf of categories(); track cf.code) {
                    <button (click)="cat.set(cf.code)" class="chip" [class.chip-on]="cat() === cf.code">{{ cf.label }}</button>
                  }
                </div>
                <div style="display:grid;grid-template-columns:1fr;gap:12px">
                  @for (p of filteredProducts(); track p.id) {
                    <div class="prod-card" [class.prod-on]="selected()?.id === p.id">
                      <button (click)="selectProduct(p)" class="prod-head">
                        <div class="prod-mini" [style.background]="cardGradient(p)">
                          @if (p.imageKey) {
                            <img [src]="api.productImageUrl(p.id)" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
                          } @else {
                            <div style="position:absolute;top:6px;left:6px;width:12px;height:9px;border-radius:2px;background:linear-gradient(135deg,#C9A227,#E0B73A)"></div>
                            <span style="font-size:7px;font-weight:800;color:rgba(255,255,255,.85);letter-spacing:.5px">{{ p.groupCode }}</span>
                          }
                        </div>
                        <div style="flex:1;min-width:0">
                          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                            <span style="font-size:14px;font-weight:700;color:var(--navy)">{{ p.label }}</span>
                            @if (hasPromo(p)) { <span class="promo-tag">{{ i18n.t('promo') }}</span> }
                            @if (isPackage(p)) { <span class="pkg-tag">{{ i18n.t('pkg_tag') }}</span> }
                          </div>
                          <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap">
                            @if (!isPackage(p)) {
                              <span style="font-size:12px;color:var(--muted-2);padding:2px 6px;border-radius:4px;background:var(--surface-3)">{{ kindLabel(p) }}</span>
                            }
                            @if (hasPromo(p)) { <span style="font-size:12px;color:var(--muted-2);text-decoration:line-through">{{ price(p.basePrice) }}</span> }
                            <span style="font-size:14px;font-weight:700" [style.color]="hasPromo(p) ? 'var(--primary)' : 'var(--navy)'">{{ price(p.effectivePrice) }}</span>
                          </div>
                          @if (isPackage(p)) {
                            <div style="font-size:11.5px;color:var(--muted);margin-top:4px">{{ i18n.t('pkg_count', { n: packageItems(p).length }) }}</div>
                          }
                        </div>
                        <div style="flex-shrink:0;display:flex;align-items:center">
                          <div class="radio" [class.radio-on]="selected()?.id === p.id">
                            @if (selected()?.id === p.id) { <div class="radio-dot"></div> }
                          </div>
                        </div>
                      </button>

                      <!-- Contenu du package : déroulé automatiquement à la sélection -->
                      @if (isPackage(p)) {
                        <button (click)="togglePackage(p)" class="pkg-toggle" [attr.aria-expanded]="isPackageOpen(p)">
                          {{ isPackageOpen(p) ? i18n.t('pkg_hide') : i18n.t('pkg_show') }}
                          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"
                               [style.transform]="isPackageOpen(p) ? 'rotate(180deg)' : 'none'" style="transition:transform .2s">
                            <path d="M6 9l6 6 6-6"></path>
                          </svg>
                        </button>
                        @if (isPackageOpen(p)) {
                          <div class="pkg-body fade-in">
                            @if (p.description) { <div class="pkg-desc">{{ p.description }}</div> }
                            <div class="pkg-h">{{ i18n.t('pkg_contents') }}</div>
                            @for (c of packageItems(p); track $index) {
                              <div class="pkg-row">
                                <span class="pkg-l">
                                  <svg width="13" height="13" fill="none" stroke="#059669" stroke-width="3" viewBox="0 0 24 24" style="flex-shrink:0"><path d="M20 6L9 17l-5-5"></path></svg>
                                  {{ c.label }}
                                </span>
                                <span class="pkg-v" [class.pkg-inc]="c.amount <= 0">{{ c.amount > 0 ? price(c.amount) : i18n.t('pkg_included') }}</span>
                              </div>
                            }
                            <div class="pkg-note">{{ i18n.t('pkg_price_note', { price: price(p.effectivePrice) }) }}</div>
                          </div>
                        }
                      }
                    </div>
                  }
                  @if (filteredProducts().length === 0) {
                    <div style="text-align:center;color:var(--muted);padding:24px">
                      {{ catalogLoaded() ? i18n.t('no_product') : i18n.t('loading_catalog') }}
                    </div>
                  }
                </div>
              </div>
            }

            <!-- STEP 1 — Identité -->
            @if (step() === 1) {
              <div class="slide-r">
                <div style="font-size:18px;font-weight:800;color:var(--navy);margin-bottom:20px">{{ i18n.t('funnel_step1') }}</div>
                <div class="fld">
                  <label class="lab">{{ i18n.t('field_firstname') }} *</label>
                  <input class="in" [class.in-err]="!!fieldErr('firstName')" maxlength="80" [value]="firstName()" (input)="firstName.set(val($event))">
                  @if (fieldErr('firstName')) { <div class="ferr">{{ fieldErr('firstName') }}</div> }
                </div>
                <div class="fld">
                  <label class="lab">{{ i18n.t('field_lastname') }} *</label>
                  <input class="in" [class.in-err]="!!fieldErr('lastName')" maxlength="80" [value]="lastName()" (input)="lastName.set(val($event))">
                  @if (fieldErr('lastName')) { <div class="ferr">{{ fieldErr('lastName') }}</div> }
                </div>
                <div class="fld">
                  <label class="lab">{{ i18n.t('field_sex') }} *</label>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <button type="button" (click)="sexe.set('M')" class="seg" [class.seg-on]="sexe() === 'M'">{{ i18n.t('field_sex_m') }}</button>
                    <button type="button" (click)="sexe.set('F')" class="seg" [class.seg-on]="sexe() === 'F'">{{ i18n.t('field_sex_f') }}</button>
                  </div>
                  @if (fieldErr('sexe')) { <div class="ferr">{{ fieldErr('sexe') }}</div> }
                </div>
                <div class="fld">
                  <label class="lab">{{ i18n.t('field_idtype') }}</label>
                  <select class="in" [value]="idType()" (change)="idType.set(val($event))">
                    <option value="cni">{{ i18n.t('field_cni') }}</option>
                    <option value="passport">{{ i18n.t('field_passport') }}</option>
                    <option value="recepisse">{{ i18n.t('field_receipt') }}</option>
                  </select>
                </div>
                <div class="fld">
                  <label class="lab">{{ i18n.t('field_idnumber') }} *</label>
                  <input class="in" [class.in-err]="!!fieldErr('idNumber')" style="text-transform:uppercase" placeholder="AB123456"
                         [value]="idNumber()" (input)="onIdNumber($event)">
                  @if (fieldErr('idNumber')) { <div class="ferr">{{ fieldErr('idNumber') }}</div> }
                </div>
                <div class="fld">
                  <label class="lab">{{ i18n.t('field_niu') }}</label>
                  <input class="in" [class.in-err]="!!fieldErr('niu')" style="text-transform:uppercase" [attr.maxlength]="niuMax"
                         [placeholder]="i18n.t('niu_ph')" [value]="niu()" (input)="onNiu($event)">
                  <div class="fhint">{{ i18n.t('niu_hint') }} ({{ niu().length }}/{{ niuMax }})</div>
                  @if (fieldErr('niu')) { <div class="ferr">{{ fieldErr('niu') }}</div> }
                </div>
                <div class="fld">
                  <label class="lab">{{ i18n.t('field_expiry') }} *</label>
                  <input type="date" class="in" [class.in-err]="!!fieldErr('expiry')" [min]="todayIso" [value]="expiry()" (input)="expiry.set(val($event))">
                  @if (fieldErr('expiry')) { <div class="ferr">{{ fieldErr('expiry') }}</div> }
                </div>
                @if (idType() === 'cni') {
                  <div class="fld">
                    <label class="lab">{{ i18n.t('field_birth') }} *</label>
                    <input type="date" class="in" [class.in-err]="!!fieldErr('birth')" [max]="todayIso" [value]="birth()" (input)="birth.set(val($event))">
                    @if (fieldErr('birth')) { <div class="ferr">{{ fieldErr('birth') }}</div> }
                  </div>
                }
                <phone-field
                  [label]="i18n.t('field_phone') + ' *'"
                  [hint]="i18n.t('tel_hint')"
                  [value]="phone()"
                  (valueChange)="phone.set($event)"
                  [err]="fieldErr('phone')" />
                <div class="fld">
                  <label class="lab">{{ i18n.t('field_email') }} *</label>
                  <input type="email" class="in" [class.in-err]="!!fieldErr('email')" placeholder="nom@email.cm" [value]="email()" (input)="email.set(val($event))">
                  @if (fieldErr('email')) { <div class="ferr">{{ fieldErr('email') }}</div> }
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px" class="fld">
                  <div>
                    <label class="lab">{{ i18n.t('field_district') }} *</label>
                    <input class="in" [class.in-err]="!!fieldErr('district')" maxlength="80" [value]="district()" (input)="district.set(val($event))">
                    @if (fieldErr('district')) { <div class="ferr">{{ fieldErr('district') }}</div> }
                  </div>
                  <div>
                    <label class="lab">{{ i18n.t('field_city') }} *</label>
                    <input class="in" [class.in-err]="!!fieldErr('city')" maxlength="80" [value]="city()" (input)="city.set(val($event))">
                    @if (fieldErr('city')) { <div class="ferr">{{ fieldErr('city') }}</div> }
                  </div>
                </div>
                <div class="dashed">
                  <phone-field
                    [label]="i18n.t('field_referrer')"
                    [hint]="i18n.t('ref_phone_hint')"
                    [value]="referrer()"
                    (valueChange)="referrer.set($event)"
                    [err]="fieldErr('referrer')" />
                </div>
                <div class="dashed">
                  <label class="lab" style="margin-bottom:8px">{{ i18n.t('geo_capture') }}</label>
                  @if (geo()) {
                    <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--label);margin-bottom:6px">
                      <span>{{ i18n.t('geo_lat') }}: <strong>{{ geo()!.lat.toFixed(4) }}</strong></span>
                      <span>{{ i18n.t('geo_lng') }}: <strong>{{ geo()!.lng.toFixed(4) }}</strong></span>
                      <span>{{ i18n.t('geo_accuracy') }}: <strong>{{ geo()!.acc.toFixed(0) }}m</strong></span>
                    </div>
                    <div class="alert-success" style="display:inline-flex;align-items:center;gap:4px">✓ {{ i18n.t('geo_captured') }}</div>
                  } @else {
                    <button (click)="captureGeo()" class="btn-soft" style="display:inline-flex;gap:6px;background:#fff;border:1.5px solid var(--border)">
                      <svg width="16" height="16" fill="none" stroke="#C8102E" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                      {{ i18n.t('geo_capture') }}
                    </button>
                  }
                </div>
              </div>
            }

            <!-- STEP 2 — KYC (caméra live + auto-cadrage document) -->
            @if (step() === 2) {
              <div class="slide-r">
                <div style="font-size:18px;font-weight:800;color:var(--navy);margin-bottom:4px">{{ i18n.t('kyc_title') }}</div>
                <div style="font-size:13px;color:var(--muted);margin-bottom:16px">{{ i18n.t('kyc_tip') }}</div>
                <div style="margin-bottom:16px">
                  <label class="lab" style="margin-bottom:8px;display:block">{{ i18n.t('kyc_front') }} *</label>
                  <photo-capture
                    [imageData]="cniRectoData()"
                    facing="environment"
                    [boxW]="280" [boxH]="180"
                    [qualityCheck]="true"
                    detect="document"
                    [autoCapture]="true"
                    [guide]="i18n.t('cni_recto_guide')"
                    tipsTitle="cni_tips_title"
                    [tips]="cniTips"
                    (captured)="onCniRecto($event)"
                    (retake)="onRetakeRecto()" />
                  @if (uploading() === 'cni-recto') {
                    <p class="muted" style="font-size:12px;text-align:center;margin-top:8px">{{ i18n.t('uploading') }}</p>
                  }
                </div>
                @if (idType() !== 'passport') {
                  <div style="margin-bottom:8px">
                    <label class="lab" style="margin-bottom:8px;display:block">{{ i18n.t('kyc_back') }} *</label>
                    <photo-capture
                      [imageData]="cniVersoData()"
                      facing="environment"
                      [boxW]="280" [boxH]="180"
                      [qualityCheck]="true"
                      detect="document"
                      [autoCapture]="true"
                      [guide]="i18n.t('cni_verso_guide')"
                      tipsTitle="cni_tips_title"
                      [tips]="cniTips"
                      (captured)="onCniVerso($event)"
                      (retake)="onRetakeVerso()" />
                    @if (uploading() === 'cni-verso') {
                      <p class="muted" style="font-size:12px;text-align:center;margin-top:8px">{{ i18n.t('uploading') }}</p>
                    }
                  </div>
                }
              </div>
            }

            <!-- STEP 3 — Selfie (détection visage + auto-capture) -->
            @if (step() === 3) {
              <div class="slide-r">
                <div style="font-size:18px;font-weight:800;color:var(--navy);margin-bottom:4px;text-align:center">{{ i18n.t('selfie_title') }}</div>
                <div style="font-size:13px;color:var(--muted);margin-bottom:16px;text-align:center">{{ i18n.t('selfie_tip') }}</div>
                <photo-capture
                  [imageData]="selfieData()"
                  facing="user"
                  [round]="true"
                  [boxW]="200" [boxH]="200"
                  [allowGallery]="false"
                  detect="face"
                  [autoCapture]="true"
                  [guide]="i18n.t('photo_guide')"
                  (captured)="onSelfie($event)"
                  (retake)="onRetakeSelfie()" />
                @if (uploading() === 'selfie') {
                  <p class="muted" style="font-size:12px;text-align:center;margin-top:8px">{{ i18n.t('uploading') }}</p>
                }
              </div>
            }

            <!-- STEP 4 -->
            @if (step() === 4) {
              <div class="slide-r">
                <div style="font-size:18px;font-weight:800;color:var(--navy);margin-bottom:20px">{{ i18n.t('funnel_step4') }}</div>
                <div style="margin-bottom:24px">
                  <label class="lab" style="margin-bottom:10px">{{ i18n.t('pay_delivery') }}</label>
                  <div style="display:flex;flex-direction:column;gap:8px">
                    @for (d of deliveryOptions; track d.id) {
                      <button (click)="delivery.set(d.id)" class="opt" [class.opt-on]="delivery() === d.id">
                        <div style="flex:1;text-align:left"><div style="font-size:14px;font-weight:600;color:var(--navy)">{{ i18n.t(d.label) }}</div></div>
                        <div class="radio" [class.radio-on]="delivery() === d.id">@if (delivery() === d.id) { <div class="radio-dot"></div> }</div>
                      </button>
                    }
                  </div>
                  @if (delivery() === 'agence') {
                    <div style="margin-top:10px">
                      <select class="in" [value]="deliveryAgency()" (change)="deliveryAgency.set(val($event))">
                        <option value="">{{ i18n.t('pay_select_agency') }}</option>
                        @for (a of agencies(); track a.id) { <option [value]="a.id">{{ a.name }} — {{ a.city }}</option> }
                      </select>
                    </div>
                  }
                </div>
                <div style="margin-bottom:24px">
                  <label class="lab" style="margin-bottom:10px">{{ i18n.t('pay_method') }}</label>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    @for (m of payMethods; track m.id) {
                      <button type="button" (click)="selectPayMethod(m.id)" class="pm" [class.pm-on]="payMethod() === m.id" [style.border-color]="payMethod() === m.id ? m.color : 'var(--border)'">
                        <div class="pm-ic" [style.background]="m.color"><span style="font-size:14px;font-weight:800" [style.color]="m.text">{{ m.icon }}</span></div>
                        <span style="font-size:13px;font-weight:600;color:var(--navy)">{{ i18n.t(m.label) }}</span>
                      </button>
                    }
                  </div>
                </div>
                @if (payMethod() === 'om' || payMethod() === 'mtn') {
                  <div class="fade-in">
                    <phone-field
                      [label]="i18n.t('pay_momo_phone') + ' *'"
                      [hint]="i18n.t('pay_phone_hint')"
                      [value]="momoPhone()"
                      (valueChange)="momoPhone.set($event)"
                      [err]="momoPhoneErr()" />
                  </div>
                }
                @if (payMethod() === 'sara') {
                  <div class="fade-in">
                    <div class="fld"><label class="lab">{{ i18n.t('pay_sara_ref') }} *</label><input class="in" [value]="saraRef()" (input)="saraRef.set(val($event))"></div>
                    <button (click)="captureSara()" class="btn-soft" style="width:100%;border:2px dashed var(--border-2);background:var(--surface-2)">
                      {{ saraReceiptKey() ? '✓ ' + i18n.t('kyc_captured') : i18n.t('kyc_capture') }}
                    </button>
                  </div>
                }
              </div>
            }

            <!-- STEP 5 -->
            @if (step() === 5) {
              <div class="slide-r">
                <div style="font-size:18px;font-weight:800;color:var(--navy);margin-bottom:20px">{{ i18n.t('summary_title') }}</div>
                <div class="card-visual">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start">
                    <span style="font-size:10px;font-weight:700;color:rgba(255,255,255,.6);letter-spacing:1px">AFRILAND FIRST BANK</span>
                    <span style="font-size:14px;font-weight:800;color:rgba(255,255,255,.8);letter-spacing:1px">{{ selected()?.groupCode }}</span>
                  </div>
                  <div>
                    <div style="width:36px;height:26px;border-radius:4px;background:linear-gradient(135deg,#C9A227,#E0B73A);margin-bottom:16px"></div>
                    <div style="font-size:16px;letter-spacing:3px;color:rgba(255,255,255,.7);font-family:monospace;margin-bottom:8px">•••• •••• •••• ••••</div>
                    <div style="font-size:14px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.5px">{{ firstName() }} {{ lastName() }}</div>
                  </div>
                </div>
                <div class="sum-card">
                  <div class="sum-h"><svg width="16" height="16" fill="none" stroke="#C8102E" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>{{ i18n.t('summary_personal') }}</div>
                  @for (r of personalRows(); track r.label) {
                    <div class="sum-row"><span class="sum-k">{{ r.label }}</span><span class="sum-v">{{ r.value }}</span></div>
                  }
                </div>
                @if (selectedPackageItems().length) {
                  <div class="sum-card">
                    <div class="sum-h"><svg width="16" height="16" fill="none" stroke="#C8102E" stroke-width="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"></path></svg>{{ i18n.t('summary_package') }} — {{ selected()?.label }}</div>
                    @for (c of selectedPackageItems(); track $index) {
                      <div class="sum-row">
                        <span class="sum-k">{{ c.label }}</span>
                        <span class="sum-v" [class.pkg-inc]="c.amount <= 0">{{ c.amount > 0 ? price(c.amount) : i18n.t('pkg_included') }}</span>
                      </div>
                    }
                  </div>
                }
                <div class="sum-card">
                  <div class="sum-h"><svg width="16" height="16" fill="none" stroke="#C8102E" stroke-width="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>{{ i18n.t('summary_tariff') }}</div>
                  @for (r of tariffRows(); track r.label) {
                    <div class="sum-row"><span class="sum-k">{{ r.label }}</span><span class="sum-v">{{ r.value }}</span></div>
                  }
                  <div style="display:flex;justify-content:space-between;padding:10px 0 0;margin-top:4px">
                    <span style="font-size:14px;font-weight:800;color:var(--navy)">{{ i18n.t('summary_total') }}</span>
                    <span style="font-size:18px;font-weight:800;color:var(--primary)">{{ price(total()) }}</span>
                  </div>
                </div>
              </div>
            }

            @if (error()) { <div class="alert-error shake" style="margin-top:8px">{{ error() }}</div> }
          </div>
        </div>

        <!-- floating scroll-down hint : indique qu'il reste des produits plus bas -->
        @if (canScrollMore()) {
          <button (click)="scrollDown()" class="scroll-hint" [attr.aria-label]="i18n.t('more_products')" title="{{ i18n.t('more_products') }}">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
          </button>
        }

        <!-- bottom bar -->
        <div style="position:fixed;bottom:0;left:0;right:0;padding:12px 16px;background:#fff;border-top:1px solid #F3F4F6;z-index:50">
          <div style="max-width:520px;margin:0 auto;width:100%;display:flex;gap:10px">
            @if (step() > 0) {
              <button (click)="prev()" class="btn-soft" style="flex:0 0 auto;border:1.5px solid var(--border);background:#fff;border-radius:12px;padding:14px 20px">{{ i18n.t('back') }}</button>
            }
            <button (click)="next()" class="btn btn-primary" style="flex:1;border-radius:12px" [disabled]="submitting()">{{ step() === 5 ? i18n.t('finish') : i18n.t('next') }}</button>
          </div>
        </div>
      </div>
    }

    <!-- ════════ PAYMENT PROCESSING ════════ -->
    @if (phase() === 'paying') {
      <div class="screen" style="align-items:center;justify-content:center;padding:32px 16px;text-align:center;background:rgba(255,255,255,.82)">
        <div class="fade-in" style="max-width:400px;width:100%">
          <div style="position:relative;width:120px;height:120px;margin:0 auto 24px">
            <svg width="120" height="120" viewBox="0 0 120 120" style="animation:spinRing 2s linear infinite"><circle cx="60" cy="60" r="52" stroke="#F3F4F6" stroke-width="6" fill="none"></circle><circle cx="60" cy="60" r="52" stroke="#C8102E" stroke-width="6" fill="none" stroke-linecap="round" stroke-dasharray="327" stroke-dashoffset="120"></circle></svg>
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><div style="width:48px;height:48px;border-radius:12px;background:var(--primary);display:flex;align-items:center;justify-content:center;animation:pulse 1.5s ease infinite"><span style="font-size:20px;font-weight:800;color:#fff">₣</span></div></div>
          </div>
          <div style="font-size:18px;font-weight:700;color:var(--navy);margin-bottom:8px">{{ i18n.t('pay_processing_title') }}</div>
          <div style="font-size:14px;color:var(--muted);margin-bottom:4px">{{ i18n.t('pay_processing_msg') }}</div>
          @if (createdRef()) {
            <div style="padding:10px 16px;background:var(--surface-2);border-radius:10px;display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);margin:12px 0 20px">{{ i18n.t('processing_ref') }} <span style="font-weight:700;color:var(--navy)" class="mono">{{ createdRef() }}</span></div>
          }
          <div style="font-size:12px;color:var(--muted-2);margin-top:12px">{{ i18n.t('pay_wait_hint') }}</div>
        </div>
      </div>
    }

    <!-- ════════ SUCCESS ════════ -->
    @if (phase() === 'success') {
      <div class="screen" style="align-items:center;justify-content:center;padding:32px 16px;text-align:center;background:linear-gradient(180deg,#ECFDF5 0%,#fff 40%)">
        <div class="slide-up" style="max-width:400px;width:100%">
          <div style="margin-bottom:24px"><svg width="80" height="80" viewBox="0 0 80 80" style="animation:countPulse .6s ease"><circle cx="40" cy="40" r="36" fill="#059669" opacity=".12"></circle><circle cx="40" cy="40" r="28" fill="#059669" opacity=".2"></circle><circle cx="40" cy="40" r="20" fill="#059669"></circle><path d="M28 40l8 8 16-16" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="40" stroke-dashoffset="40" style="animation:drawCheck .5s ease .3s forwards"></path></svg></div>
          <div style="font-size:22px;font-weight:800;color:#059669;margin-bottom:8px">{{ i18n.t('success_title') }}</div>
          <div style="font-size:14px;color:var(--muted);margin-bottom:24px">{{ i18n.t('success_msg') }}</div>
          <div style="background:#fff;border-radius:14px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,.06);margin-bottom:20px">
            <div style="font-size:12px;color:var(--muted-2);margin-bottom:4px">{{ i18n.t('success_ref') }}</div>
            <div class="mono" style="font-size:28px;font-weight:800;color:var(--navy);letter-spacing:2px;margin-bottom:12px">{{ createdRef() }}</div>
            <button (click)="copyRef()" class="btn-soft" style="background:var(--surface-3);border:1.5px solid var(--border)">{{ i18n.t('success_copy') }}</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button (click)="restart()" class="btn btn-primary" style="border-radius:12px">{{ i18n.t('success_new') }}</button>
            <button (click)="goHome()" class="btn-soft" style="width:100%;border-radius:12px;padding:14px">{{ i18n.t('success_home') }}</button>
          </div>
        </div>
      </div>
    }

    <!-- ════════ FAILURE ════════ -->
    @if (phase() === 'failure') {
      <div class="screen" style="align-items:center;justify-content:center;padding:32px 16px;text-align:center;background:linear-gradient(180deg,#FEF2F2 0%,#fff 40%)">
        <div style="animation:shakeX .5s ease forwards;max-width:400px;width:100%">
          <div style="margin-bottom:24px"><svg width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" fill="#DC2626" opacity=".1"></circle><circle cx="40" cy="40" r="28" fill="#DC2626" opacity=".15"></circle><circle cx="40" cy="40" r="20" fill="#DC2626"></circle><path d="M30 30l20 20M50 30l-20 20" stroke="#fff" stroke-width="3" stroke-linecap="round"></path></svg></div>
          <div style="font-size:22px;font-weight:800;color:#DC2626;margin-bottom:8px">{{ i18n.t('failure_title') }}</div>
          <div style="font-size:14px;color:var(--muted);margin-bottom:24px">{{ failureMsg() || i18n.t('failure_msg') }}</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button (click)="retry()" class="btn btn-primary" style="border-radius:12px">{{ i18n.t('failure_retry') }}</button>
            <button (click)="goHome()" class="btn-soft" style="width:100%;border-radius:12px;padding:14px">{{ i18n.t('failure_home') }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: flex; flex: 1; flex-direction: column; }
    .icon-sq { display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;border:1.5px solid var(--border);background:#fff;cursor:pointer;transition:all .2s;flex-shrink:0 }
    .icon-sq:hover { border-color: var(--primary); background:#F9FAFB }
    .chip { flex-shrink:0;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:#fff;color:var(--label);transition:all .2s }
    .chip-on { border-color: var(--primary); background:#FEF2F2; color: var(--primary) }
    .prod-card { border-radius:14px;border:2px solid var(--border);background:#fff;transition:all .2s;width:100%;overflow:hidden }
    .prod-card:hover { border-color: var(--primary); box-shadow:0 2px 12px rgba(200,16,46,.08) }
    .prod-on { border-color: var(--primary); background:#FEF2F2 }
    .prod-head { display:flex;gap:14px;padding:16px;width:100%;border:none;background:transparent;font:inherit;color:inherit;cursor:pointer;text-align:left }
    .pkg-tag { padding:2px 6px;border-radius:4px;background:#EEF2FF;color:#4338CA;font-size:10px;font-weight:700;letter-spacing:.5px }
    .pkg-toggle { display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:9px 16px;border:none;border-top:1px dashed var(--border-2);background:transparent;font:inherit;font-size:12px;font-weight:700;color:var(--primary);cursor:pointer }
    .pkg-toggle:hover { background:rgba(200,16,46,.04) }
    .pkg-body { padding:2px 16px 14px }
    .pkg-desc { font-size:12px;color:var(--muted);line-height:1.45;white-space:pre-line;margin-bottom:10px }
    .pkg-h { font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.5px;text-transform:uppercase;margin-bottom:2px }
    .pkg-row { display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border) }
    .pkg-row:last-of-type { border-bottom:none }
    .pkg-l { display:flex;align-items:center;gap:6px;min-width:0;font-size:12.5px;color:var(--navy);text-align:left }
    .pkg-v { flex-shrink:0;font-size:12px;font-weight:700;color:var(--navy) }
    .pkg-inc { color:#059669 }
    .pkg-note { margin-top:8px;padding:8px 10px;border-radius:8px;background:var(--surface-2);font-size:11px;color:var(--muted);line-height:1.4 }
    .scroll-hint { position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:55;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;border:none;background:var(--primary);color:#fff;box-shadow:0 6px 18px rgba(200,16,46,.35);cursor:pointer;animation:hintBounce 1.6s ease infinite }
    .scroll-hint:hover { background:#A50D26 }
    @keyframes hintBounce { 0%,100%{transform:translateX(-50%) translateY(0)} 50%{transform:translateX(-50%) translateY(5px)} }
    .prod-mini { flex-shrink:0;width:64px;height:42px;border-radius:6px;display:flex;align-items:flex-end;justify-content:flex-end;padding:4px 6px;position:relative;overflow:hidden }
    .promo-tag { padding:2px 6px;border-radius:4px;background:#FEF2F2;color:var(--primary);font-size:10px;font-weight:700;letter-spacing:.5px }
    .radio { width:22px;height:22px;border-radius:50%;border:2px solid var(--border-2);display:flex;align-items:center;justify-content:center;transition:all .2s }
    .radio-on { border-color: var(--primary) }
    .radio-dot { width:12px;height:12px;border-radius:50%;background:var(--primary) }
    .fld { margin-bottom:16px }
    .lab { display:block;font-size:13px;font-weight:600;color:var(--label);margin-bottom:6px }
    .in { width:100%;padding:12px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:15px;background:var(--surface-2);transition:all .2s }
    .in-err { border-color:var(--primary) !important }
    .ferr { font-size:11.5px;color:var(--primary);margin-top:5px;font-weight:600 }
    .fhint { font-size:11.5px;color:var(--muted);margin-top:5px;line-height:1.35 }
    .prefix { flex-shrink:0;padding:12px 10px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;color:var(--muted);background:var(--surface-3);font-weight:600 }
    .seg { padding:12px;border-radius:10px;border:1.5px solid var(--border);background:#fff;font-size:14px;font-weight:600;color:var(--label);cursor:pointer;transition:all .2s }
    .seg-on { border-color: var(--primary); background:#FEF2F2; color: var(--primary) }
    .dashed { margin-bottom:16px;padding:16px;background:#F9FAFB;border-radius:12px;border:1px dashed var(--border-2) }
    .slide-r { animation: slideRight .3s ease }
    .kyc-ok { position:relative;border-radius:12px;overflow:hidden;border:2px solid #059669;background:#ECFDF5 }
    .kyc-ok-in { width:100%;height:180px;background:linear-gradient(135deg,#E5E7EB,#D1D5DB);display:flex;flex-direction:column;align-items:center;justify-content:center }
    .retake { position:absolute;top:8px;right:8px;padding:6px 12px;border-radius:8px;background:rgba(0,0,0,.6);color:#fff;border:none;font-size:11px;font-weight:600;cursor:pointer }
    .kyc-empty { width:100%;height:180px;border-radius:12px;border:2px dashed var(--border-2);background:var(--surface-2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:all .2s }
    .kyc-empty:hover { border-color: var(--primary); background:#FEF2F2 }
    .kyc-cam { width:48px;height:48px;border-radius:12px;background:var(--surface-3);display:flex;align-items:center;justify-content:center }
    .selfie-circle { width:200px;height:200px;border-radius:50%;display:flex;align-items:center;justify-content:center }
    .opt { display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;border:1.5px solid var(--border);background:#fff;cursor:pointer;transition:all .2s;width:100% }
    .opt-on { border-color: var(--primary) }
    .pm { display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 12px;border-radius:12px;border:2px solid var(--border);background:#fff;cursor:pointer;transition:all .2s }
    .pm-ic { width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center }
    .card-visual { margin-bottom:20px;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,#C8102E 0%,#7A0B1E 50%,#1B1B2F 100%);padding:24px 20px;aspect-ratio:1.6;display:flex;flex-direction:column;justify-content:space-between }
    .sum-card { background:#F9FAFB;border-radius:14px;padding:18px;margin-bottom:14px }
    .sum-h { font-size:13px;font-weight:700;color:var(--navy);margin-bottom:12px;display:flex;align-items:center;gap:6px }
    .sum-row { display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);gap:8px }
    .sum-k { font-size:12px;color:var(--muted);flex-shrink:0 }
    .sum-v { font-size:12px;font-weight:600;color:var(--navy);text-align:right;overflow-wrap:break-word;min-width:0 }
  `],
})
export class SubscribePage implements OnDestroy {
  protected i18n = inject(I18n);
  protected api = inject(Api);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private auth = inject(Auth);

  /** Timer du suivi de paiement mobile money (polling du statut backend). */
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * « Accueil » = racine du portail. Dans le système unifié, le shell redirige
   * `/` vers le hub (/diaspora/home) ; en standalone promote, `/` redirige vers
   * la home promote. On ne renvoie donc jamais vers la page interne de promote
   * dans le portail unifié.
   */
  private goToHome() { this.router.navigateByUrl('/'); }

  phase = signal<Phase>('funnel');
  step = signal(0);
  error = signal('');
  touched = signal(false);
  submitting = signal(false);
  readonly niuMax = NIU_MAX;
  readonly todayIso = new Date().toISOString().slice(0, 10);

  scrollArea = viewChild<ElementRef<HTMLDivElement>>('scrollArea');
  canScrollMore = signal(false);

  products = signal<ProductDto[]>([]);
  /** Le catalogue a répondu : avant, « aucun produit » serait un mensonge — c'est un chargement. */
  catalogLoaded = signal(false);
  productCategories = signal<ProductCategoryDto[]>([]);
  config = signal<ConfigDto | null>(null);
  agencies = signal<AgencyDto[]>([]);
  cat = signal('__all');
  selected = signal<ProductDto | null>(null);
  /** Produit dont le contenu de package est déroulé (un seul à la fois). */
  openPackage = signal<number | null>(null);

  // step 1
  firstName = signal(''); lastName = signal(''); sexe = signal(''); idType = signal('cni');
  idNumber = signal(''); niu = signal(''); expiry = signal(''); birth = signal('');
  phone = signal(''); email = signal(''); district = signal(''); city = signal(''); referrer = signal('');
  geo = signal<{ lat: number; lng: number; acc: number } | null>(null);
  // step 2/3 — previews + storage keys
  cniRectoData = signal<string | null>(null);
  cniVersoData = signal<string | null>(null);
  selfieData = signal<string | null>(null);
  cniRectoKey = signal(''); cniVersoKey = signal(''); selfieKey = signal('');
  uploading = signal<'cni-recto' | 'cni-verso' | 'selfie' | 'sara' | ''>('');
  readonly cniTips = ['cni_tip_flat', 'cni_tip_light', 'cni_tip_glare', 'cni_tip_frame'];
  // step 4
  delivery = signal('promote'); deliveryAgency = signal('');
  payMethod = signal(''); momoPhone = signal(''); saraRef = signal(''); saraReceiptKey = signal('');
  // result
  createdRef = signal(''); failureMsg = signal('');

  deliveryOptions = [
    { id: 'promote', label: 'delivery_promote' },
    { id: 'agence', label: 'delivery_agence' },
    { id: 'home', label: 'delivery_home' },
  ];
  payMethods = [
    { id: 'om', label: 'pay_om', icon: 'OM', color: '#FF7900', text: '#fff' },
    { id: 'mtn', label: 'pay_mtn', icon: 'MTN', color: '#FFCB05', text: '#1B1B2F' },
    { id: 'cash', label: 'pay_cash', icon: '₣', color: '#059669', text: '#fff' },
    { id: 'sara', label: 'pay_sara', icon: 'S', color: '#1B1B2F', text: '#fff' },
  ];

  /**
   * Catégories que le backend autorise dans le tunnel (actives + `subscriptionVisible`).
   * Vide = on n'a pas pu les charger (ou mode démo hors ligne) : on ne masque alors rien,
   * plutôt que de présenter un catalogue vide au client.
   */
  private visibleCategories = computed(() => new Map(this.productCategories().map((c) => [c.code, c])));

  /** Un produit rattaché à une catégorie que l'admin a retirée du tunnel n'est pas vendable ici. */
  private inVisibleCategory = (p: ProductDto) => {
    const meta = this.visibleCategories();
    return meta.size === 0 || !p.groupCode || meta.has(p.groupCode);
  };

  categories = computed(() => {
    // Ne proposer que les catégories ayant au moins un produit VISIBLE (actif, non archivé) :
    // une catégorie sans produit vendable ne doit pas apparaître côté utilisateur.
    const meta = this.visibleCategories();
    const codes = new Set<string>();
    for (const p of this.sellableProducts()) if (p.groupCode) codes.add(p.groupCode);
    const sorted = [...codes].sort((a, b) =>
      (meta.get(a)?.sortOrder ?? 99) - (meta.get(b)?.sortOrder ?? 99) || a.localeCompare(b));
    // Le chip affiche le libellé de la catégorie (« Cartes »), pas son code technique (« carte »).
    return [
      { code: '__all', label: this.i18n.t('cat_all') },
      ...sorted.map((code) => ({ code, label: meta.get(code)?.label || code })),
    ];
  });

  private sellableProducts = computed(() =>
    this.products().filter((p) => p.active && !p.archived && this.inVisibleCategory(p)));

  filteredProducts = computed(() => {
    const c = this.cat();
    return this.sellableProducts().filter((p) => c === '__all' || p.groupCode === c);
  });

  /** Contenu vendable de chaque produit (id → composants), hors clés de tarification réservées. */
  private packageItemsById = computed(() => {
    const m = new Map<number, ProductComponentDto[]>();
    for (const p of this.products()) {
      m.set(p.id, (p.components ?? []).filter((c) => !CONFIG_CKEYS.has(c.ckey) && !!c.label?.trim()));
    }
    return m;
  });
  packageItems = (p: ProductDto): ProductComponentDto[] => this.packageItemsById().get(p.id) ?? [];
  isPackage = (p: ProductDto) => this.packageItems(p).length > 0;
  isPackageOpen = (p: ProductDto) => this.openPackage() === p.id;
  togglePackage(p: ProductDto) { this.openPackage.set(this.isPackageOpen(p) ? null : p.id); }
  selectedPackageItems = computed(() => {
    const p = this.selected();
    return p ? (this.packageItemsById().get(p.id) ?? []) : [];
  });

  /**
   * Tarif du produit sélectionné, calqué sur `SubscriptionService.total()` : le client règle le
   * prix du produit (promo comprise) + le transport si livraison à domicile — rien d'autre. Le
   * transport peut être surchargé par un composant `transport` du produit, comme côté backend
   * (`configForProduct`). Toute divergence ici se traduirait par un débit ≠ du montant affiché.
   */
  private tariff = computed(() => {
    const p = this.selected();
    const override = (p?.components ?? []).find((c) => c.ckey === 'transport')?.amount;
    return {
      price: p?.effectivePrice ?? 0,
      transport: this.delivery() === 'home' ? (override ?? this.config()?.transport ?? 0) : 0,
    };
  });

  total = computed(() => this.tariff().price + this.tariff().transport);

  personalRows = computed(() => [
    { label: this.i18n.t('field_firstname'), value: this.firstName() },
    { label: this.i18n.t('field_lastname'), value: this.lastName() },
    { label: this.i18n.t('field_idnumber'), value: this.idNumber() },
    { label: this.i18n.t('field_phone'), value: formatPhone(this.phone()) },
    { label: this.i18n.t('field_email'), value: this.email() },
    { label: this.i18n.t('field_city'), value: this.city() },
  ]);
  /** Détail du montant réellement débité — une ligne par composante non nulle. */
  tariffRows = computed(() => {
    const t = this.tariff();
    const rows = [{ label: this.selected()?.label ?? '', value: this.price(t.price) }];
    if (t.transport > 0) rows.push({ label: this.i18n.t('delivery_home'), value: this.price(t.transport) });
    return rows;
  });

  constructor() {
    this.api.products().subscribe({
      next: (p) => { this.products.set(p?.length ? p : DEMO_PRODUCTS); this.catalogLoaded.set(true); },
      error: () => { this.products.set(DEMO_PRODUCTS); this.catalogLoaded.set(true); },
    });
    // `true` : seules les catégories que l'admin expose au tunnel public.
    this.api.productCategories(true).subscribe({
      next: (c) => this.productCategories.set(c),
      error: () => {}, // sans catégories : aucun filtrage, chips sur le code du groupe
    });
    this.api.config().subscribe((c) => this.config.set(c));
    this.api.agencies().subscribe((a) => this.agencies.set(a));
    // Pré-remplissage « Reprendre un prospect » : identité passée en query params depuis /prospects.
    const q = this.route.snapshot.queryParamMap;
    if (q.get('prenom')) this.firstName.set(q.get('prenom')!.trim());
    if (q.get('nom')) this.lastName.set(q.get('nom')!.trim());
    if (q.get('phone')) this.phone.set(q.get('phone')!.trim());
    // Réévalue l'indicateur « défiler pour voir plus » quand la liste/le filtre/l'étape change
    effect(() => {
      this.filteredProducts(); this.cat(); this.step(); this.scrollArea();
      setTimeout(() => this.updateScrollHint());
    });
  }

  onScroll() { this.updateScrollHint(); }

  scrollDown() {
    const el = this.scrollArea()?.nativeElement;
    if (el) el.scrollBy({ top: el.clientHeight * 0.8, behavior: 'smooth' });
  }

  private updateScrollHint() {
    const el = this.scrollArea()?.nativeElement;
    if (!el || this.step() !== 0) { this.canScrollMore.set(false); return; }
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.canScrollMore.set(remaining > 24);
  }

  val(e: Event) { return (e.target as HTMLInputElement).value; }

  onIdNumber(e: Event) {
    const v = (e.target as HTMLInputElement).value.replace(/[^0-9A-Za-z-]/g, '').toUpperCase().slice(0, 20);
    this.idNumber.set(v);
  }

  onNiu(e: Event) {
    const v = (e.target as HTMLInputElement).value.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, NIU_MAX);
    this.niu.set(v);
  }

  selectPayMethod(id: string) {
    this.payMethod.set(id);
    if ((id === 'om' || id === 'mtn') && !this.momoPhone()) this.momoPhone.set(this.phone());
  }

  /** Per-field validation map for step 1 (identity). */
  private fieldErrors(): Record<string, string | null> {
    const docOk = this.idType() === 'cni'
      ? /^[0-9A-Z]{6,}$/.test(this.idNumber().trim())
      : /^[0-9A-Z-]{5,}$/.test(this.idNumber().trim());
    const phoneOk = isValidPhoneNumber(this.phone());
    const emailOk = /^\S+@\S+\.\S+$/.test(this.email().trim());
    const expiryDate = this.expiry() ? new Date(this.expiry()) : null;
    const birthDate = this.birth() ? new Date(this.birth()) : null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const ref = this.referrer().trim();
    const refOk = !ref || isValidPhoneNumber(ref);
    const niuVal = this.niu().trim();
    return {
      firstName: !this.firstName().trim() ? this.i18n.t('required') : null,
      lastName: !this.lastName().trim() ? this.i18n.t('required') : null,
      sexe: !this.sexe() ? this.i18n.t('required') : null,
      idNumber: !this.idNumber().trim() ? this.i18n.t('required')
        : !docOk ? this.i18n.t(this.idType() === 'cni' ? 'cni_invalid' : 'doc_num_invalid') : null,
      niu: niuVal && niuVal.length > NIU_MAX ? this.i18n.t('niu_invalid') : null,
      expiry: !this.expiry() ? this.i18n.t('required')
        : !expiryDate || expiryDate < today ? this.i18n.t('exp_expired') : null,
      birth: this.idType() !== 'cni' ? null
        : !this.birth() ? this.i18n.t('required')
        : !birthDate || birthDate >= today ? this.i18n.t('birth_invalid') : null,
      phone: !this.phone() ? this.i18n.t('required') : !phoneOk ? this.i18n.t('invalid_phone') : null,
      email: !this.email().trim() ? this.i18n.t('required') : !emailOk ? this.i18n.t('email_invalid') : null,
      district: !this.district().trim() ? this.i18n.t('required') : null,
      city: !this.city().trim() ? this.i18n.t('required') : null,
      referrer: !refOk ? this.i18n.t('invalid_phone') : null,
    };
  }

  /** Show a field error after the step was submitted or the field has enough input. */
  fieldErr(key: string): string | null {
    if (!this.touched()) return null;
    return this.fieldErrors()[key] ?? null;
  }

  private step1Valid(): boolean {
    return !Object.values(this.fieldErrors()).some(Boolean);
  }

  private momoPhoneError(): string | null {
    const m = this.payMethod();
    if (m !== 'om' && m !== 'mtn') return null;
    const v = this.momoPhone();
    if (!v) return this.i18n.t('required');
    if (!isValidPhoneNumber(v)) return this.i18n.t('invalid_phone');
    const p = parsePhoneNumberFromString(v);
    if (p?.country === 'CM' && !matchesOperator(m, p.nationalNumber as string)) {
      return this.i18n.t(m === 'mtn' ? 'pay_phone_not_mtn' : 'pay_phone_not_om');
    }
    return null;
  }

  momoPhoneErr(): string | null {
    return this.touched() ? this.momoPhoneError() : null;
  }

  price = (n: number) => fcfa(n);
  hasPromo = (p: ProductDto) => p.effectivePrice < p.basePrice || (p.promotions?.some((x) => x.active) ?? false);
  cardGradient = (p: ProductDto) =>
    p.groupCode?.toLowerCase().includes('visa') ? 'linear-gradient(135deg,#1B1B2F,#3A3A5A)'
    : p.groupCode?.toLowerCase().includes('master') || p.groupCode?.toLowerCase().includes('mc') ? 'linear-gradient(135deg,#7A0B1E,#C8102E)'
    : 'linear-gradient(135deg,#C8102E,#7A0B1E)';

  /** Sélectionner un package déroule aussitôt son contenu : le client voit ce qu'il achète. */
  selectProduct(p: ProductDto) {
    this.selected.set(p);
    this.openPackage.set(this.isPackage(p) ? p.id : null);
  }

  /** Le backend expose des types techniques (CARD/BANK) : on les traduit pour le client.
   *  Un package porte déjà son badge, on ne double pas l'information. */
  kindLabel(p: ProductDto): string {
    const key = { CARD: 'kind_card', BANK: 'kind_bank' }[p.kind];
    return key ? this.i18n.t(key) : p.kind;
  }

  captureGeo() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => this.geo.set({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      () => this.error.set('Géolocalisation indisponible.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  /** Upload captured KYC image to backend storage. */
  private uploadImage(dataUrl: string, kind: 'cni-recto' | 'cni-verso' | 'selfie', onKey: (key: string) => void) {
    this.uploading.set(kind);
    this.error.set('');
    this.api.uploadKycImage(dataUrl, kind).subscribe({
      next: (r) => { this.uploading.set(''); onKey(r.key); },
      error: (e) => {
        this.uploading.set('');
        const code = e?.error?.error;
        this.error.set(code === 'image_too_large'
          ? this.i18n.t('err_image_too_large')
          : code === 'invalid_kind'
            ? this.i18n.t('err_image_kind')
            : this.i18n.t('err_image_upload'));
      },
    });
  }

  onCniRecto(dataUrl: string) {
    this.cniRectoData.set(dataUrl);
    this.cniRectoKey.set('');
    this.uploadImage(dataUrl, 'cni-recto', (k) => this.cniRectoKey.set(k));
  }
  onRetakeRecto() { this.cniRectoData.set(null); this.cniRectoKey.set(''); }

  onCniVerso(dataUrl: string) {
    this.cniVersoData.set(dataUrl);
    this.cniVersoKey.set('');
    this.uploadImage(dataUrl, 'cni-verso', (k) => this.cniVersoKey.set(k));
  }
  onRetakeVerso() { this.cniVersoData.set(null); this.cniVersoKey.set(''); }

  onSelfie(dataUrl: string) {
    this.selfieData.set(dataUrl);
    this.selfieKey.set('');
    this.uploadImage(dataUrl, 'selfie', (k) => this.selfieKey.set(k));
  }
  onRetakeSelfie() { this.selfieData.set(null); this.selfieKey.set(''); }

  /** SARA receipt — file picker fallback (PDF/image). */
  captureSara() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        this.uploading.set('sara');
        this.error.set('');
        this.api.uploadReceipt(dataUrl).subscribe({
          next: (r) => {
            this.uploading.set('');
            this.saraReceiptKey.set(r.key);
            if (r.reference) this.saraRef.set(r.reference);
          },
          error: () => { this.uploading.set(''); this.error.set(this.i18n.t('err_image_upload')); },
        });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  private toFr(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
  }

  private validate(): string {
    const s = this.step();
    if (s === 0 && !this.selected()) return this.i18n.t('select_product');
    if (s === 1) {
      this.touched.set(true);
      if (!this.step1Valid()) return this.i18n.t('err_required_fields');
    }
    if (s === 2) {
      if (!this.cniRectoKey() || (this.idType() !== 'passport' && !this.cniVersoKey())) return this.i18n.t('err_kyc_required');
    }
    if (s === 3 && !this.selfieKey()) return this.i18n.t('err_selfie_required');
    if (s === 4) {
      if (!this.payMethod()) return this.i18n.t('err_pay_method');
      this.touched.set(true);
      const momoErr = this.momoPhoneError();
      if (momoErr) return momoErr;
    }
    return '';
  }

  next() {
    const err = this.validate();
    if (err) { this.error.set(err); return; }
    this.error.set('');
    if (this.step() < 5) {
      if (this.step() === 0) this.touched.set(false);
      this.step.set(this.step() + 1);
      return;
    }
    this.submit();
  }
  prev() {
    this.error.set('');
    this.touched.set(false);
    if (this.step() === 0) { this.goToHome(); return; }
    this.step.set(this.step() - 1);
  }

  private buildRequest(): CreateSubscriptionRequest {
    return {
      prenom: this.firstName().trim(),
      nom: this.lastName().trim(),
      sexe: this.sexe(),
      docType: this.idType(),
      cni: this.idNumber().trim().toUpperCase(),
      niu: this.niu().trim() || undefined,
      cniExp: this.expiry(),
      phone: this.phone().trim(),
      email: this.email().trim(),
      quartier: this.district().trim(),
      ville: this.city().trim(),
      pay: this.payMethod(),
      payPhone: this.momoPhone().trim() || undefined,
      delivery: this.delivery(),
      selfie: !!this.selfieKey(),
      selfieKey: this.selfieKey() || undefined,
      cniRectoKey: this.cniRectoKey() || undefined,
      cniVersoKey: this.cniVersoKey() || undefined,
      saraReceiptKey: this.saraReceiptKey() || undefined,
      saraRef: this.saraRef().trim() || undefined,
      referrerPhone: this.referrer().trim() || undefined,
      latitude: this.geo()?.lat ?? null,
      longitude: this.geo()?.lng ?? null,
      geoAccuracy: this.geo()?.acc ?? null,
      pickupAgencyId: this.delivery() === 'agence' ? this.deliveryAgency() : undefined,
      productCode: this.selected()?.code,
      naissance: this.idType() === 'cni' ? this.toFr(this.birth()) : undefined,
    };
  }

  /** True when a staff member of the sales chain is logged in: their sale is attributed to them
   *  (assisted path, agentId = principal) instead of going through the anonymous public funnel. */
  private isStaffSale(): boolean {
    return this.auth.isLoggedIn()
        && this.auth.hasRole('AGENT', 'CASHIER', 'PRINT_AGENT', 'COLLECTEUR', 'SUPERVISEUR', 'CHEF_EQUIPE', 'MANAGER', 'ADMIN');
  }

  submit() {
    this.submitting.set(true);
    const req = this.buildRequest();
    const create$ = this.isStaffSale()
      ? this.api.createAssistedSubscription(req)
      : this.api.createSelfSubscription(req);
    create$.subscribe({
      next: (sub) => {
        this.submitting.set(false);
        this.createdRef.set(sub.ref);
        const m = this.payMethod();
        if (m === 'om' || m === 'mtn') { this.phase.set('paying'); this.startPolling(sub.ref); }
        else this.phase.set('success');
      },
      error: (e) => {
        this.submitting.set(false);
        this.failureMsg.set(this.submitError(e?.error?.error || e?.error?.message));
        this.phase.set('failure');
      },
    });
  }

  /** Map a known backend error code to a readable message; fall back to the raw text. */
  private submitError(code?: string): string {
    return ({
      product_limit_reached: this.i18n.t('err_product_limit'),
      cni_exists: this.i18n.t('err_cni_exists'),
      product_unavailable: this.i18n.t('err_product_unavailable'),
      cni_invalid: this.i18n.t('cni_invalid'),
      sara_receipt_required: this.i18n.t('err_sara_receipt'),
      card_number_required: this.i18n.t('err_required_fields'),
      invalid_kind: this.i18n.t('err_product_unavailable'),
    } as Record<string, string>)[code || ''] || code || '';
  }

  /** Statuts terminaux renvoyés par le backend (insensible à la casse). */
  private static readonly PAID = ['paid', 'success'];
  private static readonly FAILED = ['failed', 'rejected', 'cancelled', 'canceled', 'expired', 'error'];
  private static readonly MAX_POLL_MS = 3 * 60_000; // abandon après 3 min sans confirmation
  private static readonly POLL_INTERVAL_MS = 3000;

  /**
   * Interroge le backend (payStatus) jusqu'à confirmation réelle du paiement.
   * Le push mobile money est déclenché par le backend à la création de la
   * souscription ; cette page reflète l'état réel, sans plus aucune simulation.
   */
  private startPolling(ref: string) {
    this.stopPolling();
    const started = Date.now();
    let inFlight = false;
    this.pollHandle = setInterval(() => {
      if (inFlight) return;
      if (Date.now() - started > SubscribePage.MAX_POLL_MS) {
        this.stopPolling();
        this.failureMsg.set(this.i18n.t('pay_timeout'));
        this.phase.set('failure');
        return;
      }
      inFlight = true;
      this.api.subscriptionStatus(ref).subscribe({
        next: (s) => {
          inFlight = false;
          const st = (s.payStatus || '').toLowerCase();
          if (SubscribePage.PAID.includes(st)) { this.stopPolling(); this.phase.set('success'); }
          else if (SubscribePage.FAILED.includes(st)) {
            this.stopPolling();
            this.failureMsg.set(s.message || '');
            this.phase.set('failure');
          }
          // sinon (pending/awaiting/initiated) : on continue d'attendre
        },
        error: () => { inFlight = false; }, // erreur réseau transitoire : on réessaiera au prochain tick
      });
    }, SubscribePage.POLL_INTERVAL_MS);
  }

  private stopPolling() {
    if (this.pollHandle) { clearInterval(this.pollHandle); this.pollHandle = null; }
  }

  ngOnDestroy() { this.stopPolling(); }

  copyRef() { navigator.clipboard?.writeText(this.createdRef()); }
  restart() { this.stopPolling(); window.location.reload(); }
  retry() {
    this.stopPolling();
    this.error.set(''); this.failureMsg.set('');
    this.phase.set('funnel'); this.step.set(4);
  }
  goHome() { this.stopPolling(); this.goToHome(); }
}
