import type { Metadata } from "next"
import { HomeContent } from "./home-content"

export const metadata: Metadata = {
  title: "truffalo.ai",
  description: "AI-native business operating system",
}

export default function Home() {
  return <HomeContent />
}
