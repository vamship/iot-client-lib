/* jshint node:true, expr:true */
'use strict';

var _fs = require('fs');
var _util = require('util');
var _clone = require('clone');
var _q = require('q');

var Connector = require('./connector');
var _connectorFactory = require('./connector-factory');

/**
 * Represents a controller that manages a collection of connectors, and the
 * interactions between them.
 *
 * @class Controller
 * @constructor
 */
function Controller() {
    this._initPromise = null;
    this._fileWritePromise = null;
    this._state = Controller.STATE_INACTIVE;
    this._configFilePath = null;
    this._config = {};
    this._connectors = {
        device: {},
        cloud: {}
    };
    this._cloudConnectorInfo = {};
    this._deviceConnectorInfo = {};
}

/**
 * @class Controller
 * @method _hasConfigSection
 * @private
 */
Controller.prototype._hasConfigSection = function(config, section) {
    var configSection = config[section];
    return (configSection && !(configSection instanceof Array) && typeof configSection === 'object');
};

/**
 * @class Controller
 * @method _initConnectorTypes
 * @private
 */
Controller.prototype._initConnectorTypes = function(types) {
    var typeMap = {};
    for (var key in types) {
        var module = require(types[key]);
        typeMap[key] = module;
    }
    _connectorFactory.init(typeMap);
};

/**
 * @class Controller
 * @method _initConnectorGroup
 * @private
 */
Controller.prototype._initConnectorGroup = function(group) {
    var promises = [];
    var configSection = (group === 'cloud') ?
        this._config.cloudConnectors :
        this._config.deviceConnectors;
    for (var id in configSection) {
        var config = configSection[id];
        var connectorInfo = this._initConnector(group, id, config);
        promises.push(connectorInfo.promise);
    }

    return promises;
};

/**
 * @class Controller
 * @method _stopConnectorGroup
 * @private
 */
Controller.prototype._stopConnectorGroup = function(group) {
    var promises = [];
    for (var id in this._connectors[group]) {
        var connectorInfo = this._stopConnector(group, id);
        promises.push(connectorInfo.promise);
    }

    return promises;
};

/**
 * @class Controller
 * @method _initConnector
 * @private
 */
Controller.prototype._initConnector = function(groupName, id, config) {
    var group = this._connectors[groupName];
    var connectorInfo = group[id];
    if (!connectorInfo) {
        connectorInfo = {
            connector: _connectorFactory.createConnector(config.type, id),
            promise: null,
            actionPending: true,
            handlerAttached: false,
            result: null
        };
        group[id] = connectorInfo;
    }

    if (!connectorInfo.promise) {
        var def = _q.defer();
        def.resolve();
        connectorInfo.promise = def.promise;
    }
    var connector = connectorInfo.connector;
    connectorInfo.promise = connectorInfo.promise.then(function() {

        connectorInfo.actionPending = true;
        return connector.init(config.config);
    }).then(function(data) {

        connectorInfo.actionPending = false;
        connectorInfo.result = data;
        if (!connectorInfo.handlerAttached) {
            if (groupName === 'device') {
                connector.on(Connector.DATA_EVENT, this._deviceDataHandler.bind(this));
            } else {
                connector.on(Connector.DATA_EVENT, this._cloudDataHandler.bind(this));
            }
            connectorInfo.handlerAttached = true;
        }
    }.bind(this), function(err) {
        connectorInfo.actionPending = false;
        connectorInfo.result = err;
        throw err;
    });
    return connectorInfo;
};


/**
 * @class Controller
 * @method _stopConnector
 * @private
 */
Controller.prototype._stopConnector = function(group, id) {
    // The assumption here is that _stopConnector will only be called
    // if the connector has been initialized previously.
    group = this._connectors[group];
    var connectorInfo = group[id];
    connectorInfo.promise = connectorInfo.promise.fin(function() {
        connectorInfo.actionPending = true;
        var promise = connectorInfo.connector.stop().fin(function() {
            connectorInfo.actionPending = false;
            connectorInfo.connector.removeAllListeners(Connector.DATA_EVENT);
        });
        return promise;
    });

    return connectorInfo;
};

/**
 * @class Controller
 * @method _generateConnectorInfo
 * @private
 */
Controller.prototype._generateConnectorInfo = function(connectorGroup, configSection) {
    var map = {};
    for (var key in connectorGroup) {
        var config = configSection[key];
        var connectorInfo = connectorGroup[key];
        map[key] = {
            connector: connectorInfo.connector,
            actionPending: connectorInfo.actionPending,
            result: connectorInfo.result || null,
            type: config.type,
            config: config.config
        };
    }
    return map;
};

/**
 * @class Controller
 * @method _deviceDataHandler
 * @private
 */
Controller.prototype._deviceDataHandler = function(data) {
    for (var id in this._connectors.cloud) {
        var connectorInfo = this._connectors.cloud[id];
        connectorInfo.connector.addData(data);
    }
};

/**
 * @class Controller
 * @method _cloudDataHandler
 * @private
 */
