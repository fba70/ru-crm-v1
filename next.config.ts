import type { NextConfig } from "next"
import { withWorkflow } from "workflow/next"

const nextConfig: NextConfig = {
  devIndicators: false,
  // Node-only packages that must NOT be bundled — they pull in native/CJS
  // internals (e.g. imapflow uses BigInt + node streams) that break when
  // Turbopack inlines them into the server build ("s.BigInt is not a
  // function"). Keep them external so they're require()'d at runtime.
  serverExternalPackages: ["imapflow", "mailparser", "node-ical"],
  experimental: {
    authInterrupts: true,
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  typescript: {
    ignoreBuildErrors: true,
  },
}

// `withWorkflow` registers the build-time hooks the Vercel Workflow
// SDK needs to compile `'use workflow'` / `'use step'` directives into
// durable function routes.
export default withWorkflow(nextConfig)
