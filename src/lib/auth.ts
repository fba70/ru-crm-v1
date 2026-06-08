import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db } from "@/db/drizzle"
import { schema, invitation } from "@/db/schema"
import { and, eq, gt } from "drizzle-orm"
import { sendEmails } from "@/lib/email"
import {
  lastLoginMethod,
  organization,
  admin,
  emailOTP,
  oAuthProxy,
} from "better-auth/plugins"
import { apiKey } from "@better-auth/api-key"
import { nextCookies } from "better-auth/next-js"
import { polar, checkout, portal, usage } from "@polar-sh/better-auth"
import { Polar } from "@polar-sh/sdk"
import { getActiveOrganization } from "@/server/organizations"
import {
  uniqueUsernameGenerator,
  Config,
  adjectives,
  nouns,
} from "unique-username-generator"

const config: Config = {
  dictionaries: [adjectives, nouns],
  separator: "-",
  length: 30,
  style: "lowerCase",
}

const polarClient = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  server: "sandbox",
  // Use 'sandbox' if you're using the Polar Sandbox environment
  // Remember that access tokens, products, etc. are completely separated between environments.
  // Access tokens obtained in Production are for instance not usable in the Sandbox environment.
})

export const auth = betterAuth({
  trustedOrigins: [
    "https://app.truffalo.ai",
    "https://business-os-demo.vercel.app",
    "http://localhost:3000",
  ],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: schema,
  }),
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day (every 1 day the session expiration is updated)
    freshAge: 0, // 5 minutes, 0 to disable freshness checks
    additionalFields: {
      activeOrganizationId: {
        type: "string",
        returned: true,
      },
      activeOrganizationName: {
        type: "string",
        returned: true,
      },
      activeOrganizationLogo: {
        type: "string",
        returned: true,
      },
      activeOrganizationSlug: {
        type: "string",
        returned: true,
      },
    },
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      // redirectURI: "https://xxx/api/auth/callback/github",
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // redirectURI: "https://xxx/api/auth/callback/google",
    },
  },
  emailAndPassword: {
    enabled: true,
    async sendResetPassword({ user, url }) {
      await sendEmails({
        to: user.email,
        subject: "Reset your password",
        body: `Click this link to reset your password: ${url}`,
      })
    },
    // requireEmailVerification: true, // if user can access the app without email verified
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, url }) {
      await sendEmails({
        to: user.email,
        subject: "Verify your email address",
        body: `Click this link to verify your email: ${url}`,
      })
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Skip default-org creation when the user is signing up in response
          // to an invitation — they'll join the inviter's org via
          // acceptInvitation. Otherwise they'd end up in two orgs.
          const pendingInvites = await db
            .select({ id: invitation.id })
            .from(invitation)
            .where(
              and(
                eq(invitation.email, user.email),
                eq(invitation.status, "pending"),
                gt(invitation.expiresAt, new Date()),
              ),
            )
            .limit(1)
          if (pendingInvites.length > 0) return

          const slug = uniqueUsernameGenerator(config)
          await auth.api.createOrganization({
            body: {
              name: "My Organization",
              slug: slug,
              logo: "",
              metadata: {},
              userId: user.id,
            },
          })
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const organization = await getActiveOrganization(session.userId)
          return {
            data: {
              ...session,
              activeOrganizationId: organization?.id,
              activeOrganizationName: organization?.name,
              activeOrganizationLogo: organization?.logo,
              activeOrganizationSlug: organization?.slug,
            },
          }
        },
      },
    },
    organization: {
      // Phase 2 bootstrap: every new org gets one source row per
      // `is_default = true` template (currently Files Drop Off + AI
      // Chat). Owners then add Email / GChat / GDrive themselves via
      // the "Add source" picker — those templates are
      // `is_visible_to_orgs = true` but `is_default = false`.
      //
      // Failures here MUST not block org creation — better-auth's
      // hook semantics throw the org-creation flow if the hook errors.
      // We swallow + log so a missing template seed (script not run
      // yet) doesn't lock new users out.
      create: {
        after: async (org: { id: string }) => {
          try {
            const { bootstrapDefaultsForOrg } =
              await import("@/server/templates")
            const result = await bootstrapDefaultsForOrg(org.id)
            console.log(
              `[org-bootstrap] org=${org.id} instantiated=${result.instantiated} alreadyExisted=${result.alreadyExisted}`,
            )
          } catch (err) {
            console.error(
              `[org-bootstrap] failed for org=${org.id}:`,
              err instanceof Error ? err.message : err,
            )
          }
        },
      },
    },
  },
  plugins: [
    lastLoginMethod(),
    nextCookies(),
    emailOTP({
      disableSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        const subjectMap = {
          "sign-in": "Your sign-in code",
          "email-verification": "Verify your email",
          "forget-password": "Your password reset code",
          "change-email": "Confirm your new email",
        } as const
        await sendEmails({
          to: email,
          subject: subjectMap[type],
          body: `
            <p>Your verification code is:</p>
            <p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${otp}</p>
            <p>This code expires in 5 minutes.</p>
          `,
        })
      },
    }),
    organization({
      schema: {
        organization: {
          additionalFields: {
            webUrl: { type: "string", input: true, required: false },
            address: { type: "string", input: true, required: false },
            email: { type: "string", input: true, required: false },
            phone: { type: "string", input: true, required: false },
          },
        },
      },
      async sendInvitationEmail(data) {
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
        const inviteLink = `${appUrl}/accept-invitation/${data.id}`
        await sendEmails({
          to: data.email,
          subject: `You've been invited to join ${data.organization.name}`,
          body: `
            <p>Hi,</p>
            <p><strong>${data.inviter.user.name}</strong> (${data.inviter.user.email}) has invited you to join <strong>${data.organization.name}</strong>.</p>
            <p><a href="${inviteLink}">Click here to accept the invitation</a></p>
            <p>If you don't have an account yet, you'll be able to create one.</p>
          `,
        })
      },
    }),
    admin({
      adminUserIds: ["f4c577O0wsUOkzxTAUeRAHfKNlvLyQeZ"],
    }),
    apiKey(),
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({
          products: [
            {
              productId: "4411934b-5c8e-482d-b9fc-dd88c5ab625f",
              slug: "Test-credit",
            },
          ],
          successUrl: process.env.POLAR_SUCCESS_URL,
          authenticatedUsersOnly: true,
        }),
        portal(),
        usage(),
        // webhooks({
        // secret: process.env.POLAR_WEBHOOK_SECRET,
        // onCustomerStateChanged: (payload) => // Triggered when anything regarding a customer changes
        // onOrderPaid: (payload) => // Triggered when an order was paid (purchase, subscription renewal, etc.)
        // onPayload: (payload) => // Catch-all for all events
        // })
      ],
    }),
    oAuthProxy({
      productionURL:
        process.env.NEXT_PUBLIC_PRODUCTION_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "https://business-os-demo.vercel.app",
      currentURL:
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    }),
  ],
})
