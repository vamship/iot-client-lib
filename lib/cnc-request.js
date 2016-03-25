/* jshint node:true, expr:true */

var _util = require('util');

/**
 * A wrapper object that represents CNC requests with methods for logging
 * and responding to the cloud.
 *
 * @class CncRequest
 * @constructor
 * @param {Object} command An object that contains the command associated with
 *          this request.
 * @param {Function} dispatcher A dispatch function that can be used to send
 *          data into the cloud.
 */
function CncRequest(command, dispatcher) {
    if(!command || typeof command !== 'object' ||
       typeof command.requestId !== 'string' ||
           command.requestId.length <= 0) {
        throw new Error('Invalid command specified (arg #1)');
    }
    if(typeof dispatcher !== 'function') {
        throw new Error('Invalid dispatcher specified (arg #2)');
    }
    this.id = command.requestId;
    this.command = command;
    this._dispatcher = dispatcher;
}

/**
 * @class CncRequest
 * @method _log
 * @private
 */
CncRequest.prototype._log = function(level, tokens) {
    var message = _util.format.apply(_util, tokens);

    var payload = {
        requestId: this.id,
        qos: (level === 'info')? 0:1,
        data: {
            type: 'log',
            message: '[' + level + '] [' + this.id + '] ' + message
        }
    };
    this._dispatcher(payload);
};

/**
 * Sends an "info" level log message to the cloud.
 *
 * @class CncRequest
 * @method logInfo
 * @param {String} formatString The format string for the log message.
 * @param {...*} tokens Arguments to be interpolated with the format string.
 */
CncRequest.prototype.logInfo = function() {
    var tokens = Array.prototype.slice.call(arguments, 0);
    return this._log('info', tokens);
};

/**
 * Sends an "warn" level log message to the cloud.
 *
 * @class CncRequest
 * @method logWarn
 * @param {String} formatString The format string for the log message.
 * @param {...*} tokens Arguments to be interpolated with the format string.
 */
CncRequest.prototype.logWarn = function() {
    var tokens = Array.prototype.slice.call(arguments, 0);
    return this._log('warn', tokens);
};

/**
 * Sends an "error" level log message to the cloud.
 *
 * @class CncRequest
 * @method logError
 * @param {String} formatString The format string for the log message.
 * @param {...*} tokens Arguments to be interpolated with the format string.
 */
CncRequest.prototype.logError = function() {
    var tokens = Array.prototype.slice.call(arguments, 0);
    return this._log('error', tokens);
};

/**
 * Acknowledges a command received from the cloud.
 *
 * @class CncRequest
 * @method acknowledge
 */
CncRequest.prototype.acknowledge = function() {
    var payload = {
        requestId: this.id,
        qos: 1,
        data: {
            type: 'ack',
            action: this.command.action
        }
    };
    this._dispatcher(payload);
};

/**
 * Marks a request from the cloud as being completed with errors.
 *
 * @class CncRequest
 * @method completeError
 * @param {String} formatString The format string for the log message.
 * @param {...*} tokens Arguments to be interpolated with the format string.
 */
CncRequest.prototype.completeError = function() {
    var payload = {
        requestId: this.id,
        qos: 1,
        data: {
            type: 'complete',
            hasErrors: true,
            message: error
        }
    };
    // Send an error log message
    this.logError.apply(this, Array.prototype.slice.call(arguments, 0));

    this._dispatcher(payload);
};

/**
 * Marks a request from the cloud as being successfully completed.
 *
 * @class CncRequest
 * @method completeOk
 * @param {Object} [response={}] Optional response data that is sent to the
 *          cloud.
 */
CncRequest.prototype.completeOk = function(response) {
    response = response || {};
    var payload = {
        requestId: this.id,
        qos: 1,
        data: {
            type: 'complete',
            hasErrors: false,
            response: response
        }
    };
    this._dispatcher(payload);
};

/**
 * Returns a function that will mark a request as complete with errors. This
 * function can be used with promises to mark a request as complete after an
 * async processing action.
 *
 * @class CncRequest
 * @method getErrorHandler
 * @return {Function} An error handler for failed async processes.
 */
CncRequest.prototype.getErrorHandler = function() {
    return function(err) {
        this.completeError(err);
        throw err;
    }.bind(this);
};

/**
 * Returns a function that will mark a request as successfully completed. This
 * function can be used with promises to mark a request as complete after an
 * async processing action.
 *
 * @class CncRequest
 * @method getSuccessHandler
 * @param {Boolean} [passData = false] If set to true, passes the results of
 *          the async operation to the cloud.
 * @return {Function} An error handler for failed async processes.
 */
CncRequest.prototype.getSuccessHandler = function(passData) {
    passData = !!passData;
    return function(data) {
        var response = (passData)? data:{};
        this.completeOk();
        throw err;
    }.bind(this);
};

module.exports = CncRequest;
