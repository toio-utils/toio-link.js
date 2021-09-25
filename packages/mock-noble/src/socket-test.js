/**
 * Author: programus
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import WebSocket from 'ws'

const ws = new WebSocket('wss://device-manager.scratch.mit.edu:20110/scratch/ble')

ws.on('message', data => {
  console.log(data.toString())
})

ws.on('open', () => {
  console.log('connected')
  ws.send(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'discover',
      params: {
        filters: [
          {
            services: ['10b20100-5b3b-4571-9508-cf3efcd7bbae'],
          },
        ],
      },
    }),
  )
})
