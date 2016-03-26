/* jshint node:true, expr:true */
'use strict';

var _fs = require('fs');
var _util = require('util');
var _clone = require('clone');
var _q = require('q');
var _path = require('path');
var EventEmitter = require('events').EventEmitter;

var _loggerHelper = require('./logger-helper');
var Connector = require('./connector');
var CncRequest = require('./cnc-request');
var _connectorFactory = require('./connector-factory');

var UPDATE_CONFIG_ACTION = 'update_config';
var DELETE_CONFIG_ACTION = 'delete_config';
var UPDATE_CONNECTOR_TYPE_ACTION = 'update_connector_type';
var SEND_DATA_ACTION = 'send_data';

var STOP_CONNECTOR_ACTION = 'stop_connector';
var START_CONNECTOR_ACTION = 'start_connector';
var RESTART_CONNECTOR_ACTION = 'restart_connector';
var STOP_ALL_CONNECTORS_ACTION = 'stop_all_connectors';
var START_ALL_CONNECTORS_ACTION = 'start_all_connectors';
var RESTART_ALL_CONNECTORS_ACTION = 'restart_all_connectors';
var LIST_CONNECTORS_ACTION = 'list_connectors';
var GET_CONNECTOR_CONFIG_ACTION = 'get_connector_config';

var MAINTENANCE_ACTION = 'maintenance_action';

var CLOUD_CONNECTOR_CATEGORY = 'cloud';
var DEVICE_CONNECTOR_CATEGORY = 'device';

var DEFAULT_REQUEST_ID = 'na';

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
    Controller.super_.call(this);

    this._controllerConfig = this._initControllerConfig(controllerConfig);
    this._loggerProvider = loggerProvider;

    this._initPromise = null;
    this._fileWritePromise = null;
    this._shutdownFlag = false;
    this._state = Controller.STATE_INACTIVE;
    this._configFilePath = null;
    this._config = {};
    this._connectors = { };
    this._connectors[CLOUD_CONNECTOR_CATEGORY] = {};
    this._connectors[DEVICE_CONNECTOR_CATEGORY] = {};

    this._cloudConnectorInfo = {};
    this._deviceConnectorInfo = {};
    if (loggerProvider && typeof loggerProvider === 'object' &&
        typeof loggerProvider.getLogger === 'function') {
        this._logger = loggerProvider.getLogger('controller');
    }
    _loggerHelper.ensureLogger(this);

    this._logger.debug('Controller configuration:', this._controllerConfig);
}

_util.inherits(Controller, EventEmitter);

/**
 * Name of the event emitted by the controller when a maintenance action is
 * received from the cloud.
 *
 * @class Controller
 * @event maintenance
 * @readonly
 */
Controller.MAINTENANCE_EVENT = 'maintenance';

/**
 * Controller action that indicates an administrative event.
 *
 * @class Controller
 * @property MAINTENANCE_ACTION
 * @readonly
 */
Controller.MAINTENANCE_ACTION = MAINTENANCE_ACTION;

/**
 * @class Controller
 * @method _passthroughSuccess
 * @private
 */
Controller.prototype._passthroughSuccess = function(data) {
    return data;
};

/**
 * @class Controller
 * @method _passthroughFail
 * @private
 */
Controller.prototype._passthroughFail = function(err) {
    err = err || '';
    this._logger.warn('Recovering from previous eror: [%s]', err.toString());
};

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
Controller.prototype._initConnectorTypes = function(request) {
    this._logger.debug('Loading connector modules. RequestId: [%s]', request.id);
    var types = this._config.connectorTypes;
    var typeMap = {};
    for (var key in types) {
        var modulePath = types[key];

        if (modulePath.indexOf('./') === 0) {
            modulePath = _path.resolve(this._controllerConfig.moduleBasePath, modulePath);
        }
        this._logger.info('Type mapping: [%s] :: [%s]. RequestId: [%s]', key, modulePath, request.id);
        var module = require(modulePath);
        typeMap[key] = module;
    }
    this._logger.debug('Initializing connector factory. RequestId: [%s]', request.id);
    _connectorFactory.init(typeMap, this._loggerProvider);
};


