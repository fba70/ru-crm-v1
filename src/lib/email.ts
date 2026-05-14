import { Resend } from "resend"
import nylas from "@/lib/nylas"

/**
 * Email sending is routed through Nylas by default — messages are sent from the
 * Gmail account connected via NYLAS_GRANT_ID (hello@truffalo.ai).
 *
 * The previous Resend implementation is preserved below as `sendEmailsViaResend`
 * so we can switch back, or route specific flows to Resend, without rewriting.
 *
 * To switch the default provider, set EMAIL_PROVIDER=resend | nylas in .env.
 */

const resend = new Resend(process.env.RESEND_API_KEY!)

const RESEND_DEFAULT_FROM = "onboarding@resend.dev"

interface SendEmailValues {
  to: string
  subject: string
  body: string
}

// --- Resend (legacy / fallback) --------------------------------------------

export async function sendEmailsViaResend({
  to,
  subject,
  body,
}: SendEmailValues) {
  const from = process.env.RESEND_FROM || RESEND_DEFAULT_FROM
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html: body,
  })
  if (error) {
    console.error("[resend] send failed", { to, subject, from, error })
    throw new Error(
      `Resend error: ${error.message ?? JSON.stringify(error)}`,
    )
  }
  return data
}

// --- Nylas (default) -------------------------------------------------------

export async function sendEmailsViaNylas({
  to,
  subject,
  body,
}: SendEmailValues) {
  const grantId = process.env.NYLAS_GRANT_ID
  if (!grantId) {
    throw new Error("NYLAS_GRANT_ID is not configured")
  }
  try {
    const { data } = await nylas.messages.send({
      identifier: grantId,
      requestBody: {
        to: [{ email: to }],
        subject,
        body,
      },
    })
    return data
  } catch (err) {
    console.error("[nylas] send failed", {
      to,
      subject,
      grantId,
      err,
    })
    throw err instanceof Error ? err : new Error(String(err))
  }
}

// --- Dispatcher ------------------------------------------------------------

export async function sendEmails(values: SendEmailValues) {
  const provider = (process.env.EMAIL_PROVIDER ?? "nylas").toLowerCase()
  if (provider === "resend") return sendEmailsViaResend(values)
  return sendEmailsViaNylas(values)
}
