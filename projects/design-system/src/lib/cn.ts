/**
 * cn — équivalent Angular de ui-components/src/utils/index.ts (clsx + tailwind-merge).
 * Version sans dépendance : concatène les classes tronquées. Si tailwind-merge est
 * installé plus tard, remplacer par `twMerge(clsx(inputs))`.
 */
export type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

function toVal(mix: ClassValue): string {
  let str = '';
  if (typeof mix === 'string' || typeof mix === 'number') {
    str += mix;
  } else if (Array.isArray(mix)) {
    for (const m of mix) {
      const v = toVal(m);
      if (v) str += (str && ' ') + v;
    }
  } else if (mix && typeof mix === 'object') {
    for (const k in mix) {
      if (mix[k]) str += (str && ' ') + k;
    }
  }
  return str;
}

export function cn(...inputs: ClassValue[]): string {
  let str = '';
  for (const i of inputs) {
    const v = toVal(i);
    if (v) str += (str && ' ') + v;
  }
  // dédoublonnage simple (garde la dernière occurrence d'une classe exacte)
  const seen = new Set<string>();
  const out: string[] = [];
  const parts = str.split(/\s+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!seen.has(parts[i])) {
      seen.add(parts[i]);
      out.unshift(parts[i]);
    }
  }
  return out.join(' ');
}
