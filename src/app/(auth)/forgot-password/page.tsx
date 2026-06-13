import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Восстановление пароля",
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <div className="space-y-6 w-full">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Восстановление пароля</h1>
          <p className="text-muted-foreground">
            Введите адрес email, и мы отправим вам ссылку для сброса пароля.
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
