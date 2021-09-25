/**
 * Author: programus
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

var util = require('util')
var events = require('events')

const { BLE, ScratchLinkWebSocket } = require('./scratch')

var debug = require('debug')('scratch-link-bindings')

function makeList(uuid) {
  return { services: [uuid] }
}

function addDashes(uuid) {
  if (!uuid || typeof uuid !== 'string') {
    return uuid
  }
  return uuid.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/g, '$1-$2-$3-$4-$5')
}

function stripDashes(uuid) {
  if (typeof uuid === 'string') {
    uuid = uuid.split('-').join('')
  }
  return uuid
}

const toioPeripheral = {
  services: [
    {
      uuid: '10b201005b3b45719508cf3efcd7bbae',
      characteristics: [
        {
          type: 'battery',
          uuid: '10b201085b3b45719508cf3efcd7bbae',
          properties: ['writeWithoutResponse', 'write', 'notify', 'read'],
        },
        {
          type: 'button',
          uuid: '10b201075b3b45719508cf3efcd7bbae',
          properties: ['writeWithoutResponse', 'write', 'notify', 'read'],
        },
        {
          type: 'configuration',
          uuid: '10b201ff5b3b45719508cf3efcd7bbae',
          properties: ['writeWithoutResponse', 'write', 'notify', 'read'],
        },
        {
          type: 'id',
          uuid: '10b201015b3b45719508cf3efcd7bbae',
          properties: ['writeWithoutResponse', 'write', 'notify', 'read'],
        },
        {
          type: 'light',
          uuid: '10b201035b3b45719508cf3efcd7bbae',
          properties: ['writeWithoutResponse', 'write'],
        },
        {
          type: 'motor',
          uuid: '10b201025b3b45719508cf3efcd7bbae',
          properties: ['writeWithoutResponse', 'write', 'notify', 'read'],
        },
        {
          type: 'sensor',
          uuid: '10b201065b3b45719508cf3efcd7bbae',
          properties: ['writeWithoutResponse', 'write', 'notify', 'read'],
        },
        {
          type: 'sound',
          uuid: '10b201045b3b45719508cf3efcd7bbae',
          properties: ['writeWithoutResponse', 'write'],
        },
      ],
    },
  ],
}

var NobleBindings = function() {
  this._ble = null
  this._scanRequest = null
  this._keepScanning = false
  this._peripherals = {}
  this._blePeripheralMapping = {}

  this.on('discovered', this.onDiscovered.bind(this))
  this.on('connected', this.onConnected.bind(this))
  this.on('disconnect-error', this.onDisconnectedError.bind(this))
  this.on('request-error', this.onRequestError.bind(this))
}
util.inherits(NobleBindings, events.EventEmitter)

NobleBindings.prototype.getScratchLinkSocket = function(type) {
  return new ScratchLinkWebSocket(type)
}

NobleBindings.prototype.init = function() {
  debug('initing')
  debug('emit powered on')
  this.emit('stateChange', 'poweredOn')
}

NobleBindings.prototype.onOpen = function() {
  debug('on -> open')
}

NobleBindings.prototype.onClose = function() {
  debug('on -> close')

  this.emit('stateChange', 'poweredOff')
}

NobleBindings.prototype.onRequestError = function(event) {
  const { extensionId } = event
  const ble = this._blePeripheralMapping[extensionId]
  event.peripheralId = ble.peripheralId
  event.peripheral = this._peripherals[ble.peripheralId]
  debug(event)
  this.emit('error', event)
}

NobleBindings.prototype.newBle = function(peripheralId) {
  const extensionIds = Object.keys(this._blePeripheralMapping)
  const extensionId = parseInt(extensionIds[extensionIds.length - 1] || -1) + 1
  const ble = new BLE(this, extensionId, this._scanRequest, this.startConnect.bind(this), peripheralId)
  this._blePeripheralMapping[extensionId] = ble
  return ble
}

NobleBindings.prototype.startScanning = function(options, allowDuplicates) {
  if (this._ble) {
    console.log('scan had been started...')
    return
  }
  if (Array.isArray(options)) {
    options = { services: options }
  }

  if (typeof options !== 'object') {
    options = { services: options }
  }

  if (!Array.isArray(options.services)) {
    options.services = [options.services]
  }

  options.services = options.services.map(function(service) {
    //web bluetooth requires 4 char hex service names to be passed in as integers
    if (typeof service === 'string' && service.length === 4) {
      service = parseInt('0x' + service)
    } else if (typeof service === 'string' && service.length === 6 && service.indexOf('0x') === 0) {
      service = parseInt(service)
    }
    return service
  })

  var dashedUuids = options.services.map(addDashes)

  var filterList = dashedUuids.map(makeList)
  if (options.name) {
    filterList.push({ name: options.name })
  }
  if (options.namePrefix) {
    filterList.push({ namePrefix: options.namePrefix })
  }

  this._scanRequest = { filters: filterList }

  debug('startScanning', this._scanRequest, allowDuplicates)

  this._keepScanning = true
  this._ble = this.newBle()

  this.emit('scanStart')
}

NobleBindings.prototype.onDiscovered = function(device) {
  if (this._keepScanning) {
    const address = device.peripheralId
    const peripheral = this._peripherals[address]
    if (!(peripheral && peripheral.connecting)) {
      this._peripherals[address] = {
        uuid: address,
        address: address,
        advertisement: { localName: device.name },
        localName: device.name,
        rssi: device.rssi,
        requestedConnect: false,
        ...toioPeripheral,
        serviceChars: toioPeripheral.services.reduce((a, v) => {
          a[v.uuid] = v.characteristics
          return a
        }, {}),
      }
      this.emit(
        'discover',
        address,
        address,
        '',
        true,
        this._peripherals[address].advertisement,
        this._peripherals[address].rssi,
      )
    }
  }
}

NobleBindings.prototype.stopScanning = function() {
  this._keepScanning = false

  //TODO: need scratch link api completed for this to work'=
  this.emit('scanStop')
}

NobleBindings.prototype.connect = function(deviceUuid) {
  debug('connect', deviceUuid)
  const peripheral = this._peripherals[deviceUuid]
  peripheral.connecting = true
  peripheral.ble = this.newBle(peripheral.uuid)

  // // Attempts to connect to remote GATT Server.
  // peripheral.device.gatt.connect().then(
  //   function(gattServer) {
  //     debug('peripheral connected', gattServer)

  //     var onDisconnected = function(event) {
  //       debug('disconnected', peripheral.uuid)
  //       this.emit('disconnect', peripheral.uuid)
  //     }
  //     peripheral.device.addEventListener('gattserverdisconnected', onDisconnected, { once: true })

  //     this.emit('connect', deviceUuid)
  //   },
  //   function(err) {
  //     debug('err connecting', err)
  //     this.emit('connect', deviceUuid, err)
  //   },
  // )
}

NobleBindings.prototype.startConnect = function(deviceUuid) {
  const peripheral = this._peripherals[deviceUuid]
  if (!peripheral.requestedConnect) {
    peripheral.requestedConnect = true
    peripheral.ble.connectPeripheral(deviceUuid)
  }
}

NobleBindings.prototype.onConnected = function(id) {
  debug('connected!', id)
  this.emit('connect', id)
}

NobleBindings.prototype.disconnect = function(deviceUuid) {
  var peripheral = this._peripherals[deviceUuid]
  peripheral.ble.disconnect()
  this.emit('disconnect', deviceUuid)
}

NobleBindings.prototype.onDisconnectedError = function(event) {
  const { extensionId } = event
  const ble = this._blePeripheralMapping[extensionId]
  debug('disconnected by peripheral', ble.peripheralId, event)
  this.disconnect(ble.peripheralId)
}

NobleBindings.prototype.updateRssi = function(deviceUuid) {
  var peripheral = this._peripherals[deviceUuid]

  //TODO: need web api completed for this to work
  // this.emit('rssiUpdate', deviceUuid, rssi);
}

NobleBindings.prototype.discoverServices = function(deviceUuid, uuids) {
  var peripheral = this._peripherals[deviceUuid]

  //TODO: need web api completed for this to work
  if (peripheral) {
    this.emit(
      'servicesDiscover',
      deviceUuid,
      peripheral.services.map(s => s.uuid),
    )
  }
}

NobleBindings.prototype.discoverIncludedServices = function(deviceUuid, serviceUuid, serviceUuids) {
  var peripheral = this._peripherals[deviceUuid]

  //TODO impelment when web API has functionatility then emit response
  //this.emit('includedServicesDiscover', deviceUuid, serviceUuid, includedServiceUuids);
}

NobleBindings.prototype.discoverCharacteristics = function(deviceUuid, serviceUuid, characteristicUuids) {
  var peripheral = this._peripherals[deviceUuid]

  if (peripheral) {
    const discoveredCharacteristics = peripheral.serviceChars[serviceUuid]

    debug('discoverCharacteristics', deviceUuid, serviceUuid, discoveredCharacteristics)
    this.emit('characteristicsDiscover', deviceUuid, serviceUuid, discoveredCharacteristics)
  }
}

NobleBindings.prototype.read = async function(deviceUuid, serviceUuid, characteristicUuid) {
  const peripheral = this._peripherals[deviceUuid]
  debug('read', deviceUuid, serviceUuid, characteristicUuid)
  if (peripheral) {
    try {
      const json = await peripheral.ble.read(addDashes(serviceUuid), addDashes(characteristicUuid))
      debug('read: ', json)
      this.emit(
        'read',
        peripheral.uuid,
        serviceUuid,
        characteristicUuid,
        new Buffer.from(json.message, 'base64'),
        false,
      )
    } catch (err) {
      debug('error reading characteristic', err)
      this.emit('error', err)
    }
  }
}

NobleBindings.prototype.write = async function(deviceUuid, serviceUuid, characteristicUuid, data, withoutResponse) {
  const peripheral = this._peripherals[deviceUuid]
  debug('write', deviceUuid, serviceUuid, characteristicUuid, data, withoutResponse)
  if (peripheral) {
    try {
      const res = await peripheral.ble.write(
        addDashes(serviceUuid),
        addDashes(characteristicUuid),
        data.toString('base64'),
        'base64',
        withoutResponse,
      )
      debug('value written')
      this.emit('write', peripheral.uuid, serviceUuid, characteristicUuid)
    } catch (err) {
      debug('error writing to characteristic', serviceUuid, characteristicUuid, err)
    }
  }
}

NobleBindings.prototype.broadcast = function(deviceUuid, serviceUuid, characteristicUuid, broadcast) {
  var peripheral = this._peripherals[deviceUuid]

  //TODO impelment when web API has functionatility then emit response
  //this.emit('broadcast', deviceUuid, serviceUuid, characteristicUuid, state);
}

NobleBindings.prototype.notify = async function(deviceUuid, serviceUuid, characteristicUuid, notify) {
  const peripheral = this._peripherals[deviceUuid]
  try {
    if (notify) {
      debug('notifications started', characteristicUuid)
      await peripheral.ble.startNotifications(addDashes(serviceUuid), addDashes(characteristicUuid), json => {
        debug('oncharacteristicvaluechanged', json)
        this.emit('read', deviceUuid, serviceUuid, characteristicUuid, Buffer.from(json.message, 'base64'), true)
      })
    } else {
      debug('notifications stopped', characteristicUuid)
      await peripheral.ble.stopNotifications(addDashes(serviceUuid), addDashes(characteristicUuid))
    }
    this.emit('notify', deviceUuid, serviceUuid, characteristicUuid, notify)
  } catch (err) {
    debug('error setting notification', serviceUuid, characteristicUuid, notify, err)
  }
}

NobleBindings.prototype.discoverDescriptors = function(deviceUuid, serviceUuid, characteristicUuid) {
  var peripheral = this._peripherals[deviceUuid]

  //TODO impelment when web API has functionatility then emit response
  //this.emit('descriptorsDiscover', deviceUuid, serviceUuid, characteristicUuid, descriptors);
}

NobleBindings.prototype.readValue = function(deviceUuid, serviceUuid, characteristicUuid, descriptorUuid) {
  var peripheral = this._peripherals[deviceUuid]

  //TODO impelment when web API has functionatility then emit response
  //this.emit('valueRead', deviceUuid, serviceUuid, characteristicUuid, descriptorUuid, data);
}

NobleBindings.prototype.writeValue = function(deviceUuid, serviceUuid, characteristicUuid, descriptorUuid, data) {
  var peripheral = this._peripherals[deviceUuid]

  //TODO impelment when web API has functionatility then emit response
  //this.emit('valueWrite', deviceUuid, serviceUuid, characteristicUuid, descriptorUuid);
}

NobleBindings.prototype.readHandle = function(deviceUuid, handle) {
  var peripheral = this._peripherals[deviceUuid]

  //TODO impelment when web API has functionatility then emit response
  //this.emit('handleRead', deviceUuid, handle, data);
}

NobleBindings.prototype.writeHandle = function(deviceUuid, handle, data, withoutResponse) {
  var peripheral = this._peripherals[deviceUuid]

  //TODO impelment when web API has functionatility then emit response
  //this.emit('handleWrite', deviceUuid, handle);
}

var nobleBindings = new NobleBindings()

module.exports = nobleBindings
