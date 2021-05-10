const { assert } = require('./errors')
const { KubeResourceKind } = require('./resources')
const { KubeApiRequest } = require('./api')

/**
 * @typedef {Object} GetPodLogsOptions
 * @property {Date} since Since when to start reading the logs. Defaults to current time.
 * @property {boolean} follow Continue reading pod logs.
 * @property {number} timeout The time in seconds before the request times-out.
 * @property {string} container The name of the container. If null, and single container,
 * will returns the logs to that container. Otherwise error.
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
        { since = null, follow = true, timeout = null, container = null },
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
        super(kind.compose_resource_path(name, namespace, { suffix: 'log' }), {
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

        this.on(this.start_event_name, () => this.prepare_log_read())
    }

    prepare_log_read() {
        if (this.since != null) this.params['sinceSeconds'] = new Date() - this.since
    }

    parse_response_data(log_chunk) {
        // overrides to parse the response log items.
        
    }
}

module.exports = {
    GetPodLogs,
}