/**
 * @class Controller
 * @method _isValidConnectorCategory
 * @private
 */
Controller.prototype._isValidConnectorCategory = function(category) {
    return (category === CLOUD_CONNECTOR_CATEGORY ||
            category === DEVICE_CONNECTOR_CATEGORY);
};

/**
 * @class Controller
 * @method _sanitizeConnectorConfig
 * @private
 * //TODO: Need to find a more elegant solution for this. We are now bleeding
 * // logic across libraries.
 */
Controller.prototype._sanitizeConnectorConfig = function(configSection) {
    for(var key in configSection) {
        var config = configSection[key];

        if(config.type === 'CncCloud') {
            config.config.password = '';
        } else if(config.type === 'Http') {
            config.config.headers.authorization = '';
        }
    }

    return configSection;
};

/**
 * @class Controller
 * @method _getConnectorConfig
 * @private
 */
Controller.prototype._getConnectorConfig = function(category) {
    if (category === CLOUD_CONNECTOR_CATEGORY) {
        return this._config.cloudConnectors;
    } else if(category === DEVICE_CONNECTOR_CATEGORY) {
         return this._config.deviceConnectors;
    }
    //Failsafe - should never be called.
    throw new Error('Invalid connector category: [%s]', category);
};

/**
 * @class Controller
 * @method _getConnectorInfo
 * @private
 */
Controller.prototype._getConnectorInfo = function(category) {
    if (category === CLOUD_CONNECTOR_CATEGORY) {
        return this._connectors.cloud;
    } else if(category === DEVICE_CONNECTOR_CATEGORY) {
         return this._connectors.device;
    }
    //Failsafe - should never be called.
    throw new Error('Invalid connector category: [%s]', category);
};

/**
 * @class Controller
 * @method _initConnectorGroup
 * @private
 */
Controller.prototype._initConnectorGroup = function(category, request) {
    var promises = [];
    var configSection = this._getConnectorConfig(category);
    for (var id in configSection) {
        var connectorInfo = this._initConnector(category, id, request);
        promises.push(connectorInfo.promise);
    }

    return promises;
};

/**
 * @class Controller
 * @method _stopConnectorGroup
 * @private
 */
Controller.prototype._stopConnectorGroup = function(category, request) {
    var promises = [];
    for (var id in this._getConnectorInfo(category)) {
        var connectorInfo = this._stopConnector(category, id, request);
        promises.push(connectorInfo.promise);
    }

    return promises;
};

/**
 * Note that this method assumes that a valid connector and its configuration
 * have been defined with the specified category/id.
 *
 * ** NO additional validation checks will be performed here **
 * 
 * @class Controller
 * @method _initConnector
 * @private
 */
