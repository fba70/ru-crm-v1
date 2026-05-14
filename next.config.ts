import type { NextConfig } from "next"
import { withWorkflow } from "workflow/next"

const nextConfig: NextConfig = {
  devIndicators: false,
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
