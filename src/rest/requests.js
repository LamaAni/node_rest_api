const http = require('http')
const https = require('https')

const { RestApiEventEmitter } = require('./events')
const { assert } = require('../errors')

const REST_API_REQUEST_EVENT_NAMES = {
    complete_event_name: 'request_complete',
    data_event_name: 'request_data',
    start_event_name: 'request_start',
    ignore_errors_event_name: 'request_error_ignored',
}

/**
 * @typedef {"GET" | "POST" | "PUT" | "DELETE"} REST_API_METHODS
 * @typedef {import('./api').RestApi} RestApi
 *
 * @typedef {Object} RestApiRequestOptions
 * @property {Object<string, Object|string} params The request params
 * @property {Object<string,string>} headers The request headers
 * @property {REST_API_METHODS} method The request method
 * @property {string|Object|()=>string|Object} body The request body, if Object, converts to
 * JSON, if method get the function result and the convert if needed.
 * @property {[number]|(code)=>{}} ignore_errors If a list of codes or a method to filter. These errors are ignored.
 * @property {RestApi} rest_api The associated rest api
 */

class RestApiRequest extends RestApiEventEmitter {
    /**
     * A self contained request api that allows sending requests to a server.
     * @param {string|URL} url The url to use
     * @param {RestApiRequestOptions} param1 The request options.
     */
    constructor(
        url,
        {
            params = null,
            headers = null,
            method = 'GET',
            timeout = null,
            body = null,
            ignore_errors = null,
            max_concurrent_request_failures: max_concurrent_request_failures = null,
            rest_api = null,
        } = {},
    ) {
        super()

        this.complete_event_name = REST_API_REQUEST_EVENT_NAMES.complete_event_name
        this.data_event_name = REST_API_REQUEST_EVENT_NAMES.data_event_name
        this.start_event_name = REST_API_REQUEST_EVENT_NAMES.start_event_name
        this.ignore_errors_event_name = REST_API_REQUEST_EVENT_NAMES.ignore_errors_event_name

        this._id = RestApiRequest.__generate_next_id()
        this.url = url
        this.params = params || {}
        this.headers = headers || {}
        this.method = method || 'GET'
        this.timeout = timeout
        this.body = body
        this.ignore_errors = ignore_errors
        this.max_concurrent_request_failures = max_concurrent_request_failures
        this.rest_api = rest_api
    }

    static __generate_next_id() {
        global._rest_api_request_id =
            (global._rest_api_request_id == null ? -1 : global._rest_api_request_id) + 1
        return global._rest_api_request_id
    }

    static parse_response_status_code(response) {
        response = response || {}
        return response.statusCode || response.status
    }

    /**
     * The unique ID of the request
     * @returns {number|string}
     */
    get id() {
        return this._id
    }

    _params_to_url_search_params() {
        const url_search_params = {}
        for (let k of Object.keys(this.params)) {
            let v = this.params[k]
            if (v == null) continue
            const type_v = typeof v
            switch (type_v) {
                case 'bigint':
                case 'boolean':
                case 'number':
                    {
                        v = v.toString()
                    }
                    break
                case 'object':
                    v = JSON.stringify(v)
                    break
                case string:
                    break
                default:
                    assert(false, 'Invalid params object type: ' + type_v)
                    break
            }
            url_search_params[k] = v
        }
        return url_search_params
    }

    /**
     * internal
     * @param {Error} err
     * @returns {boolean}
     */
    _check_ignore_errors(err) {
        if (this.ignore_errors == null) return false

        if (Array.isArray(this.ignore_errors)) {
            let status = err.status || (err.response || {}).status
            return this.ignore_errors.some((c) => status == c)
        }

        if (typeof this.ignore_errors == 'function') return this.ignore_errors(err)

        return false
    }