Controller.prototype._initConnector = function(category, id, request) {
    this._logger.info('Initializing connector: [%s::%s]. RequestId: [%s]', category, id, request.id);
    request.logInfo('Initializing connector: [%s::%s]', category, id);

    var configSection = this._getConnectorConfig(category);
    var config = configSection[id];
    this._logger.info('Connector config: [%s::%s]. RequestId: [%s]', category, id, request.id, config);
    var group = this._getConnectorInfo(category);
    var connectorInfo = group[id];
    if (!connectorInfo) {
        connectorInfo = {
            connector: null,
            promise: null,
            actionPending: true,
            result: null
        };
        group[id] = connectorInfo;
    }

    if (!connectorInfo.promise) {
        var def = _q.defer();
        def.resolve();
        connectorInfo.promise = def.promise;
    } else {
        this._logger.info('Waiting for previous init/stop to complete: [%s::%s]. RequestId: [%s]', category, id, request.id);
    }
    connectorInfo.promise = connectorInfo.promise
    .then(this._passthroughSuccess, this._passthroughFail.bind(this))
    .then(function() {
        this._logger.info('Starting connector initialization: [%s::%s]. RequestId: [%s]', category, id, request.id);
        request.logInfo('Starting connector initialization: [%s::%s]', category, id);
        var message ='';

        if(connectorInfo.connector) {
            request.logWarn('Aborting init. Connector already active: [%s::%s]', category, id);
            message = _util.format('Aborting init. Connector already active: [%s::%s]. RequestId: [%s]', category, id, request.id);
            this._logger.warn(message);
            throw new Error(message);
        } else if(this._shutdownFlag) {
            request.logWarn('Aborting init. System in shutdown state: [%s::%s]', category, id);
            message = _util.format('Aborting init. System in shutdown state: [%s::%s]. RequestId: [%s]', category, id, request.id);
            this._logger.warn(message);
            throw new Error(message);
        }

        connectorInfo.connector = _connectorFactory.createConnector(config.type, id);
        connectorInfo.actionPending = true;
        return connectorInfo.connector.init(config.config, request.id);
    }.bind(this)).then(function(data) {

        connectorInfo.actionPending = false;
        connectorInfo.result = data;
        this._logger.debug('Attaching event handlers: [%s::%s]. RequestId: [%s]', category, id, request.id);
        if (category === DEVICE_CONNECTOR_CATEGORY) {
            connectorInfo.connector.on(Connector.DATA_EVENT, this._deviceDataHandler.bind(this));
        } else {
            connectorInfo.connector.on(Connector.DATA_EVENT, this._cloudDataHandler.bind(this));
        }
        connectorInfo.connector.on(Connector.LOG_EVENT, this._logDataHandler.bind(this));
        this._logger.info('Connector initialization complete: [%s::%s]. RequestId: [%s]', category, id, request.id);
        request.logInfo('Connector initialization complete: [%s::%s]', category, id);
    }.bind(this), function(err) {
        connectorInfo.actionPending = false;
        connectorInfo.result = err;
        this._logger.error('Error initializing connector: [%s::%s]. RequestId: [%s]', category, id, request.id, err);
        request.logError('Error initializing connector: [%s::%s]', category, id);
        throw err;
    }.bind(this));
    return connectorInfo;
};


/**
 * Note that this method assumes that a valid connector has been defined with
 * the specified category/id.
 *
 * ** NO additional validation checks will be performed here **
 *
 * @class Controller
 * @method _stopConnector
 * @private
 */
