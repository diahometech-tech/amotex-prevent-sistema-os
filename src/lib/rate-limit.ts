// Rate limiter em memória, janela deslizante simples por chave (ex.: IP).
// Seguro pro NexusFlow porque o PM2 roda em `instances: 1` (fork único,
// ver ecosystem.config.js) — não há múltiplos processos disputando estado
// que um limiter em memória não veria. Se isso mudar pra cluster/múltiplas
// instâncias, este limiter precisa virar Redis ou equivalente compartilhado.

type Bucket = { attempts: number[]; blockedUntil?: number };

const buckets = new Map<string, Bucket>();

// Limpa entradas velhas periodicamente pra não vazar memória indefinidamente
// (chaves de IPs que pararam de tentar ficam presas no Map pra sempre, senão).
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    const stale = (!bucket.blockedUntil || bucket.blockedUntil < now) &&
      (bucket.attempts.length === 0 || bucket.attempts[bucket.attempts.length - 1] < now - SWEEP_INTERVAL_MS);
    if (stale) buckets.delete(key);
  }
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds?: number };

/**
 * Verifica se `key` ainda pode tentar. Não registra tentativa — chame
 * `recordFailure(key, ...)` separadamente após uma falha real.
 */
export function checkRateLimit(key: string, windowMs: number, maxAttempts: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket) return { allowed: true };
  if (bucket.blockedUntil && bucket.blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.blockedUntil - now) / 1000) };
  }
  const recent = bucket.attempts.filter((t) => t > now - windowMs);
  bucket.attempts = recent;
  if (recent.length >= maxAttempts) {
    bucket.blockedUntil = now + windowMs;
    return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }
  return { allowed: true };
}

/** Registra uma tentativa malsucedida (chamar só em falha, nunca em sucesso). */
export function recordFailure(key: string, windowMs: number, maxAttempts: number): void {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { attempts: [] };
  bucket.attempts = [...bucket.attempts.filter((t) => t > now - windowMs), now];
  if (bucket.attempts.length >= maxAttempts) {
    bucket.blockedUntil = now + windowMs;
  }
  buckets.set(key, bucket);
}

/** Limpa o bucket de uma chave (chamar em sucesso, pra não penalizar acertos futuros). */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}
