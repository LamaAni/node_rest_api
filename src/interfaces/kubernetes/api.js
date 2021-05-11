const fs = require('fs')
const path = require('path')
const os = require('os')
const yaml = require('yaml')
const { KubeConfig, CoreV1Api } = require('@kubernetes/client-node')

const { assert } = require('./errors')
const { RestApi, RestApiRequest } = require('../../rest/api')

class KubeApiConfig {
    constructor({ config_file = null, load_defaults = true } = {}) {
        this.config = new KubeConfig()
        if (config_file != null) this.config.loadFromFile(config_file)
        else if (load_defaults) this.config.loadFromDefault()
    }

    get server_base_url() {
        return this.config.getCurrentCluster().server
    }

    async apply_to_request_options(options) {
        await this.config.applyToRequest(options)
    }
}

class KubeApiRequest extends RestApiRequest {
    constructor(
        resource_path,
        {
            params = null,
            headers = null,
            method = REST_API_REQUEST_METHODS.GET,
            timeout = null,
            body = null,
            ignore_errors = null,
            max_concurrent_request_failures = null,
        } = {},
    ) {
        super(resource_path, {
            params,
            headers,
            method,
            timeout,
            body,
            ignore_errors,
            max_concurrent_request_failures,
        })

        this.resource_path = resource_path

        /**
         * @type {KubeApi}
         */
        this.rest_api = this.rest_api
    }

    compose_log_header() {
        return `[${this.resource_path}] `
    }

    /**
     * Composes the request options for this api.
     */
    async compose_request_options() {
        let url = this.url
        if (
            this.rest_api instanceof KubeApi &&
            typeof url == 'string' &&
            !/^https?:\/{2}/.test(url.trim())
        ) {
            url = url.trim()
            url = this.rest_api.config.server_base_url + (url.startsWith('/') ? '' : '/') + url
        }
        const options = await super.compose_request_options(url)
        if (this.rest_api instanceof KubeApi)
            await this.rest_api.config.apply_to_request_options(options)
        return options
    }
}

class KubeApi extends RestApi {
    constructor({
        max_active_requests = 1000,
        params = {},
        headers = {},
        delay_between_concurrent_requests = null,
        config_file = null,
        load_default_config = true,
    } = {}) {
        super({
            max_active_requests,
            params,
            headers,
            delay_between_concurrent_requests,
        })

        this.config = new KubeApiConfig({
            config_file: config_file,
            load_defaults: load_default_config,
        })
    }
}

module.exports = {
    KubeApi,
    KubeApiRequest,
}
