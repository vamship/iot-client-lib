/* jshint node:true */
'use strict';


module.exports = {

    /**
     * Ensures that the specified object has a "_logger" property, and that
     * this property is an object with defined logging methods.
     *
     * @module loggerHelper
     * @private
     * @method ensureLogger
     * @param {Object} component The object for which the logger property
     *          is ensured
     */
    ensureLogger: function(component) {
        if (!component || typeof component !== 'object') {
            return;
        }
        if (!component._logger || typeof component._logger !== 'object') {
            component._logger = {};
        }
        ['silly', 'debug', 'verbose',
            'info', 'warn', 'error'
        ].forEach(function(methodName) {
            if (typeof component._logger[methodName] !== 'function') {
                component._logger[methodName] = function() {}
            }
        });
    }
};