Controller.prototype._cloudDataHandler = function(data) {
    if (!data || (data instanceof Array) || typeof data !== 'object') {
        //TODO: Log a message here.
        //Unknown data payload
        return;
    }

    var hasUpdates = false;
    for (var id in data) {
        var deviceCommand = data[id];
        if (deviceCommand && typeof deviceCommand === 'object') {
            switch (deviceCommand.action) {
                case 'update':
                    this._initConnector('device', id, deviceCommand.config);
                    break;
                default:
                    //TODO: Log a message here.
                    // Unknown action
                    break;
            }
            this._config.deviceConnectors[id].config = deviceCommand.config;
            hasUpdates = true;
        }
        // else {
        // }
        //TODO: Log a message on the else block.
        // Bad device command
    }

    if (hasUpdates) {
        if (!this._fileWritePromise) {
            var def = _q.defer();
            def.resolve();
            this._fileWritePromise = def.promise;
        }
        var writer = this._writeFile.bind(this, id);
        this._fileWritePromise = this._fileWritePromise.fin(
            this._writeFile.bind(this));
    }
};

Controller.prototype._writeFile = function() {
    var def = _q.defer();
    _fs.writeFile(this._configFilePath, JSON.stringify(this._config), function(err) {
        if (err) {
            //TODO: Log a message here.
            // Error writing to file
            def.reject(err);
        } else {
            def.resolve();
        }
    });

    return def.promise;
}

/**
 * Controller state that indicates that the controller is not active.
 *
 * @class Controller
 * @private
 * @property STATE_INACTIVE
 * @static
 * @readonly
 */
Controller.STATE_INACTIVE = 'INACTIVE';

/**
 * Controller state that indicates that the controller is active.
 *
 * @class Controller
 * @private
 * @property STATE_ACTIVE
 * @static
 * @readonly
 */
Controller.STATE_ACTIVE = 'ACTIVE';

/**
 * Returns a boolean value that indicates whether or not the controller is
 * currently active
 *
 * @class Controller
 * @method isActive
 * @return {Boolean} True if the controller is active, false otherwise.
 */
Controller.prototype.isActive = function() {
    return this._state === Controller.STATE_ACTIVE;
};

/**
 * Initializes the controller by loading configuration and starting up
 * connectors based on configuration.
 *
 * @class Controller
 * @method init
 * @param {String} configFilePath The path to a config file from which core
 *          connector and other config information can be loaded.
 * @return {Object} A promise that is resolved or rejected based on the
 *          result of the initialization process.
 */
Controller.prototype.init = function(configFilePath) {
    if (typeof configFilePath !== 'string' || configFilePath.length <= 0) {
        throw new Error('Invalid config file path specified (arg #1)');
    }
    this._state = Controller.STATE_INACTIVE;
    var def = _q.defer();
    _fs.readFile(configFilePath, function(err, data) {
        this._configFilePath = configFilePath;
        if (err) {
            def.reject(err);
        } else {
            try {
                data = JSON.parse(data);
                if (!this._hasConfigSection(data, 'connectorTypes')) {
                    return def.reject('Config does not define the connectorTypes section');
                }
                if (!this._hasConfigSection(data, 'cloudConnectors')) {
                    return def.reject('Config does not define the cloudConnectors section');
                }
                if (!this._hasConfigSection(data, 'deviceConnectors')) {
                    return def.reject('Config does not define the deviceConnectors section');
                }
                this._config = _clone(data);
                this._initConnectorTypes(this._config.connectorTypes);

                var promises = [];

                promises = promises.concat(this._initConnectorGroup('cloud'));
                promises = promises.concat(this._initConnectorGroup('device'));

                _q.all(promises).then(function(data) {
                    this._state = Controller.STATE_ACTIVE;
                    def.resolve();
                }.bind(this), function() {
                    def.reject('Error starting one or more connectors', promises);
                });
            } catch (ex) {
                def.reject('Error processing configuration: ' + ex);
            }
        }
    }.bind(this));

    return def.promise;
};

/**
 * Stops the controller, which will result in the shutdown of all connectors.
 *
 * @class Controller
 * @method stop
 */
Controller.prototype.stop = function() {
    var def = _q.defer();

    var promises = [];

    promises = promises.concat(this._stopConnectorGroup('cloud'));
    promises = promises.concat(this._stopConnectorGroup('device'));

    _q.all(promises).then(function(data) {
        def.resolve();
    }, function() {
        def.reject('Error stopping one or more connectors', promises);
    });

    return def.promise;
};

/**
 * Returns a map of all initialized cloud connectors.
 *
 * @class Controller
 * @method getCloudConnectors
 * @return {Object} A map of all defined cloud connectors and their current
 *              state
 */
Controller.prototype.getCloudConnectors = function() {
    return this._generateConnectorInfo(this._connectors.cloud,
        this._config.cloudConnectors);
};

/**
 * Returns a map of all initialized device connectors.
 *
 * @class Controller
 * @method getDeviceConnectors
 * @return {Object} A map of all defined device connectors and their current
 *              state
 */
Controller.prototype.getDeviceConnectors = function() {
    return this._generateConnectorInfo(this._connectors.device,
        this._config.deviceConnectors);
};

module.exports = Controller;
