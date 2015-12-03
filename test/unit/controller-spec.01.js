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
var EventEmitter = require('events').EventEmitter;
var Controller = null;

describe('Controller (1)', function() {

    beforeEach(function() {
        Controller = _rewire('../../lib/controller');
        _ctrlUtil.setup();
    });

    afterEach(function() {
        _ctrlUtil.teardown();
    });

    describe('ctor()', function() {
        it('should return an object with the required properties and methods', function() {
            var ctrl = new Controller();

            expect(ctrl).to.be.an('object');
            expect(ctrl).to.be.an.instanceof(EventEmitter);
            expect(ctrl).to.have.property('isActive').and.to.be.a('function');
            expect(ctrl).to.have.property('init').and.to.be.a('function');
            expect(ctrl).to.have.property('stop').and.to.be.a('function');
            expect(ctrl).to.have.property('getCloudConnectors').and.to.be.a('function');
            expect(ctrl).to.have.property('getDeviceConnectors').and.to.be.a('function');
        });

        it('should create a new logger object using the logger provider, if one was specified', function() {
            var provider = {
                getLogger: _sinon.spy()
            };
            var ctrl = new Controller(null, provider);
            expect(provider.getLogger).to.have.been.calledOnce;
            expect(provider.getLogger).to.have.been.calledWith('controller');
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
            var mockFs = _ctrlUtil.createMockFs();
            Controller.__set__('_fs', mockFs);
            var ctrl = new Controller();

            var configFilePath = _ctrlUtil.initConfig();
            var ret = ctrl.init(configFilePath);
            expect(ret).to.be.an('object');
            expect(ret).to.have.property('then').and.to.be.a('function');
        });

        it('should load configuration from the config file', function() {
            var mockFs = _ctrlUtil.createMockFs();
            Controller.__set__('_fs', mockFs);
            var ctrl = new Controller();

            expect(mockFs.readFile).to.not.have.been.called;

            var configFilePath = _ctrlUtil.initConfig();
            ctrl.init(configFilePath);

            expect(mockFs.readFile).to.have.been.calledOnce;

            var args = mockFs.readFile.args[0];
            expect(args[0]).to.equal(_ctrlUtil.CONFIG_FILE);
        });

        it('should reject the promise if a bad (non existent) configuration file is specified', function(done) {
            var ctrl = new Controller();
            var ret = ctrl.init('bad_file.cfg');

            expect(ret).to.be.rejected.and.notify(done);
        });

        it('should reject the promise if the configuration file does not contain a valid JSON payload', function(done) {
            var ctrl = new Controller();
            var configFilePath = _ctrlUtil.initConfig('non json content');
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.rejected.and.notify(done);
        });

        it('should reject the promise if the configuration does not define the connectorTypes member', function(done) {
            var ctrl = new Controller();
            var error = 'Config does not define the connectorTypes section';
            var configFilePath = _ctrlUtil.initConfig({});
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.rejectedWith(error).and.notify(done);
        });

        it('should reject the promise if the configuration does not define the cloudConnectors member', function(done) {
            var ctrl = new Controller();
            var error = 'Config does not define the cloudConnectors section';
            var configFilePath = _ctrlUtil.initConfig({ connectorTypes: {} });
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.rejectedWith(error).and.notify(done);
        });

        it('should reject the promise if the configuration does not define the deviceConnectors member', function(done) {
            var ctrl = new Controller();
            var error = 'Config does not define the deviceConnectors section';
            var configFilePath = _ctrlUtil.initConfig({ connectorTypes: {}, cloudConnectors: {} });
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.rejectedWith(error).and.notify(done);
        });

        it('should resolve the promise immediately if no connectors have have been configured', function(done) {
            var ctrl = new Controller();
            var configFilePath = _ctrlUtil.initConfig();
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.fulfilled.and.notify(done);
        });

        it('should initialize the connector factory with the type information in the config', function(done) {
            var mockConnectorFactory = _ctrlUtil.createMockConnectorFactory();
            Controller.__set__('_connectorFactory', mockConnectorFactory);

            var mockConfig = _ctrlUtil.createConfig(0, 'resolve');

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
            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
            var ctrl = new Controller();
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.fulfilled
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should prefix the module path with a base path, if the type module is specified as a relative path', function(done) {
            var mockConnectorFactory = _ctrlUtil.createMockConnectorFactory();
            Controller.__set__('_connectorFactory', mockConnectorFactory);

            var mockConfig = _ctrlUtil.createConfig(0, 'resolve');

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
            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
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
            var mockConfig = _ctrlUtil.createConfig(2, 'resolve');

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

            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
            var ctrl = new Controller();
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.fulfilled
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should resolve the promise only after promises from each of the connectors is resolved', function(done) {
            var mockConfig = _ctrlUtil.createConfig(1);

            var promiseState = 'pending';
            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
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

        it('should ignore subsequent initialization calls once a connector has been initialized', function(done) {
            var mockConfig = _ctrlUtil.createConfig(1, 'resolve');
            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
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
            var unexpectedSuccess = function() {
                throw new Error('Init was successful, where failure was expected');
            };

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(checkCallCount(1))
                .then(ctrl.init.bind(ctrl, configFilePath))
                .then(unexpectedSuccess, checkCallCount(1))
                .then(ctrl.init.bind(ctrl, configFilePath))
                .then(unexpectedSuccess, checkCallCount(1))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should reject the promise if the promises from at least one of the connectors is rejected', function(done) {
            var mockConfig = _ctrlUtil.createConfig(1);

            var promiseState = 'pending';
            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
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

            var configFilePath = _ctrlUtil.initConfig();
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

            var configFilePath = _ctrlUtil.initConfig();

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
            var mockConfig = _ctrlUtil.createConfig(2, 'resolve', 'resolve');

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

            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
            var ctrl = new Controller();

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(ctrl.stop.bind(ctrl))
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should stop each of the initialized device connectors when invoked', function(done) {
            var mockConfig = _ctrlUtil.createConfig(2, 'resolve', 'resolve');

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

            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
            var ctrl = new Controller();

            expect(ctrl.init(configFilePath)).to.be.fulfilled
                .then(ctrl.stop.bind(ctrl))
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should resolve the promise only after promises from each of the connectors is resolved', function(done) {
            var mockConfig = _ctrlUtil.createConfig(1, 'resolve');

            var promiseState = 'pending';
            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
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
            var mockConfig = _ctrlUtil.createConfig(1, 'resolve');

            var promiseState = 'pending';
            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
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
            var configFilePath = _ctrlUtil.initConfig();
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
            var mockConfig = _ctrlUtil.createConfig(1, 'resolve');

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

            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
            var ctrl = new Controller();
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.fulfilled
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should reflect the state of each connector in the response', function(done) {
            var mockConfig = _ctrlUtil.createConfig(1);

            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
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
            var configFilePath = _ctrlUtil.initConfig();
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
            var mockConfig = _ctrlUtil.createConfig(1, 'resolve');

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

            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
            var ctrl = new Controller();
            var ret = ctrl.init(configFilePath);

            expect(ret).to.be.fulfilled
                .then(doTests)
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should reflect the state of each connector in the response', function(done) {
            var mockConfig = _ctrlUtil.createConfig(1);

            var configFilePath = _ctrlUtil.initConfig(mockConfig.config);
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

    describe('[coverage - ensures code coverage for otherwise uncalled code]', function() {
        it('should throw an error when _getConnectorConfig is called with an invalid category', function() {
            var ctrl = new Controller();
            expect(function() {
                ctrl._getConnectorConfig('bad');
            }).to.throw();
        });

        it('should throw an error when _getConnectorInfo is called with an invalid category', function() {

            var ctrl = new Controller();
            expect(function() {
                ctrl._getConnectorInfo('bad');
            }).to.throw();
        });
    });
});
