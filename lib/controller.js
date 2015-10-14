/* jshint node:true, expr:true */
'use strict';

var _fs = require('fs');
var _util = require('util');
var _clone = require('clone');
var _q = require('q');
var _path = require('path');

var _loggerHelper = require('./logger-helper');
var Connector = require('./connector');
var _connectorFactory = require('./connector-factory');

var UPDATE_CONFIG_ACTION = 'update_config';
var SEND_DATA_ACTION = 'send_data';

/**
 * Represents a controller that manages a collection of connectors, and the
 * interactions between them.
 *
 * @class Controller
 * @constructor
 * @param {Object} [controllerConfig] An optional configuration object that
 *          influences the behavior of the controller.
 * @param {Object} [loggerProvider] A provider for logger methods, used to
 *          instantiate logger entities and attach them to connectors. The
 *          provider must expose a 'getLogger(id)' method that must return
 *          a logger object when invoked.
 */
function Controller(controllerConfig, loggerProvider) {
    this._controllerConfig = this._initControllerConfig(controllerConfig);
    this._loggerProvider = loggerProvider;

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
    if (loggerProvider && typeof loggerProvider === 'object' &&
        typeof loggerProvider.getLogger === 'function') {
        this._logger = loggerProvider.getLogger('controller');
    }
    _loggerHelper.ensureLogger(this);

    this._logger.debug('Controller configuration:', this._controllerConfig);
}

/**
 * @class Controller
 * @method _initControllerConfig
 * @private
 */
Controller.prototype._initControllerConfig = function(controllerConfig) {
    var config = _clone(controllerConfig) || {};
    config.moduleBasePath = config.moduleBasePath || '';


    return config;
};


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
    this._logger.debug('Loading connector modules');
    var typeMap = {};
    for (var key in types) {
        var modulePath = types[key];

        if (modulePath.indexOf('./') === 0) {
            modulePath = _path.resolve(this._controllerConfig.moduleBasePath, modulePath);
        }
        this._logger.info('Type mapping: [%s] :: [%s]', key, modulePath);
        var module = require(modulePath);
        typeMap[key] = module;
    }
    this._logger.debug('Initializing connector factory');
    _connectorFactory.init(typeMap, this._loggerProvider);
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
    this._logger.debug('Initializing connector: [%s]::[%s]', groupName, id, config);
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
    } else {
        this._logger.info('Waiting for previous init to complete [%s]::[%s]', groupName, id);
    }
    var connector = connectorInfo.connector;
    connectorInfo.promise = connectorInfo.promise.then(function() {
        this._logger.info('Starting connector initialization: [%s]::[%s]', groupName, id);

        connectorInfo.actionPending = true;
        return connector.init(config.config);
    }.bind(this)).then(function(data) {

        connectorInfo.actionPending = false;
        connectorInfo.result = data;
        if (!connectorInfo.handlerAttached) {
            this._logger.debug('Attaching event handlers: [%s]::[%s]', groupName, id);
            if (groupName === 'device') {
                connector.on(Connector.DATA_EVENT, this._deviceDataHandler.bind(this));
            } else {
                connector.on(Connector.DATA_EVENT, this._cloudDataHandler.bind(this));
            }
            connectorInfo.handlerAttached = true;
        }
        this._logger.info('Connector initialization complete: [%s]::[%s]', groupName, id);
    }.bind(this), function(err) {
        connectorInfo.actionPending = false;
        connectorInfo.result = err;
        this._logger.error('Error initializing connector: [%s]::[%s]', groupName, id, err);
        throw err;
    }.bind(this));
    return connectorInfo;
};


/**
 * @class Controller
 * @method _stopConnector
 * @private
 */
