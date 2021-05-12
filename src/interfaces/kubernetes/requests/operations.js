const { assert, KubeApiResourceStatusError } = require('../errors')
const { KubeApiNamespaceResourceRequest } = require('./core')
const { KubeResourceKind } = require('../resources')
const { GetResources } = require('./info')
const yaml = require('yaml')

/**
 * @typedef {import('../api').KubeApi} KubeApi
 * @typedef {import('../resources').KubeResourceKind} KubeResourceKind
 * @typedef {"APPLY" | "DELETE" | "CREATE"} ConfigureNamespaceResourceCommandType
 */

class ConfigureResource extends KubeApiNamespaceResourceRequest {
    /**
     * @param {ConfigureNamespaceResourceCommandType} command
     * @param {string|Object|()=>string|Object} body
     * @param {KubeApi} kube_api
     * @param {string|KubeResourceKind} kind
     */
    constructor(command, body, kube_api = null, kind = null) {
        if (typeof body == 'string' && body.trim().length > 0) body = yaml.parse(body)
        assert(
            typeof body == 'object',
            'Invalid body type, body must be an object or a yaml that represents an object',
        )

        super((kind = kind || body.kind), null, null, {
            body,
            method: 'POST',
            kube_api,
        })
        this.command = command
        this.resource_updated_event_name = 'resource_updated'
    }

    async update_body_and_method() {
        const body = this.body || {}
        body.metadata = body.metadata || {}
        body.metadata.namespace =
            body.metadata.namespace || this.kube_api == null
                ? 'default'
                : this.kube_api.config.current_namespace

        let method = 'PUT'
        let name = body.metadata.name
        let namespace = body.metadata.namespace
        switch (this.command) {
            case 'APPLY':
                const cur_info = await this._get_resource_info(name, namespace)
                if (cur_info == null) {
                    method = 'POST'
                    name = null
                } else {
                    method = 'PUT'
                }
                break
            case 'CREATE':
                method = 'POST'
                name = null
                break
            case 'DELETE':
                method = 'DELETE'
                name = body.name
                body = null
                break
            default:
                assert(false, 'Command must be either APPLY, CREATE or DELETE')
        }

        this.method = method

        this.url = this.resource_path = this.kind.compose_resource_path(namespace, name, {
            api_version: this.api_version,
        })
    }

    emit_resource_updated(body) {
        this.emit(this.resource_updated_event_name, body)
    }

    parse_data(data) {
        data = super.parse_data(data)
        this.emit_resource_updated(data)
        return data
    }

    bind_logger(logger) {
        super.bind_logger(logger)

        this.on(this.resource_updated_event_name, (body) => {
            logger.info(
                this.compose_log_header() +
                    this.kind.compose_resource_path(body.metadata.namespace, body.metadata.name) +
                    ' updated',
            )
        })
    }

    async _send_request() {
        await this.update_body_and_method()
        return await super._send_request()
    }

    async _get_resource_info(name, namespace) {
        const rq = new GetResources(this.kind, {
            namespace,
            name,
            api_version: this.api_version,
        })

        try {
            return await rq.send(this.kube_api)
        } catch (err) {
            if (!err instanceof KubeApiResourceStatusError || err.status != 'Failure') throw err
            return null
        }
    }

    /**
     * @param {ConfigureNamespaceResourceCommandType} command
     * @param {string} as_yaml
     * @param {KubeApi} api
     * @param {yaml.Options} options
     * @param {(r:Object)=>{}} prepare_resource
     * @returns {[ConfigureResource]}
     */
    static from_yaml(command, as_yaml, api = null, prepare_resource = null, options = {}) {
        assert(
            typeof as_yaml == 'string' && as_yaml.trim().length > 0,
            'as_yaml must be a non empty string',
        )
        const resources = yaml.parseAllDocuments(as_yaml, options).map((d) => d.toJSON())
        if (prepare_resource) resources.forEach((r) => prepare_resource(r))
        return resources.map((r) => new ConfigureResource(command, r, api))
    }
}

class DeleteResourceByName extends ConfigureResource {
    /**
     * @param {string|Object|()=>string|Object} body
     * @param {KubeApi} kube_api
     * @param {string|KubeResourceKind} kind
     */
    constructor(kind, name, namespace, kube_api = null) {
        super(
            'DELETE',
            {
                kind: kind,
                metadata: {
                    name: name,
                    namespace: namespace,
                },
            },
            kube_api,
        )
    }
}

module.exports = {
    ConfigureNamespaceResource: ConfigureResource,
    DeleteNamespaceResourceByName: DeleteResourceByName,
}
