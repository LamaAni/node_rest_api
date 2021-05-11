const { assert, KubeApiServiceError } = require('./errors')
const { KubeResourceKind } = require('./resources')
const { KubeApiRequest } = require('./api')
const moment = require('moment')

/**
 * @typedef {"CRITICAL"|"ERROR"|"WARN"|"DEBUG"|"TRACE"} KubeApiLogLineLevel
 */

/**
 * @param {string} msg
 * @return {KubeApiLogLineLevel} the level.
 */
function default_parse_kubernetes_log_level(msg) {
    const matched = msg.match(/CRITICAL|ERROR|WARN|WARNING|DEBUG|TRACE/g)
    if (matched == null || matched.length == 0) return 'INFO'
    /** @type {KubeApiLogLineLevel} */
    matched = Array.isArray(matched) ? matched[0] : matched
    if (matched == 'WARNING') matched = 'WARN'
    return matched
}

const LOG_LINE_START_MATCH = /^[0-9]{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}([.][0-9]+)?([-+]\d{2}:\d{2}|[Zz])/gm

/**
 * @typedef {Object} KubeLogLineOptions
 * @property {boolean} show_timestamps Show server timestamps
 * @property {detect_kuberentes_log_level} parse_log_level Detect kubernetes log level.
 */

class KubeApiLogLine {
    /**
     * Represents a pod log line.
     * @param {string} container_name The pod container name, if any.
     * @param {string} pod_name The pod name
     * @param {string} namespace The pod namespace
     * @param {string} message The message
     * @param {Date} timestamp The message timestamp
     * @param {KubeLogLineOptions} param0
     */
    constructor(
        container_name,
        pod_name,
        namespace,
        message,
        timestamp,
        { show_timestamps = false, parse_log_level = default_parse_kubernetes_log_level } = {},
    ) {
        this.container_name = container_name
        this.pod_name = pod_name
        this.namespace = namespace
        this.message = message
        this.timestamp = timestamp
        this.show_timestamps = show_timestamps
        this.parse_log_level = parse_log_level
    }

    /**
     * Log this line to a logger.
     * @param {console} logger
     */
    log(logger) {
        const level = this.parse_log_level(this.message)
        logger[level.toLowerCase()](this.toString())
    }

    context_header() {
        return [
            `${this.namespace}/${this.pod_name}`,
            this.container_name,
            this.show_timestamps ? moment(this.timestamp).toISOString() : null,
        ]
            .filter((v) => v != null)
            .map((v) => `[${v}]`)
            .join('')
    }

    toString() {
        return `${this.context_header()}: ${this.message}`
    }
}

/**
 * @typedef {import('http').ClientRequest} ClientRequest
 * @typedef {import('http').IncomingMessage} IncomingMessage
 *
 * @typedef {Object} GetPodLogsOptions
 * @property {Date} since Since when to start reading the logs. Defaults to current time.
 * @property {boolean} follow Continue reading pod logs.
 * @property {number} timeout The time in seconds before the request times-out.
 * @property {string} container The name of the container. If null, and single container,
 * will returns the logs to that container. Otherwise error.
 * @property {boolean} collect_log_lines If true, collect the log lines and returns the lines
 * as a result of the request. Otherwise just emits the log event.
 */

class GetPodLogs extends KubeApiRequest {
    /***
     * @param {string} name
     * @param {string} namespace
     * @param {GetPodLogsOptions} param2
     */
    constructor(
        name,
        namespace,
        {
            since = null,
            follow = true,
            timeout = null,
            container = null,
            collect_log_lines = true,
            show_timestamps = false,
        },
    ) {
        assert(typeof name == 'string' && name.trim().length > 0, 'name must be a non empty string')
        assert(
            typeof namespace == 'string' && name.trim().length > 0,
            'namespace must be a non empty string',
        )

        assert(
            since == null || typeof since == 'number' || since instanceof Date,
            'since must be either null, a number or a date',
        )

        assert(
            container == null || (typeof container == 'string' && container.trim().length > 0),
            'container must be either null or a non empty string',
        )

        const kind = KubeResourceKind.get_kind('pod')
        super(kind.compose_resource_path(namespace, name, { suffix: 'log' }), {
            method: 'GET',
            timeout: timeout,
            params: {
                follow,
                container,
                pretty: false,
                timestamps: true,
            },
        })

        this.kind = kind
        this.name = name
        this.namespace = namespace
        this.since = since
        this.container = container
        this.collect_log_lines = collect_log_lines
        this.show_timestamps = show_timestamps

        this.on(this.start_event_name, () => this.prepare_log_read())

        this.log_event_name = 'log'
    }

