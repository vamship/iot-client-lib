/* jshint node:true, expr:true */
'use strict';

var _sinon = require('sinon');

var _rewire = require('rewire');
var _shortId = require('shortid');

var _fs = require('fs');
var _q = require('q');
var _path = require('path');
var _wfs = require('wysknd-test').fs;

var TEMP_DIR = './.tmp';
var _filesToCleanup = [];
var DEFAULT_CONFIG = {
    connectorTypes: { },
    cloudConnectors: { },
    deviceConnectors: { }
};
var CONFIG_FILE = _path.join(TEMP_DIR, 'controller.cfg');


var mod = {
    CONFIG_FILE: CONFIG_FILE,

    createMockFs: function() {
        var mockFs = {
            readFile: function() {},
            writeFile: function() {},
            _writeDefers: [],
            _completeDeferred: function(index, resolve) {
                if(index < mockFs._writeDefers.length) {
                    if(resolve) {
                        mockFs._writeDefers[index].resolve();
                    } else {
                        mockFs._writeDefers[index].reject();
                    }
                } else {
                    throw new Error('Invalid deferred index: ' + index);
                }
            }
        };

        _sinon.stub(mockFs, 'readFile', function(path, callback) {
            return _fs.readFile(path, callback);
        });

        _sinon.stub(mockFs, 'writeFile', function(path, data, callback){
            var def = _q.defer();
            mockFs._writeDefers.push(def);

            def.promise.then(callback, callback.bind(null, 'something went wrong'));
        });

        return mockFs;
    },

    createMockConnectorFactory: function() {
        return {
            init: _sinon.spy(),
            createConnector: _sinon.spy()
        };
    },

    createModule: function(name, initAction, stopAction) {
        var body = [
                     'var _sinon = require("sinon");',
                     'var _q = require("q");',
                     'var EventEmitter = require("events").EventEmitter;',
                     '',
                     'var con = {',
                     '    init: function() {},',
                     '    stop: function() {},',
                     '    addData: _sinon.spy(),',
                     '    addLogData: _sinon.spy(),',
                     '    isActive: function() { return con._state === "ACTIVE"; },',
                     '    _emitData: function(data) { this.emit("data", data); },',
                     '    _emitLog: function(data) { this.emit("log", data); },',
                     '    _completeDeferred: function(type, index, resolve) {',
                     '        var defArray = (type === "init")? con._initDefers: con._stopDefers;',
                     '        if(resolve) {',
                     '            defArray[index].resolve();',
                     '            if(type==="init") { con._state = "ACTIVE"; } else { con._state = "INACTIVE" };',
                     '        } else { ',
                     '            defArray[index].reject();',
                     '            if(type==="init") { con._state = "ACTIVE"; } else { con._state = "INACTIVE" };',
                     '        }',
                     '    },',
                     '    _type: "' + name + '",',
                     '    _initDefers: [],',
                     '    _stopDefers: [],',
                     '    _state: "INACTIVE"',
                     '};',
                     'con.__proto__ = new EventEmitter();',
                     '',
                     '_sinon.stub(con, "init", function(config) {',
                     '    var def = _q.defer();',
                     (initAction === 'resolve') ? '    def.resolve(); con._state="ACTIVE";':'',
                     (initAction === 'rejected') ? '   def.reject(); con._state="ACTIVE";':'',
                     '    con._initDefers.push(def);',
                     '    return def.promise;',
                     '});',
                     '_sinon.stub(con, "stop", function(config) {',
                     '    var def = _q.defer();',
                     (stopAction === 'resolve') ? '    def.resolve(); con._state="INACTIVE";':'',
                     (stopAction === 'rejected') ? '    def.reject(); con._state="INACTIVE";':'',
                     '    con._stopDefers.push(def);',
                     '    return def.promise;',
                     '});',
                     'var Connector = _sinon.stub().returns(con);',
                     'module.exports = Connector;',
                     ''
                    ].join('\r\n');
        name = name + '-' + _shortId.generate();
        var filePath = _path.join(TEMP_DIR, name + '.js');

        _wfs.createFiles({
            path: filePath,
            contents: body
        });
        _filesToCleanup.push(filePath);

        var ret = {
            path: '.' + TEMP_DIR + '/' + name,
        };
        ret.module = require('../' + ret.path);

        return ret;
    },

    initConfig: function(config) {
        if(!config) {
            config = JSON.stringify(DEFAULT_CONFIG);
        } else if (!(config instanceof Array) && typeof config === 'object') {
            config = JSON.stringify(config);
        }

        var configFilePath = CONFIG_FILE;

        _wfs.createFiles({
            path: configFilePath,
            contents: config
        });
        _filesToCleanup.push(configFilePath);

        return configFilePath;
    },

    createConfig: function(instanceCount, initAction, stopAction) {
        var connectors = {
            device_temp: mod.createModule('temp-connector', initAction, stopAction),
            device_humi: mod.createModule('humi-connector', initAction, stopAction),
            cloud_http: mod.createModule('http-connector', initAction, stopAction),
            cloud_mqtt: mod.createModule('mqtt-connector', initAction, stopAction)
        };
        var config = {
            connectorTypes: {},
            cloudConnectors: {},
            deviceConnectors: {}
        };
        var cloudConnectorIds = [];
        var deviceConnectorIds = [];

        for(var type in connectors) {
            config.connectorTypes[type] = connectors[type].path;
            for(var index=0; index<instanceCount; index++) {
                var id = type + '-instance-' + index;
                var group = null;
                var keys = null;
                if(type.indexOf('device_') === 0) {
                    group = config.deviceConnectors;
                    keys = deviceConnectorIds;
                } else {
                    group = config.cloudConnectors;
                    keys = cloudConnectorIds;
                }
                group[id] = { type: type, config: { id: id } };
                keys.push(id);
            }
        }

        return {
            connectors: connectors,
            config: config,
            cloudConnectorIds: cloudConnectorIds,
            deviceConnectorIds: deviceConnectorIds,
            getConnectorDefinition: function(key) {
                return connectors[key].module;
            },
            getConnectorByType: function(type) {
                return connectors[type].module();
            },
            getConnectorById: function(group, id) {
                group = (group === 'device')? config.deviceConnectors:
                                                config.cloudConnectors;
                return connectors[group[id].type].module();
            }
        };
    },

    setup: function() {
        _wfs.createFolders(TEMP_DIR);
    },

    teardown: function() {
        if(_filesToCleanup.length > 0) {
            _wfs.cleanupFiles(_filesToCleanup);
        }
        _wfs.cleanupFolders(TEMP_DIR);

        _filesToCleanup = [];
    }
};

module.exports = mod;
