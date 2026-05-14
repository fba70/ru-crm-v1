import type { Metadata } from "next"
import { Suspense } from "react"
import { SignInOtpForm } from "@/components/forms/form-sign-in-otp"

export const metadata: Metadata = {
  title: "Sign in with code",
}

export default function SignInOtp() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <Suspense fallback={null}>
        <SignInOtpForm />
      </Suspense>
    </main>
  )
}
