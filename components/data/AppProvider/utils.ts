import { TypeAccepted } from "@commercelayer/react-components/lib/utils/getLineItemsCount"
import {
  Order,
  Address,
  CustomerAddress,
  PaymentMethod,
  CommerceLayerClient,
  OrderUpdate,
  StripePayment,
  WireTransfer,
  AdyenPayment,
  BraintreePayment,
  CheckoutComPayment,
  PaypalPayment,
  ShippingMethod,
  Shipment,
} from "@commercelayer/sdk"

import { AppStateData } from "components/data/AppProvider"
import { LINE_ITEMS_SHIPPABLE } from "components/utils/constants"

interface IsNewAddressProps {
  address: Address | undefined
  customerAddresses: Array<CustomerAddress> | undefined
  isGuest: boolean
}

interface CheckAndSetDefaultAddressForOrderProps {
  cl: CommerceLayerClient
  order: Order
  customerAddresses?: Array<CustomerAddress>
}

interface PaymentSourceProps {
  options?: { card?: string }
  metadata?: { card?: string }
  payment_response?: { source?: string }
}

type PaymentSourceType = (
  | AdyenPayment
  | BraintreePayment
  | CheckoutComPayment
  | PaypalPayment
  | StripePayment
  | WireTransfer
) &
  PaymentSourceProps

export interface FetchOrderByIdResponse {
  isGuest: boolean
  isUsingNewBillingAddress: boolean
  isUsingNewShippingAddress: boolean
  hasSameAddresses: boolean
  hasEmailAddress: boolean
  customerAddresses: CustomerAddress[]
  emailAddress: string | undefined
  hasShippingAddress: boolean
  shippingAddress: Address | undefined
  hasBillingAddress: boolean
  billingAddress: Address | undefined
  requiresBillingInfo: boolean | undefined
  hasShippingMethod: boolean
  paymentMethod: PaymentMethod | undefined
  shipments: Array<ShipmentSelected>
  hasPaymentMethod: boolean
  hasCustomerAddresses: boolean
  shippingCountryCodeLock: string | undefined
  isShipmentRequired: boolean
  isPaymentRequired: boolean
  isComplete: boolean
  returnUrl: string | undefined
  cartUrl: string | undefined
  isCreditCard: boolean
  taxIncluded: boolean | undefined
  shippingMethodName: string | undefined
}

function isNewAddress({
  address,
  customerAddresses,
  isGuest,
}: IsNewAddressProps): boolean {
  if (isGuest) {
    return true
  }

  const hasAddressIntoAddresses = Boolean(
    customerAddresses?.find(
      (customerAddress) =>
        customerAddress.address?.reference === address?.reference
    )
  )

  if (
    !hasAddressIntoAddresses &&
    customerAddresses &&
    customerAddresses?.length > 1 &&
    Boolean(address)
  ) {
    return true
  }
  if (
    !hasAddressIntoAddresses &&
    customerAddresses &&
    customerAddresses?.length > 1 &&
    Boolean(!address)
  ) {
    return false
  }
  return !hasAddressIntoAddresses
}

export async function checkAndSetDefaultAddressForOrder({
  cl,
  order,
}: CheckAndSetDefaultAddressForOrderProps) {
  const customerAddresses = order?.customer?.customer_addresses
  if (
    order.guest ||
    !customerAddresses ||
    (customerAddresses && customerAddresses.length !== 1) ||
    order.billing_address ||
    order.shipping_address
  ) {
    return {}
  }

  const address = customerAddresses[0]?.address

  if (!address) {
    return {}
  }

  if (
    !!order.shipping_country_code_lock &&
    order.shipping_country_code_lock !== address.country_code
  ) {
    return {}
  }

  // Set reference on original address if not present
  // doing this we can lookup the cloned address for the same entity
  if (address.id && address.reference !== address.id) {
    await cl.addresses.update({
      id: address.id,
      reference: address.id,
    })
  }

  const updateObjet: OrderUpdate = {
    id: order.id,
    _billing_address_clone_id: address.id,
    _shipping_address_clone_id: address.id,
  }
  try {
    const { billing_address, shipping_address } = await cl.orders.update(
      updateObjet,
      {
        include: ["billing_address", "shipping_address"],
      }
    )

    localStorage.setItem(
      "_save_billing_address_to_customer_address_book",
      "false"
    )
    localStorage.setItem(
      "_save_shipping_address_to_customer_address_book",
      "false"
    )
    return {
      customerAddresses: [
        {
          ...customerAddresses[0],
          address: { ...address, reference: address.id },
        },
      ],
      hasSameAddresses: true,
      hasBillingAddress: true,
      hasShippingAddress: true,
      isUsingNewBillingAddress: false,
      isUsingNewShippingAddress: false,
      billingAddress: billing_address,
      shippingAddress: shipping_address,
    }
  } catch (error) {
    console.log(error)
    return {}
  }
}

