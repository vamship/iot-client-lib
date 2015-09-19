/* jshint node:true, expr:true */
'use strict';

var _sinon = require('sinon');
var _chai = require('chai');
_chai.use(require('sinon-chai'));
_chai.use(require('chai-as-promised'));
var expect = _chai.expect;

var _index = require('../../lib/index');

describe('index', function() {
    it('should expose the expected methods and properties', function() {
        expect(_index).to.be.an('object');
        expect(_index).to.have.property('Connector').and.to.be.a('function');
        expect(_index).to.have.property('Controller').and.to.be.a('function');
        expect(_index).to.have.property('connectorFactory').and.to.be.an('object');
    });
});
