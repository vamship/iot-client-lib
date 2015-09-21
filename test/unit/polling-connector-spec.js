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
var PollingConnector = require('../../lib/polling-connector');
var Connector = require('../../lib/connector');
var EventEmitter = require('events').EventEmitter;

describe('Connector', function() {

    function _createConnector(id) {
        id = id || 'foo';
        return new PollingConnector(id);
    }

    function _checkCallCount(spy, count) {
        return function() {
            expect(spy.callCount).to.equal(count);
        };
    };

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
            expect(con).to.be.an.instanceof(Connector);

            expect(con).to.have.property('_process').and.to.be.a('function');
        });
    });

    describe('init()', function() {

        it('should reject the promise if the connector config does not define a pollFrequency property', function(done) {
            var error = 'Connector configuration does not define a valid pollFrequency property';
            var con = _createConnector();
            var ret = con.init({});

            var checkReject = function(pollFrequency) {
                return function() {
                    return expect(con.init({
                        pollFrequency: pollFrequency
                    })).to.be.rejectedWith(error);
                };
            };

            expect(checkReject()()).to.be.fulfilled
                .then(checkReject(null))
                .then(checkReject(-1))
                .then(checkReject(0))
                .then(checkReject('abc'))
                .then(checkReject(true))
                .then(checkReject({}))
                .then(checkReject([]))
                .then(checkReject(function() {}))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should resolve the promise when the connector config defines a valid pollFrequency property', function(done) {
            var con = _createConnector();
            var ret = con.init({
                pollFrequency: 1000
            });

            expect(ret).to.be.fulfilled.and.notify(done);
        });

        it('should invoke the process() method at a frequency defined by the value of the pollFrequency property', function(done) {
            var con = _createConnector();
            var process = _sinon.stub(con, '_process');

            expect(con.init({ pollFrequency: 100 })).to.be.fulfilled
                .then(_checkCallCount(process, 0))
                .then(_assertionHelper.wait(105))
                .then(_checkCallCount(process, 1))
                .then(_assertionHelper.wait(105))
                .then(_checkCallCount(process, 2))
                .then(_assertionHelper.wait(105))
                .then(_checkCallCount(process, 3))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should change the polling frequency to a new one, if invoked consecutive times', function(done) {
            var con = _createConnector();
            var process = _sinon.stub(con, '_process');
            var freq1 = 100;
            var freq2 = 300;

            expect(con.init({ pollFrequency: freq1 })).to.be.fulfilled
                .then(_checkCallCount(process, 0))
                .then(_assertionHelper.wait(freq1 + 5))
                .then(_checkCallCount(process, 1))

                .then(con.init.bind(con, { pollFrequency: freq2}))
                .then(_assertionHelper.wait(freq1 + 5))
                .then(_checkCallCount(process, 1))
                .then(_assertionHelper.wait(freq1 + 5))
                .then(_assertionHelper.wait(freq1 + 5))
                .then(_checkCallCount(process, 2))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });
    });

    describe('stop()', function() {
        it('should resolve the promise when invoked', function(done) {
            var con = _createConnector();
            var ret = con.init({
                pollFrequency: 1000
            });

            expect(ret).to.be.fulfilled
                .then(con.stop.bind(con))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should stop invoking the process() method if polling had been previously initiated', function(done) {
            var con = _createConnector();
            var process = _sinon.stub(con, '_process');

            expect(con.init({ pollFrequency: 100 })).to.be.fulfilled
                .then(_checkCallCount(process, 0))
                .then(_assertionHelper.wait(105))
                .then(_checkCallCount(process, 1))
                .then(_assertionHelper.wait(105))
                .then(_checkCallCount(process, 2))
                .then(con.stop.bind(con))
                .then(_assertionHelper.wait(300))
                .then(_checkCallCount(process, 2))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });

        it('should do nothing if polling had previously not been initiated', function(done) {
            var con = _createConnector();
            var process = _sinon.stub(con, '_process');

            expect(con.stop()).to.be.fulfilled
                .then(_checkCallCount(process, 0))
                .then(_assertionHelper.wait(300))
                .then(_checkCallCount(process, 0))
                .then(_assertionHelper.getNotifySuccessHandler(done),
                      _assertionHelper.getNotifyFailureHandler(done));
        });
    });

});
