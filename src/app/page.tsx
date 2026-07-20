import type { Metadata } from "next"
import { HomeContent } from "./home-content"

export const metadata: Metadata = {
  title: "SALES DAILY",
  description: "Sales Daily Demo App",
}

export default function Home() {
  return <HomeContent />
}
