// Almacenamiento minimo para la lista de espera (y, mas adelante, el tablero de mensajes).
//
// Reglas del sitio:
// - Si no hay almacenamiento configurado, el formulario no se muestra: nunca un boton que falla.
// - Solo se guarda lo que la persona escribe y acepta: un correo y la marca de consentimiento.
// - Produccion: Upstash Redis desde Vercel Marketplace (REST), leido de variables de entorno.
// - Memoria: solo en desarrollo, o con WAITLIST_MEMORY=1 para pruebas y demos. No usar en Vercel.

export interface WaitlistEntry {
  email: string;
  consent: true;
  createdAt: string;
  source: string;
}

export type AddResult = { ok: true } | { ok: false; reason: "already_exists" | "storage_error" };

export interface WaitlistStore {
  add(entry: WaitlistEntry): Promise<AddResult>;
}

class MemoryStore implements WaitlistStore {
  private entries = new Map<string, WaitlistEntry>();

  async add(entry: WaitlistEntry): Promise<AddResult> {
    const key = entry.email.toLowerCase();
    if (this.entries.has(key)) return { ok: false, reason: "already_exists" };
    this.entries.set(key, entry);
    return { ok: true };
  }
}

// Upstash Redis por REST. SET ... NX guarda solo si el correo no existia, de forma atomica.
class UpstashStore implements WaitlistStore {
  constructor(private url: string, private token: string) {}

  async add(entry: WaitlistEntry): Promise<AddResult> {
    const key = `waitlist:${entry.email.toLowerCase()}`;
    try {
      const res = await fetch(`${this.url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify([
          ["SET", key, JSON.stringify(entry), "NX"],
          ["SADD", "waitlist:index", entry.email.toLowerCase()],
        ]),
      });
      if (!res.ok) return { ok: false, reason: "storage_error" };
      const out = (await res.json()) as Array<{ result?: unknown; error?: string }>;
      if (!Array.isArray(out) || out[0]?.error) return { ok: false, reason: "storage_error" };
      return out[0]?.result === "OK" ? { ok: true } : { ok: false, reason: "already_exists" };
    } catch {
      return { ok: false, reason: "storage_error" };
    }
  }
}

let cached: WaitlistStore | null | undefined;

// Devuelve null si no hay almacenamiento configurado.
export function getStore(): WaitlistStore | null {
  if (cached !== undefined) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) cached = new UpstashStore(url.replace(/\/$/, ""), token);
  else if (process.env.NODE_ENV === "development" || process.env.WAITLIST_MEMORY === "1") cached = new MemoryStore();
  else cached = null;
  return cached;
}

// Limite de frecuencia por IP, en memoria de cada instancia: frena el abuso casual, no un ataque.
const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_HITS = 5;

export function checkRateLimit(ip: string, now = Date.now()): { ok: boolean; retryAfter?: number } {
  if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
  const rec = hits.get(ip);
  if (!rec || rec.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }
  if (rec.count >= MAX_HITS) return { ok: false, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
  rec.count += 1;
  return { ok: true };
}
