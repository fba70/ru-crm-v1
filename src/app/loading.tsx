import { PageLoader } from "@/components/blocks/page-loader"

// Показывается при перезагрузке страницы / первом заходе после авторизации —
// тот же индикатор, что и на внутренних страницах.
export default function Loading() {
  return <PageLoader className="min-h-svh" />
}
