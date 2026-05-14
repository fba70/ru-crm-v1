import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function NotFoundnPage() {
  return (
    <main className="flex grow items-center justify-center px-4 text-center">
      <div className="mt-16 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            This page can not be found ...
          </h1>
          <p className="text-muted-foreground">
            Go back to the homepage and try again.
          </p>
        </div>
        <div>
          <Button asChild>
            <Link href="/">Go to Home Page</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
