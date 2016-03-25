/* jshint node:true, expr:true */
'use strict';

/**
 * A library of reusable classes that provide core functionality for IOT
 * gateways
 *
 * @module iotClientLibrary
 */
module.exports = {

    /**
     * Returns the type definition for a controller class.
     *
     * @module iotClientLibrary
     * @property Controller
     * @readonly
     * @final
     */
    Controller: require('./controller'),

    /**
     * Returns a reference to the connector factory object.
     *
     * @module iotClientLibrary
     * @property connectorFactory
     * @readonly
     * @final
     */
    connectorFactory: require('./connector-factory'),

    /**
     * Returns the type definition for a connector class.
     *
     * @module iotClientLibrary
     * @property Connector
     * @readonly
     * @final
     */
    Connector: require('./connector'),

    /**
     * Returns the type definition for a polling connector class
     *
     * @module iotClientLibrary
     * @property PollingConnector
     * @readonly
     * @final
     */
    PollingConnector: require('./polling-connector'),


    /**
     * Returns the type definition for a Command and Control
     * request object
     *
     * @module iotClientLibrary
     * @property CncRequest
     * @readonly
     * @final
     */
    CncRequest: require('./cnc-request')
};
