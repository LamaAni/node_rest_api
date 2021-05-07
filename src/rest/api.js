const AsyncQueue = require('../events/queue')
const { Lock } = require('../events/lock')
const { RestApiEventEmitter } = require('./events')
const axios = require('axios')
const assert = require('assert')

const REST_API_REQUEST_METHODS = {
    GET: 'GET',
    POST: 'POST',
    PUT: 'PUT',
    DELETE: 'DELETE',
}

const RestApiRequest_EVENT_NAMES = {
    complete_event_name: 'request_complete',
    data_event_name: 'request_data',
    start_event_name: 'request_start',
    ignore_errors_event_name: 'request_error_ignored',
}

const sleep = async (ms) =>
    await new Promise((r) => {
        setTimeout(() => r(), ms)
    })

global._rest_api_request_id

class RestApiRequest extends RestApiEventEmitter {
    /**
     * A basic request object that can be sent to the rest api.
     * @param {string} url
     * @param {object} param1 A collection of request options
     * @param {number} param1.timeout The request timeout in ms
     * @param {object} param1.params The request params
     * @param {object} param1.headers The request headers
     * @param {REST_API_REQUEST_METHODS} param1.method The request method
     * @param {string} param1.body The request body
     * @param {[number]|(code)=>{}} param1.ignore_errors If a list of codes, ignores the error codes in the list.
     * If method then predicts the error responses to ignore.
     */
    constructor(
        url,
        {
            params = null,
            headers = null,
            method = REST_API_REQUEST_METHODS.GET,
            timeout = null,
            body = null,
            ignore_errors = null,
            max_cuncurrent_request_failures = null,
        } = {},
    ) {
        super()

        this._id = RestApiRequest.__generate_next_id()
        this.url = url
        this.params = params || {}
        this.headers = headers || {}
        this.method = method || 'GET'
        this.timeout = timeout
        this.body = body
        this.ignore_errors = ignore_errors
        this.max_cuncurrent_request_failures = max_cuncurrent_request_failures

        this.complete_event_name = RestApiRequest_EVENT_NAMES.complete_event_name
        this.data_event_name = RestApiRequest_EVENT_NAMES.data_event_name
        this.start_event_name = RestApiRequest_EVENT_NAMES.start_event_name
        this.ignore_errors_event_name = RestApiRequest_EVENT_NAMES.ignore_errors_event_name
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
     * Called to emit new data. Override this method to allow for custom data
     * processing.
     * @param {object} data The data received from the server. Any type.
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
     * Called to parse the response data from the response object. Override to add custom
     * response parsing.
     * @param {object} rsp
     */
    parse_response_data(rsp) {
        /** @type {string} */
        let data = rsp.data || rsp.body
        if (typeof data == 'string') {
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
     */
    async do_request_processing() {
        try {
            await this.emit_start()
            let rsp = await this.send_request()
            let data = this.parse_response_data(rsp)
            rsp = null
            await this.emit_data(data)
            data = null
        } catch (err) {
            if (this._check_ignore_errors(err)) await this.emit_error_ignored(err)
            else this.emit_error(err)
        } finally {
            await this.emit_complete()
        }
    }

    async __do_send_request() {
        return await new Promise((resolve, reject) => {
            let timeout_index = null

            function clear_request_timeout() {
                if (timeout_index != null) {
                    clearTimeout(timeout_index)
                    timeout_index = null
                }
            }

            /**
             * @param {Error} err
             */
            function do_reject(err) {
                try {
                    err.message = (err.response.data || {}).message || err.message || ''
                    err.status = RestApiRequest.parse_response_status_code(err.response)

                    if (err.response != null && err.status != null)
                        err.message += ` @ {${err.status}} ${
                            err.config.url || err.request.url || '[unknown]'
                        } `

                    // hide the internals.
                    err.internal_stack = err.stack
                    try {
                        throw new Error()
                    } catch (inner_err) {
                        err.stack =
                            (err.message != null ? err.message + '\n' : '') + inner_err.stack
                    }

                    reject(err)
                } catch (inner_err) {
                    reject(err)
                }
            }

            function do_resolve(rsp) {
                resolve(rsp)
            }

            try {
                let options = {
                    url: this.url,
                    method: this.method || 'GET',
                    headers: this.headers || {},
                    data: this.body,
                    params: this.params || {},
                }

                Object.keys(options).forEach((k) => {
                    if (options[k] == null) delete options[k]
                })

                axios(options)
                    // got(this.url, options)
                    .then((rsp) => {
                        try {
                            let status_code = RestApiRequest.parse_response_status_code(rsp)
                            if (status_code != 200) {
                                throw Error(`${rsp.statusMessage} (${status_code})`, rsp)
                            } else {
                                do_resolve(rsp)
                            }
                        } catch (err) {
                            do_reject(err)
                        }
                    })
                    .catch((err) => {
                        do_reject(err)
                    })
                    .finally(() => {
                        clear_request_timeout()
                    })

                if (this.timeout != null)
                    timeout_index = setTimeout(() => {
                        do_reject(new Error(`Request timeout (${this.timeout} [ms])`))
                    }, this.timeout)
            } catch (err) {
                clear_request_timeout()
                do_reject(err)
            }
        })
    }

    /**
     * Sends a request to the server. Override this method
     * to provide custom request sending.
     */
    async send_request() {
        let max_attempts =
            typeof this.max_cuncurrent_request_failures != 'number'
                ? 1
                : this.max_cuncurrent_request_failures

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
}

class RestApi extends RestApiEventEmitter {
    /**
     * An internal rest api that allows parerallized calls to remote servers.
     * @param {object} param0
     * @param {number} param0.max_active_requests The max number of active requests.
     * @param {number} param0.params Add these params to all requests.
     * @param {number} param0.headers Add these headers to all requests.
     */
    constructor({
        max_active_requests = 1000,
        params = {},
        headers = {},
        delay_between_concurrent_requests = null,
    } = {}) {
        super()
        /** @type {[RestApiRequest]} A list of pending requests*/
        this._pending_requests = []

        /** @type {Object<string,{request:RestApiRequest, promise: Promise}>} */
        this._active_requests = {}
        this._is_sending_requests = false
        this.max_active_requests = max_active_requests
        this.params = params
        this.headers = headers
        this.delay_between_concurrent_requests = delay_between_concurrent_requests

        this.start_sending_requests_event_name = 'start_sending_requests'
        this.stop_sending_requests_event_name = 'stop_sending_requests'
        this.complete_all_active_requests_event_name = 'stop_sending_requests'
    }

    async emit_completed_all_active_requests() {
        this.emit(this.complete_all_active_requests_event_name, this)
    }

    async __send_pending_requests_loop() {
        while (this._pending_requests.length > 0) {
            while (
                this._pending_requests.length > 0 &&
                Object.keys(this._active_requests).length < this.max_active_requests
            ) {
                const rq = this._pending_requests.shift()
                const rq_info = {
                    request: rq,
                    promise: rq
                        .do_request_processing()
                        .catch(() => {}) // errors are handled by the request.
                        .finally(() => {
                            delete this._active_requests[rq.id]
                            if (Object.keys(this._active_requests).length == 0)
                                this.emit_completed_all_active_requests()
                        }),
                }

                this._active_requests[rq.id] = rq_info

                if (
                    this.delay_between_concurrent_requests != null &&
                    this.delay_between_concurrent_requests > 0
                )
                    await sleep(this.delay_between_concurrent_requests)
            }

            await Promise.race(Object.values(this._active_requests).map((rq) => rq.promise))
        }

        this._is_sending_requests = false
    }

    /**
     * Start the pending requests send loop if was not started.
     */
    start_sending_pending_requests() {
        if (this._is_sending_requests) return false
        this._is_sending_requests = true
        this.emit(this.start_sending_requests_event_name, this)
        this.__send_pending_requests_loop()
            .catch((err) => {
                this.emit_error(err)
            })
            .finally(() => {
                this._is_sending_requests = false
                this.emit(this.stop_sending_requests_event_name, this)
            })
        return true
    }

    /**
     * Returns a validated requests list.
     * @param {RestApiRequest|[RestApiRequest]} requests The requests to send.
     * @returns {[RestApiRequest]}
     */
    _validate_requests(requests) {
        if (!Array.isArray(requests)) {
            requests = [requests]
        }
        assert(
            requests.every((rq) => rq instanceof RestApiRequest),
            'All requests must be of type RestApiRequest',
        )
        return requests
    }

    /**
     * A-synchronically sends a list of requests to the server.
     * @param {RestApiRequest|[RestApiRequest]} requests The requests to send.
     */
    send(requests) {
        requests = this._validate_requests(requests)
        const handler = new RestApiEventEmitter()

        for (let rq of requests) {
            rq.pipe(this)
            rq.pipe(handler)
            rq.params = { ...(this.params || {}), ...rq.params }
            rq.headers = { ...(this.headers || {}), ...rq.headers }
            this._pending_requests.push(rq)
        }

        handler.on(
            requests.map((rq) => rq.complete_event_name),
            (rq) => {
                rq.clear_pipe(this)
                rq.clear_pipe(handler)
            },
        )

        this.start_sending_pending_requests()
    }

    /**
     * Create a request stream to get the request responses (returns the response from send_request command)
     * @param {RestApiRequest|[RestApiRequest]} requests The requests to send.
     */
    stream(requests) {
        requests = this._validate_requests(requests)
        const pending = new Set(requests)
        const stream = new AsyncQueue()

        requests.forEach((rq) => {
            rq.on(rq.error_event_name, (err) => {
                stream.raise(err)
            })
            rq.on(rq.data_event_name, (data) => {
                stream.endqueue(data)
            })
            rq.on(rq.complete_event_name, (rq) => {
                pending.delete(rq)
                if (pending.size == 0) stream.stop()
            })
        })

        this.send(requests)

        return stream
    }

    /**
     * @param {RestApiRequest|[RestApiRequest]} requests The requests to wait for
     * @param {bool} throw_errors If true throw errors.
     */
    async wait_until_complete(requests, throw_errors = true) {
        requests = this._validate_requests(requests)
        const lock = new Lock()
        const pending = new Set(Array.from(requests))

        const handler = new RestApiEventEmitter()
        const complete_event_names = Array.from(new Set(requests.map((r) => r.complete_event_name)))
        const error_event_names = Array.from(new Set(requests.map((r) => r.error_event_name)))

        requests.forEach((r) => r.pipe(handler))
        this.pipe(handler)

        function on_complete(rq) {
            if (pending.has(rq)) pending.delete(rq)
            if (lock.is_locked && pending.size == 0) lock.clear()
        }

        function on_error(err) {
            if (throw_errors && lock.is_locked) lock.raise(err)
        }

        for (let name of complete_event_names) handler.on(name, on_complete)
        if (throw_errors) for (let name of error_event_names) handler.on(name, on_error)

        try {
            await lock.wait()
        } finally {
            this.clear_pipe(handler)
            requests.forEach((r) => r.clear_pipe(handler))
        }
    }

    /**
     * Send a request to the server and wait for response.
     * @param {RestApiRequest|[RestApiRequest]} requests The requests to send.
     * @returns {object | [object]}
     */
    async request(requests) {
        const stream = this.stream(requests)
        const is_single = !Array.isArray(requests)
        const rslt = []

        for await (let v of stream) {
            rslt.push(v)
        }

        return is_single ? (rslt.length == 1 ? rslt[0] : rslt) : rslt
    }
}

module.exports = {
    RestApi,
    RestApiRequest,
    REST_API_REQUEST_METHODS,
}

if (require.main == module) {
    const { Logger } = require('@lamaani/ZCli')
    const api = new RestApi({ max_active_requests: 10 })
    const log = new Logger()

    ;(async () => {
        const requests = new Array(100).fill(0).map(() => {
            const rq = new RestApiRequest('http://www.google.com', {
                timeout: 3000,
            })
            rq.on(rq.complete_event_name, () => log.info('Completed request ' + rq.id))

            rq.on(rq.start_event_name, () => log.info('Started request ' + rq.id))

            return rq
        })

        const results = await api.request(requests)

        log.info(`${results}`)
    })().catch((err) => {
        console.error(err)
        process.exit(typeof err.code == 'number' && err.code < 255 ? err.code : 1)
    })
}