interface IsBillingAddressSameAsShippingAddressProps {
  billingAddress: Address | undefined
  shippingAddress: Address | undefined
}

function isBillingAddressSameAsShippingAddress({
  billingAddress,
  shippingAddress,
}: IsBillingAddressSameAsShippingAddressProps) {
  if (shippingAddress && billingAddress) {
    if (
      (shippingAddress.reference === billingAddress.reference &&
        shippingAddress.reference !== null) ||
      shippingAddress.name === billingAddress.name
    ) {
      return true
    } else if (
      shippingAddress.reference !== billingAddress.reference ||
      shippingAddress.name !== billingAddress.name
    ) {
      return false
    }
  } else if (shippingAddress === undefined && billingAddress) {
    return true
  } else if (billingAddress === undefined && shippingAddress) {
    return false
  } else {
    return true
  }
  return true
}

export const fetchOrder = async (cl: CommerceLayerClient, orderId: string) => {
  return cl.orders.retrieve(orderId, {
    fields: {
      orders: [
        "id",
        "guest",
        "shipping_country_code_lock",
        "customer_email",
        "status",
        "return_url",
        "cart_url",
        "tax_included",
        "requires_billing_info",
        "total_amount_with_taxes_float",
        "language_code",
        "shipping_address",
        "billing_address",
        "shipments",
        "payment_method",
        "payment_source",
        "customer",
      ],
      shipments: ["shipping_method"],
      customer: ["customer_addresses"],
      customer_addresses: ["address"],
    },
    include: [
      "shipping_address",
      "billing_address",
      "shipments",
      "shipments.shipping_method",
      "payment_method",
      "payment_source",
      "customer",
      "customer.customer_addresses",
      "customer.customer_addresses.address",
    ],
  })
}

export async function checkIfShipmentRequired(
  cl: CommerceLayerClient,
  orderId: string
): Promise<boolean> {
  const lineItems = (
    await cl.orders.retrieve(orderId, {
      fields: {
        line_items: ["item_type", "item"],
      },
      include: ["line_items", "line_items.item"],
    })
  ).line_items?.filter(
    (line_item) =>
      LINE_ITEMS_SHIPPABLE.includes(line_item.item_type as TypeAccepted) &&
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      !line_item.item?.do_not_ship
  )

  if (lineItems?.length === undefined) {
    return false
  }
  // riguardare
  return lineItems.length > 0
}

function isPaymentRequired(order: Order) {
  return !(order.total_amount_with_taxes_float === 0)
}

export function calculateAddresses(
  order: Order,
  addresses?: CustomerAddress[]
): Partial<AppStateData> {
  const cAddresses = addresses || order.customer?.customer_addresses
  const values = {
    hasCustomerAddresses: (cAddresses && cAddresses.length >= 1) || false,
    billingAddress: order.billing_address,
    shippingAddress: order.shipping_address,
    hasBillingAddress: Boolean(order.billing_address),
    hasShippingAddress: Boolean(order.shipping_address),
    customerAddresses: cAddresses,
    isUsingNewBillingAddress: isNewAddress({
      address: order.billing_address,
      customerAddresses: cAddresses,
      isGuest: Boolean(order.guest),
    }),
    isUsingNewShippingAddress: isNewAddress({
      address: order.shipping_address,
      customerAddresses: cAddresses,
      isGuest: Boolean(order.guest),
    }),
    hasSameAddresses: isBillingAddressSameAsShippingAddress({
      billingAddress: order.billing_address,
      shippingAddress: order.shipping_address,
    }),
  }
  return values
}

