const { assert, KubeApiServiceError } = require('../errors')
const { KubeApiNamespaceResourceRequest } = require('./core')
const { KubeResourceKind } = require('../resources')
const yaml = require('yaml')

/**
 * @typedef {import('../api').KubeApi} KubeApi
 * @typedef {import('../resources').KubeResourceKind} KubeResourceKind
 * @typedef {"APPLY" | "DELETE" | "CREATE"} ConfigureNamespaceResourceCommandType
 */

const FORCE_CREATE_KINDS = ['pod']

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

        body.metadata = body.metadata || {}
        body.metadata.namespace =
            body.metadata.namespace || kube_api == null
                ? 'default'
                : kube_api.config.current_namespace

        let method = 'PUT'
        let name = null
        let namespace = body.metadata.namespace
        kind = kind || body.kind
        switch (command) {
            case 'APPLY':
                // always replace.
                const kind_name = (kind instanceof KubeResourceKind
                    ? kind.name
                    : kind || body.kind
                ).toLowerCase()

                if (ConfigureResource.FORCE_CREATE_KINDS.some((k) => k.toLowerCase() == kind_name))
                    method = 'POST'
                else method = 'PUT'
                break
            case 'CREATE':
                method = 'POST'
                break
            case 'DELETE':
                method = 'DELETE'
                name = body.name
                body = null
                break
            default:
                assert(false, 'Command must be either APPLY, CREATE or DELETE')
        }

        super(kind, name, namespace, {
            body,
            method,
            kube_api,
        })

        this.resource_updated_event_name = 'resource_updated'
    }

    static get FORCE_CREATE_KINDS() {
        return FORCE_CREATE_KINDS
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
