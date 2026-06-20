import "server-only"
import { ImapFlow } from "imapflow"
import type { ImapCredentials } from "@/server/providers/handlers"

// Thin factory for an imapflow client from decrypted per-source credentials.
// The CALLER owns the connection lifecycle:
//
//   const client = buildImapClient(creds)
//   await client.connect()
//   try { … } finally { try { await client.logout() } catch {} }
//
// `secure=true` opens an implicit-TLS connection (typically port 993);
// `secure=false` upgrades via STARTTLS (typically port 143). Timeouts are
// deliberately short — a hung mailbox should fail the sync/parse fast and
// surface a clear error, not block the orchestration pipeline.
export function buildImapClient(creds: ImapCredentials): ImapFlow {
  return new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.user, pass: creds.password },
    // imapflow logs verbosely by default; we don't want its pino output in
    // the server logs (and `false` is the documented "disable" sentinel).
    logger: false,
    greetingTimeout: 15_000,
    connectionTimeout: 20_000,
    socketTimeout: 60_000,
  })
}