export function calculateSettings(order: Order, isShipmentRequired: boolean) {
  const calculatedAddresses = calculateAddresses(order)
  const paymentRequired = isPaymentRequired(order)
  return {
    isPaymentRequired: paymentRequired,
    isGuest: Boolean(order.guest),
    shippingCountryCodeLock: order.shipping_country_code_lock,
    hasEmailAddress: Boolean(order.customer_email),
    emailAddress: order.customer_email,
    ...calculatedAddresses,
    ...(isShipmentRequired
      ? calculateSelectedShipments(prepareShipments(order.shipments))
      : {
          hasShippingMethod: true,
          shipments: [],
        }),
    ...checkPaymentMethod(order),
    returnUrl: order.return_url,
    cartUrl: order.cart_url,
    taxIncluded: order.tax_included,
    requiresBillingInfo: order.requires_billing_info,
  }
}

export function checkPaymentMethod(order: Order) {
  const paymentMethod = order.payment_method

  const paymentSource: PaymentSourceType | undefined = order.payment_source

  let hasPaymentMethod = Boolean(
    paymentSource?.metadata?.card ||
      paymentSource?.options?.card ||
      paymentSource?.payment_response?.source
  )

  if (!hasPaymentMethod && !isPaymentRequired(order)) {
    hasPaymentMethod = true
  }

  const isComplete = order.status === "placed"

  return {
    hasPaymentMethod,
    paymentMethod,
    isComplete,
    isCreditCard: creditCardPayment(paymentMethod),
    paymentSource,
  }
}

export function creditCardPayment(paymentMethod?: PaymentMethod) {
  return (
    paymentMethod?.payment_source_type === "adyen_payments" ||
    paymentMethod?.payment_source_type === "stripe_payments" ||
    paymentMethod?.payment_source_type === "braintree_payments" ||
    paymentMethod?.payment_source_type === "checkout_com_payments"
  )
}
export function calculateSelectedShipments(
  shipments: ShipmentSelected[],
  payload?: {
    shipmentId: string
    shippingMethod: ShippingMethod | Record<string, any>
  }
) {
  const shipmentsSelected = shipments?.map((shipment) => {
    return shipment.shipmentId === payload?.shipmentId
      ? {
          ...shipment,
          shippingMethodId: payload.shippingMethod.id,
          shippingMethodName: payload.shippingMethod.name,
        }
      : shipment
  })
  const hasShippingMethod = hasShippingMethodSet(shipmentsSelected)
  return { shipments: shipmentsSelected, ...hasShippingMethod }
}

export function prepareShipments(shipments?: Shipment[]) {
  return (shipments || []).map((a) => {
    return {
      shipmentId: a.id,
      shippingMethodId: a.shipping_method?.id,
      shippingMethodName: a.shipping_method?.name,
    }
  })
}

export function hasShippingMethodSet(shipments: ShipmentSelected[]) {
  const shippingMethods = shipments?.map(
    (a: ShipmentSelected) => a.shippingMethodId
  )
  const hasShippingMethod = Boolean(
    shippingMethods?.length && !shippingMethods?.includes(undefined)
  )
  return { hasShippingMethod }
}

export async function setAutomatedShippingMethods(
  cl: CommerceLayerClient,
  order: Order,
  hasAddresses: boolean
) {
  if (!hasAddresses) {
    return {}
  }
  const shippingMethods = await cl.shipping_methods.list()
  if (shippingMethods.length > 1 || shippingMethods.length === 0) {
    return {}
  }

  const promises = (order.shipments || []).map((shipment) => {
    return cl.shipments.update({
      id: shipment.id,
      shipping_method: cl.shipping_methods.relationship(shippingMethods[0].id),
    })
  })
  await Promise.all(promises)
  return {
    hasShippingMethod: true,
    shippingMethodName: shippingMethods[0].name,
  }
}