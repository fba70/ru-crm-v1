"use client"

import { useState, useTransition } from "react"
import { authClient } from "@/lib/auth-client"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { LoadingButton } from "@/components/blocks/loading-button"
import { PasswordInput } from "@/components/blocks/password-input"
import { Input } from "@/components/ui/input"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  CheckCircle,
  XCircle,
  Loader,
  AlertTriangle,
} from "lucide-react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { passwordSchema } from "@/lib/validation"
import type { PublicInvitation } from "@/server/invitations"

type InvitationInfo = {
  id: string
  email: string
  organizationId: string
  organizationName: string | null
  status: string
  expired: boolean
}

export function AcceptInvitationContent({
  initialInvitation,
}: {
  initialInvitation: PublicInvitation | null
}) {
  const router = useRouter()

  const { data: session, isPending: sessionLoading } = authClient.useSession()

  // Invitation data is loaded server-side and passed in as a prop, so we can
  // compute the error/active state synchronously up-front.
  const { invitation, invitationError } = resolveInvitation(initialInvitation)

  const [acceptState, setAcceptState] = useState<
    "idle" | "accepting" | "success" | "error"
  >("idle")
  const [acceptError, setAcceptError] = useState("")

  async function acceptNow() {
    if (!invitation) return
    setAcceptState("accepting")
    setAcceptError("")
    const { error } = await authClient.organization.acceptInvitation({
      invitationId: invitation.id,
    })
    if (error) {
      setAcceptError(error.message || "Failed to accept invitation")
      toast.error(error.message || "Failed to accept invitation")
      setAcceptState("error")
      return
    }
    // Make the newly joined org the active one
    if (invitation.organizationId) {
      await authClient.organization.setActive({
        organizationId: invitation.organizationId,
      })
    }
    setAcceptState("success")
    toast.success("Invitation accepted!")
    setTimeout(() => router.push("/dashboard"), 1200)
  }

  // -------------------------------------------------------------------------
  // Render branches
  // -------------------------------------------------------------------------

  if (sessionLoading) {
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 pt-6">
            <Loader className="h-6 w-6 animate-spin" />
            <p className="text-sm text-muted-foreground">
              Loading invitation…
            </p>
          </CardContent>
        </Card>
      </Centered>
    )
  }

  if (invitationError || !invitation) {
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 pt-6">
            <XCircle className="h-12 w-12 text-red-500" />
            <p className="text-lg font-medium">Invalid invitation</p>
            <p className="text-sm text-muted-foreground text-center">
              {invitationError ?? "This invitation link is no longer valid."}
            </p>
            <Button onClick={() => router.push("/sign-in")} className="w-full">
              Go to Sign in
            </Button>
          </CardContent>
        </Card>
      </Centered>
    )
  }

  if (acceptState === "success") {
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 pt-6">
            <CheckCircle className="h-12 w-12 text-green-500" />
            <p className="text-lg font-medium">Invitation accepted!</p>
            <p className="text-sm text-muted-foreground">
              Taking you to the dashboard…
            </p>
          </CardContent>
        </Card>
      </Centered>
    )
  }

  // --- Signed in ----------------------------------------------------------
  if (session?.user) {
    const sameEmail =
      session.user.email.toLowerCase() === invitation.email.toLowerCase()

    if (!sameEmail) {
      return (
        <Centered>
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-lg text-center">
                Wrong account
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <p className="text-sm text-center text-muted-foreground">
                This invitation was sent to{" "}
                <strong className="text-foreground">{invitation.email}</strong>
                , but you are signed in as{" "}
                <strong className="text-foreground">
                  {session.user.email}
                </strong>
                .
              </p>
              <p className="text-sm text-center text-muted-foreground">
                Sign out first, then open this invitation link again.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={async () => {
                  await authClient.signOut()
                  // Stay on this page so the next render shows signup/sign-in branch
                  router.refresh()
                }}
              >
                Sign out
              </Button>
            </CardContent>
          </Card>
        </Centered>
      )
    }

    // Signed in with matching email — show accept button
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-lg text-center">
              You&apos;ve been invited
            </CardTitle>
            {invitation.organizationName && (
              <CardDescription className="text-center">
                Join <strong>{invitation.organizationName}</strong>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-center text-muted-foreground">
              Signed in as{" "}
              <strong className="text-foreground">{session.user.email}</strong>
              .
            </p>
            {acceptState === "error" && (
              <p className="text-sm text-red-600 text-center">{acceptError}</p>
            )}
            <LoadingButton
              className="w-full"
              loading={acceptState === "accepting"}
              onClick={acceptNow}
            >
              Accept invitation
            </LoadingButton>
          </CardContent>
        </Card>
      </Centered>
    )
  }

  // --- Not signed in -----------------------------------------------------
  return (
    <Centered>
      <SignUpForInvitation
        invitation={invitation}
        onDone={async () => {
          // After successful signup the user is signed in; now accept + set active.
          await acceptNow()
        }}
      />
    </Centered>
  )
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function resolveInvitation(initial: PublicInvitation | null): {
  invitation: InvitationInfo | null
  invitationError: string | null
} {
  if (!initial) {
    return {
      invitation: null,
      invitationError: "Invitation not found or has expired",
    }
  }
  if (initial.expired) {
    return { invitation: null, invitationError: "This invitation has expired." }
  }
  if (initial.status !== "pending") {
    return {
      invitation: null,
      invitationError: `This invitation is no longer active (status: ${initial.status}).`,
    }
  }
  return {
    invitation: {
      id: initial.id,
      email: initial.email,
      organizationId: initial.organizationId,
      organizationName: initial.organizationName,
      status: initial.status,
      expired: initial.expired,
    },
    invitationError: null,
  }
}

// -----------------------------------------------------------------------------
// Signup form (email locked to invitation.email)
// -----------------------------------------------------------------------------

const signupSchema = z
  .object({
    name: z.string().min(1, { message: "Name is required" }),
    password: passwordSchema,
    passwordConfirmation: z
      .string()
      .min(1, { message: "Please confirm password" }),
  })
  .refine((d) => d.password === d.passwordConfirmation, {
    message: "Passwords do not match",
    path: ["passwordConfirmation"],
  })

type SignupValues = z.infer<typeof signupSchema>

function SignUpForInvitation({
  invitation,
  onDone,
}: {
  invitation: InvitationInfo
  onDone: () => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      password: "",
      passwordConfirmation: "",
    },
  })

  function onSubmit(values: SignupValues) {
    startTransition(async () => {
      setFormError(null)
      const { error } = await authClient.signUp.email({
        name: values.name,
        email: invitation.email,
        password: values.password,
      })
      if (error) {
        if (error.status === 422) {
          const msg =
            "An account with this email already exists — sign in instead."
          setFormError(msg)
          toast.error(msg)
        } else {
          const msg = error.message || "Failed to create account"
          setFormError(msg)
          toast.error(msg)
        }
        return
      }
      await onDone()
    })
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg">You&apos;ve been invited</CardTitle>
        <CardDescription>
          {invitation.organizationName ? (
            <>
              Join <strong>{invitation.organizationName}</strong>. Create an
              account for{" "}
              <strong className="text-foreground">{invitation.email}</strong>
              .
            </>
          ) : (
            <>
              Create an account for{" "}
              <strong className="text-foreground">{invitation.email}</strong>
              .
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input value={invitation.email} disabled />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                Locked to the invited address.
              </p>
            </FormItem>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Your name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="new-password"
                      placeholder="Password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="passwordConfirmation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="new-password"
                      placeholder="Confirm password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {formError && (
              <p role="alert" className="text-sm text-red-600">
                {formError}
              </p>
            )}

            <LoadingButton type="submit" loading={isPending} className="w-full">
              Create account & accept invitation
            </LoadingButton>
          </form>
        </Form>

        <div className="mt-4 pt-4 border-t text-center text-xs text-muted-foreground">
          Already have an account with <strong>{invitation.email}</strong>?{" "}
          <Link
            href={`/sign-in?callbackURL=/accept-invitation/${invitation.id}`}
            className="underline"
          >
            Sign in
          </Link>{" "}
          and you&apos;ll be brought back to accept.
        </div>
      </CardContent>
    </Card>
  )
}

// -----------------------------------------------------------------------------

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      {children}
    </main>
  )
}
