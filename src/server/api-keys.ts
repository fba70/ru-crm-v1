"use server"

import { auth } from "@/lib/auth"
import { headers } from "next/headers"

export const createApiKey = async ({
  name,
  expiresIn,
  prefix,
  description,
}: {
  name: string
  expiresIn: number
  prefix: string
  description: string
}) => {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    console.error("No session found")
    return null
  }

  try {
    const data = await auth.api.createApiKey({
      body: {
        name,
        expiresIn,
        prefix,
        metadata: { keyDescription: description },
      },
      headers: await headers(),
    })
    return { data, error: null }
  } catch (error) {
    console.error("Error creating API key:", error)
    return { data: null, error }
  }
}

export const getApiKeys = async (keyId: string) => {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    console.error("No session found")
    return null
  }

  try {
    const data = await auth.api.getApiKey({
      query: {
        id: keyId,
      },
      headers: await headers(),
    })
    return { data, error: null }
  } catch (error) {
    console.error("Error getting API key:", error)
    return { data: null, error }
  }
}

export const getAllApiKeys = async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    console.error("No session found")
    return null
  }

  try {
    const data = await auth.api.listApiKeys({
      headers: await headers(),
    })
    return { data, error: null }
  } catch (error) {
    console.error("Error getting API keys list:", error)
    return { data: null, error }
  }
}

export const deleteApiKeys = async (keyId: string) => {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    console.error("No session found")
    return null
  }

  try {
    const data = await auth.api.deleteApiKey({
      body: {
        keyId: keyId,
      },
      headers: await headers(),
    })
    return { data, error: null }
  } catch (error) {
    console.error("Error deleting API key:", error)
    return { data: null, error }
  }
}
