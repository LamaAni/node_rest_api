const { assert } = require('./errors')

/**
 * @typedef { "Pending" | "Active" | "Succeeded" | "Failed" | "Running" | "Deleted" } ResourceKindState
 */

/**
 * @typedef {Object} KubeResourceKindOptions
 * @property {string} api_version The api version of the kind. Defaults to v1.
 * @property {(body:{}, was_deleted:boolean)=>ResourceKindState|string} parse_kind_state Parse the state of the resource.
 * @property {boolean} auto_include_in_watch If true, and watching resource changes, will
 * be auto included.
 */

/**
 * @param {{}} body The resource body
 * @returns {ResourceKindState}
 */
function parse_kind_state_default(body, was_deleted = false) {
    return 'Active'
}

const RESOURCE_KINDS = {}

class KubeResourceKind {
    /**
     *
     * @param {string} name The name of the resource (Pod, Deployment)
     * @param {KubeResourceKindOptions} param2
     */
    constructor(name, { api_version = 'v1', parse_kind_state, auto_include_in_watch = true } = {}) {
        assert(
            typeof name == 'string' && api_version.trim().length > 0,
            'Name must be of type string and not empty',
        )
        assert(
            typeof api_version == 'string' && api_version.trim().length > 0,
            'Name must be of type string and not empty',
        )
        assert(
            parse_kind_state == null || typeof parse_kind_state == 'function',
            'parse_kind_state must be None or a callable',
        )

        this._name = name.toLowerCase()
        this.api_version = api_version
        this.parse_kind_state = parse_kind_state
        this.auto_include_in_watch = auto_include_in_watch
    }

    /**
     * The resource kinds dictionary
     * @type {Object<string,KubeResourceKind>}
     */
    static get global_kinds() {
        return RESOURCE_KINDS
    }

    get name() {
        return this._name
    }

    get plural() {
        return this._name.endsWith('s') ? this._name : this._name + 's'
    }

    /**
     * Parses the state of the kind given the object body.
     * @param {Object} body The body of the object as returned from the api.
     * @param {boolean} was_deleted
     * @returns {ResourceKindState}
     */
    parse_state(body, was_deleted = false) {
        if (was_deleted) return 'Deleted'
        state = (this.parse_kind_state || parse_kind_state_default)(body, was_deleted)
        return state
    }

    /**
     * Composes a resource path from its name.
     * @param {string} namespace The resource namespace
     * @param {string} name The resource name.
     * @param {{
     *  api_version:string,
     *  suffix:string,
     * }} param2
     * @returns {string} the resource API path.
     */
    compose_resource_path(namespace, name, { api_version = null, suffix = null } = {}) {
        api_version = api_version || this.api_version
        const version_header = /^v[0-9]+/.test(api_version) ? 'api' : 'apis'
        const parts = [
            '',
            version_header,
            api_version,
            'namespaces',
            namespace,
            this.plural,
            name,
            suffix,
        ].filter((p) => p != null)

        return parts.join('/')
    }

    static has_kind(name) {
        assert(typeof name == 'string' && name.trim().length > 0, 'Name cannot be null')
        name = name.toLowerCase()
        return this.global_kinds[name] instanceof KubeResourceKind
    }

    /**
     * @param {string} name
     */
    static get_kind(name) {
        assert(typeof name == 'string' && name.trim().length > 0, 'Name cannot be null')
        name = name.toLowerCase()
        assert(
            this.has_kind(name),
            `Unknown kubernetes kind ${name},` +
                ` you can use  KubeResourceKind.register_global_kind to register new kinds`,
        )
        return this.global_kinds[name]
    }

    static all() {
        return Object.values(KubeResourceKind.global_kinds).filter(
            (k) => k instanceof KubeResourceKind,
        )
    }

    static parseable() {
        return KubeResourceKind.all().filter((k) => k.parse_kind_state != null)
    }

    static all_names() {
        return KubeResourceKind.all().map((k) => k.name)
    }

    /**
     *Create an object kind and fill the default values from the one existing in global collection.
     * @param {string} name
     * @param {{
     *  api_version:string,
     *  parse_kind_state:parse_kind_state_default,
     * }} param1
     */
    static create_from_existing(name, { api_version = null, parse_kind_state = null } = {}) {
        assert(typeof name == 'string' && name.trim().length > 0, 'Name cannot be null')
        name = name.toLowerCase()

        if (!this.has_kind(name)) return new KubeResourceKind(name, api_version, parse_kind_state)

        const kind = KubeResourceKind.global_kinds[name]
        return new KubeResourceKind(name, kind.api_version, kind.parse_kind_state)
    }

    /**
     * @param {KubeResourceKind} kind
     * @param {boolean} overwrite_existing
     */
    static register_global_kind(kind, overwrite_existing = false) {
        assert(overwrite_existing || !this.has_kind(kind.name), 'Kind already exists')
        this.global_kinds[kind.name] = kind
    }

    // DEFAULT PARSERS.

    /***
     * @param {{}} yaml The resource yaml
     * @returns {ResourceKindState}
     */
    static parse_job_state(yaml) {
        const status = yaml['status'] || {}
        /** @type {[{}]} */
        const conditions = status['conditions'] || []

        /** @type {ResourceKindState} */
        let job_status = 'Pending'

        // TODO: check why we go through all conditions.
        for (let c of conditions) {
            if (c.type == 'Failed') {
                job_status = 'Failed'
            }
            if (c.type == 'Complete') {
                job_status = 'Succeeded'
            }
        }
        return job_status
    }

    /***
     * @param {{}} yaml The resource yaml
     * @returns {ResourceKindState}
     */
    static parse_pod_state(yaml) {
        const status = yaml['status'] || {}
        /** @type {[{}]} */
        const container_status = status['containerStatuses'] || []
        const pod_phase = status['phase']

        for (let c_status of container_status) {
            if (c_status.state != null) {
                const waiting_reason = (c_status.waiting || {}).reason || {}
                if (waiting_reason.BackOff != null) return 'Failed'
                if (c_status.error != null) return 'Failed'
            }
        }

        switch (pod_phase) {
            case 'Pending':
                return 'Pending'
            case 'Running':
                return 'Running'
            case 'Succeeded':
                return 'Succeeded'
            case 'Failed':
                return 'Failed'
        }

        return pod_phase
    }

    /**
     *
     * @param {KubeResourceKind} other
     */
    equals(other) {
        return other.api_version == this.api_version && other.name == this.name
    }

    toString() {
        return `${this.api_version}/${this.name}`
    }
}

for (let kind of [
    new KubeResourceKind('Pod', { parse_kind_state: KubeResourceKind.parse_pod_state }),
    new KubeResourceKind('Service'),
    new KubeResourceKind('Event', { auto_include_in_watch: false }),
    new KubeResourceKind('Job', {
        api_version: 'batch/v1',
        parse_kind_state: KubeResourceKind.parse_job_state,
    }),
    new KubeResourceKind('Deployment', { api_version: 'apps/v1' }),
]) {
    KubeResourceKind.register_global_kind(kind)
}

module.exports = {
    KubeResourceKind,
    /** @type {ResourceKindState} Interface */
    ResourceKindState: null,
}

if (require.main == module) {
    KubeResourceKind.all().forEach((k) =>
        console.log(k.compose_resource_path('default', 'resource_name')),
    )
}
