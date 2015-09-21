/* jshint node:true, expr:true */
'use strict';

var _util = require('util');
var _clone = require('clone');
var _q = require('q');
var Connector = require('./connector');

/**
 * Base class for a connector, with built in polling functionality.
 *
 * @class PollingConnector
 * @constructor
 * @param {String} id A unique id for the connector
 */
function PollingConnector(id) {
    PollingConnector.super_.call(this, id);
    this._pollingHandle = null;
}

_util.inherits(PollingConnector, Connector);

/**
 * @class PollingConnector
 * @method _start
 * @protected
 */
PollingConnector.prototype._start = function() {
    var def = _q.defer();
    if(typeof this._config.pollFrequency !== 'number' ||
       this._config.pollFrequency <= 0) {
        def.reject('Connector configuration does not define a valid pollFrequency property');
    } else {
        if(this._pollingHandle) {
            clearInterval(this._pollingHandle);
        }
        this._pollingHandle = setInterval(this._process.bind(this),
                                          this._config.pollFrequency);
        def.resolve();
    }
    return def.promise;
};

/**
 * @class PollingConnector
 * @method _stop
 * @protected
 */
PollingConnector.prototype._stop = function() {
    var def = _q.defer();
    if(this._pollingHandle) {
        clearInterval(this._pollingHandle);
    }
    def.resolve();
    return def.promise;
};

/**
 * @class PollingConnector
 * @method _process
 * @protected
 */
PollingConnector.prototype._process = function() {
};

module.exports = PollingConnector;
