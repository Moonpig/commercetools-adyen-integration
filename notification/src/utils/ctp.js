const fetch = require('node-fetch')
const { merge } = require('lodash')
const { createClient } = require('@commercetools/sdk-client')
const { createAuthMiddlewareForClientCredentialsFlow } = require('@commercetools/sdk-middleware-auth')
const { createHttpMiddleware } = require('@commercetools/sdk-middleware-http')
const { createQueueMiddleware } = require('@commercetools/sdk-middleware-queue')
const { createRequestBuilder } = require('@commercetools/api-request-builder')
const { scopes } = require('@commercetools/sdk-middleware-auth')

function createCtpClient (config, extraScopes) {
  const AUTH_HOST = 'https://auth.commercetools.com'
  const API_HOST = 'https://api.commercetools.com'
  const clientId = config.ctp.clientId
  const clientSecret = config.ctp.clientSecret
  const projectKey = config.ctp.projectKey
  const concurrency = 10

  let scopeBuilder = [scopes.MANAGE_PAYMENTS.concat(':').concat(projectKey)]
  if (config.ensureResources) scopeBuilder = scopeBuilder.concat(scopes.MANAGE_TYPES.concat(':').concat(projectKey))
  if (extraScopes) scopeBuilder = scopeBuilder.concat('manage_extensions:'.concat(projectKey))

  const authMiddleware = createAuthMiddlewareForClientCredentialsFlow({
    host: AUTH_HOST,
    projectKey,
    credentials: {
      clientId,
      clientSecret
    },
    scopes: scopeBuilder,
    fetch
  })

  const httpMiddleware = createHttpMiddleware({
    maskSensitiveHeaderData: true,
    host: API_HOST,
    enableRetry: true,
    fetch
  })

  const queueMiddleware = createQueueMiddleware({
    concurrency,
  })

  return createClient({
    middlewares: [
      authMiddleware,
      httpMiddleware,
      queueMiddleware
    ]
  })
}

function setUpClient (config, extraScopes) {
  const ctpClient = createCtpClient(config, extraScopes)
  const customMethods = {
    get builder () {
      return getRequestBuilder(config.ctp.projectKey)
    },

    delete (uri, id, version) {
      return ctpClient.execute(this.buildRequestOptions(
        uri.byId(id).withVersion(version).build(),
        'DELETE'
      ))
    },

    create (uri, body) {
      return ctpClient.execute(this.buildRequestOptions(uri.build(), 'POST', body))
    },

    update (uri, id, version, actions) {
      const body = {
        version,
        actions
      }
      return ctpClient.execute(
        this.buildRequestOptions(uri.byId(id).build(), 'POST', body)
      )
    },

    fetch (uri) {
      return ctpClient.execute(this.buildRequestOptions(uri.build()))
    },

    fetchById (uri, id) {
      return ctpClient.execute(this.buildRequestOptions(uri.byId(id).build()))
    },

    fetchBatches (uri, callback, opts = { accumulate: false }) {
      return this.process(
        this.buildRequestOptions(uri.build()),
        data => callback(data.body.results),
        opts
      )
    },

    buildRequestOptions (uri, method = 'GET', body = undefined) {
      return {
        uri,
        method,
        body,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }
      }
    }
  }
  return merge(customMethods, ctpClient)
}

function getRequestBuilder (projectKey) {
  return createRequestBuilder({ projectKey })
}

/**
 * Compares transaction states
 * @param currentState state of the transaction from the CT platform
 * @param newState state of the transaction from the Adyen notification
 * @return number 1 if newState can appear after currentState
 * -1 if newState cannot appear after currentState
 * 0 if newState is the same as currentState
 * @throws Error when newState and/or currentState is a wrong transaction state
 * */
function compareTransactionStates (currentState, newState) {
  const transactionStateFlow = {
    Initial: 0,
    Pending: 1,
    Success: 2,
    Failure: 2
  }
  if (!transactionStateFlow.hasOwnProperty(currentState) || !transactionStateFlow.hasOwnProperty(newState))
    throw Error('Wrong transaction state passed. '
      + `currentState: ${currentState}, newState: ${newState}`)

  return transactionStateFlow[newState] - transactionStateFlow[currentState]
}


module.exports = {
  get: (config, extraScopes) => setUpClient(config, extraScopes),
  compareTransactionStates
}
