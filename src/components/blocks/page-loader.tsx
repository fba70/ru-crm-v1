import { Loader } from "lucide-react"
import { cn } from "@/lib/utils"

// Единый индикатор загрузки страницы: спиннер по центру области + подпись.
// По умолчанию занимает всю высоту родителя (контентной зоны страницы);
// для полноэкранной загрузки передать className="min-h-svh".
export function PageLoader({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex h-full min-h-60 w-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground",
        className,
      )}
    >
      <Loader className="h-6 w-6 animate-spin" />
      Загрузка данных…
    </div>
  )
}
