/* jshint node:true, expr:true */
'use strict';

var _sinon = require('sinon');
var _chai = require('chai');
_chai.use(require('sinon-chai'));
_chai.use(require('chai-as-promised'));
var expect = _chai.expect;

var _q = require('q');
var _util = require('util');
var connectorFactory = require('../../lib/connector-factory');
var EventEmitter = require('events').EventEmitter;

describe('connectorFactory', function() {

    function _createConnectorConfig() {
        var CloudConnector = _sinon.spy();
        var TempSensorConnector = _sinon.spy();
        var HumiditySensorConnector = _sinon.spy();

        return {
            'cloud': CloudConnector,
            'temperature': TempSensorConnector,
            'humidity': HumiditySensorConnector
        };
    }

    describe('[init]', function() {
        it('should expose the required methods and properties', function() {
            expect(connectorFactory).to.be.an('object');
            expect(connectorFactory).to.have.property('init').and.to.be.a('function');
            expect(connectorFactory).to.have.property('createConnector').and.to.be.a('function');
        });
    });

    describe('init()', function() {
        it('should throw an error if invoked without a valid configuration object', function() {
            var error = 'Invalid factory configuration specified (arg #1)';

            function invokeMethod(config) {
                return function(){
                    connectorFactory.init(config);
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

        it('should not throw any errors if invoked with a valid configuration object', function() {
            function invokeMethod() {
                return function() {
                    var config = _createConnectorConfig();
                    connectorFactory.init(config);
                };
            }

            expect(invokeMethod()).to.not.throw();

        });
    });

    describe('createConnector()', function() {
        it('should throw an error if invoked without a valid connector type', function() {
            var error = 'Invalid connector type specified (arg #1)';

            function invokeMethod(type) {
                return function(){
                    connectorFactory.createConnector(type);
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

        it('should throw an error if invoked without a valid connector id', function() {
            var error = 'Invalid connector id specified (arg #2)';

            function invokeMethod(id) {
                return function(){
                    connectorFactory.createConnector('foo', id);
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

        it('should throw an error if the specified connector type has not been defined using the init method', function() {
            function doTest(type) {
                var invoke = function(){
                    connectorFactory.createConnector(type, type + '_id');
                };
                var error = 'The specified connector type has not been defined: ' + type;

                expect(invoke).to.throw(error);
            }

            doTest('foo');
            doTest('bar');
            doTest('baz');
        });

        it('should create and return a new connector object when invoked with a valid connector type', function() {
            var config = _createConnectorConfig();

            connectorFactory.init(config);
            for(var name in config) {
                var type = config[name];

                type.reset();
                var connector = connectorFactory.createConnector(name, name + '_id');
                expect(type).to.have.been.calledOnce;
                expect(type).to.have.been.calledWithNew;
                expect(connector).to.be.an('object');
                expect(connector).to.be.an.instanceof(type);
            }
        });

        it('should use the id in the argument list when creating the connector, if one was specified', function() {
            var config = _createConnectorConfig();

            connectorFactory.init(config);
            for(var name in config) {
                var type = config[name];
                var id = name + '_id';

                type.reset();
                var connector = connectorFactory.createConnector(name, id);
                expect(type.args[0][0]).to.equal(id);
            }
        });
    });
});