Controller.prototype._stopConnector = function(category, id, request) {
    var group = this._getConnectorInfo(category);
    var connectorInfo = group[id];
    connectorInfo.promise = connectorInfo.promise
    .then(this._passthroughSuccess, this._passthroughFail.bind(this))
    .then(function() {
        this._logger.info('Stopping connector: [%s::%s]. RequestId: [%s]', category, id, request.id);
        request.logInfo('Stopping connector: [%s::%s]', category, id);
        connectorInfo.actionPending = true;

        var promise = null;
        if(connectorInfo.connector) {
            var promise = connectorInfo.connector.stop(request.id).fin(function() {
                this._logger.info('Connector stopped: [%s::%s]. RequestId: [%s]', category, id, request.id);
                request.logInfo('Connector stopped:: [%s::%s]', category, id);

                connectorInfo.actionPending = false;
                connectorInfo.connector.removeAllListeners(Connector.DATA_EVENT);
                this._logger.info('Destroying connector: [%s::%s]. RequestId: [%s]', category, id, request.id);
                request.logInfo('Destroying connector:: [%s::%s]', category, id);
                connectorInfo.connector = null;
            }.bind(this));
            return promise;
        } else {
            request.logWarn('Aborting stop. Connector not running [%s::%s]', category, id);
            var message = _util.format('Aborting stop. Connector not active [%s::%s]. RequestId: [%s]', category, id, request.id);
            this._logger.warn(message);
            throw new Error(message);
        }
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
        config = config || { };
        var connectorInfo = connectorGroup[key];
        if(connectorInfo.connector) {
            map[key] = {
                connector: connectorInfo.connector,
                actionPending: connectorInfo.actionPending,
                result: connectorInfo.result || null,
                type: config.type,
                config: config.config
            };
        }
    }
    return map;
};

/**
 * @class Controller
 * @method _deviceDataHandler
 * @private
 */
Controller.prototype._deviceDataHandler = function(data) {
    var group = this._getConnectorInfo(CLOUD_CONNECTOR_CATEGORY);
    for (var id in group) {
        var connectorInfo = group[id];
        if(connectorInfo && connectorInfo.connector) {
            connectorInfo.connector.addData(data);
        }
    }
};

/**
 * @class Controller
 * @method _logDataHandler
 * @private
 */
Controller.prototype._logDataHandler = function(data) {
    var group = this._getConnectorInfo(CLOUD_CONNECTOR_CATEGORY);
    for (var id in group) {
        var connectorInfo = group[id];
        if(connectorInfo && connectorInfo.connector) {
            connectorInfo.connector.addLogData(data);
        }
    }
};

/**
 * @class Controller
 * @method _cloudDataHandler
 * @private
 */
Controller.prototype._cloudDataHandler = function(data) {
    if(!data || !(data instanceof Array)) {
        this._logger.warn('Unexpected payload type: [%s]', (typeof data));
        return;
    }

    if(data.length <= 0) {
        this._logger.warn('Data from cloud connector has no elements: [%s]', data.length);
        return;
    }

    var configUpdated = false;
    var writeFileRequest = null;

    this._logger.debug('Processing commands from the cloud', data);
    data.forEach(function(command) {
        if(!command || typeof command !== 'object') {
            this._logger.warn('Bad connector command received from cloud connector. Expected object, got: [%s]', (typeof command));
        } else if(typeof command.action !== 'string') {
            this._logger.warn('Connector command does not define a valid "action" property: [%s]', command.action);
        } else {
            command.requestId = command.requestId || DEFAULT_REQUEST_ID;
            this._logger.info('Processing command from cloud', command);

            var request = new CncRequest(command, this._logDataHandler.bind(this));
            if(this._processCloudCommand(request)) {
                configUpdated = true;
                writeFileRequest = request;
            }
            
        }
    }.bind(this));

    if (configUpdated) {
        this._logger.info('Configuration updates detected. Writing to file.');
        if (!this._fileWritePromise) {
            var def = _q.defer();
            def.resolve();
            this._fileWritePromise = def.promise;
        } else {
            this._logger.info('Waiting for previous write to finish');
        }
        var writer = this._writeFile.bind(this, writeFileRequest);
        this._fileWritePromise = this._fileWritePromise.fin(
            this._writeFile.bind(this, writeFileRequest));
    }
};

/**
 * @class Controller
 * @method _processCloudCommand
 * @private
 */
Controller.prototype._processCloudCommand = function(request) {
    var cmd = request.command;
    var arg2 = cmd.category || cmd.type || cmd.command;
    var arg3 = cmd.id || cmd.modulePath || 'na';

    request.logInfo('Processing command: [%s] [%s::%s]', cmd.action, arg2, arg3);
    request.acknowledge();
    switch (cmd.action) {
        case STOP_CONNECTOR_ACTION:
            return this._execStopCommand(cmd.category, cmd.id, request);
        case START_CONNECTOR_ACTION:
            return this._execStartCommand(cmd.category, cmd.id, request);
        case RESTART_CONNECTOR_ACTION:
            this._execStopCommand(cmd.category, cmd.id, request);
            this._execStartCommand(cmd.category, cmd.id, request);
            return false;
        case LIST_CONNECTORS_ACTION:
            return this._execListConnectorsCommand(cmd.category, request);
        case GET_CONNECTOR_CONFIG_ACTION:
            return this._execGetConnectorConfigAction(cmd.category, cmd.id, request);
        case STOP_ALL_CONNECTORS_ACTION:
            if(!cmd.category) {
                this._stopConnectorGroup(CLOUD_CONNECTOR_CATEGORY, request);
                this._stopConnectorGroup(DEVICE_CONNECTOR_CATEGORY, request);
            } else if(this._isValidConnectorCategory(cmd.category)) {
                this._stopConnectorGroup(cmd.category, request);
            }
            return false;
        case START_ALL_CONNECTORS_ACTION:
            if(!cmd.category) {
                this._initConnectorGroup(CLOUD_CONNECTOR_CATEGORY, request);
                this._initConnectorGroup(DEVICE_CONNECTOR_CATEGORY, request);
            } else if(this._isValidConnectorCategory(cmd.category)) {
                this._initConnectorGroup(cmd.category, request);
            }
            return false;
        case RESTART_ALL_CONNECTORS_ACTION:
            if(!cmd.category) {
                this._stopConnectorGroup(CLOUD_CONNECTOR_CATEGORY, request);
                this._initConnectorGroup(CLOUD_CONNECTOR_CATEGORY, request);
                this._stopConnectorGroup(DEVICE_CONNECTOR_CATEGORY, request);
                this._initConnectorGroup(DEVICE_CONNECTOR_CATEGORY, request);
            } else if(this._isValidConnectorCategory(cmd.category)) {
                this._stopConnectorGroup(cmd.category, request);
                this._initConnectorGroup(cmd.category, request);
            }
            return false;
        case SEND_DATA_ACTION:
            this._execSendDataCommand(cmd.category, cmd.id,
                                      cmd.data, request);
            return false;
        case UPDATE_CONFIG_ACTION:
            return this._execUpdateConfigCommand(cmd.category, cmd.id,
                                                 cmd.config, request);
        case DELETE_CONFIG_ACTION:
            return this._execDeleteConfigCommand(cmd.category, cmd.id,
                                                 request);
        case UPDATE_CONNECTOR_TYPE_ACTION:
            if(this._execUpdateConnectorTypeCommand(cmd.type,
                                                    cmd.modulePath, request)) {
                this._initConnectorTypes(request);
                return true;
            }
            return false;
        case MAINTENANCE_ACTION:
            this.stop(request).fin(function() {
                this.emit(Controller.MAINTENANCE_EVENT, {
                    command: cmd.command,
                    requestId: request.id
                });
            }.bind(this))
            return false;
        default:
            this._logger.warn('Unrecognized action: [%s]. RequestId: [%s]', cmd.action, request.id);
            request.completeError('Unrecognized action: [%s]', cmd.action);
            break;
    }
};

/**
 * @class Controller
 * @method _execStopCommand
 * @private
 */
Controller.prototype._execStopCommand = function(category, id, request) {
    if(!this._isValidConnectorCategory(category)) {
        this._logger.error('Invalid connector category specified: [%s]. RequestId: [%s]', category, request.id);
        request.completeError('Invalid connector category specified: [%s::%s]', category, id);
        return false;
    }
    var group = this._getConnectorInfo(category);
    var connectorInfo = group[id];
    if(!connectorInfo) {
        this._logger.warn('Cannot stop connector. Connector not initialized: [%s::%s]. RequestId: [%s]', category, id, request.id);
        request.completeError('Cannot stop connector. Connector not initialized: [%s::%s]', category, id);
        return false;
    }
    this._stopConnector(category, id, request)
        .promise.then(request.getSuccessHandler(), request.getErrorHandler());
    return false;
};

/**
 * @class Controller
 * @method _execStartCommand
 * @private
 */
Controller.prototype._execStartCommand = function(category, id, request) {
    if(!this._isValidConnectorCategory(category)) {
        this._logger.error('Invalid connector category specified: [%s]. RequestId: [%s]', category, request.id);
        request.completeError('Invalid connector category specified: [%s::%s]', category, id);
        return false;
    }
    var configSection = this._getConnectorConfig(category);
    var config = configSection[id];
    if(!config) {
        this._logger.warn('Cannot start connector. No config defined: [%s::%s]. RequestId: [%s]', category, id, request.id);
        request.completeError('Cannot start connector. No config defined: [%s::%s]', category, id);
        return false;
    };
    this._initConnector(category, id, request)
        .promise.then(request.getSuccessHandler(), request.getErrorHandler());
    return false;
};

/**
 * @class Controller
 * @method _execListConnectorsCommand
 * @private
 */
Controller.prototype._execListConnectorsCommand = function(category, request) {
    var categories;
    if(typeof category === 'undefined') {
        categories = [ CLOUD_CONNECTOR_CATEGORY, DEVICE_CONNECTOR_CATEGORY ];
        category = 'all';
    } else if(!this._isValidConnectorCategory(category)) {
        this._logger.error('Invalid connector category specified: [%s]. RequestId: [%s]', category, request.id);
        request.completeError('Invalid connector category specified: [%s]', category);
        return false;
    } else {
        categories = [ category ]
    }
    var response = [ ];
    categories.forEach(function(category) {
        var group = this._getConnectorInfo(category);
        var config = this._getConnectorConfig(category);
        var connectorMap = this._generateConnectorInfo(group, config);
        for(var id in connectorMap) {
            var connectorInfo = connectorMap[id];
            var state = (connectorInfo.actionPending)? 'WAITING':'READY';
            response.push({
                id: id,
                category: category,
                state: state
            });
        }
    }.bind(this));
    request.completeOk(response);
    return false;
};

/**
 * @class Controller
 * @method _execGetConnectorConfigAction
 * @private
 */
Controller.prototype._execGetConnectorConfigAction = function(category, id, request) {
    var categories;
    if(!this._isValidConnectorCategory(category)) {
        this._logger.error('Invalid connector category specified: [%s]. RequestId: [%s]', category, request.id);
        request.completeError('Invalid connector category specified: [%s::%s]', category, id);
        return false;
    }
    var response = null;
    var configSection = this._getConnectorConfig(category);
    if(typeof id !== 'undefined') {
        var config = configSection[id];
        if(!config) {
            this._logger.warn('Cannot get connector config. No config defined: [%s::%s]. RequestId: [%s]', category, id, request.id);
            request.completeError('Cannot get connector config. No config defined: [%s::%s]', category, id);
            return false;
        };
        response = {
            id: _clone(config)
        };
    } else {
        response = _clone(configSection);
    }
    request.completeOk(this._sanitizeConnectorConfig(response));
    return false;
};

/**
 * @class Controller
 * @method _execSendDataCommand
 * @private
 */
Controller.prototype._execSendDataCommand = function(category, id, data, request) {
    if(!this._isValidConnectorCategory(category)) {
        this._logger.error('Invalid connector category specified: [%s]. RequestId: [%s]', category, request.id);
        request.completeError('Invalid connector category specified: [%s::%s]', category, id);
        return false;
    }
    var group = this._getConnectorInfo(category);
    var connectorInfo = group[id];
    if(!connectorInfo || !connectorInfo.connector) {
        this._logger.warn('Cannot send data to connector. Connector not initialized: [%s::%s]. RequestId: [%s]', category, id, request.id);
        request.completeError('Cannot send data to connector. Connector not initialized: [%s::%s]', category, id);
        return false;
    }
    connectorInfo.connector.addData(data, request.id);
    request.completeOk();
    return false;
};

/**
 * @class Controller
 * @method _execUpdateConfigCommand
 * @private
 */
Controller.prototype._execUpdateConfigCommand = function(category, id, config, request) {
    if(!this._isValidConnectorCategory(category)) {
        this._logger.error('Invalid connector category specified: [%s]. RequestId: [%s]', category, request.id);

        request.completeError('Invalid connector category specified: [%s::%s]', category, id);
        return false;
    }
    if(!config) {
        this._logger.warn('Cannot update connector config. Invalid config specified: [%s::%s]. RequestId: [%s]', category, id, request.id, config);

        request.completeError('Cannot update connector config. Invalid config specified: [%s::%s]', category, id, config);
        return false;
    }
    var configSection = this._getConnectorConfig(category);
    configSection[id] = config;
    request.completeOk();
    return true;
};

/**
 * @class Controller
 * @method _execDeleteConfigCommand
 * @private
 */
Controller.prototype._execDeleteConfigCommand = function(category, id, config, request) {
    if(!this._isValidConnectorCategory(category)) {
        this._logger.error('Invalid connector category specified: [%s]. RequestId: [%s]', category, request.id);
        request.completeError('Invalid connector category specified: [%s::%s]', category, id);
        return false;
    }
    var configSection = this._getConnectorConfig(category);
    var config = configSection[id];
    if(!config) {
        this._logger.warn('Cannot delete connector config. No config defined: [%s::%s]. RequestId: [%s]', category, id, request.id);
        request.completeError('Cannot delete connector config. No config defined: [%s::%s]', category, id);
        return false;
    };
    delete configSection[id];
    request.completeOk();
    return true;
};

/**
 * @class Controller
 * @method _execUpdateConnectorTypeCommand
 * @private
 */
Controller.prototype._execUpdateConnectorTypeCommand = function(type, modulePath, request) {
    if(typeof type !== 'string' || type.length <= 0) {
        this._logger.error('Cannot update connector type. Invalid type specified: [%s]. RequestId: [%s]', type, request.id);
        request.completeError('Cannot update connector type. Invalid type specified: [%s].', type);
        return false;
    }
    if(typeof modulePath !== 'string' || modulePath.length <= 0) {
        this._logger.error('Cannot update connector type. Invalid path specified: [%s]. RequestId: [%s]', modulePath, request.id);
        request.completeError('Cannot update connector type. Invalid path specified: [%s].', modulePath);
        return false;
    }
    this._config.connectorTypes[type] = modulePath;
    request.completeOk();
    return true;
};

/**
 * @class Controller
 * @method _writeFile
 * @private
 */
Controller.prototype._writeFile = function(request) {
    var def = _q.defer();
    this._logger.debug('Writing configuration to file: [%s]', this._configFilePath);
    _fs.writeFile(this._configFilePath, JSON.stringify(this._config, null, 4), function(err) {
        if (err) {
            this._logger.error('Error writing to configuration file: [%s]', this._configFilePath);
            request.logError('Error writing to configuration file: [%s]', this._configFilePath, err);
            def.reject(err);
        } else {
            this._logger.info('Config file update successful: [%s]', this._configFilePath);
            request.logInfo('Config file update successful: [%s]', this._configFilePath);
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
 * @param {String} [requestId] An optional request id to use track the init
 *          action.
 * @return {Object} A promise that is resolved or rejected based on the
 *          result of the initialization process.
 */
Controller.prototype.init = function(configFilePath, requestId) {
    requestId = requestId || DEFAULT_REQUEST_ID;
    var request = new CncRequest({
        requestId: requestId,
        action: 'init()'
    }, this._logDataHandler.bind(this));

    this._shutdownFlag = false;
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
                this._initConnectorTypes(request);

                var promises = [];

                promises = promises.concat(this._initConnectorGroup(CLOUD_CONNECTOR_CATEGORY, request));
                promises = promises.concat(this._initConnectorGroup(DEVICE_CONNECTOR_CATEGORY, request));

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
 * @param {String} [requestId] An optional request id to use track the init
 *          action.
 */
Controller.prototype.stop = function(requestId) {
    requestId = requestId || DEFAULT_REQUEST_ID;
    var request = new CncRequest({
        requestId: requestId,
        action: 'stop()'
    }, this._logDataHandler.bind(this));
    var def = _q.defer();

    var promises = [];

    this._shutdownFlag = true;
    promises = promises.concat(this._stopConnectorGroup(CLOUD_CONNECTOR_CATEGORY, request));
    promises = promises.concat(this._stopConnectorGroup(DEVICE_CONNECTOR_CATEGORY, request));

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
