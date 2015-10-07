/* jshint node:true, expr:true */
'use strict';

var _sinon = require('sinon');
var _chai = require('chai');
_chai.use(require('sinon-chai'));
_chai.use(require('chai-as-promised'));
var expect = _chai.expect;

var _loggerHelper = require('../../lib/logger-helper');

describe('loggerHelper', function() {
    it('should expose the expected methods and properties', function() {
        expect(_loggerHelper).to.be.an('object');
        expect(_loggerHelper).to.have.property('ensureLogger').and.to.be.a('function');
    });

    describe('ensureLogger()', function() {

        it('should do nothing if the input is not a valid object', function() {
            function ensureLogger(obj) {
                _loggerHelper.ensureLogger(obj);
                return obj;
            }

            expect(ensureLogger(null)).to.be.null;
            expect(ensureLogger()).to.be.undefined;
            expect(ensureLogger(123)).to.equal(123);
            expect(ensureLogger('abc')).to.equal('abc');
            expect(ensureLogger(true)).to.be.true;
            expect(ensureLogger(function() {})).to.be.a('function');
        });

        it('should create a "_logger" property if the object does not define it as an object', function() {
            function doTest(obj) {
                _loggerHelper.ensureLogger(obj);
                expect(obj).to.have.property('_logger').and.to.be.an('object');
            }

            doTest({});
            doTest({ _logger: null });
            doTest({ _logger: 123 });
            doTest({ _logger: 'abc' });
            doTest({ _logger: true });
            doTest({ _logger: function() {} });
        });

        it('should not redefine the "_logger" property if it already exists', function() {
            var logger = {};
            var obj = {
                _logger: logger
            };

            _loggerHelper.ensureLogger(obj);
            expect(obj._logger).to.equal(logger);
        });

        it('should define logger methods within the "_logger" object', function() {
            var logger = {
                silly: undefined,
                debug: 'abc',
                verbose: 123,
                info: true,
                warn: {},
                error: []
            };
            var obj = {
                _logger: logger
            };

            _loggerHelper.ensureLogger(obj);
            expect(obj._logger).to.have.property('silly').and.to.be.a('function');
            expect(obj._logger).to.have.property('debug').and.to.be.a('function');
            expect(obj._logger).to.have.property('verbose').and.to.be.a('function');
            expect(obj._logger).to.have.property('info').and.to.be.a('function');
            expect(obj._logger).to.have.property('warn').and.to.be.a('function');
            expect(obj._logger).to.have.property('error').and.to.be.a('function');
        });

        it('should not redefine logger methods if the "_logger" object already defines them', function() {
            var spy = _sinon.spy();
            var logger = {
                silly: spy,
                debug: spy,
                verbose: spy,
                info: spy,
                warn: spy,
                error: spy
            };
            var obj = {
                _logger: logger
            };

            _loggerHelper.ensureLogger(obj);
            expect(obj._logger.silly).to.equal(spy);
            expect(obj._logger.debug).to.equal(spy);
            expect(obj._logger.verbose).to.equal(spy);
            expect(obj._logger.info).to.equal(spy);
            expect(obj._logger.warn).to.equal(spy);
            expect(obj._logger.error).to.equal(spy);
        });
    });
});
