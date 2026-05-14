import type { Metadata } from "next"
import { Suspense } from "react"
import { SignInForm } from "@/components/forms/form-sign-in"

export const metadata: Metadata = {
  title: "Sign in",
}

export default function SignIn() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </main>
  )
}
