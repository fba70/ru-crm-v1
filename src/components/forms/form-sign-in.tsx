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
  email: z.email({ message: "Введите корректный email" }),
  password: z.string().min(1, { message: "Введите пароль" }),
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
      setError(error.message || "Неизвестная ошибка авторизации")
      toast.error(error.message || "Неизвестная ошибка авторизации")
    } else {
      toast.success("Вход выполнен успешно!")
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
    toast.success("Перенаправляем к внешнему провайдеру для авторизации…")

    if (error) {
      setError(error.message || "Неизвестная ошибка авторизации")
      toast.error(error.message || "Неизвестная ошибка авторизации")
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg md:text-xl">Вход</CardTitle>
        <CardDescription className="text-xs md:text-sm">
          Войдите в аккаунт по email или через внешних провайдеров
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
                    <FormLabel>Пароль</FormLabel>
                    <Link
                      href="/forgot-password"
                      className="ml-auto inline-block text-sm underline"
                    >
                      Забыли пароль?
                    </Link>
                  </div>
                  <FormControl>
                    <PasswordInput
                      autoComplete="current-password"
                      placeholder="Пароль"
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
                  <FormLabel>Запомнить меня</FormLabel>
                </FormItem>
              )}
            />

            {error && (
              <div role="alert" className="text-sm text-red-600">
                {error}
              </div>
            )}

            <LoadingButton type="submit" className="w-full" loading={loading}>
              Войти
            </LoadingButton>

            <div className="flex w-full flex-col items-center justify-between gap-4 mt-4">
              <Button
                asChild
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={loading}
              >
                <Link href="/sign-in/otp">Войти по одноразовому коду (email)</Link>
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={loading}
                onClick={() => handleSocialSignIn("google")}
              >
                <GoogleIcon width="0.98em" height="1em" />
                Войти через Google
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={loading}
                onClick={() => handleSocialSignIn("github")}
              >
                <GitHubIcon />
                Войти через GitHub
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
      <CardFooter>
        <div className="flex w-full justify-center border-t pt-4">
          <p className="text-muted-foreground text-center text-xs">
            Нет аккаунта?{" "}
            <Link href="/sign-up" className="underline">
              Зарегистрироваться
            </Link>
          </p>
        </div>
      </CardFooter>
    </Card>
  )
}
