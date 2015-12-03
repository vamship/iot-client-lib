var _sinon = require("sinon");
var _q = require("q");
var EventEmitter = require("events").EventEmitter;

var con = {
    init: function() {},
    stop: function() {},
    addData: _sinon.spy(),
    isActive: function() { return con._state === "ACTIVE"; },
    _emitData: function(data) { this.emit("data", data); },
    _completeDeferred: function(type, index, resolve) {
        var defArray = (type === "init")? con._initDefers: con._stopDefers;
        if(resolve) {
            defArray[index].resolve();
            if(type==="init") { con._state = "ACTIVE"; } else { con._state = "INACTIVE" };
        } else { 
            defArray[index].reject();
            if(type==="init") { con._state = "ACTIVE"; } else { con._state = "INACTIVE" };
        }
    },
    _type: "mqtt-connector",
    _initDefers: [],
    _stopDefers: [],
    _state: "INACTIVE"
};
con.__proto__ = new EventEmitter();

_sinon.stub(con, "init", function(config) {
    var def = _q.defer();
    def.resolve(); con._state="ACTIVE";

    con._initDefers.push(def);
    return def.promise;
});
_sinon.stub(con, "stop", function(config) {
    var def = _q.defer();
    def.resolve(); con._state="INACTIVE";

    con._stopDefers.push(def);
    return def.promise;
});
var Connector = _sinon.stub().returns(con);
module.exports = Connector;
