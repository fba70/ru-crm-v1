import { Loader2 } from "lucide-react"

export default function Loading() {
  return (
    <div className="flex flex-col min-h-svh items-center justify-center p-6 gap-4">
      <Loader2 className="text-muted-foreground size-8 animate-spin" />
      Please wait, loading the content ...
    </div>
  )
}