    prepare_log_read() {
        if (this.since != null)
            this.params['sinceSeconds'] = Math.ceil((new Date() - this.since) / 1000)
    }

    /**
     * Internal
     * @param {string} strm
     * @param {boolean} last_can_pend If false ignore last line. It is pending.
     */
    _parse_log_lines(strm, last_can_pend = false) {
        let line_texts = strm.split('\n')
        let pending_data = null
        if (!last_can_pend) {
            strm = null
        } else {
            const last_line = line_texts[line_texts.length - 1]
            if (!/[\n]\s*$/.test(last_line)) {
                // last line is pending.
                line_texts = line_texts.slice(0, -1)
                pending_data = last_line
            }
        }

        /** @type {[KubeApiLogLine]} */
        const lines = []
        for (let line of line_texts) {
            // parse line.
            line = line.replace(/[\n]\s*$/, '')

            let message = line
            let timestamp = null
            if (new RegExp(LOG_LINE_START_MATCH).test(line) == true) {
                const ts_end_index = line.indexOf(' ')
                message = line.slice(ts_end_index + 1)
                timestamp = new Date(Date.parse(line.slice(0, ts_end_index)))
            }
            lines.push(
                new KubeApiLogLine(this.container, this.name, this.namespace, message, timestamp, {
                    show_timestamps: this.show_timestamps,
                }),
            )
        }

        return [pending_data, lines]
    }

    /**
     * @param {ClientRequest} req The request object
     * @param {IncomingMessage} res The server response message.
     * @param {string|Buffer} chunk The response data chunk
     * @returns
     */
    parse_data_chunk(req, res, chunk) {
        chunk =
            chunk instanceof Buffer
                ? chunk.toString(res.headers['content-encoding'] || 'utf-8')
                : chunk

        // just accumulate data in the res object.
        if (res.data == null)
            res.data = {
                lines: [],
                pending: null,
                has_started: false,
                service_response: false,
            }

        if (
            res.data.service_response ||
            (!res.data.has_started && chunk.trim().startsWith('{"kind":"Status",'))
        ) {
            res.data.service_response = true
            res.data.pending = (res.data.pending || '') + chunk
            return res.data
        }

        res.data.has_started = true
        const cur_pending =
            (res.data.pending != null && res.data.pending.length > 0
                ? res.data.pending + '\n'
                : '') + chunk

        let [pending_data, lines] = this._parse_log_lines(cur_pending, true)
        res.data.pending = pending_data
        if (this.collect_log_lines) res.data.lines = res.data.lines.concat(lines)

        this.emit_log_lines(lines)

        return res.data
    }

    /**
     * @param {[KubeApiLogLine]} lines
     */
    emit_log_lines(lines) {
        for (let line of lines) this.emit(this.log_event_name, line)
    }

    /**
     * Parse the log lines as data.
     * @param {string} data
     * @param {boolean} emit If true emit the event.
     */
    parse_data(data, emit = true) {
        if (data.service_response) {
            const service_json = JSON.parse(data.pending)
            if (service_json.status == 'Failure') {
                throw new KubeApiServiceError(
                    'Service error: ' + service_json.message,
                    service_json,
                )
            }
            return data
        }
        if (data.pending != null) {
            let [pending_data, lines] = this._parse_log_lines(data.pending, false)
            assert(pending_data == null, 'Pending data should be null')
            if (emit) this.emit_log_lines(lines)
            if (this.collect_log_lines) data.lines = data.lines.concat(lines)
        }
        return data
    }

    /**
     * Emits the log lines.
     * @param {[KubeApiLogLine]} lines
     */
    emit_data(data) {
        super.emit_data(data.lines || [])
    }

    /**
     * @param {console} logger
     */
    bind_logger(logger) {
        super.bind_logger(logger)
        this.on(this.log_event_name, (line) => {
            logger.info(line.toString())
        })
    }
}

module.exports = {
    GetPodLogs,
}
