import type { Metadata } from "next"
import { SignUpForm } from "@/components/forms/form-sign-up"

export const metadata: Metadata = {
  title: "Sign up",
}

export default function SignUp() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <SignUpForm />
    </main>
  )
}
