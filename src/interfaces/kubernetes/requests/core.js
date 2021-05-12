const { assert, KubeApiServiceError, KubeApiResourceStatusError } = require('../errors')
const { RestApiRequest } = require('../../../rest/api')
const { KubeResourceKind } = require('../resources')
const { KubeApi } = require('../api')
const yaml = require('yaml')

/**
 * @typedef {import('../../../rest/requests').RestApiRequestOptions} RestApiRequestOptions
 * @typedef {import('../../../rest/requests').REST_API_METHODS} REST_API_METHODS
 * @typedef {import('../../rest/requests').RestApiRequestOptions} RestApiRequestOptions
 */

/**
 * @typedef {Object} KubeApiRequestOptions
 * @property {Object<string, Object|string} params The request params
 * @property {Object<string,string>} headers The request headers
 * @property {REST_API_METHODS} method The request method
 * @property {string|Object|()=>string|Object} body The request body, if Object, converts to
 * JSON, if method get the function result and the convert if needed.
 * @property {[number]|(code)=>{}} ignore_errors If a list of codes or a method to filter. These errors are ignored.
 * @property {KubeApi} kube_api The associated rest api
 * @property {number} max_concurrent_request_failures The max number of concurrent failures.
 * @property {string} api_version The api version.
 */

class KubeApiRequest extends RestApiRequest {
    /**
     * @param {string} resource_path
     * @param {KubeApiRequestOptions} param1
     */
    constructor(
        resource_path,
        {
            params = null,
            headers = null,
            method = 'GET',
            timeout = null,
            body = null,
            ignore_errors = null,
            max_concurrent_request_failures = null,
            kube_api = null,
            api_version = null,
        } = {},
    ) {
        if (typeof body == 'function') body = body()
        if (body != null && typeof body == 'object') {
            api_version = api_version || body.apiVersion
        }

        super(resource_path, {
            params,
            headers,
            method,
            timeout,
            body,
            ignore_errors,
            max_concurrent_request_failures,
            rest_api: kube_api,
        })

        this.resource_path = resource_path
        this.api_version = api_version
    }

    /** @type {KubeApi} */
    get kube_api() {
        return this.rest_api
    }

    async get_body_as_string() {
        if (this.body == null) return null
        if (typeof this.body == 'string') return this.body
        return JSON.stringify(this.body)
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

/**
 * @typedef {Object} KubeApiNamespaceResourceRequestOptionsExtend
 * @property {string} name The name of the resource
 * @property {string} nmamesp
 * @typedef {KubeApiRequestOptions}
 */

class KubeApiNamespaceResourceRequest extends KubeApiRequest {
    /**
     *
     * @param {string|KubeResourceKind} kind The kind of the resource.
     * @param {string} namespace The namespace for the resource. If null = all namespaces (may not apply to all requests
     * @param {string} name The name of the resource. If null = all pods (may not apply to all requests)
     * @param {KubeApiRequestOptions} options
     * @param {string} api_suffix The suffix to use with the api. If null, ignored.
     */
    constructor(kind, name = null, namespace = null, options = {}, api_suffix = null) {
        assert(
            (typeof kind == 'string' && kind.trim().length > 0) || kind instanceof KubeResourceKind,
            'Invalid kind, must be a non empty string or KubeResourceKind',
        )
        if (typeof kind == 'string') kind = kind.trim()
        const resource_kind =
            kind instanceof KubeResourceKind ? kind : KubeResourceKind.get_kind(kind)

        const resource_path = resource_kind.compose_resource_path(namespace, name, {
            api_version: options.api_version,
            suffix: api_suffix,
        })

        super(resource_path, options)

        this.kind = resource_kind
        this.namespace = namespace
        this.name = name
    }

    parse_data(data) {
        data = super.parse_data(data)
        if (data.kind == 'Status') {
            if (data.status == 'Failure') {
                throw new KubeApiResourceStatusError(data)
            }
        }
        return data
    }
}

module.exports = {
    KubeApiRequest,
    KubeApiNamespaceResourceRequest,
}
