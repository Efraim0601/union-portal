import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AdminAuth } from './admin-auth';

/** Attache le token admin (si présent) aux appels /api/* — seules les écritures /api/lookups/*
 *  (PUT) l'exigent réellement (cf. mock-api.interceptor.ts), le reste l'ignore sans effet. */
export const adminTokenInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.includes('/api/')) return next(req);
  const token = inject(AdminAuth).token();
  if (!token) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
