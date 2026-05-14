"use client"

import { LoadingButton } from "@/components/blocks/loading-button"
import { PasswordInput } from "@/components/blocks/password-input"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { passwordSchema } from "@/lib/validation"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { authClient } from "@/lib/auth-client"
import { z } from "zod"

const signUpSchema = z
  .object({
    name: z.string().min(1, { message: "Name is required" }),
    email: z.email({ message: "Please enter a valid email" }),
    password: passwordSchema,
    passwordConfirmation: z
      .string()
      .min(1, { message: "Please confirm password" }),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "Passwords do not match",
    path: ["passwordConfirmation"],
  })

type SignUpValues = z.infer<typeof signUpSchema>

export function SignUpForm() {
  const [error, setError] = useState<string | null>(null)
  const [pendingInviteEmail, setPendingInviteEmail] = useState<string | null>(
    null,
  )

  const router = useRouter()

  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      passwordConfirmation: "",
    },
  })

  async function onSubmit({ email, password, name }: SignUpValues) {
    setError(null)
    setPendingInviteEmail(null)

    // Block standalone signup if the email has a live invitation — the user
    // should use the invite link instead (so they end up in the inviter's org
    // rather than a fresh "My Organization").
    try {
      const res = await fetch(
        `/api/invitations/check?email=${encodeURIComponent(email)}`,
        { cache: "no-store" },
      )
      if (res.ok) {
        const body = (await res.json()) as { hasPending?: boolean }
        if (body.hasPending) {
          setPendingInviteEmail(email)
          return
        }
      }
    } catch {
      // If the check endpoint fails we let signup proceed — better to allow
      // creation than block indefinitely on a transient error.
    }

    const { error } = await authClient.signUp.email({
      email: email,
      password: password,
      name: name,
      callbackURL: "/account",
    })

    if (error) {
      if (error.status === 422) {
        setError("Email address is already used, please select another one")
        toast.error("Email address is already used, please select another one")
      } else {
        setError(error.message || "Unknown authorization error")
        toast.error(error.message || "Unknown authorization error")
      }
    } else {
      toast.success("Sign-Up is successful!")
      router.push("/dashboard")
    }
  }

  const loading = form.formState.isSubmitting

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg md:text-xl">Sign Up</CardTitle>
        <CardDescription className="text-xs md:text-sm">
          Enter your information to create an account
        </CardDescription>
      </CardHeader>
      <CardContent>
        {pendingInviteEmail && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
          >
            <p className="font-medium">You have a pending invitation.</p>
            <p className="mt-1 text-xs">
              An organization has already invited{" "}
              <strong>{pendingInviteEmail}</strong>. Please use the invitation
              link from your email to join. If you don&apos;t have it, ask the
              organization administrator to resend it.
            </p>
          </div>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="John Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      {...field}
                      onChange={(e) => {
                        field.onChange(e)
                        if (pendingInviteEmail) setPendingInviteEmail(null)
                      }}
                    />
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
                  <FormLabel>Confirm Password</FormLabel>
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

            {error && (
              <div role="alert" className="text-sm text-red-600">
                {error}
              </div>
            )}

            <LoadingButton
              type="submit"
              className="w-full mt-2"
              loading={loading}
            >
              Create an account
            </LoadingButton>
          </form>
        </Form>
      </CardContent>
      <CardFooter>
        <div className="flex w-full justify-center border-t pt-4">
          <p className="text-muted-foreground text-center text-xs">
            Already have an account?{" "}
            <Link href="/sign-in" className="underline">
              Sign in
            </Link>
          </p>
        </div>
      </CardFooter>
    </Card>
  )
}
