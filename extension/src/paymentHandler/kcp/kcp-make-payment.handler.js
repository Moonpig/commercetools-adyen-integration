const fetch = require('node-fetch')
const _ = require('lodash')

const configLoader = require('../../config/config')
const pU = require('../payment-utils')
const c = require('../../config/constants')
const ValidatorBuilder = require('../../validator/validator-builder')

const config = configLoader.load()

async function handlePayment (paymentObject) {
  const validator = _validatePayment(paymentObject)
  if (validator.hasErrors())
    return validator.buildCtpErrorResponse()

  const { response, request } = await _callAdyen(paymentObject)
  const status = response.status === 200 ? c.SUCCESS : c.FAILURE
  const responseBody = await response.json()
  let actions = [
    pU.ensureAddInterfaceInteractionAction({
      paymentObject, request, response: responseBody, type: c.CTP_INTERACTION_TYPE_MAKE_PAYMENT, status
    })
  ]
  if (responseBody.resultCode === c.REDIRECT_SHOPPER) {
    const transaction = pU.getAuthorizationTransactionInit(paymentObject)
    const redirectUrl = responseBody.redirect.url
    actions.push(
      pU.createSetCustomFieldAction('redirectUrl', redirectUrl)
    )
    const redirectMethod = responseBody.redirect.method
    actions.push(
      pU.createSetCustomFieldAction('redirectMethod', redirectMethod)
    )
    actions.push(
      pU.createChangeTransactionStateAction(transaction.id, c.CTP_TXN_STATE_PENDING)
    )
  }

  actions = _.compact(actions)

  return {
    actions
  }
}

function _validatePayment (paymentObject) {
  return ValidatorBuilder.withPayment(paymentObject)
    .validateReturnUrlField()
}

async function _callAdyen (paymentObject) {
  const transaction = pU.getAuthorizationTransactionInit(paymentObject)
  const paymentMethodType = paymentObject.paymentMethodInfo.method
  const requestBody = {
    amount: {
      currency: transaction.amount.currencyCode,
      value: transaction.amount.centAmount
    },
    reference: paymentObject.custom.fields.merchantReference,
    paymentMethod: {
      type: paymentMethodType
    },
    returnUrl: paymentObject.custom.fields.returnUrl,
    merchantAccount: config.adyen.merchantAccount
  }

  const request = {
    method: 'POST',
    body: JSON.stringify(requestBody),
    headers: { 'x-api-key': config.adyen.apiKey, 'Content-Type': 'application/json' }
  }
  const response = await fetch(`${config.adyen.apiBaseUrl}/payments`, request)

  return { response, request }
}

module.exports = { handlePayment }