Controller.prototype._stopConnector = function(groupName, id) {
    // The assumption here is that _stopConnector will only be called
    // if the connector has been initialized previously.
    var group = this._connectors[groupName];
    var connectorInfo = group[id];
    connectorInfo.promise = connectorInfo.promise.fin(function() {
        this._logger.info('Stopping connector: [%s]::[%s]', groupName, id);
        connectorInfo.actionPending = true;
        var promise = connectorInfo.connector.stop().fin(function() {
            this._logger.info('Connector stopped: [%s]::[%s]', groupName, id);
            connectorInfo.actionPending = false;
            connectorInfo.connector.removeAllListeners(Connector.DATA_EVENT);
        }.bind(this));
        return promise;
    }.bind(this));

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
        if (data instanceof Array) {
            this._logger.warn('Unexpected payload type: [array]');
        } else {
            this._logger.warn('Unexpected payload type: [%s]', (typeof data));
        }
        return;
    }

    var hasUpdates = false;
    for (var id in data) {
        var deviceCommand = data[id];
        if (deviceCommand && typeof deviceCommand === 'object') {
            switch (deviceCommand.action) {
                case UPDATE_CONFIG_ACTION:
                    //Note: This will create a new connector if one does not already
                    //exist.
                    this._initConnector('device', id, deviceCommand.config);
                    this._config.deviceConnectors[id].config = deviceCommand.config;
                    hasUpdates = true;
                    break;
                case SEND_DATA_ACTION:
                    var connectorInfo = this._connectors.device[id];
                    if (connectorInfo) {
                        connectorInfo.connector.addData(data);
                    } else {
                        this._logger.warn('Cannot send data to unrecognized connector: [%s]', id);
                    }
                    break;
                default:
                    this._logger.warn('Unrecognized action: [%s]', deviceCommand.action);
                    break;
            }
        } else {
            this._logger.warn('Bad device command received: ', (typeof deviceCommand));
        }
    }

    if (hasUpdates) {
        this._logger.info('Configuration updates detected. Writing to file.');
        if (!this._fileWritePromise) {
            var def = _q.defer();
            def.resolve();
            this._fileWritePromise = def.promise;
        } else {
            this._logger.info('Waiting for previous write to finish');
        }
        var writer = this._writeFile.bind(this, id);
        this._fileWritePromise = this._fileWritePromise.fin(
            this._writeFile.bind(this));
    }
};

Controller.prototype._writeFile = function() {
    var def = _q.defer();
    this._logger.debug('Writing configuration to file: [%s]', this._configFilePath);
    _fs.writeFile(this._configFilePath, JSON.stringify(this._config), function(err) {
        if (err) {
            this._logger.error('Error writing to configuration file: [%s]', this._configFilePath);
            def.reject(err);
        } else {
            this._logger.info('Config file update successful: [%s]', this._configFilePath);
            def.resolve();
        }
    }.bind(this));

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
    this._logger.debug('Initializing controller. Config file: [%s]', configFilePath);
    if (typeof configFilePath !== 'string' || configFilePath.length <= 0) {
        throw new Error('Invalid config file path specified (arg #1)');
    }
    this._state = Controller.STATE_INACTIVE;
    var def = _q.defer();
    _fs.readFile(configFilePath, function(err, data) {
        this._configFilePath = configFilePath;
        if (err) {
            this._logger.error('Error reading config file: [%s]', configFilePath);
            def.reject(err);
        } else {
            this._logger.info('Config file read successfully: [%s]', configFilePath);
            try {
                var message = '';
                data = JSON.parse(data);
                if (!this._hasConfigSection(data, 'connectorTypes')) {
                    message = 'Config does not define the connectorTypes section';
                    this._logger.error(message);
                    return def.reject(message);
                }
                if (!this._hasConfigSection(data, 'cloudConnectors')) {
                    message = 'Config does not define the cloudConnectors section';
                    this._logger.error(message);
                    return def.reject(message);
                }
                if (!this._hasConfigSection(data, 'deviceConnectors')) {
                    message = 'Config does not define the deviceConnectors section';
                    this._logger.error(message);
                    return def.reject(message);
                }
                this._config = _clone(data);
                this._initConnectorTypes(this._config.connectorTypes);

                var promises = [];

                promises = promises.concat(this._initConnectorGroup('cloud'));
                promises = promises.concat(this._initConnectorGroup('device'));

                _q.all(promises).then(function(data) {
                    this._logger.info('Connectors started successfully');
                    this._state = Controller.STATE_ACTIVE;
                    def.resolve();
                }.bind(this), function() {
                    var message = 'Error starting one or more connectors';
                    this._logger.error(message);
                    return def.reject(message, promises);
                }.bind(this));
            } catch (ex) {
                var message = 'Error processing configuration: ' + ex;
                this._logger.error(message);
                def.reject(message);
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
        this._logger.info('All connectors stopped successfully');
        def.resolve();
    }.bind(this), function() {
        var message = 'Error stopping one or more connectors';
        this._logger.error(message);
        def.reject(message, promises);
    }.bind(this));

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
