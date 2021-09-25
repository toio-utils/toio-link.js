/**
 * Author: programus
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const WebSocket = require('ws')

class JSONRPC {
  constructor() {
    this._requestID = 0
    this._openRequests = {}
  }

  /**
   * Make an RPC Request and retrieve the result.
   * @param {string} method - the remote method to call
   * @param {object} params - the parameters to pass to the remote method
   * @returns {Promise} - a promise for the result of the call
   */
  sendRemoteRequest(method, params) {
    const requestID = this._requestID++

    const promise = new Promise((resolve, reject) => {
      this._openRequests[requestID] = { resolve, reject }
    })

    this._sendRequest(method, params, requestID)

    return promise
  }

  /**
   * Make an RPC Notification with no expectation of a result or callback.
   * @param {string} method - the remote method to call
   * @param {object} params - the parameters to pass to the remote method
   */
  sendRemoteNotification(method, params) {
    this._sendRequest(method, params)
  }

  /**
   * Handle an RPC request from remote.
   * @param {string} method - the method requested by the remote caller
   * @param {object} params - the parameters sent with the remote caller's request
   * @returns a result or Promise for result, if appropriate.
   */
  didReceiveCall(method, params) {
    throw new Error('Must override didReceiveCall')
  }

  /**
   * Send a JSON-style message object over the transport.
   * @param {object} jsonMessageObject - the message to send
   * @private
   */
  _sendMessage(jsonMessageObject) {
    throw new Error('Must override _sendMessage')
  }

  _sendRequest(method, params, id) {
    const request = {
      jsonrpc: '2.0',
      method,
      params,
    }

    if (id != null) {
      request.id = id
    }

    this._sendMessage(request)
  }

  _handleMessage(json) {
    if (json.jsonrpc !== '2.0') {
      throw new Error(`Bad or missing JSON-RPC version in message: ${JSON.stringify(json)}`)
    }
    if (json.hasOwnProperty('method')) {
      this._handleRequest(json)
    } else {
      this._handleResponse(json)
    }
  }

  _sendResponse(id, result, error) {
    const response = {
      jsonrpc: '2.0',
      id,
    }
    if (error != null) {
      response.error = error
    } else {
      response.result = result || null
    }
    this._sendMessage(response)
  }

  _handleResponse(json) {
    const { result, error, id } = json
    const openRequest = this._openRequests[id]
    delete this._openRequests[id]
    if (error) {
      openRequest.reject(error)
    } else {
      openRequest.resolve(result)
    }
  }

  _handleRequest(json) {
    const { method, params, id } = json
    const rawResult = this.didReceiveCall(method, params)
    if (id != null) {
      Promise.resolve(rawResult).then(
        result => {
          this._sendResponse(id, result)
        },
        error => {
          this._sendResponse(id, null, error)
        },
      )
    }
  }
}

class JSONRPCWebSocket extends JSONRPC {
  constructor(webSocket) {
    super()

    this._ws = webSocket
    this._ws.onmessage = e => this._onSocketMessage(e)
    this._ws.onopen = e => this._onSocketOpen(e)
    this._ws.onclose = e => this._onSocketClose(e)
    this._ws.onerror = e => this._onSocketError(e)
  }

  dispose() {
    this._ws.close()
    this._ws = null
  }

  _onSocketOpen(e) {
    console.log(`WS opened: ${JSON.stringify(e)}`)
  }

  _onSocketClose(e) {
    console.log(`WS closed: ${JSON.stringify(e)}`)
  }

  _onSocketError(e) {
    console.log(`WS error: ${JSON.stringify(e)}`)
  }

  _onSocketMessage(e) {
    console.log(`Received message: ${e.data}`)
    const json = JSON.parse(e.data)
    this._handleMessage(json)
  }

  _sendMessage(message) {
    const messageText = JSON.stringify(message)
    console.log(`Sending message: ${messageText}`)
    this._ws.send(messageText)
  }
}

class ScratchBLE extends JSONRPCWebSocket {
  constructor(discoveredCallback) {
    super(new WebSocket('wss://device-manager.scratch.mit.edu:20110/scratch/ble'))
    this.discoveredCallback = discoveredCallback
  }

  requestDevice(options) {
    return this.sendRemoteRequest('discover', options)
  }

  didReceiveCall(method, params) {
    switch (method) {
      case 'didDiscoverPeripheral':
        console.log(`Peripheral discovered: ${JSON.stringify(params)}`)
        this.discoveredCallback(params)
        break
      case 'ping':
        return 42
    }
  }

  read(serviceId, characteristicId, optStartNotifications = false) {
    const params = {
      serviceId,
      characteristicId,
    }
    if (optStartNotifications) {
      params.startNotifications = true
    }
    return this.sendRemoteRequest('read', params)
  }

  write(serviceId, characteristicId, message, encoding = null, withResponse = null) {
    const params = { serviceId, characteristicId, message }
    if (encoding) {
      params.encoding = encoding
    }
    if (withResponse !== null) {
      params.withResponse = withResponse
    }
    return this.sendRemoteRequest('write', params)
  }
}

module.exports = {
  ScratchBLE,
}
