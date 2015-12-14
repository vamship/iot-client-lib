/* jshint node:true, expr:true */
'use strict';

var _sinon = require('sinon');
var _chai = require('chai');
_chai.use(require('sinon-chai'));
_chai.use(require('chai-as-promised'));
var expect = _chai.expect;

var _rewire = require('rewire');
var _shortId = require('shortid');

var _fs = require('fs');
var _q = require('q');
var _util = require('util');
var _path = require('path');
var _wfs = require('wysknd-test').fs;
var _assertionHelper = require('wysknd-test').assertionHelper;
var _ctrlUtil = require('./controller-util');
var Controller = null;

describe('Controller (2)', function() {

    beforeEach(function() {
        Controller = _rewire('../../lib/controller');
        _ctrlUtil.setup();
    });

    afterEach(function() {
        _ctrlUtil.teardown();
    });

    describe('[events]', function() {
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

        var SHUTDOWN_ACTION = 'shutdown_program';
        var UPGRADE_ACTION = 'upgrade_program';

        var ADMIN_ACTION_EVENT = 'admin-action';

        function _unexpectedResolution(message) {
            message = 'A promise was resolved, when failure was expected. Additional Info: ' +
                        (message || 'n/a');
            return function(data) {
                throw new Error( message);
            };
        }

        function _initConnectorArray(mockConfig, emitterId) {
            var connectors = [ ];
            mockConfig.deviceConnectorIds.forEach(function(id) {
                if(id !== emitterId) {
                    connectors.push({
                        id: id,
                        category: 'device',
                        config: {
                            type: mockConfig.config.deviceConnectors[id].type,
                            config: {
                                id: id,
                                sampleFrequency: 20
                            }
                        },
                        data: {
                            value: '1234'
                        },
                        connector: mockConfig.getConnectorById('device', id)
                    });
                }
            });

            mockConfig.cloudConnectorIds.forEach(function(id) {
                if(id !== emitterId) {
                    connectors.push({
                        id: id,
                        category: 'cloud',
                        config: {
                            type: mockConfig.config.cloudConnectors[id].type,
                            config: {
                                id: id,
                                sampleFrequency: 20
                            }
                        },
                        data: {
                            value: '1234'
                        },
                        connector: mockConfig.getConnectorById('cloud', id)
                    });
                }
            });
            return connectors;
        }

        function _resetCallCount(methodName, connectors) {
            return function(data) {
                connectors.forEach(function(connectorInfo) {
                    connectorInfo.connector[methodName].reset();
                });
                return data;
            };
        }

        function _emitRawData(connector, payload) {
            return function(data) {
                connector._emitData(payload);
                return data;
            };
        }

        function _emitDataEvent(connector, action, connectors) {
            return function(data) {
                var payload = [];
                connectors.forEach(function(device) {
                    var deviceData = {
                        id: device.id,
                        category: device.category,
                        action: action
                    };
                    switch(action) {
                        case UPDATE_CONFIG_ACTION:
                            deviceData.config = device.config;
                            break;
                        case SEND_DATA_ACTION:
                            deviceData.data = device.data;
                            break;
                        default:
                            //Nothing to do here.
                            break;

                    }
                    payload.push(deviceData);
                });
                connector._emitData(payload);
                return data;
            };
        }

        function _checkCallCount(method, connectors, count) {
            return function(data) {
                connectors.forEach(function(connectorInfo) {
                    expect(connectorInfo.connector[method].callCount).to.equal(count);
                });
                return data;
            }
        }

        function _completeDeferred(connectors, method, index, resolve) {
            return function() {
                connectors.forEach(function(connectorInfo) {
                    connectorInfo.connector._completeDeferred(method, index, resolve)
                });
            };
        };

        function _checkNonExecution(connectors) {
            return function(data)  {
                // It is hard to check non execution of action. The current check just
                // makes sure that none of the know actions are executed. This code may
                // have to be updated if more actions are added.
                _checkCallCount('init', connectors, 0);
                _checkCallCount('stop', connectors, 0);
                _checkCallCount('addData', connectors, 0);
                return data;
            };
        }

        function _checkConfigFileWrite(mockFs, expectWrite) {
            return function(data) {
                if(!expectWrite) {
                    expect(mockFs.writeFile).to.not.have.been.called;
                } else {
                    expect(mockFs.writeFile).to.have.been.calledOnce;
                    var args = mockFs.writeFile.args[0];
                    expect(args[0]).to.equal(_ctrlUtil.CONFIG_FILE);
                    expect(args[1]).to.be.a('string');

                    // This will throw an error if the file content is not a
                    // valid JSON
                    var config = JSON.parse(args[1]);
                }
                return data;
            };
        }

        function _getConnectorFilter(category, excludeId) {
            return function(connector) {
                return connector.category === category && connector.id !== excludeId;
            };
        }

        function _verifyConnectorConfig(ctrl, expectedConnectors) {
            return function(data) {
                expectedConnectors.forEach(function(expConnector) {
                    var configSection = (expConnector.category === 'cloud')?
                                                ctrl._config.cloudConnectors:
                                                ctrl._config.deviceConnectors;
                    var connectorConfig = configSection[expConnector.id];
                    expect(connectorConfig).to.deep.equal(expConnector.config);
                });
                return data;
            };
        }

        function _captureCurrentConfig(ctrl, connectors){
            return function(data) {
                var connectorConfig = null;
                var id = null;
                connectors.splice(0);
                for(id in ctrl._config.deviceConnectors) {
                    connectorConfig = ctrl._config.deviceConnectors[id];
                    connectors.push({
                        id: id,
                        category: 'device',
                        config: connectorConfig
                    });
                }

                for(id in ctrl._config.cloudConnectors) {
                    connectorConfig = ctrl._config.cloudConnectors[id];
                    connectors.push({
                        id: id,
                        category: 'cloud',
                        config: connectorConfig
                    });
                }

                return data;
            };
        }

        describe('[log data]', function() {
            function _emitLogData(connectors, eventData) {
                return function(data) {
                    connectors.forEach(function(connectorInfo) {
                        connectorInfo.connector._emitLog(eventData);
                    });
                    return data;
                };
            }

            it('should add data to all cloud connector log buffers when a device connector emits a log event', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();
                var connectors = _initConnectorArray(mockConfig);
                var deviceConnectors = connectors.filter(_getConnectorFilter('device', null));
                var cloudConnectors = connectors.filter(_getConnectorFilter('cloud', null));

                var eventData = [ 'test log message' ];

                var doTests = function() {
                    cloudConnectors.forEach(function(connectorInfo) {
                        var connector = connectorInfo.connector;
                        connector.addData.args.forEach(function(arg) {
                            expect(arg[0].data).to.deep.equal(eventData);
                        });
                    });
                };

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('addLogData', connectors))
                    .then(_emitLogData(connectors, eventData))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('addLogData', deviceConnectors, 0))
                    .then(_checkCallCount('addLogData', cloudConnectors, connectors.length))
                    .then(doTests)
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not add log data to cloud connectors that are are not active', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var cloud1Id = mockConfig.cloudConnectorIds[0];
                var cloud1Connector = mockConfig.getConnectorById('cloud', cloud1Id);
                var connectors = _initConnectorArray(mockConfig);
                var deviceConnectors = connectors.filter(_getConnectorFilter('device', null));
                var cloudConnectors = connectors.filter(_getConnectorFilter('cloud', cloud1Id));

                var eventData = [ 'test log message' ];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(function() { ctrl._stopConnector('cloud', cloud1Id); })
                    .then(_assertionHelper.wait(10))
                    .then(_resetCallCount('addLogData', connectors))
                    .then(_emitLogData(connectors, eventData))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('addLogData', deviceConnectors, 0))
                    .then(_checkCallCount('addLogData', cloudConnectors, connectors.length))
                    .then(_checkCallCount('addLogData', [{ connector: cloud1Connector} ], 0))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[device -> cloud (data)]', function() {
            function _emitDeviceData(connectors, eventData) {
                return function(data) {
                    connectors.forEach(function(connectorInfo) {
                        connectorInfo.connector._emitData({
                            id: connectorInfo.id,
                            data: eventData
                        });
                    });
                    return data;
                };
            }
            it('should add data to all cloud connector buffers when a device connector emits a data event', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();
                var connectors = _initConnectorArray(mockConfig);
                var deviceConnectors = connectors.filter(_getConnectorFilter('device', null));
                var cloudConnectors = connectors.filter(_getConnectorFilter('cloud', null));

                var eventData = {
                    timestamp: Date.now(),
                    value: Math.random() * 10
                };

                var doTests = function() {
                    cloudConnectors.forEach(function(connectorInfo) {
                        var connector = connectorInfo.connector;
                        connector.addData.args.forEach(function(arg) {
                            expect(mockConfig.deviceConnectorIds).to.include(arg[0].id);
                            expect(arg[0].data).to.deep.equal(eventData);
                        });
                    });
                };

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_emitDeviceData(deviceConnectors, eventData))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('addData', deviceConnectors, 0))
                    .then(_checkCallCount('addData', cloudConnectors, deviceConnectors.length))
                    .then(doTests)
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not add data to cloud connectors that are are not active', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var cloud1Id = mockConfig.cloudConnectorIds[0];
                var cloud1Connector = mockConfig.getConnectorById('cloud', cloud1Id);
                var connectors = _initConnectorArray(mockConfig);
                var deviceConnectors = connectors.filter(_getConnectorFilter('device', null));
                var cloudConnectors = connectors.filter(_getConnectorFilter('cloud', cloud1Id));

                var eventData = {
                    timestamp: Date.now(),
                    value: Math.random() * 10
                };

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(function() { ctrl._stopConnector('cloud', cloud1Id); })
                    .then(_assertionHelper.wait(10))
                    .then(_emitDeviceData(deviceConnectors, eventData))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('addData', deviceConnectors, 0))
                    .then(_checkCallCount('addData', cloudConnectors, deviceConnectors.length))
                    .then(_checkCallCount('addData', [{ connector: cloud1Connector} ], 0))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[cloud -> device (validation)]', function() {
            it('should ignore the device commands if it is not a non emtpy array', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_emitRawData(emitterConnector, undefined))
                    .then(_assertionHelper.wait(10))
                    .then(_checkNonExecution(connectors))

                    .then(_emitRawData(emitterConnector, null))
                    .then(_assertionHelper.wait(10))
                    .then(_checkNonExecution(connectors))

                    .then(_emitRawData(emitterConnector, 123))
                    .then(_assertionHelper.wait(10))
                    .then(_checkNonExecution(connectors))

                    .then(_emitRawData(emitterConnector, 'foo'))
                    .then(_assertionHelper.wait(10))
                    .then(_checkNonExecution(connectors))

                    .then(_emitRawData(emitterConnector, true))
                    .then(_assertionHelper.wait(10))
                    .then(_checkNonExecution(connectors))

                    .then(_emitRawData(emitterConnector, function() {}))
                    .then(_assertionHelper.wait(10))
                    .then(_checkNonExecution(connectors))

                    .then(_emitRawData(emitterConnector, {}))
                    .then(_assertionHelper.wait(10))
                    .then(_checkNonExecution(connectors))

                    // Even though the payload is an array, it is empty.
                    .then(_emitRawData(emitterConnector, []))
                    .then(_assertionHelper.wait(10))
                    .then(_checkNonExecution(connectors))

                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should ignore device commands if the payload to the sensor is not a valid object', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                var payload = [];
                payload.push(null);
                payload.push(undefined);
                payload.push(123);
                payload.push('abc');
                payload.push(true);
                payload.push(function() {});

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkNonExecution(connectors))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should ignore commands to specific sensors if the payload to the sensor does not define a valid action', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                var payload = [];

                connectors.forEach(function(device) {
                    payload.push({
                        action: null
                    });
                });

                payload.push({ action: 'bad-action' });

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkNonExecution(connectors))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[cloud -> device (stop connector)]', function() {
            it('should ignore stop connector requests if the command has an invalid connector category', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var badConnectors = [
                    { category: 'bad1' },
                    { category: null },
                    { category: 123 },
                    { category: true },
                    { category: function() {} },
                    { category: {} },
                    { category: [] },
                ];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, badConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should ignore stop connector requests if the command has an invalid connector id', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var badConnectors = [];
                var index = 0;
                connectors.forEach(function(connector) {
                    index++;
                    badConnectors.push({
                        category: connector.category,
                        id: 'bad' + index
                    });
                });

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, badConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should stop a specific connector when the cloud connector reports a stop action', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should ignore subsequent stop actions once the connector has been stopped', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 1))
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not write the configuration to the file system after command execution', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[cloud -> device (start connector)]', function() {
            it('should ignore start connector requests if the command has an invalid connector category', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                var badConnectors = [
                    { category: 'bad1' },
                    { category: null },
                    { category: 123 },
                    { category: true },
                    { category: function() {} },
                    { category: {} },
                    { category: [] },
                ];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, START_CONNECTOR_ACTION, badConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should ignore start connector requests if the command has an invalid connector id', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                var badConnectors = [];
                var index = 0;
                connectors.forEach(function(connector) {
                    index++;
                    badConnectors.push({
                        category: connector.category,
                        id: 'bad' + index
                    });
                });

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, START_CONNECTOR_ACTION, badConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should start a specific connector when the cloud connector reports a start action', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_emitDataEvent(emitterConnector, START_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should ignore subsequent start actions once the connector has been started', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_emitDataEvent(emitterConnector, START_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 1))
                    .then(_emitDataEvent(emitterConnector, START_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should start the connector if the connector has been stopped after failed consecutive starts', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                ctrl.__debug = true;

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_emitDataEvent(emitterConnector, START_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 1))
                    .then(_emitDataEvent(emitterConnector, START_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 1))
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_emitDataEvent(emitterConnector, START_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 2))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not write the configuration to the file system after command execution', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_emitDataEvent(emitterConnector, START_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[cloud -> device (restart connector)]', function() {
            it('should ignore restart connector requests if the command has an invalid connector category', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var badConnectors = [
                    { category: 'bad1' },
                    { category: null },
                    { category: 123 },
                    { category: true },
                    { category: function() {} },
                    { category: {} },
                    { category: [] },
                ];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, RESTART_CONNECTOR_ACTION, badConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should ignore restart connector requests if the command has an invalid connector id', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var badConnectors = [];
                var index = 0;
                connectors.forEach(function(connector) {
                    index++;
                    badConnectors.push({
                        category: connector.category,
                        id: 'bad' + index
                    });
                });

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, RESTART_CONNECTOR_ACTION, badConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should restart a specific connector when the cloud connector reports a restart action', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, RESTART_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 1))
                    .then(_checkCallCount('init', connectors, 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not write the configuration to the file system after command execution', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_emitDataEvent(emitterConnector, RESTART_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[chaining behavior: start]', function() {
            it('should chain init calls on connectors if a previous stop is in progress', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1);
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);


                var ret = ctrl.init(configFilePath);
                setTimeout(function() {
                    emitterConnector._completeDeferred('init', 0, true);
                    _completeDeferred(connectors, 'init', 0, true)();
                }, 10);

                expect(ret).to.be.fulfilled
                    .then(_checkCallCount('init', connectors, 1))
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, connectors))
                    .then(_emitDataEvent(emitterConnector, START_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 1))

                    .then(_completeDeferred(connectors, 'stop', 0, true))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 2))

                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[chaining behavior: stop]', function() {
            it('should chain stop calls on connectors if a previous start is in progress', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1);
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);


                var ret = ctrl.init(configFilePath);
                setTimeout(function() {
                    emitterConnector._completeDeferred('init', 0, true);
                    _completeDeferred(connectors, 'init', 0, true)();
                }, 10);

                expect(ret).to.be.fulfilled
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_completeDeferred(connectors, 'stop', 0, true))
                    .then(_checkCallCount('stop', connectors, 1))

                    .then(_emitDataEvent(emitterConnector, START_CONNECTOR_ACTION, connectors))
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 1))

                    .then(_completeDeferred(connectors, 'init', 1, true))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 2))


                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[cloud -> device (list connectors)]', function() {
            function _checkListConnectorsResponse(cloudConnectors, requestId, expectedConnectors) {
                return function(data) {
                    var listResponseStart = '[info] [' + requestId + '] Listing connectors ';
                    cloudConnectors.forEach(function(connectorInfo) {
                        var spy = connectorInfo.connector.addLogData;
                        var connectorCount = 0;
                        spy.args.forEach(function(arg) {
                            var message = arg[0].message;
                            if(message.indexOf(listResponseStart) === 0) {
                                var lines = message.split('\n');
                                // One line for each connector minus the line for the heading
                                connectorCount = lines.length - 1; 
                                expectedConnectors.forEach(function(connector) {
                                    var conString = _util.format('[%s::%s]', connector.category, connector.id);
                                    var hasConnector = false;
                                    lines.forEach(function(line) {
                                        if(line.indexOf(conString) >= 0) {
                                            hasConnector = true;
                                        }
                                    });
                                    expect(hasConnector).to.be.true;
                                });
                            }
                        });
                        expect(connectorCount).to.equal(expectedConnectors.length);
                    });
                    return data;
                };
            }

            it('should ignore list connector requests if the command has an invalid connector category', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var requestId = 'req_1';
                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var cloudConnectors = connectors.filter(_getConnectorFilter('cloud', emitterId));

                var payload = [{
                    action: LIST_CONNECTORS_ACTION,
                    category: 'bad-category',
                    requestId: requestId
                }];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('addLogData', connectors))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkListConnectorsResponse(cloudConnectors, requestId, []))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should list all connectors when no category is specified', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var requestId = 'req_1';
                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig);
                var cloudConnectors = connectors.filter(_getConnectorFilter('cloud', emitterId));
                var payload = [{
                    action: LIST_CONNECTORS_ACTION,
                    requestId: requestId
                }];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('addLogData', connectors))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkListConnectorsResponse(cloudConnectors, requestId, connectors))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should start only the specified category of connectors when a valid category is specified', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var requestId = 'req_1';
                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig);

                var devicePayload = [{
                    action: LIST_CONNECTORS_ACTION,
                    category: 'device',
                    requestId: requestId
                }];
                var cloudPayload = [{
                    action: LIST_CONNECTORS_ACTION,
                    category: 'cloud',
                    requestId: requestId
                }];

                var deviceConnectors = connectors.filter(_getConnectorFilter('device'));
                var cloudConnectors = connectors.filter(_getConnectorFilter('cloud'));

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('addLogData', connectors))
                    .then(_emitRawData(emitterConnector, devicePayload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkListConnectorsResponse(cloudConnectors, requestId, deviceConnectors))

                    .then(_resetCallCount('addLogData', connectors))
                    .then(_emitRawData(emitterConnector, cloudPayload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkListConnectorsResponse(cloudConnectors, requestId, cloudConnectors))

                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not write the configuration to the file system after command execution', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var requestId = 'req_1';
                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig);
                var cloudConnectors = connectors.filter(_getConnectorFilter('cloud', emitterId));
                var payload = [{
                    action: LIST_CONNECTORS_ACTION,
                    requestId: requestId
                }];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('addLogData', connectors))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });


        describe('[cloud -> device (start all connectors)]', function() {
            it('should ignore start all connector requests if the command has an invalid connector category', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var payload = [{
                    action: START_ALL_CONNECTORS_ACTION,
                    category: 'bad-category'
                }];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should start all connectors when no category is specified', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var payload = [{
                    action: START_ALL_CONNECTORS_ACTION
                }];


                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should start only the specified category of connectors when a valid category is specified', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var devicePayload = [{
                    action: START_ALL_CONNECTORS_ACTION,
                    category: 'device'
                }];
                var cloudPayload = [{
                    action: START_ALL_CONNECTORS_ACTION,
                    category: 'cloud'
                }];

                var deviceConnectors = connectors.filter(_getConnectorFilter('device', emitterId));
                var cloudConnectors = connectors.filter(_getConnectorFilter('cloud', emitterId));

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('init', deviceConnectors, 0))
                    .then(_checkCallCount('init', cloudConnectors, 0))

                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, deviceConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_emitRawData(emitterConnector, devicePayload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', deviceConnectors, 1))
                    .then(_checkCallCount('init', cloudConnectors, 0))

                    .then(_emitDataEvent(emitterConnector, STOP_CONNECTOR_ACTION, cloudConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_emitRawData(emitterConnector, cloudPayload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', deviceConnectors, 1))
                    .then(_checkCallCount('init', cloudConnectors, 1))

                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not write the configuration to the file system after command execution', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_emitDataEvent(emitterConnector, START_ALL_CONNECTORS_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[cloud -> device (stop all connectors)]', function() {
            it('should ignore stop all connector requests if the command has an invalid connector category', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var payload = [{
                    action: STOP_ALL_CONNECTORS_ACTION,
                    category: 'bad-category'
                }];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should stop all connectors when no category is specified', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var payload = [{
                    action: STOP_ALL_CONNECTORS_ACTION
                }];


                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should stop only the specified category of connectors when a valid category is specified', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var devicePayload = [{
                    action: STOP_ALL_CONNECTORS_ACTION,
                    category: 'device'
                }];
                var cloudPayload = [{
                    action: STOP_ALL_CONNECTORS_ACTION,
                    category: 'cloud'
                }];

                var deviceConnectors = connectors.filter(_getConnectorFilter('device'));
                var cloudConnectors = connectors.filter(_getConnectorFilter('cloud'));

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('stop', deviceConnectors, 0))
                    .then(_checkCallCount('stop', cloudConnectors, 0))
                    .then(_emitRawData(emitterConnector, devicePayload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', deviceConnectors, 1))
                    .then(_checkCallCount('stop', cloudConnectors, 0))
                    .then(_emitRawData(emitterConnector, cloudPayload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', deviceConnectors, 1))
                    .then(_checkCallCount('stop', cloudConnectors, 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not write the configuration to the file system after command execution', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_emitDataEvent(emitterConnector, STOP_ALL_CONNECTORS_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[cloud -> device (restart all connectors)]', function() {
            it('should ignore restart all connector requests if the command has an invalid connector category', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var payload = [{
                    action: RESTART_ALL_CONNECTORS_ACTION,
                    category: 'bad-category'
                }];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should restart all connectors when no category is specified', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var payload = [{
                    action: RESTART_ALL_CONNECTORS_ACTION
                }];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('init', connectors, 0))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 1))
                    .then(_checkCallCount('stop', connectors, 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should restart only the specified category of connectors when a valid category is specified', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var devicePayload = [{
                    action: RESTART_ALL_CONNECTORS_ACTION,
                    category: 'device'
                }];
                var cloudPayload = [{
                    action: RESTART_ALL_CONNECTORS_ACTION,
                    category: 'cloud'
                }];

                var deviceConnectors = connectors.filter(_getConnectorFilter('device'));
                var cloudConnectors = connectors.filter(_getConnectorFilter('cloud'));

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('stop', deviceConnectors, 0))
                    .then(_checkCallCount('init', deviceConnectors, 0))
                    .then(_checkCallCount('stop', cloudConnectors, 0))
                    .then(_checkCallCount('init', cloudConnectors, 0))
                    .then(_emitRawData(emitterConnector, devicePayload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', deviceConnectors, 1))
                    .then(_checkCallCount('init', deviceConnectors, 1))
                    .then(_checkCallCount('stop', cloudConnectors, 0))
                    .then(_checkCallCount('init', cloudConnectors, 0))
                    .then(_emitRawData(emitterConnector, cloudPayload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', deviceConnectors, 1))
                    .then(_checkCallCount('init', deviceConnectors, 1))
                    .then(_checkCallCount('stop', cloudConnectors, 1))
                    .then(_checkCallCount('init', cloudConnectors, 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not write the configuration to the file system after command execution', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_emitDataEvent(emitterConnector, RESTART_ALL_CONNECTORS_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[cloud -> device (send data)]', function() {
            it('should ignore send data requests if the command has an invalid connector category', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var badConnectors = [
                    { category: 'bad1' },
                    { category: null },
                    { category: 123 },
                    { category: true },
                    { category: function() {} },
                    { category: {} },
                    { category: [] },
                ];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('addData', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, SEND_DATA_ACTION, badConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('addData', connectors, 0))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should ignore send data requests if the command has an invalid connector id', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var badConnectors = [];
                var index = 0;
                connectors.forEach(function(connector) {
                    index++;
                    badConnectors.push({
                        category: connector.category,
                        id: 'bad' + index
                    });
                });

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('addData', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, SEND_DATA_ACTION, badConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('addData', connectors, 0))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should send data to a specific connector when the cloud connector reports a send data action', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('addData', connectors, 0))
                    .then(_emitDataEvent(emitterConnector, SEND_DATA_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('addData', connectors, 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not write the configuration to the file system after command execution', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_emitDataEvent(emitterConnector, SEND_DATA_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[cloud -> device (update config)]', function() {
            it('should ignore update config requests if the command has an invalid connector category', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var originalConnectors = [];
                var badConnectors = [
                    { category: 'bad1' },
                    { category: null },
                    { category: 123 },
                    { category: true },
                    { category: function() {} },
                    { category: {} },
                    { category: [] },
                ];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_captureCurrentConfig(ctrl, originalConnectors))
                    .then(_emitDataEvent(emitterConnector, UPDATE_CONFIG_ACTION, badConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_verifyConnectorConfig(ctrl, originalConnectors))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should ignore update config requests if the command has an invalid config property', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var originalConnectors = [];
                var badConnectors = [];
                connectors.forEach(function(connector) {
                    badConnectors.push({
                        id: connector.id,
                        category: connector.category,
                        config: null
                    });
                });

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_captureCurrentConfig(ctrl, originalConnectors))
                    .then(_emitDataEvent(emitterConnector, UPDATE_CONFIG_ACTION, badConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_verifyConnectorConfig(ctrl, originalConnectors))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should update configuration for specific device connectors when config update command is issued', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_emitDataEvent(emitterConnector, UPDATE_CONFIG_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_verifyConnectorConfig(ctrl, connectors))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should write the configuration to the file system after command execution', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_emitDataEvent(emitterConnector, UPDATE_CONFIG_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkConfigFileWrite(mockFs, true))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[cloud -> device (delete config)]', function() {
            it('should ignore delete config requests if the command has an invalid connector category', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var originalConnectors = [];
                var badConnectors = [
                    { category: 'bad1' },
                    { category: null },
                    { category: 123 },
                    { category: true },
                    { category: function() {} },
                    { category: {} },
                    { category: [] },
                ];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_captureCurrentConfig(ctrl, originalConnectors))
                    .then(_emitDataEvent(emitterConnector, DELETE_CONFIG_ACTION, badConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_verifyConnectorConfig(ctrl, originalConnectors))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should ignore delete config requests if the command has an invalid id property', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);
                var originalConnectors = [];
                var badConnectors = [];
                var index = 0;
                connectors.forEach(function(connector) {
                    index++;
                    badConnectors.push({
                        id: 'bad-connector-' + index,
                        category: connector.category
                    });
                });

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_captureCurrentConfig(ctrl, originalConnectors))
                    .then(_emitDataEvent(emitterConnector, DELETE_CONFIG_ACTION, badConnectors))
                    .then(_assertionHelper.wait(10))
                    .then(_verifyConnectorConfig(ctrl, originalConnectors))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should delete configuration for specific device connectors when config delete command is issued', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                var doTests = function() {
                    connectors.forEach(function(connector) {
                        var configSection = (connector.category === 'cloud')?
                                                    ctrl._config.cloudConnectors:
                                                    ctrl._config.deviceConnectors;
                        expect(configSection[connector.id]).to.be.undefined;
                    });
                };

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_emitDataEvent(emitterConnector, DELETE_CONFIG_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(doTests)
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should write the configuration to the file system after command execution', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_emitDataEvent(emitterConnector, DELETE_CONFIG_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkConfigFileWrite(mockFs, true))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[cloud -> device (update connector type)]', function() {
            function _captureCurrentTypes(ctrl, typeConfig) {
                return function(data) {
                    var keys = Object.keys(typeConfig);
                    keys.forEach(function(key) {
                        delete typeConfig[key];
                    });

                    for(var key in ctrl._config.connectorTypes) {
                        typeConfig[key] = ctrl._config.connectorTypes[key];
                    }
                    return data;
                };
            }

            function _verifyTypeConfig(ctrl, expectedTypes) {
                return function(data) {
                    expect(ctrl._config.connectorTypes).to.deep.equal(expectedTypes);
                    return data;
                };
            }

            it('should ignore update connector type requests if the command has an invalid key', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);

                var originalTypes = {};
                var payload = [ {
                    action: UPDATE_CONNECTOR_TYPE_ACTION
                } ];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_captureCurrentTypes(ctrl, originalTypes))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_verifyTypeConfig(ctrl, originalTypes))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should ignore update connector type requests if an invalid connector type is specified', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);

                var originalTypes = {};
                var payload = [ {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: null
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: undefined
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: 1
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: ''
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: true
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: []
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: {}
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: function() {}
                }];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_captureCurrentTypes(ctrl, originalTypes))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_verifyTypeConfig(ctrl, originalTypes))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should ignore update connector type requests if an invalid module path is specified', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);

                var originalTypes = {};
                var payload = [ {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: 'Type1',
                    modulePath: null
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: 'Type2',
                    modulePath: undefined
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: 'Type3',
                    modulePath: 1
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: 'Type3',
                    modulePath: ''
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: 'Type4',
                    modulePath: true
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: 'Type5',
                    modulePath: []
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: 'Type5',
                    modulePath: {}
                }, {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: 'Type6',
                    modulePath: function() {}
                }];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_captureCurrentTypes(ctrl, originalTypes))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_verifyTypeConfig(ctrl, originalTypes))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should update the connector types config with the specified value when a valid name and module path are specified', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);

                var originalTypes = {};
                var newConnector = _ctrlUtil.createModule('new-connector', 'resolve', 'resolve');
                var connectorTypes = Object.keys(mockConfig.connectors);
                var payload = [ {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: 'NewConnector',
                    modulePath: newConnector.path
                }];

                connectorTypes.forEach(function(type) {
                    payload.push({
                        action: UPDATE_CONNECTOR_TYPE_ACTION,
                        type: type,
                        modulePath: newConnector.path
                    });
                });

                var updateTypes = function(data) {
                    originalTypes.NewConnector = newConnector.path;
                    connectorTypes.forEach(function(type) {
                        originalTypes[type] = newConnector.path;
                    });
                    return data;
                };

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_captureCurrentTypes(ctrl, originalTypes))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(updateTypes)
                    .then(_verifyTypeConfig(ctrl, originalTypes))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should use new connector type definitions for newly started connectors', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);

                var originalTypes = {};
                var newConnector = _ctrlUtil.createModule('new-connector', 'resolve', 'resolve');
                var connectorTypes = Object.keys(mockConfig.connectors);
                var payload = [ {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: 'NewConnector',
                    modulePath: newConnector.path
                }];

                connectorTypes.forEach(function(type) {
                    payload.push({
                        action: UPDATE_CONNECTOR_TYPE_ACTION,
                        type: type,
                        modulePath: newConnector.path
                    });
                });

                var checkCallCount = function(count) {
                    return function(data) {
                        var module = newConnector.module();
                        expect(module.init.callCount).to.equal(count);
                    };
                };
                var initNewConnectorPayload = [ {
                    id: 'new-connector-instance-1',
                    category: 'cloud',
                    action: UPDATE_CONFIG_ACTION,
                    config: {
                        type: 'NewConnector',
                        config: { foo: 'bar' }
                    }
                } ];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(checkCallCount(0))
                    .then(_emitRawData(emitterConnector, initNewConnectorPayload))
                    .then(_assertionHelper.wait(10))
                    .then(_emitRawData(emitterConnector, [{ action: RESTART_ALL_CONNECTORS_ACTION }]))
                    .then(_assertionHelper.wait(10))
                    // All of the existing connectors, plus an additional connector
                    .then(checkCallCount(connectorTypes.length + 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should write the configuration to the file system after command execution', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);

                var originalTypes = {};
                var newConnector = _ctrlUtil.createModule('new-connector', 'resolve', 'resolve');
                var connectorTypes = Object.keys(mockConfig.connectors);
                var payload = [ {
                    action: UPDATE_CONNECTOR_TYPE_ACTION,
                    type: 'NewConnector',
                    modulePath: newConnector.path
                }];

                connectorTypes.forEach(function(type) {
                    payload.push({
                        action: UPDATE_CONNECTOR_TYPE_ACTION,
                        type: type,
                        modulePath: newConnector.path
                    });
                });

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkConfigFileWrite(mockFs, true))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[write config updates]', function() {
            it('should write updated configuration to the file system when a configuration update is received', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(mockFs.writeFile).to.not.have.been.called;

                var doTests = function() {
                    expect(mockFs.writeFile).to.have.been.calledOnce;
                    var args = mockFs.writeFile.args[0];
                    expect(args[0]).to.equal(_ctrlUtil.CONFIG_FILE);
                    expect(args[1]).to.be.a('string');

                    var config = JSON.parse(args[1]);
                };

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_emitDataEvent(emitterConnector, UPDATE_CONFIG_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(doTests)
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should subsequent file writes if a file write is currently in progress', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                var checkCallCount = function(callCount) {
                    return function() {
                        expect(mockFs.writeFile.callCount).to.equal(callCount);
                    };
                };

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_emitDataEvent(emitterConnector, UPDATE_CONFIG_ACTION, connectors))
                    .then(_emitDataEvent(emitterConnector, UPDATE_CONFIG_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(checkCallCount(1))
                    .then(mockFs._completeDeferred.bind(mockFs, 0, true))
                    .then(_assertionHelper.wait(500))
                    .then(checkCallCount(2))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should attempt a subsequent file write even if the previous write fails', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                var checkCallCount = function(callCount) {
                    return function() {
                        expect(mockFs.writeFile.callCount).to.equal(callCount);
                    };
                };

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_emitDataEvent(emitterConnector, UPDATE_CONFIG_ACTION, connectors))
                    .then(_emitDataEvent(emitterConnector, UPDATE_CONFIG_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(checkCallCount(1))
                    .then(mockFs._completeDeferred.bind(mockFs, 0, false))
                    .then(_assertionHelper.wait(500))
                    .then(checkCallCount(2))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[cloud -> device (shutdown program)]', function() {

            it('should stop all connectors when the shutdown command is received', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, null);
                var payload = [ {
                    action: SHUTDOWN_ACTION
                } ];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not allow the initialization of connectors while a shutdown is in progress', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1);
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, null);
                var shutdownPayload = [ {
                    action: SHUTDOWN_ACTION
                } ];
                var startAllPayload = [ {
                    action: START_ALL_CONNECTORS_ACTION
                } ];

                var ret = ctrl.init(configFilePath);
                setTimeout(function() {
                    _completeDeferred(connectors, 'init', 0, true)();
                }, 10);

                expect(ret).to.be.fulfilled
                    .then(_emitRawData(emitterConnector, shutdownPayload))
                    .then(_emitRawData(emitterConnector, startAllPayload))
                    .then(_assertionHelper.wait(10))

                    .then(_completeDeferred(connectors, 'stop', 0, true))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 1))

                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should emit an "admin-action" event indicating the shutdown when a shutdown command is received', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, null);
                var payload = [ {
                    action: SHUTDOWN_ACTION
                } ];

                var handlerSpy = _sinon.spy();
                ctrl.on(ADMIN_ACTION_EVENT, handlerSpy);

                var doTests = function(data) {
                    expect(handlerSpy).to.have.been.calledOnce;
                    var arg = handlerSpy.args[0][0];
                    expect(arg).to.be.an('object');
                    expect(arg.action).to.equal(SHUTDOWN_ACTION);
                    return data;
                }

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(doTests)
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not write the configuration to the file system after command execution', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_emitDataEvent(emitterConnector, SHUTDOWN_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

        describe('[cloud -> device (upgrade program)]', function() {

            it('should stop all connectors when the upgrade command is received', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, null);
                var payload = [ {
                    action: UPGRADE_ACTION
                } ];

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkCallCount('stop', connectors, 0))
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('stop', connectors, 1))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not allow the initialization of connectors while a upgrade is in progress', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1);
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, null);
                var upgradePayload = [ {
                    action: UPGRADE_ACTION
                } ];
                var startAllPayload = [ {
                    action: START_ALL_CONNECTORS_ACTION
                } ];

                var ret = ctrl.init(configFilePath);
                setTimeout(function() {
                    _completeDeferred(connectors, 'init', 0, true)();
                }, 10);

                expect(ret).to.be.fulfilled
                    .then(_emitRawData(emitterConnector, upgradePayload))
                    .then(_emitRawData(emitterConnector, startAllPayload))
                    .then(_assertionHelper.wait(10))

                    .then(_completeDeferred(connectors, 'stop', 0, true))
                    .then(_assertionHelper.wait(10))
                    .then(_checkCallCount('init', connectors, 1))

                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should emit an "admin-action" event indicating the upgrade when a upgrade command is received', function(done) {
                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, null);
                var payload = [ {
                    action: UPGRADE_ACTION
                } ];

                var handlerSpy = _sinon.spy();
                ctrl.on(ADMIN_ACTION_EVENT, handlerSpy);

                var doTests = function(data) {
                    expect(handlerSpy).to.have.been.calledOnce;
                    var arg = handlerSpy.args[0][0];
                    expect(arg).to.be.an('object');
                    expect(arg.action).to.equal(UPGRADE_ACTION);
                    return data;
                }

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_emitRawData(emitterConnector, payload))
                    .then(_assertionHelper.wait(10))
                    .then(doTests)
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });

            it('should not write the configuration to the file system after command execution', function(done) {
                var mockFs = _ctrlUtil.createMockFs();
                Controller.__set__('_fs', mockFs);

                var mockConfig = _ctrlUtil.createConfig(1, 'resolve', 'resolve');
                var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
                var ctrl = new Controller();

                var emitterId = mockConfig.cloudConnectorIds[0];
                var emitterConnector = mockConfig.getConnectorById('cloud', emitterId);
                var connectors = _initConnectorArray(mockConfig, emitterId);

                expect(ctrl.init(configFilePath)).to.be.fulfilled
                    .then(_resetCallCount('init', connectors))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_emitDataEvent(emitterConnector, UPGRADE_ACTION, connectors))
                    .then(_assertionHelper.wait(10))
                    .then(_checkConfigFileWrite(mockFs, false))
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
            });
        });

    });
});
