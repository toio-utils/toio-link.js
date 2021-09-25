/**
 * Author: programus
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const Noble = require('noble/lib/noble')
const bindings = require('./bindings')

const nobleInstance = new Noble(bindings)

module.exports = nobleInstance
