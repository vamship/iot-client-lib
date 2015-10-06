/* jshint node:true, expr:true */
'use strict';

var _sinon = require('sinon');
var _chai = require('chai');
_chai.use(require('sinon-chai'));
_chai.use(require('chai-as-promised'));
var expect = _chai.expect;

var _rewire = require('rewire');
var _shortId = require('shortid');
var _clone = require('clone');

var _fs = require('fs');
var _q = require('q');
var _util = require('util');
var _path = require('path');
var _wfs = require('wysknd-test').fs;
var _assertionHelper = require('wysknd-test').assertionHelper;
var Controller = null;

describe('Controller', function() {
    var TEMP_DIR = './tmp';
    var CONFIG_FILE = _path.join(TEMP_DIR, 'controller.cfg');
    var DEFAULT_CONFIG = {
        connectorTypes: { },
        cloudConnectors: { },
        deviceConnectors: { }
    };

    var _filesToCleanup = [];

    function _createMockFs() {
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
    }

    function _createMockConnectorFactory() {
        return {
            init: _sinon.spy(),
            createConnector: _sinon.spy()
        };
    }

    function _createModule(name, initAction, stopAction) {
        var body = [
                     'var _sinon = require("sinon");',
                     'var _q = require("q");',
                     'var EventEmitter = require("events").EventEmitter;',
                     '',
                     'var con = {',
                     '    init: function() {},',
                     '    stop: function() {},',
                     '    addData: _sinon.spy(),',
                     '    _emitData: function(data) { this.emit("data", data); },',
                     '    _completeDeferred: function(type, index, resolve) {',
                     '        var defArray = (type === "init")? con._initDefers: con._stopDefers;',
                     '        if(resolve) {',
                     '            defArray[index].resolve();',
                     '        } else { ',
                     '            defArray[index].reject();',
                     '        }',
                     '    },',
                     '    _initDefers: [],',
                     '    _stopDefers: []',
                     '};',
                     'con.__proto__ = new EventEmitter();',
                     '',
                     '_sinon.stub(con, "init", function(config) {',
                     '    var def = _q.defer();',
                     (initAction === 'resolve') ? '    def.resolve();':'',
                     (initAction === 'rejected') ? '   def.reject();':'',
                     '    con._initDefers.push(def);',
                     '    return def.promise;',
                     '});',
                     '_sinon.stub(con, "stop", function(config) {',
                     '    var def = _q.defer();',
                     (stopAction === 'resolve') ? '    def.resolve();':'',
                     (stopAction === 'rejected') ? '    def.reject();':'',
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
    }

    function _initConfig(config) {
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
    }

    function _createConfig(instanceCount, initAction, stopAction) {
        var connectors = {
            device_temp: _createModule('temp-connector', initAction, stopAction),
            device_humi: _createModule('humi-connector', initAction, stopAction),
            cloud_http: _createModule('http-connector', initAction, stopAction),
            cloud_mqtt: _createModule('mqtt-connector', initAction, stopAction)
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
    }

    beforeEach(function() {
        Controller = _rewire('../../lib/controller');
        _wfs.createFolders(TEMP_DIR);
    });

    afterEach(function() {
        if(_filesToCleanup.length > 0) {
            _wfs.cleanupFiles(_filesToCleanup);
        }
        _wfs.cleanupFolders(TEMP_DIR);

        _filesToCleanup = [];
    });

    describe('ctor()', function() {
        it('should return an object with the required properties and methods', function() {
            var ctrl = new Controller();

            expect(ctrl).to.be.an('object');
            expect(ctrl).to.have.property('isActive').and.to.be.a('function');
            expect(ctrl).to.have.property('init').and.to.be.a('function');
            expect(ctrl).to.have.property('stop').and.to.be.a('function');
            expect(ctrl).to.have.property('getCloudConnectors').and.to.be.a('function');
            expect(ctrl).to.have.property('getDeviceConnectors').and.to.be.a('function');
        });

        it('should default the controller to an inactive state', function() {
            var ctrl = new Controller();

            expect(ctrl.isActive()).to.be.false;
        });
    });

    describe('init()', function() {
        it('should throw an error if invoked without a config file path', function() {
            var error = 'Invalid config file path specified (arg #1)';

            function invokeMethod(configFilePath) {
                return function() {
                    var ctrl = new Controller();
                    return ctrl.init(configFilePath);
                };
            }

            expect(invokeMethod()).to.throw(error);
            expect(invokeMethod(null)).to.throw(error);
            expect(invokeMethod(123)).to.throw(error);
            expect(invokeMethod('')).to.throw(error);
            expect(invokeMethod(true)).to.throw(error);
            expect(invokeMethod([])).to.throw(error);
            expect(invokeMethod({})).to.throw(error);
            expect(invokeMethod(function() {})).to.throw(error);
        });

        it('should return a promise when invoked with a valid config file', function() {
            var mockFs = _createMockFs();
            Controller.__set__('_fs', mockFs);
            var ctrl = new Controller();

            var configFilePath = _initConfig();
            var ret = ctrl.init(configFilePath);
            expect(ret).to.be.an('object');
            expect(ret).to.have.property('then').and.to.be.a('function');
        });

        it('should load configuration from the config file', function() {
            var mockFs = _createMockFs();
            Controller.__set__('_fs', mockFs);
            var ctrl = new Controller();

            expect(mockFs.readFile).to.not.have.been.called;

            var configFilePath = _initConfig();
            ctrl.init(configFilePath);

            expect(mockFs.readFile).to.have.been.calledOnce;

            var args = mockFs.readFile.args[0];
            expect(args[0]).to.equal(CONFIG_FILE);
        });

        it('should reject the promise if a bad (non existent) configuration file is specified', function(done) {
            var ctrl = new Controller();
            var ret = ctrl.init('bad_file.cfg');

            expect(ret).to.be.rejected.and.notify(done);
        });

        it('should reject the promise if the configuration file does not contain a valid JSON payload', function(done) {
            var ctrl = new Controller();
            var configFilePath = _initConfig('non json content');
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.rejected.and.notify(done);
        });

        it('should reject the promise if the configuration does not define the connectorTypes member', function(done) {
            var ctrl = new Controller();
            var error = 'Config does not define the connectorTypes section';
            var configFilePath = _initConfig({});
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.rejectedWith(error).and.notify(done);
        });

        it('should reject the promise if the configuration does not define the cloudConnectors member', function(done) {
            var ctrl = new Controller();
            var error = 'Config does not define the cloudConnectors section';
            var configFilePath = _initConfig({ connectorTypes: {} });
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.rejectedWith(error).and.notify(done);
        });

        it('should reject the promise if the configuration does not define the deviceConnectors member', function(done) {
            var ctrl = new Controller();
            var error = 'Config does not define the deviceConnectors section';
            var configFilePath = _initConfig({ connectorTypes: {}, cloudConnectors: {} });
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.rejectedWith(error).and.notify(done);
        });

        it('should resolve the promise immediately if no connectors have have been configured', function(done) {
            var ctrl = new Controller();
            var configFilePath = _initConfig();
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.fulfilled.and.notify(done);
        });

        it('should initialize the connector factory with the type information in the config', function(done) {
            var mockConnectorFactory = _createMockConnectorFactory();
            Controller.__set__('_connectorFactory', mockConnectorFactory);

            var mockConfig = _createConfig(0, 'resolve');

            var doTests = function() {
                expect(mockConnectorFactory.init).to.have.been.calledOnce;
                var initArg = mockConnectorFactory.init.args[0][0];
                expect(initArg).to.be.an('object');
                expect(initArg).to.have.keys(Object.keys(mockConfig.config.connectorTypes));
                for(var key in initArg) {
                    var connectorDefinition = initArg[key];
                    var expectedDefinition = mockConfig.getConnectorDefinition(key);
                    expect(connectorDefinition).to.equal(expectedDefinition);
                }
            };

            expect(mockConnectorFactory.init).to.not.have.been.called;
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.fulfilled
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should prefix the module path with a base path, if the type module is specified as a relative path', function(done) {
            var mockConnectorFactory = _createMockConnectorFactory();
            Controller.__set__('_connectorFactory', mockConnectorFactory);

            var mockConfig = _createConfig(0, 'resolve');

            for(var moduleName in mockConfig.config.connectorTypes) {
                var path = mockConfig.config.connectorTypes[moduleName];
                mockConfig.config.connectorTypes[moduleName] = path.replace('./tmp','');
            }

            var doTests = function() {
                expect(mockConnectorFactory.init).to.have.been.calledOnce;
                var initArg = mockConnectorFactory.init.args[0][0];
                expect(initArg).to.be.an('object');
                expect(initArg).to.have.keys(Object.keys(mockConfig.config.connectorTypes));
                for(var key in initArg) {
                    var connectorDefinition = initArg[key];
                    var expectedDefinition = mockConfig.getConnectorDefinition(key);
                    expect(connectorDefinition).to.equal(expectedDefinition);
                }
            };

            expect(mockConnectorFactory.init).to.not.have.been.called;
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller({
                moduleBasePath: './tmp'
            });
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.fulfilled
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should create and init cloud connectors based on the cloud connector information in the config', function(done) {
            var mockConfig = _createConfig(2, 'resolve');

            var doTests = function() {
                var connectorMap = {};
                var id = null;
                for(id in mockConfig.config.cloudConnectors) {
                    var instanceConfig = mockConfig.config.cloudConnectors[id];
                    var connectorType = instanceConfig.type;
                    var connectorInfo = mockConfig.connectors[connectorType];

                    connectorMap[id] = connectorInfo;
                    expect(connectorInfo.module).to.have.been.calledTwice;
                    expect(connectorInfo.module).to.have.been.calledWithNew;
                    expect(connectorInfo.module).to.have.been.calledWith(id);
                }

                for(id in connectorMap) {
                    // This will alter the spy, but we have already checked
                    // call counts, so the test is ok.
                    var connector = connectorMap[id];
                    var obj = connector.module();
                    var ids = obj.init.args.map(function(item) { return item[0].id });

                    expect(obj.init).to.have.been.calledTwice;
                    expect(ids).to.contain(id);
                }
            };

            for(var key in mockConfig.connectors) {
                expect(mockConfig.getConnectorDefinition(key)).to.not.have.been.called;
            }

            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.fulfilled
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should resolve the promise only after promises from each of the connectors is resolved', function(done) {
            var mockConfig = _createConfig(1);

            var promiseState = 'pending';
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();
            var ret = ctrl.init(configFilePath).then(function() {
                promiseState = 'resolved';
            }, function() {
                promiseState = 'rejected';
            });
            var keys = Object.keys(mockConfig.connectors);

            var expectState = function(state) {
                return function() {
                    if(state === 'pending') {
                        expect(ctrl.isActive()).to.be.false;
                    } else {
                        expect(ctrl.isActive()).to.be.true;
                    }
                    expect(promiseState).to.equal(state);
                };
            };

            var completeInit = function(type, resolve) {
                return function() {
                    var conRef = mockConfig.getConnectorByType(type);
                    if(resolve) {
                        conRef._completeDeferred('init', 0, true);
                    } else {
                        conRef._completeDeferred('init', 0, false);
                    }
                };
            };
            var runner = _assertionHelper.getDelayedRunner(function() {
                expectState('pending')();
            }, 10);

            expect(runner()).to.be.fulfilled
                .then(completeInit(keys[0], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeInit(keys[1], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeInit(keys[2], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeInit(keys[3], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('resolved'))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should only attach event handlers once, even if the connector is reinitialized multiple times', function(done) {
            var mockConfig = _createConfig(1, 'resolve');
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            mockConfig.cloudConnectorIds.forEach(function(id) {
                var connector = mockConfig.getConnectorById('cloud', id);
                _sinon.stub(connector, 'on');
            });
            mockConfig.deviceConnectorIds.forEach(function(id) {
                var connector = mockConfig.getConnectorById('device', id);
                _sinon.stub(connector, 'on');
            });

            var checkCallCount = function(callCount) {
                return function() {
                    mockConfig.cloudConnectorIds.forEach(function(id) {
                        var connector = mockConfig.getConnectorById('cloud', id);
                        expect(connector.on.callCount).to.equal(callCount);
                    });
                    mockConfig.deviceConnectorIds.forEach(function(id) {
                        var connector = mockConfig.getConnectorById('device', id);
                        expect(connector.on.callCount).to.equal(callCount);
                    });
                };
            };

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(checkCallCount(1))
                .then(ctrl.init.bind(ctrl, configFilePath))
                .then(checkCallCount(1))
                .then(ctrl.init.bind(ctrl, configFilePath))
                .then(checkCallCount(1))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should reject the promise if the promises from at least one of the connectors is rejected', function(done) {
            var mockConfig = _createConfig(1);

            var promiseState = 'pending';
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();
            var ret = ctrl.init(configFilePath).then(function() {
                promiseState = 'resolved';
            }, function() {
                promiseState = 'rejected';
            });
            var keys = Object.keys(mockConfig.connectors);

            var expectState = function(state) {
                return function() {
                    expect(promiseState).to.equal(state);
                };
            };

            var completeInit = function(type, resolve) {
                return function() {
                    var conRef = mockConfig.getConnectorByType(type);
                    if(resolve) {
                        conRef._completeDeferred('init', 0, true);
                    } else {
                        conRef._completeDeferred('init', 0, false);
                    }
                };
            };
            var runner = _assertionHelper.getDelayedRunner(function() {
                expectState('pending')();
            }, 10);

            expect(runner()).to.be.fulfilled
                .then(completeInit(keys[0], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeInit(keys[1], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeInit(keys[2], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeInit(keys[3], false))
                .then(_assertionHelper.wait(10))
                .then(expectState('rejected'))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });
    });

    describe('stop()', function() {
        it('should return a promise when invoked', function(done) {
            var ctrl = new Controller();

            var configFilePath = _initConfig();
            var ret = ctrl.init(configFilePath).then(function() {
                var stopPromise = ctrl.stop();
                expect(stopPromise).to.be.an('object');
                expect(stopPromise).to.have.property('then').and.to.be.a('function');
            });

            expect(ret).to.be.fulfilled
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should resolve the promise automatically if no connectors have been initialized', function(done) {
            var ctrl = new Controller();

            var configFilePath = _initConfig();

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(ctrl.stop.bind(ctrl))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should resolve the promise automatically if init has not yet been called', function(done) {
            var ctrl = new Controller();

            expect(ctrl.stop()).to.be.fulfilled
                .then(ctrl.stop.bind(ctrl))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should stop each of the initialized cloud connectors when invoked', function(done) {
            var mockConfig = _createConfig(2, 'resolve', 'resolve');

            var doTests = function() {
                for(var id in mockConfig.config.cloudConnectors) {
                    var conRef = mockConfig.getConnectorById('cloud', id);

                    expect(conRef.stop).to.have.been.calledTwice;
                }
            };

            for(var id in mockConfig.config.cloudConnectors) {
                var conRef = mockConfig.getConnectorById('cloud', id);

                expect(conRef.stop).to.not.have.been.called;
            }

            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(ctrl.stop.bind(ctrl))
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should stop each of the initialized device connectors when invoked', function(done) {
            var mockConfig = _createConfig(2, 'resolve', 'resolve');

            var doTests = function() {
                for(var id in mockConfig.config.deviceConnectors) {
                    var conRef = mockConfig.getConnectorById('device', id);

                    expect(conRef.stop).to.have.been.calledTwice;
                }
            };

            for(var id in mockConfig.config.deviceConnectors) {
                var conRef = mockConfig.getConnectorById('device', id);

                expect(conRef.stop).to.not.have.been.called;
            }

            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(ctrl.stop.bind(ctrl))
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should resolve the promise only after promises from each of the connectors is resolved', function(done) {
            var mockConfig = _createConfig(1, 'resolve');

            var promiseState = 'pending';
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();
            var keys = Object.keys(mockConfig.connectors);

            var expectState = function(state) {
                return function() {
                    expect(promiseState).to.equal(state);
                };
            };

            var completeStop = function(type, resolve) {
                return function() {
                    var conRef = mockConfig.getConnectorByType(type);
                    if(resolve) {
                        conRef._completeDeferred('stop', 0, true);
                    } else {
                        conRef._completeDeferred('stop', 0, false);
                    }
                };
            };

            var doStop = function() {
                var ret = ctrl.stop();

                ret.then(function() {
                    promiseState = 'resolved';
                }, function() {
                    promiseState = 'rejected';
                });
            };

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(doStop)
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeStop(keys[0], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeStop(keys[1], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeStop(keys[2], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeStop(keys[3], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('resolved'))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should reject the promise if the promises from at least one of the connectors is rejected', function(done) {
            var mockConfig = _createConfig(1, 'resolve');

            var promiseState = 'pending';
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();
            var keys = Object.keys(mockConfig.connectors);

            var expectState = function(state) {
                return function() {
                    expect(promiseState).to.equal(state);
                };
            };

            var completeStop = function(type, resolve) {
                return function() {
                    var conRef = mockConfig.getConnectorByType(type);
                    if(resolve) {
                        conRef._completeDeferred('stop', 0, true);
                    } else {
                        conRef._completeDeferred('stop', 0, false);
                    }
                };
            };

            var doStop = function() {
                var ret = ctrl.stop();

                ret.then(function() {
                    promiseState = 'resolved';
                }, function() {
                    promiseState = 'rejected';
                });
            };

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(doStop)
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeStop(keys[0], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeStop(keys[1], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeStop(keys[2], true))
                .then(_assertionHelper.wait(10))
                .then(expectState('pending'))
                .then(completeStop(keys[3], false))
                .then(_assertionHelper.wait(10))
                .then(expectState('rejected'))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });
    });

    describe('getCloudConnectors()', function() {
        it('should return an object when invoked', function(done) {
            var ctrl = new Controller();
            var configFilePath = _initConfig();
            var ret = ctrl.init(configFilePath);

            var doTests = function() {
                expect(ctrl.getCloudConnectors()).to.be.an('object');
                expect(ctrl.getCloudConnectors()).to.be.empty;
            };

            expect(ret).to.be.fulfilled
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should return a map of objects that lists all configured cloud connectors', function(done) {
            var mockConfig = _createConfig(1, 'resolve');

            var doTests = function() {
                var connectorMap = ctrl.getCloudConnectors();
                expect(connectorMap).to.have.keys(mockConfig.cloudConnectorIds);
                for(var key in connectorMap) {
                    var connector = connectorMap[key];
                    var connectorConfig = mockConfig.config.cloudConnectors[key];

                    expect(connector).to.have.property('connector').and.to.be.an('object');
                    expect(connector).to.have.property('actionPending').and.to.be.a('boolean');
                    expect(connector).to.have.property('type').and.to.equal(connectorConfig.type);
                    expect(connector).to.have.property('config').and.to.deep.equal(connectorConfig.config);
                    expect(connector).to.have.property('result');
                }
            };

            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.fulfilled
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should reflect the state of each connector in the response', function(done) {
            var mockConfig = _createConfig(1);

            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();
            var ret = ctrl.init(configFilePath);

            var expectInitComplete = function(key) {
                return function() {
                    var connectorMap = ctrl.getCloudConnectors();
                    var connectorInfo = connectorMap[key];
                    expect(connectorInfo.actionPending).to.be.false;
                };
            };

            var completeInit = function(key, resolve) {
                return function() {
                    var conRef = mockConfig.getConnectorById('cloud', key);
                    if(resolve) {
                        conRef._completeDeferred('init', 0, true);
                    } else {
                        conRef._completeDeferred('init', 0, false);
                    }
                };
            };
            var runner = _assertionHelper.getDelayedRunner(function() {
                var connectorMap = ctrl.getCloudConnectors();
                for(var key in connectorMap) {
                    expect(connectorMap[key].actionPending).to.be.true;
                }
            }, 10);

            expect(runner()).to.be.fulfilled
                .then(completeInit(mockConfig.cloudConnectorIds[0], true))
                .then(_assertionHelper.wait(10))
                .then(expectInitComplete(mockConfig.cloudConnectorIds[0]))
                .then(completeInit(mockConfig.cloudConnectorIds[1], false)) //Init should be complete on failure also
                .then(_assertionHelper.wait(10))
                .then(expectInitComplete(mockConfig.cloudConnectorIds[1]))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });
    });

    describe('getDeviceConnectors()', function() {

        it('should return an object when invoked', function(done) {
            var ctrl = new Controller();
            var configFilePath = _initConfig();
            var ret = ctrl.init(configFilePath);

            var doTests = function() {
                expect(ctrl.getDeviceConnectors()).to.be.an('object');
                expect(ctrl.getDeviceConnectors()).to.be.empty;
            };

            expect(ret).to.be.fulfilled
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should return a map of objects that lists all configured device connectors', function(done) {
            var mockConfig = _createConfig(1, 'resolve');

            var doTests = function() {
                var connectorMap = ctrl.getDeviceConnectors();
                expect(connectorMap).to.have.keys(mockConfig.deviceConnectorIds);
                for(var key in connectorMap) {
                    var connector = connectorMap[key];
                    var connectorConfig = mockConfig.config.deviceConnectors[key];

                    expect(connector).to.have.property('connector').and.to.be.an('object');
                    expect(connector).to.have.property('actionPending').and.to.be.a('boolean');
                    expect(connector).to.have.property('type').and.to.equal(connectorConfig.type);
                    expect(connector).to.have.property('config').and.to.deep.equal(connectorConfig.config);
                    expect(connector).to.have.property('result');
                }
            };

            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.fulfilled
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should reflect the state of each connector in the response', function(done) {
            var mockConfig = _createConfig(1);

            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();
            var ret = ctrl.init(configFilePath);

            var expectInitComplete = function(key) {
                return function() {
                    var connectorMap = ctrl.getDeviceConnectors();
                    var connectorInfo = connectorMap[key];
                    expect(connectorInfo.actionPending).to.be.false;
                };
            };

            var completeInit = function(key, resolve) {
                return function() {
                    var conRef = mockConfig.getConnectorById('device', key);
                    if(resolve) {
                        conRef._completeDeferred('init', 0, true);
                    } else {
                        conRef._completeDeferred('init', 0, false);
                    }
                };
            };
            var runner = _assertionHelper.getDelayedRunner(function() {
                var connectorMap = ctrl.getDeviceConnectors();
                for(var key in connectorMap) {
                    expect(connectorMap[key].actionPending).to.be.true;
                }
            }, 10);

            expect(runner()).to.be.fulfilled
                .then(completeInit(mockConfig.deviceConnectorIds[0], true))
                .then(_assertionHelper.wait(10))
                .then(expectInitComplete(mockConfig.deviceConnectorIds[0]))
                .then(completeInit(mockConfig.deviceConnectorIds[1], false)) //Init should be complete on failure also
                .then(_assertionHelper.wait(10))
                .then(expectInitComplete(mockConfig.deviceConnectorIds[1]))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });
    });

    describe('[events]', function() {
        var UPDATE_CONFIG_ACTION = 'update_config';
        var SEND_DATA_ACTION = 'send_data';

        function _initDeviceArray(mockConfig) {
            var devices = [ ];
            mockConfig.deviceConnectorIds.forEach(function(id) {
                devices.push({
                    id: id,
                    config: {
                        sampleFrequency: 20
                    },
                    data: {
                        value: '1234'
                    },
                    connector: mockConfig.getConnectorById('device', id)
                });
            });
            return devices;
        }

        function _resetInitSpy(devices) {
            return function(data) {
                devices.forEach(function(deviceInfo) {
                    deviceInfo.connector.init.reset();
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

        function _emitDataEvent(connector, action, devices) {
            return function(data) {
                var payload = {};
                devices.forEach(function(device) {
                    payload[device.id] = {
                        action: action
                    };
                    switch(action) {
                        case UPDATE_CONFIG_ACTION:
                            payload[device.id].config = device.config;
                            break;
                        case SEND_DATA_ACTION:
                            payload[device.id].data = device.data;
                            break;
                        default:
                            throw new Error('Unrecognized action: ' + action);

                    }
                });
                connector._emitData(payload);
                return data;
            };
        }

        function _checkInitCallCount(devices, count) {
            return function(data) {
                devices.forEach(function(deviceInfo) {
                    expect(deviceInfo.connector.init.callCount).to.equal(count);
                });
                return data;
            }
        }

        function _checkAddDataCount(devices, count) {
            return function(data) {
                devices.forEach(function(deviceInfo) {
                    expect(deviceInfo.connector.addData.callCount).to.equal(count);
                });
                return data;
            }
        }

        it('should add data to all cloud connector buffers when a device connector emits a data event', function(done) {
            var mockConfig = _createConfig(1, 'resolve', 'resolve');
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            var eventData = {
                timestamp: Date.now(),
                value: Math.random() * 10
            };

            var emitDataEvent = function() {
                return function() {
                    mockConfig.cloudConnectorIds.forEach(function(id) {
                        var conRef = mockConfig.getConnectorById('cloud', id);
                        expect(conRef.addData).to.not.have.been.called;
                    });

                    mockConfig.deviceConnectorIds.forEach(function(id) {
                        var conRef = mockConfig.getConnectorById('device', id);
                        conRef._emitData({
                            id: id,
                            data: eventData
                        });
                    });
                };
            };

            var doTests = function() {
                mockConfig.cloudConnectorIds.forEach(function(id) {
                    var conRef = mockConfig.getConnectorById('cloud', id);
                    expect(conRef.addData.callCount).to.equal(mockConfig.deviceConnectorIds.length);
                    conRef.addData.args.forEach(function(arg) {
                        expect(mockConfig.deviceConnectorIds).to.include(arg[0].id);
                        expect(arg[0].data).to.deep.equal(eventData);
                    });
                });
            };

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(emitDataEvent(eventData))
                .then(_assertionHelper.wait(10))
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should ignore the data payload if it is not a valid object', function(done) {
            var mockConfig = _createConfig(1, 'resolve', 'resolve');
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            var cloudConnector = mockConfig.getConnectorById('cloud',
                                               mockConfig.cloudConnectorIds[0]);
            var devices = _initDeviceArray(mockConfig);

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(_resetInitSpy(devices))
                .then(_emitRawData(cloudConnector, undefined))
                .then(_assertionHelper.wait(10))
                .then(_checkInitCallCount(devices, 0))

                .then(_emitRawData(cloudConnector, null))
                .then(_assertionHelper.wait(10))
                .then(_checkInitCallCount(devices, 0))

                .then(_emitRawData(cloudConnector, 123))
                .then(_assertionHelper.wait(10))
                .then(_checkInitCallCount(devices, 0))

                .then(_emitRawData(cloudConnector, 'foo'))
                .then(_assertionHelper.wait(10))
                .then(_checkInitCallCount(devices, 0))

                .then(_emitRawData(cloudConnector, true))
                .then(_assertionHelper.wait(10))
                .then(_checkInitCallCount(devices, 0))

                .then(_emitRawData(cloudConnector, function() {}))
                .then(_assertionHelper.wait(10))
                .then(_checkInitCallCount(devices, 0))

                .then(_emitRawData(cloudConnector, []))
                .then(_assertionHelper.wait(10))
                .then(_checkInitCallCount(devices, 0))

                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should ignore commands to specific sensors if the payload to the sensor is not a valid object', function(done) {
            var mockConfig = _createConfig(1, 'resolve', 'resolve');
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            var cloudConnector = mockConfig.getConnectorById('cloud',
                                               mockConfig.cloudConnectorIds[0]);
            var devices = _initDeviceArray(mockConfig);

            var payload = {};

            devices.forEach(function(device) {
                payload[device.id] = null;
            });

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(_resetInitSpy(devices))
                .then(_emitRawData(cloudConnector, payload))
                .then(_assertionHelper.wait(10))
                .then(_checkInitCallCount(devices, 0))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should ignore commands to specific sensors if the payload to the sensor does not define a valid action', function(done) {
            var mockConfig = _createConfig(1, 'resolve', 'resolve');
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            var cloudConnector = mockConfig.getConnectorById('cloud',
                                               mockConfig.cloudConnectorIds[0]);
            var devices = _initDeviceArray(mockConfig);

            var payload = {};

            devices.forEach(function(device) {
                payload[device.id] = {
                    action: null
                };
            });

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(_resetInitSpy(devices))
                .then(_emitRawData(cloudConnector, payload))
                .then(_assertionHelper.wait(10))
                .then(_checkInitCallCount(devices, 0))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should ignore send data requests to unrecognized device connectors', function(done) {
            var mockConfig = _createConfig(1, 'resolve', 'resolve');
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            var cloudConnector = mockConfig.getConnectorById('cloud',
                                               mockConfig.cloudConnectorIds[0]);
            var devices = _initDeviceArray(mockConfig);
            var badDevices = [
                { id: 'bad1', data: 'does not matter' },
                { id: 'bad2', data: 'does not matter' },
                { id: 'bad3', data: 'does not matter' },
            ];

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(_resetInitSpy(devices))
                .then(_checkAddDataCount(devices, 0))
                .then(_emitDataEvent(cloudConnector, SEND_DATA_ACTION, badDevices))
                .then(_assertionHelper.wait(10))
                .then(_checkAddDataCount(devices, 0))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should add data to specific device connector buffers when the cloud connector sends a data packet', function(done) {
            var mockConfig = _createConfig(1, 'resolve', 'resolve');
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            var cloudConnector = mockConfig.getConnectorById('cloud',
                                               mockConfig.cloudConnectorIds[0]);
            var devices = _initDeviceArray(mockConfig);

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(_resetInitSpy(devices))
                .then(_checkAddDataCount(devices, 0))
                .then(_emitDataEvent(cloudConnector, SEND_DATA_ACTION, devices))
                .then(_assertionHelper.wait(10))
                .then(_checkAddDataCount(devices, 1))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should reinitialize specific device connectors when the cloud connector reports a configuration update', function(done) {
            var mockConfig = _createConfig(1, 'resolve', 'resolve');
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            var cloudConnector = mockConfig.getConnectorById('cloud',
                                               mockConfig.cloudConnectorIds[0]);
            var devices = _initDeviceArray(mockConfig);

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(_resetInitSpy(devices))
                .then(_emitDataEvent(cloudConnector, UPDATE_CONFIG_ACTION, devices))
                .then(_assertionHelper.wait(10))
                .then(_checkInitCallCount(devices, 1))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should chain reinitialization calls on connectors if a previous init is in progress', function(done) {
            var mockConfig = _createConfig(1);
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            var cloudConnector = mockConfig.getConnectorById('cloud',
                                               mockConfig.cloudConnectorIds[0]);
            var devices = _initDeviceArray(mockConfig);

            var checkCallCount = function(callCount) {
                return function() {
                    devices.forEach(function(device) {
                        expect(device.connector.init.callCount).to.equal(callCount);
                    });
                };
            };

            var completeDeferred = function(index, resolve) {
                return function() {
                    devices.forEach(function(device) {
                        device.connector._completeDeferred('init', index, resolve)
                    });
                };
            };

            var ret = ctrl.init(configFilePath);
            setTimeout(function() {
                completeDeferred(0, true)();
                mockConfig.cloudConnectorIds.forEach(function(id) {
                    var connector = mockConfig.getConnectorById('cloud', id);
                    connector._completeDeferred('init', 0, true);
                });
            }, 10);

            expect(ret).to.be.fulfilled
                .then(checkCallCount(1))
                .then(_emitDataEvent(cloudConnector, UPDATE_CONFIG_ACTION, devices))
                .then(_emitDataEvent(cloudConnector, UPDATE_CONFIG_ACTION, devices))
                .then(_emitDataEvent(cloudConnector, UPDATE_CONFIG_ACTION, devices))
                .then(_assertionHelper.wait(10))
                .then(checkCallCount(2))

                .then(completeDeferred(1, true))
                .then(_assertionHelper.wait(10))
                .then(checkCallCount(3))

                .then(completeDeferred(2, true))
                .then(_assertionHelper.wait(10))
                .then(checkCallCount(4))

                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should write updated configuration to the file system when a configuration update is received', function(done) {
            var mockFs = _createMockFs();
            Controller.__set__('_fs', mockFs);

            var mockConfig = _createConfig(1, 'resolve', 'resolve');
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            var cloudConnector = mockConfig.getConnectorById('cloud',
                                               mockConfig.cloudConnectorIds[0]);
            var devices = _initDeviceArray(mockConfig);

            expect(mockFs.writeFile).to.not.have.been.called;

            var doTests = function() {
                expect(mockFs.writeFile).to.have.been.calledOnce;
                var args = mockFs.writeFile.args[0];
                expect(args[0]).to.equal(CONFIG_FILE);
                expect(args[1]).to.be.a('string');

                var config = JSON.parse(args[1]);
            };

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(_resetInitSpy(devices))
                .then(_emitDataEvent(cloudConnector, UPDATE_CONFIG_ACTION, devices))
                .then(_assertionHelper.wait(10))
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should subsequent file writes if a file write is currently in progress', function(done) {
            var mockFs = _createMockFs();
            Controller.__set__('_fs', mockFs);

            var mockConfig = _createConfig(1, 'resolve', 'resolve');
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            var cloudConnector = mockConfig.getConnectorById('cloud',
                                               mockConfig.cloudConnectorIds[0]);
            var devices = _initDeviceArray(mockConfig);

            var checkCallCount = function(callCount) {
                return function() {
                    expect(mockFs.writeFile.callCount).to.equal(callCount);
                };
            };

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(_resetInitSpy(devices))
                .then(_emitDataEvent(cloudConnector, UPDATE_CONFIG_ACTION, devices))
                .then(_emitDataEvent(cloudConnector, UPDATE_CONFIG_ACTION, devices))
                .then(_assertionHelper.wait(10))
                .then(checkCallCount(1))
                .then(mockFs._completeDeferred.bind(mockFs, 0, true))
                .then(_assertionHelper.wait(500))
                .then(checkCallCount(2))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should attempt a subsequent file write even if the previous write fails', function(done) {
            var mockFs = _createMockFs();
            Controller.__set__('_fs', mockFs);

            var mockConfig = _createConfig(1, 'resolve', 'resolve');
            var configFilePath = _initConfig(mockConfig.config);
            var ctrl = new Controller();

            var cloudConnector = mockConfig.getConnectorById('cloud',
                                               mockConfig.cloudConnectorIds[0]);
            var devices = _initDeviceArray(mockConfig);

            var checkCallCount = function(callCount) {
                return function() {
                    expect(mockFs.writeFile.callCount).to.equal(callCount);
                };
            };

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(_resetInitSpy(devices))
                .then(_emitDataEvent(cloudConnector, UPDATE_CONFIG_ACTION, devices))
                .then(_emitDataEvent(cloudConnector, UPDATE_CONFIG_ACTION, devices))
                .then(_assertionHelper.wait(10))
                .then(checkCallCount(1))
                .then(mockFs._completeDeferred.bind(mockFs, 0, false))
                .then(_assertionHelper.wait(500))
                .then(checkCallCount(2))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

    });

});
