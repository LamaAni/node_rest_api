const AsyncQueue = require('../events/queue')
const { Lock } = require('../events/lock')
const { RestApiEventEmitter } = require('./events')
const { assert } = require('../errors')
const { RestApiRequest } = require('./requests')

const sleep = async (ms) =>
    await new Promise((r) => {
        setTimeout(() => r(), ms)
    })

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
                        .send()
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
     * Invokes the requests (by adding them to the pending list), and
     * dose not wait for response.
     * @param {RestApiRequest|[RestApiRequest]} requests The requests to send.
     * @returns {RestApiEventEmitter} the associated event handler.
     */
    invoke(requests) {
        requests = this._validate_requests(requests)
        const handler = new RestApiEventEmitter()

        for (let rq of requests) {
            rq.pipe(this)
            rq.pipe(handler)
            rq.rest_api = this
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

        return handler
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

        this.invoke(requests)

        return stream
    }

    /**
     * A-synchronically sends a list of requests to the server.
     * @param {RestApiRequest|[RestApiRequest]} requests The requests to send.
     */
    async send(requests) {
        const strm = this.stream(requests)
        const rt = []
        for await (let val of strm) {
            rt.push(val)
        }
        return rt
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
