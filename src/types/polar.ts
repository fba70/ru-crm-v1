export type PolarOrder = {
  id: string
  createdAt: string
  modifiedAt: string
  status: string
  paid: boolean
  subtotalAmount: number
  discountAmount: number
  netAmount: number
  taxAmount: number
  totalAmount: number
  appliedBalanceAmount: number
  dueAmount: number
  refundedAmount: number
  refundedTaxAmount: number
  currency: string
  billingReason: string
  billingName: string
  billingAddress: {
    country: string
    line1: string
    line2: string
    postalCode: string
    city: string
    state: string
  }
  invoiceNumber: string
  isInvoiceGenerated: boolean
  customerId: string
  productId: string
  discountId: string
  subscriptionId: string
  checkoutId: string
  userId: string
  product: {
    id: string
    createdAt: string
    modifiedAt: string
    trialInterval: string
    trialIntervalCount: number
    name: string
    description: string
    recurringInterval: string
    recurringIntervalCount: number
    isRecurring: boolean
    isArchived: boolean
    organizationId: string
    prices: Array<{
      createdAt: string
      modifiedAt: string
      id: string
      source: string
      amountType: string
      isArchived: boolean
      productId: string
      type: string
      recurringInterval: string
      priceCurrency: string
      priceAmount: number
      legacy: boolean
    }>
    benefits: Array<{
      id: string
      createdAt: string
      modifiedAt: string
      type: string
      description: string
      selectable: boolean
      deletable: boolean
      organizationId: string
    }>
    medias: Array<{
      id: string
      organizationId: string
      name: string
      path: string
      mimeType: string
      size: number
      storageVersion: string
      checksumEtag: string
      checksumSha256Base64: string
      checksumSha256Hex: string
      lastModifiedAt: string
      version: string
      service: string
      isUploaded: boolean
      createdAt: string
      sizeReadable: string
      publicUrl: string
    }>
    organization: {
      createdAt: string
      modifiedAt: string
      id: string
      name: string
      slug: string
      avatarUrl: string
      prorationBehavior: string
      allowCustomerUpdates: boolean
    }
  }
  subscription: {
    createdAt: string
    modifiedAt: string
    id: string
    amount: number
    currency: string
    recurringInterval: string
    recurringIntervalCount: number
    status: string
    currentPeriodStart: string
    currentPeriodEnd: string
    trialStart: string
    trialEnd: string
    cancelAtPeriodEnd: boolean
    canceledAt: string
    startedAt: string
    endsAt: string
    endedAt: string
    customerId: string
    productId: string
    discountId: string
    checkoutId: string
    customerCancellationReason: string
    customerCancellationComment: string
    seats: number
  }
  items: Array<{
    createdAt: string
    modifiedAt: string
    id: string
    label: string
    amount: number
    taxAmount: number
    proration: boolean
    productPriceId: string
  }>
  description: string
  seats: number
  nextPaymentAttemptAt: string
}

export type PolarOrdersResponse = {
  items: PolarOrder[]
  pagination: {
    totalCount: number
    maxPage: number
  }
}

export type PolarCustomerState = {
  id: string
  createdAt: string
  modifiedAt: string
  metadata: Record<string, unknown>
  externalId: string
  email: string
  emailVerified: boolean
  name: string
  billingAddress: {
    country: string
    line1: string
    line2: string
    postalCode: string
    city: string
    state: string
  }
  taxId: [string, string]
  organizationId: string
  deletedAt: string
  activeSubscriptions: Array<{
    id: string
    createdAt: string
    modifiedAt: string
    metadata: Record<string, unknown>
    status: string
    amount: number
    currency: string
    recurringInterval: string
    currentPeriodStart: string
    currentPeriodEnd: string
    trialStart: string
    trialEnd: string
    cancelAtPeriodEnd: boolean
    canceledAt: string | null
    startedAt: string
    endsAt: string | null
    productId: string
    discountId: string | null
    meters: Array<{
      createdAt: string
      modifiedAt: string
      id: string
      consumedUnits: number
      creditedUnits: number
      amount: number
      meterId: string
    }>
    customFieldData: Record<string, unknown>
  }>
  grantedBenefits: Array<{
    id: string
    createdAt: string
    modifiedAt: string
    grantedAt: string
    benefitId: string
    benefitType: string
    benefitMetadata: Record<string, unknown>
    properties: {
      accountId: string
      guildId: string
      roleId: string
      grantedAccountId: string
    }
  }>
  activeMeters: Array<{
    id: string
    createdAt: string
    modifiedAt: string
    meterId: string
    consumedUnits: number
    creditedUnits: number
    balance: number
  }>
  avatarUrl: string
}
