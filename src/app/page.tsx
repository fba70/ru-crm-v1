import type { Metadata } from "next"
import { HomeContent } from "./home-content"

export const metadata: Metadata = {
  title: "SALES DAILY",
  description: "Demo web application",
}

export default function Home() {
  return <HomeContent />
}
