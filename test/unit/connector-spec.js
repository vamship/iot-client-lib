/* jshint node:true, expr:true */
'use strict';

var _sinon = require('sinon');
var _chai = require('chai');
_chai.use(require('sinon-chai'));
_chai.use(require('chai-as-promised'));
var expect = _chai.expect;

var _q = require('q');
var _util = require('util');
var _assertionHelper = require('wysknd-test').assertionHelper;
var Connector = require('../../lib/connector');
var EventEmitter = require('events').EventEmitter;

describe('Connector', function() {

    function _createConnector(id) {
        id = id || 'foo';
        return new Connector(id);
    }

    function _defineChildConnector(methods) {
        function ChildConnector(id) {
            ChildConnector.super_.call(this, id);
        }

        _util.inherits(ChildConnector, Connector);

        for(var methodName in methods) {
            ChildConnector.prototype[methodName] = methods[methodName];
        }

        return ChildConnector;
    }

    describe('[static members]', function() {
        it('should expose static members for each of the standard events supported', function() {
            expect(Connector).to.have.property('DATA_EVENT').and.to.be.a('string').and.to.not.be.empty;
            expect(Connector).to.have.property('ERROR_EVENT').and.to.be.a('string').and.to.not.be.empty;
        });
    });

    describe('ctor()', function() {
        it('should throw an error if invoked without a valid id', function() {
            var error = 'Invalid connector id specified (arg #1)';

            function invokeMethod(id) {
                return function() {
                    new Connector(id);
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

        it('should return an object when invoked', function() {
            var con = _createConnector();

            expect(con).to.be.an('object');
            expect(con).to.be.an.instanceof(EventEmitter);

            expect(con).to.have.property('init').and.to.be.a('function');
            expect(con).to.have.property('getId').and.to.be.a('function');
            expect(con).to.have.property('isActive').and.to.be.a('function');
            expect(con).to.have.property('addData').and.to.be.a('function');
            expect(con).to.have.property('stop').and.to.be.a('function');
        });

        it('should set the active flag to false when initialized', function() {
            var con = _createConnector();

            expect(con.isActive()).to.be.false;
        });
    });

    describe('getId()', function() {
        it('should return the id specified during object creation', function() {
            var id = 'test-123';
            var con = _createConnector(id);

            expect(con.getId()).to.equal(id);
        });
    });

    describe('init()', function() {
        it('should throw an error if invoked without a valid configuration object', function() {
            var error = 'Invalid connector configuration specified (arg #1)';

            function invokeMethod(config) {
                return function() {
                    var con = _createConnector();
                    con.init(config);
                };
            }

            expect(invokeMethod()).to.throw(error);
            expect(invokeMethod(null)).to.throw(error);
            expect(invokeMethod(123)).to.throw(error);
            expect(invokeMethod('abc')).to.throw(error);
            expect(invokeMethod(true)).to.throw(error);
            expect(invokeMethod([])).to.throw(error);
            expect(invokeMethod(function() {})).to.throw(error);
        });

        it('should return a promise when invoked with a valid configuration object', function() {
            var con = _createConnector();
            var ret = con.init({});

            expect(ret).to.be.an('object');
            expect(ret).to.have.property('then').and.to.be.a('function');
        });
        
        it('should reject the promise by default', function(done) {
            // Default implementation requires that the promise be rejected.
            // This can be changed by child classes that provide proper
            // implementations for the _start() and _stop() methods.
            var error = 'The _start() method has not been implemented';
            var con = _createConnector();
            var ret = con.init({});

            expect(ret).to.be.rejectedWith(error).and.notify(done);
        });

        it('should delegate promise resolution to an inheriting class', function(done) {
            var ChildConnectorClass = _defineChildConnector({
                _start: function() {
                    var def = _q.defer();

                    def.resolve();
                    return def.promise;
                }
            });

            var con = new ChildConnectorClass('foo');
            var ret = con.init({});

            expect(ret).to.be.fulfilled.and.notify(done);
        });

        it('should delegate promise rejection to an inheriting class', function(done) {
            var error = 'Child class rejected init';
            var ChildConnectorClass = _defineChildConnector({
                _start: function() {
                    var def = _q.defer();

                    def.reject(error);
                    return def.promise;
                }
            });

            var con = new ChildConnectorClass('foo');
            var ret = con.init({});

            expect(ret).to.be.rejectedWith(error).and.notify(done);
        });

        it('should set the connector to active state if initialization succeeds', function(done) {
            var ChildConnectorClass = _defineChildConnector({
                _start: function() {
                    var def = _q.defer();

                    def.resolve();
                    return def.promise;
                }
            });

            var doTests = function() {
                expect(con.isActive()).to.be.true;
            };

            var con = new ChildConnectorClass('foo');

            expect(con.isActive()).to.be.false;
            var ret = con.init({});
            expect(ret).to.be.fulfilled
                    .then(doTests)
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should set the connector to inactive state if initialization succeeds', function(done) {
            var counter = 0;
            var ChildConnectorClass = _defineChildConnector({
                _start: function() {
                    var def = _q.defer();

                    if(counter===0) {
                        def.resolve();
                    } else {
                        def.reject('something went wrong');
                    }
                    counter++;
                    return def.promise;
                }
            });

            var checkForActiveTransition = function() {
                expect(con.isActive()).to.be.true;
            };

            var doTests = function() {
                expect(con.isActive()).to.be.false;
            };

            var con = new ChildConnectorClass('foo');
            var doInit = function() {
                return con.init({});
            };

            expect(con.isActive()).to.be.false;
            var ret = doInit();
            expect(ret).to.be.fulfilled
                    .then(checkForActiveTransition)
                    .then(doInit)
                    .fail(doTests) // We're expecting the previous call to fail (counter > 0)
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
        });
    });

    describe('addData()', function() {
        it('should throw an error if invoked without a valid data object', function() {
            var error = 'Invalid data object specified (arg #1)';

            function invokeMethod(data) {
                return function() {
                    var con = _createConnector();
                    con.init({});
                    con.addData(data);
                };
            };

            expect(invokeMethod()).to.throw(error);
            expect(invokeMethod(null)).to.throw(error);
            expect(invokeMethod(123)).to.throw(error);
            expect(invokeMethod('abc')).to.throw(error);
            expect(invokeMethod(true)).to.throw(error);
            expect(invokeMethod([])).to.throw(error);
            expect(invokeMethod(function(){})).to.throw(error);
        });

        it('should add data to the internal buffer when invoked with a valid data object', function() {
            var expectedBuffer = [];
            var con = _createConnector();
            con.init({});

            expect(con._buffer).to.be.empty;
            for(var index=0; index<10; index++) {
                var data = {
                    foo: 'bar-' + index
                };
                con.addData(data);
                expectedBuffer.push(data);
            }
            expect(con._buffer).to.deep.equal(expectedBuffer);
        });
    });

    describe('stop()', function() {
        it('should return a promise when invoked', function() {
            var con = _createConnector();
            var ret = con.stop();

            expect(ret).to.be.an('object');
            expect(ret).to.have.property('then').and.to.be.a('function');
        });

        it('should reject the promise by default', function(done) {
            // Default implementation requires that the promise be rejected.
            // This can be changed by child classes that provide proper
            // implementations for the _start() and _stop() methods.
            var con = _createConnector();
            var ret = con.stop();
            var error = 'The _stop() method has not been implemented';

            expect(ret).to.be.rejectedWith(error).and.notify(done);
        });

        it('should delegate promise resolution to an inheriting class', function(done) {
            var ChildConnectorClass = _defineChildConnector({
                _stop: function() {
                    var def = _q.defer();

                    def.resolve();
                    return def.promise;
                }
            });

            var con = new ChildConnectorClass('foo');
            var ret = con.stop();

            expect(ret).to.be.fulfilled.and.notify(done);
        });

        it('should delegate promise rejection to an inheriting class', function(done) {
            var error = 'Child class rejected init';
            var ChildConnectorClass = _defineChildConnector({
                _stop: function() {
                    var def = _q.defer();

                    def.reject(error);
                    return def.promise;
                }
            });

            var con = new ChildConnectorClass('foo');
            var ret = con.stop();

            expect(ret).to.be.rejectedWith(error).and.notify(done);
        });

        it('should set the connector to inactive state if stop succeeds', function(done) {
            var ChildConnectorClass = _defineChildConnector({
                _start: function() {
                    var def = _q.defer();

                    def.resolve();
                    return def.promise;
                },
                _stop: function() {
                    var def = _q.defer();

                    def.resolve();
                    return def.promise;
                }
            });

            var checkForActiveTransition = function() {
                expect(con.isActive()).to.be.true;
            };

            var doTests = function() {
                expect(con.isActive()).to.be.false;
            };

            var con = new ChildConnectorClass('foo');
            var doStop = function() {
                return con.stop();
            };

            expect(con.isActive()).to.be.false;
            var ret = con.init({});
            expect(ret).to.be.fulfilled
                    .then(checkForActiveTransition)
                    .then(doStop)
                    .then(doTests)
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should set the connector to inactive state if stop fails', function(done) {
            var ChildConnectorClass = _defineChildConnector({
                _start: function() {
                    var def = _q.defer();

                    def.resolve();
                    return def.promise;
                },
                _stop: function() {
                    var def = _q.defer();

                    def.reject();
                    return def.promise;
                }
            });

            var checkForActiveTransition = function() {
                expect(con.isActive()).to.be.true;
            };

            var doTests = function() {
                expect(con.isActive()).to.be.false;
            };

            var con = new ChildConnectorClass('foo');
            var doStop = function() {
                return con.stop();
            };

            expect(con.isActive()).to.be.false;
            var ret = con.init({});
            expect(ret).to.be.fulfilled
                    .then(checkForActiveTransition)
                    .then(doStop)
                    .fail(doTests)
                    .then(_assertionHelper.getNotifySuccessHandler(done),
                          _assertionHelper.getNotifyFailureHandler(done));
        });
    });
});
