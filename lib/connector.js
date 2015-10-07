/* jshint node:true, expr:true */
'use strict';

var _loggerHelper = require('./logger-helper');
var _util = require('util');
var _clone = require('clone');
var _q = require('q');
var EventEmitter = require('events').EventEmitter;

/**
 * Base class for a connector object.
 *
 * @class Connector
 * @constructor
 * @param {String} id A unique id for the connector
 */
function Connector(id) {
    if (typeof id !== 'string' || id.length <= 0) {
        throw new Error('Invalid connector id specified (arg #1)');
    }

    Connector.super_.call(this);

    this._id = id;
    this._state = Connector.STATE_INACTIVE;
    this._buffer = [];
    this._logger = null;
    _loggerHelper.ensureLogger(this);
}

_util.inherits(Connector, EventEmitter);

/**
 * @class Connector
 * @method _start
 * @protected
 */
Connector.prototype._start = function() {
    var def = _q.defer();
    var error = 'The _start() method has not been implemented';
    this._logger.error(error);
    def.reject(error);
    return def.promise;
};

/**
 * @class Connector
 * @method _stop
 * @protected
 */
Connector.prototype._stop = function() {
    var def = _q.defer();
    var error = 'The _stop() method has not been implemented';
    this._logger.error(error);
    def.reject(error);
    return def.promise;
};

/**
 * Name of the event emitted by the connector when new data is available to it.
 *
 * @class Connector
 * @event data
 * @readonly
 */
Connector.DATA_EVENT = 'data';

/**
 * Name of the event emitted by the connector when an error occurs during data sync.
 *
 * @class Connector
 * @event error
 * @readonly
 */
Connector.ERROR_EVENT = 'error';

/**
 * Connector state that indicates that the connector is not active.
 *
 * @class Connector
 * @protected
 * @property STATE_INACTIVE
 * @static
 * @readonly
 */
Connector.STATE_INACTIVE = 'INACTIVE';

/**
 * Connector state that indicates that the connector is active.
 *
 * @class Connector
 * @protected
 * @property STATE_ACTIVE
 * @static
 * @readonly
 */
Connector.STATE_ACTIVE = 'ACTIVE';

/**
 * Returns a boolean value that indicates whether or not the connector is
 * currently active
 *
 * @class Connector
 * @method isActive
 * @return {Boolean} True if the connector is active, false otherwise.
 */
Connector.prototype.isActive = function() {
    return this._state === Connector.STATE_ACTIVE;
};

/**
 * Gets the id of the current connector object.
 *
 * @class Connector
 * @method getId
 * @return {String} The unique id of the connector
 */
Connector.prototype.getId = function() {
    return this._id;
};

/**
 * Attaches a logger object to the connector.
 *
 * @class Connector
 * @method setLogger
 * @param {Object} logger An object that exposes common logging methods. Any
 *          missing methods will be polyfilled with an alternative
 *          implementation
 */
Connector.prototype.setLogger = function(logger) {
    if (logger && typeof logger === 'object') {
        this._logger = logger;
        _loggerHelper.ensureLogger(this);
        this._logger.debug('Logger attached');
    }
};

/**
 * Initializes the connector, getting it ready for processing. This method will
 * initialize or update the connector's configuration, and then kick off (or
 * restart) any data sync operations that the connector implements.
 *
 * @class Connector
 * @method init
 * @param {Object} config Configuration information for the connector.
 * @return {Object} A promise that will be rejected or resolved based on the 
 *          outcome of the init operation.
 */
Connector.prototype.init = function(config) {
    if (!config || config instanceof Array || typeof config !== 'object') {
        throw new Error('Invalid connector configuration specified (arg #1)');
    }
    this._config = _clone(config);
    var promise = this._start().then(function(data) {
        this._logger.info('Connector started successfully');
        this._state = Connector.STATE_ACTIVE;
        return data;
    }.bind(this), function(err) {
        this._logger.error('Error starting connector: [%s]', err);
        this._state = Connector.STATE_INACTIVE;
        throw err;
    }.bind(this));

    return promise;
};

/**
 * Adds data to the connector's buffer, essentially queueing it for dispatch
 * on the next data sync cycle.
 *
 * @class Connector
 * @method addData
 * @param {Object} data The data to add to the connectors buffer.
 */
Connector.prototype.addData = function(data) {
    if (!data || data instanceof Array || typeof data !== 'object') {
        throw new Error('Invalid data object specified (arg #1)');
    }
    this._logger.debug('Pushing data into buffer', data);
    this._buffer.push(data);
};

/**
 * Stops the connector if the connector is actively running. If not, this method
 * has no effect.
 *
 * @class Connector
 * @method stop
 */
Connector.prototype.stop = function() {
    var promise = this._stop().then(function(data) {
        this._state = Connector.STATE_INACTIVE;
        this._logger.info('Connector stopped successfully');
        return data;
    }.bind(this), function(err) {
        this._logger.warn('Error stopping connector: [%s]', err);
        this._state = Connector.STATE_INACTIVE;
        throw err;
    }.bind(this));

    return promise;
};

module.exports = Connector;
