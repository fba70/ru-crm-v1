import { drizzle } from 'drizzle-orm/neon-http';
import { neonConfig } from '@neondatabase/serverless';
import { schema } from './schema';

// Force a fresh connection per request instead of reusing a pooled
// keep-alive socket. On this dev machine's network, idle Neon HTTP
// connections were getting silently dropped (some middlebox/router/AV
// between here and Neon's eu-central-1 endpoint appears to kill idle
// sockets), so the next query reused over that half-dead connection failed
// with ECONNRESET/"fetch failed" — intermittent, but frequent enough to
// make every page ("no cards"/"no companies") look like data loss. `curl`
// never hit this because it opens a brand-new connection on every call,
// which is what we now force here too. Costs one extra TLS handshake per
// query (Neon's edge responds in ~200-300ms either way), trading a little
// latency for not silently failing.
neonConfig.fetchFunction = (url: string | URL, init?: RequestInit) =>
  fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Connection: 'close' },
  });

export const db = drizzle(process.env.DATABASE_URL!, { schema });
