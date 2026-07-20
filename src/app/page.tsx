import type { Metadata } from "next"
import { HomeContent } from "./home-content"

export const metadata: Metadata = {
  title: "SALES DAILY",
  description: "Операционная система продаж",
}

export default function Home() {
  return <HomeContent />
}
