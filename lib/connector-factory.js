/* jshint node:true, expr:true */
'use strict';

var _util = require('util');
var _clone = require('clone');
var EventEmitter = require('events').EventEmitter;

var _typeMap = {};
var _loggerProvider = null;

module.exports = {
    /**
     * Initializes the factory with a mapping of connector names to connector
     * types.
     *
     * @module connectorFactory
     * @method init
     * @param {Object} config Factory configuration - a mapping of connector
     *          names to connector types.
     * @param {Object} [loggerProvider] A provider for logger methods, used to
     *          instantiate logger entities and attach them to connectors. The
     *          provider must expose a 'getLogger(id)' method that must return
     *          a logger object when invoked.
     */
    init: function(config, loggerProvider) {
        if (!config || config instanceof Array || typeof config !== 'object') {
            throw new Error('Invalid factory configuration specified (arg #1)');
        }
        _typeMap = _clone(config);
        _loggerProvider = loggerProvider;
    },

    /**
     * Creates a new connector object, initialized with the specified id.
     *
     * @module connectorFactory
     * @method createConnector
     * @param {String} name The name of the connector to create. This connector
     *          must have been initialized with the factory using the init()
     *          method.
     * @param {String} [id] An optional id for the connector instance. If
     *          omitted, a new id will be generated for the connector.
     * @return {Object} A connector object.
     */
    createConnector: function(name, id) {
        if (typeof name !== 'string' || name.length <= 0) {
            throw new Error('Invalid connector type specified (arg #1)');
        }
        if (typeof id !== 'string' || id.length <= 0) {
            throw new Error('Invalid connector id specified (arg #2)');
        }

        var Type = _typeMap[name];
        if (!Type) {
            throw new Error('The specified connector type has not been defined: ' + name);
        }
        var connector = new Type(id);
        if (_loggerProvider && typeof _loggerProvider === 'object' &&
            typeof _loggerProvider.getLogger === 'function') {

            var logger = _loggerProvider.getLogger(id);
            if (logger) {
                connector.setLogger(logger);
            }
        }
        return connector;
    }
};