    /**
     * Composes the requests options. Override to update the request options
     * before sending to server.
     * @returns {http.RequestOptions}
     */
    async compose_request_options(uri = null) {
        /** @type {URL} */
        const url = new URL(uri || this.url)
        const url_search_params = this._params_to_url_search_params()
        for (let k of Object.keys(url_search_params)) url.searchParams[k] = url_search_params[k]

        assert(
            ['http:', 'https:'].some((p) => url.protocol == p),
            `Protocol ${url.protocol} not available. Available: http, https`,
        )

        for (let k of Object.keys(url_search_params)) {
            if (url_search_params[k] == null) continue
            url.searchParams[k] = url_search_params[k]
        }

        url.search = Object.keys(url.searchParams)
            .filter((k) => url.searchParams[k] != null)
            .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(url.searchParams[k])}`)
            .join('&')

        /** @type {http.RequestOptions} */
        const options = {
            method: this.method || 'GET',
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            headers: this.headers || {},
            timeout: this.timeout || 1000 * 60 * 24, // defaults to 24 [H]
        }

        return options
    }

    /**
     * @param {http.ClientRequest} req The request object
     * @param {http.IncomingMessage} res The server response message.
     * @param {Buffer} chunk The response data chunk
     * @returns
     */
    parse_data_chunk(req, res, chunk) {
        // just accumulate data in the res object.
        res.data =
            (res.data || '') +
            (chunk instanceof Buffer
                ? chunk.toString(res.headers['content-encoding'] || 'utf-8')
                : chunk)
        return res.data
    }

    /**
     * Sends a request to the server. Override this method
     * to provide custom request sending.
     */
    async _send_request() {
        let max_attempts =
            typeof this.max_concurrent_request_failures != 'number'
                ? 1
                : this.max_concurrent_request_failures

        while (max_attempts > 0) {
            max_attempts -= 1
            try {
                return await this.__do_send_request()
            } catch (err) {
                if (max_attempts == 0) throw err
                else this.emit_error_ignored(err)
            }
        }
    }

    async __do_send_request() {
        return await new Promise(async (resolve, reject) => {
            /** @type {http.ClientRequest} */
            let request = null

            const do_reject = (err) => {
                try {
                    if (request) request.end()
                } finally {
                    reject(err)
                }
            }

            /**
             * @param {http.IncomingMessage} res
             */
            const bind_request_events = (res) => {
                let data = null

                res.on('data', (chunk) => {
                    try {
                        data = this.parse_data_chunk(request, res, chunk)
                    } catch (err) {
                        do_reject(err)
                    }
                })

                res.on('end', () => {
                    resolve(data)
                })
            }

            try {
                const options = await this.compose_request_options()

                request = (options.protocol == 'https:' ? https : http).request(
                    options,
                    bind_request_events,
                )

                request.on('error', (err) => {
                    do_reject(err)
                })

                if (this.body) request.write(this.body)

                request.end()
            } catch (err) {
                do_reject(err)
            }
        })
    }

    /**
     * Called to emit new data. Override this method to allow for custom data
     * processing.
     * @param {Object} data The data received from the server. Any type.
     */
    async emit_data(data) {
        this.emit(this.data_event_name, data, this)
    }

    /**
     * Called when the request is complete. Override this method for custom
     * processing.
     */
    async emit_complete() {
        this.emit(this.complete_event_name, this)
    }

    /**
     * Called when the request is starting. Override this method for custom
     * processing.
     */
    async emit_start() {
        this.emit(this.start_event_name, this)
    }

    /**
     * Called when the request is error is ignored. Override this method for custom
     * processing.
     */
    async emit_error_ignored(err) {
        this.emit(this.ignored_error_event_name, err, this)
    }

    /**
     * Called to parse the response data from the response Object. Override to add custom
     * response parsing.
     * @param {Object} data
     */
    parse_data(data) {
        if (typeof data == 'string' && data.trim().startsWith('{')) {
            try {
                return JSON.parse(data)
            } catch (err) {
                return data
            }
        } else {
            return data
        }
    }

    /**
     * Called to process the request a-synchronically.
     * Override this method to allow for custom request processing.
     * @param {boolean} throw_errors If true, throws errors.
     */
    async send() {
        try {
            await this.emit_start()
            let data = await this._send_request()
            data = this.parse_data(data)
            await this.emit_data(data)
            return data
        } catch (err) {
            if (this._check_ignore_errors(err)) await this.emit_error_ignored(err)
            else {
                this.emit_error(err)
                throw err
            }
        } finally {
            await this.emit_complete()
        }
    }

    compose_log_header(msg) {
        return `[${this.url.toString()}] `
    }

    /**
     * Binds a logger to defaults events
     * @param {console} logger
     */
    bind_logger(logger = null) {
        logger = logger || console
        const compose_line = (msg) => {
            return `${this.compose_log_header()}${msg}`
        }
        this.on(this.complete_event_name, () => {
            logger.info(compose_line('Request complete'))
        })

        this.on(this.data_event_name, () => {
            logger.info(compose_line('Data received'))
        })

        this.on(this.start_event_name, () => {
            logger.info(compose_line('Request started'))
        })

        this.on(this.error_event_name, (err) => {
            logger.error(compose_line(err.stack || err.message || err))
        })

        this.on(this.warning_event_name, (err) => {
            logger.warn(compose_line(err.stack || err.message || err))
        })
    }
}

module.exports = {
    RestApiRequest,
}
