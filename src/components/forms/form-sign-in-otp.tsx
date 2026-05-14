"use client"

import { LoadingButton } from "@/components/blocks/loading-button"
import { Button } from "@/components/ui/button"
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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { authClient } from "@/lib/auth-client"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

const emailSchema = z.object({
  email: z.email({ message: "Please enter a valid email" }),
})
type EmailValues = z.infer<typeof emailSchema>

const otpSchema = z.object({
  otp: z.string().length(6, { message: "Enter the 6-digit code" }),
})
type OtpValues = z.infer<typeof otpSchema>

export function SignInOtpForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get("redirect") || "/dashboard"

  const [step, setStep] = useState<"email" | "otp">("email")
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)

  const emailForm = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "" },
  })

  const otpForm = useForm<OtpValues>({
    resolver: zodResolver(otpSchema),
    defaultValues: { otp: "" },
  })

  async function onRequestOtp({ email }: EmailValues) {
    setError(null)
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    })
    if (error) {
      const msg = error.message || "Failed to send code"
      setError(msg)
      toast.error(msg)
      return
    }
    setEmail(email)
    setStep("otp")
    toast.success("Code sent. Check your email.")
  }

  async function onVerifyOtp({ otp }: OtpValues) {
    setError(null)
    const { error } = await authClient.signIn.emailOtp({ email, otp })
    if (error) {
      const msg = error.message || "Invalid or expired code"
      setError(msg)
      toast.error(msg)
      return
    }
    toast.success("Signed in!")
    router.push(redirect)
  }

  async function onResend() {
    setError(null)
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    })
    if (error) {
      toast.error(error.message || "Failed to resend code")
      return
    }
    toast.success("New code sent.")
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg md:text-xl">Sign in with code</CardTitle>
        <CardDescription className="text-xs md:text-sm">
          {step === "email"
            ? "Enter your email and we'll send you a one-time code."
            : `Enter the 6-digit code sent to ${email}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === "email" ? (
          <Form {...emailForm}>
            <form
              onSubmit={emailForm.handleSubmit(onRequestOtp)}
              className="space-y-4"
            >
              <FormField
                control={emailForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="your@email.com"
                        autoComplete="email"
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
                className="w-full"
                loading={emailForm.formState.isSubmitting}
              >
                Send code
              </LoadingButton>
            </form>
          </Form>
        ) : (
          <Form {...otpForm}>
            <form
              onSubmit={otpForm.handleSubmit(onVerifyOtp)}
              className="space-y-4"
            >
              <FormField
                control={otpForm.control}
                name="otp"
                render={({ field }) => (
                  <FormItem className="flex flex-col items-center">
                    <FormLabel>Verification code</FormLabel>
                    <FormControl>
                      <InputOTP
                        maxLength={6}
                        value={field.value}
                        onChange={field.onChange}
                      >
                        <InputOTPGroup>
                          <InputOTPSlot index={0} />
                          <InputOTPSlot index={1} />
                          <InputOTPSlot index={2} />
                          <InputOTPSlot index={3} />
                          <InputOTPSlot index={4} />
                          <InputOTPSlot index={5} />
                        </InputOTPGroup>
                      </InputOTP>
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
                className="w-full"
                loading={otpForm.formState.isSubmitting}
              >
                Verify and sign in
              </LoadingButton>

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStep("email")
                    setError(null)
                    otpForm.reset()
                  }}
                >
                  Change email
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onResend}
                >
                  Resend code
                </Button>
              </div>
            </form>
          </Form>
        )}
      </CardContent>
      <CardFooter>
        <div className="flex w-full justify-center border-t pt-4">
          <p className="text-muted-foreground text-center text-xs">
            Prefer password?{" "}
            <Link href="/sign-in" className="underline">
              Sign in with password
            </Link>
          </p>
        </div>
      </CardFooter>
    </Card>
  )
}
