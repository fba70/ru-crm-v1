"use client"

import { GitHubIcon } from "@/components/icons/GitHubIcon"
import { GoogleIcon } from "@/components/icons/GoogleIcon"
import { LoadingButton } from "@/components/blocks/loading-button"
import { PasswordInput } from "@/components/blocks/password-input"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { authClient } from "@/lib/auth-client"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

const signInSchema = z.object({
  email: z.email({ message: "Please enter a valid email" }),
  password: z.string().min(1, { message: "Password is required" }),
  rememberMe: z.boolean().optional(),
})

type SignInValues = z.infer<typeof signInSchema>

export function SignInForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get("redirect") || "/dashboard"

  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
  })

  async function onSubmit({ email, password, rememberMe }: SignInValues) {
    setError(null)
    setLoading(true)

    const { error } = await authClient.signIn.email({
      email: email,
      password: password,
      rememberMe: rememberMe,
    })

    setLoading(false)

    if (error) {
      setError(error.message || "Unknown authorization error")
      toast.error(error.message || "Unknown authorization error")
    } else {
      toast.success("Sign-In is successful!")
      router.push(redirect)
    }
  }

  async function handleSocialSignIn(provider: "google" | "github") {
    setError(null)
    setLoading(true)

    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: redirect,
    })

    setLoading(false)
    toast.success("Redirecting to social provider for authentication...")

    if (error) {
      setError(error.message || "Unknown authorization error")
      toast.error(error.message || "Unknown authorization error")
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg md:text-xl">Sign In</CardTitle>
        <CardDescription className="text-xs md:text-sm">
          Sign-in to your account with email or using social providers
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                  <div className="flex items-center">
                    <FormLabel>Password</FormLabel>
                    <Link
                      href="/forgot-password"
                      className="ml-auto inline-block text-sm underline"
                    >
                      Forgot your password?
                    </Link>
                  </div>
                  <FormControl>
                    <PasswordInput
                      autoComplete="current-password"
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
              name="rememberMe"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel>Remember me</FormLabel>
                </FormItem>
              )}
            />

            {error && (
              <div role="alert" className="text-sm text-red-600">
                {error}
              </div>
            )}

            <LoadingButton type="submit" className="w-full" loading={loading}>
              Login
            </LoadingButton>

            <div className="flex w-full flex-col items-center justify-between gap-4 mt-4">
              <Button
                asChild
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={loading}
              >
                <Link href="/sign-in/otp">Sign in with email OTP</Link>
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={loading}
                onClick={() => handleSocialSignIn("google")}
              >
                <GoogleIcon width="0.98em" height="1em" />
                Sign in with Google
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={loading}
                onClick={() => handleSocialSignIn("github")}
              >
                <GitHubIcon />
                Sign in with Github
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
      <CardFooter>
        <div className="flex w-full justify-center border-t pt-4">
          <p className="text-muted-foreground text-center text-xs">
            Don&apos;t have an account?{" "}
            <Link href="/sign-up" className="underline">
              Sign up
            </Link>
          </p>
        </div>
      </CardFooter>
    </Card>
  )
}
