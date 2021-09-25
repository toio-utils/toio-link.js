/**
 * Author: programus
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const JSONRPC = require('./jsonrpc')
var debug = require('debug')('BLE')

class BLE extends JSONRPC {
  /**
   * A BLE peripheral socket object.  It handles connecting, over web sockets, to
   * BLE peripherals, and reading and writing data to them.
   * @param {Runtime} runtime - the Runtime for sending/receiving GUI update events.
   * @param {string} extensionId - the id of the extension using this socket.
   * @param {object} peripheralOptions - the list of options for peripheral discovery.
   * @param {object} connectCallback - a callback for connection.
   * @param {string} peripheralId - the peripheral uuid
   * @param {object} resetCallback - a callback for resetting extension state.
   */
  constructor(
    runtime,
    extensionId,
    peripheralOptions,
    connectCallback,
    peripheralId = undefined,
    resetCallback = null,
  ) {
    super()

    this._socket = runtime.getScratchLinkSocket('BLE')
    this._socket.setOnOpen(this.requestPeripheral.bind(this))
    this._socket.setOnClose(this.handleDisconnectError.bind(this))
    this._socket.setOnError(this._handleRequestError.bind(this))
    this._socket.setHandleMessage(this._handleMessage.bind(this))

    this._sendMessage = this._socket.sendMessage.bind(this._socket)

    this._availablePeripherals = {}
    this._connectCallback = connectCallback
    this._connected = false
    this._characteristicDidChangeCallback = null
    this._characteristicDidChangeCallbacks = {}
    this._resetCallback = resetCallback
    this._discoverTimeoutID = null
    this._extensionId = extensionId
    this._peripheralOptions = peripheralOptions
    this._runtime = runtime
    this.peripheralId = peripheralId

    this._socket.open()
  }

  /**
   * Request connection to the peripheral.
   * If the web socket is not yet open, request when the socket promise resolves.
   */
  requestPeripheral() {
    this._availablePeripherals = {}
    this.sendRemoteRequest('discover', this._peripheralOptions).catch(e => {
      this._handleRequestError(e)
    })
  }

  /**
   * Try connecting to the input peripheral id, and then call the connect
   * callback if connection is successful.
   * @param {number} id - the id of the peripheral to connect to
   */
  connectPeripheral(id) {
    this.sendRemoteRequest('connect', { peripheralId: id })
      .then(() => {
        this._connected = true
        this._runtime.emit('connected', id)
        this._connectCallback(id)
      })
      .catch(e => {
        this._handleRequestError(e)
      })
  }

  /**
   * Close the websocket.
   */
  disconnect() {
    if (this._connected) {
      this._connected = false
    }

    if (this._socket.isOpen()) {
      this._socket.close()
    }

    // Sets connection status icon to orange
    this._runtime.emit('disconnected')
  }

  /**
   * @return {bool} whether the peripheral is connected.
   */
  isConnected() {
    return this._connected
  }

  /**
   * Start receiving notifications from the specified ble service.
   * @param {number} serviceId - the ble service to read.
   * @param {number} characteristicId - the ble characteristic to get notifications from.
   * @param {object} onCharacteristicChanged - callback for characteristic change notifications.
   * @return {Promise} - a promise from the remote startNotifications request.
   */
  startNotifications(serviceId, characteristicId, onCharacteristicChanged = null) {
    const params = {
      serviceId,
      characteristicId,
    }
    this._characteristicDidChangeCallbacks[`${serviceId}/${characteristicId}`] = onCharacteristicChanged
    return this.sendRemoteRequest('startNotifications', params).catch(e => {
      this._handleRequestError(e)
    })
  }

  /**
   * Stop receiving notifications from the specified ble service.
   * @param {number} serviceId - the ble service to read.
   * @param {number} characteristicId - the ble characteristic to get notifications from.
   * @return {Promise} - a promise from the remote startNotifications request.
   */
  stopNotifications(serviceId, characteristicId) {
    const params = {
      serviceId,
      characteristicId,
    }
    delete this._characteristicDidChangeCallbacks[`${serviceId}/${characteristicId}`]
    return this.sendRemoteRequest('stopNotifications', params).catch(e => {
      this._handleRequestError(e)
    })
  }

  /**
   * Read from the specified ble service.
   * @param {number} serviceId - the ble service to read.
   * @param {number} characteristicId - the ble characteristic to read.
   * @param {boolean} optStartNotifications - whether to start receiving characteristic change notifications.
   * @param {object} onCharacteristicChanged - callback for characteristic change notifications.
   * @return {Promise} - a promise from the remote read request.
   */
  read(serviceId, characteristicId, optStartNotifications = false, onCharacteristicChanged = null) {
    const params = {
      serviceId,
      characteristicId,
    }
    if (optStartNotifications) {
      params.startNotifications = true
    }
    if (onCharacteristicChanged) {
      this._characteristicDidChangeCallbacks[`${serviceId}/${characteristicId}`] = onCharacteristicChanged
    }
    return this.sendRemoteRequest('read', params).catch(e => {
      this._handleRequestError(e)
    })
  }

  /**
   * Write data to the specified ble service.
   * @param {number} serviceId - the ble service to write.
   * @param {number} characteristicId - the ble characteristic to write.
   * @param {string} message - the message to send.
   * @param {string} encoding - the message encoding type.
   * @param {boolean} withResponse - if true, resolve after peripheral's response.
   * @return {Promise} - a promise from the remote send request.
   */
  write(serviceId, characteristicId, message, encoding = null, withResponse = null) {
    const params = { serviceId, characteristicId, message }
    if (encoding) {
      params.encoding = encoding
    }
    if (withResponse !== null) {
      params.withResponse = withResponse
    }
    return this.sendRemoteRequest('write', params).catch(e => {
      this._handleRequestError(e)
    })
  }

  /**
   * Handle a received call from the socket.
   * @param {string} method - a received method label.
   * @param {object} params - a received list of parameters.
   * @return {object} - optional return value.
   */
  didReceiveCall(method, params) {
    switch (method) {
      case 'didDiscoverPeripheral':
        if (!this.peripheralId) {
          this._availablePeripherals[params.peripheralId] = params
          this._runtime.emit('discovered', params)
        } else if (params.peripheralId === this.peripheralId) {
          this._connectCallback(this.peripheralId)
        }
        break
      case 'userDidPickPeripheral':
        this._availablePeripherals[params.peripheralId] = params
        this._runtime.emit('pick', params)
        break
      case 'userDidNotPickPeripheral':
        this._runtime.emit('not-pick')
        break
      case 'characteristicDidChange':
        {
          const callback = this._characteristicDidChangeCallbacks[`${params.serviceId}/${params.characteristicId}`]
          if (callback) {
            callback(params)
          }
        }
        break
      case 'ping':
        return 42
    }
  }

  /**
   * Handle an error resulting from losing connection to a peripheral.
   *
   * This could be due to:
   * - battery depletion
   * - going out of bluetooth range
   * - being powered down
   *
   * Disconnect the socket, and if the extension using this socket has a
   * reset callback, call it. Finally, emit an error to the runtime.
   */
  handleDisconnectError(/* e */) {
    // log.error(`BLE error: ${JSON.stringify(e)}`);

    if (!this._connected) return

    this.disconnect()

    if (this._resetCallback) {
      this._resetCallback()
    }

    this._runtime.emit('disconnect-error', {
      message: `Scratch lost connection to`,
      extensionId: this._extensionId,
    })
  }

  _handleRequestError(e) {
    // log.error(`BLE error: ${JSON.stringify(e)}`);

    this._runtime.emit('request-error', {
      message: `request to scratch link error`,
      extensionId: this._extensionId,
      error: e,
    })
  }

  _handleDiscoverTimeout() {
    this._runtime.emit('scan-timeout')
  }
}

module.exports = BLE
