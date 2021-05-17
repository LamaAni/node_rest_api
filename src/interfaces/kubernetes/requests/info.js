const { assert, KubeApiServiceError } = require('../errors')
const { KubeResourceKind } = require('../resources')
const { KubeApiNamespaceResourceRequest } = require('./core')
const moment = require('moment')

/**
 * @typedef {Object} GetNamespaceResourcesOptions
 * @property {string} namespace The namespace of the resource.
 * @property {string} name The resource name.
 * @property {string} api_version override kind api version.
 * @property {boolean} watch Watch for changes.
 * @property {string} label_selector The resource label selector.
 * @property {string} field_selector The resource field selector.
 */

class GetResources extends KubeApiNamespaceResourceRequest {
    /**
     * Returns the list of namespace resources.
     * @param {KubeResourceKind} kind
     * @param {GetNamespaceResourcesOptions} param1
     */
    constructor(
        kind,
        {
            namespace = null,
            name = null,
            api_version = null,
            watch = false,
            label_selector = null,
            field_selector = null,
        } = {},
    ) {
        super(kind, name, namespace, {
            method: 'GET',
            params: {
                pretty: false,
                fieldSelector: field_selector,
                labelSelector: label_selector,
                watch,
                api_version,
            },
        })
    }

    parse_data(data) {
        data = super.parse_data(data)
        if (data.kind != null && data.kind.endsWith('List')) {
            const item_kind = data.kind.slice(0, -4)
            for (let item of data.items) {
                item.kind = item_kind
            }
            return data.items
        }
        return data
    }

    emit_data(data) {
        if (Array.isArray(data)) data.forEach((item) => super.emit_data(item))
        else super.emit_data(data)
    }

    /**
     * @param {string} as_yaml
     * @param {KubeApi} api
     * @param {yaml.Options} options
     * @param {(r:Object)=>{}} prepare_resource
     * @returns {[GetResources]}
     */
    static from_yaml(as_yaml, api = null, prepare_resource = null, options = {}) {
        assert(
            typeof as_yaml == 'string' && as_yaml.trim().length > 0,
            'as_yaml must be a non empty string',
        )
        const resources = yaml.parseAllDocuments(as_yaml, options).map((d) => d.toJSON())
        if (prepare_resource) resources.forEach((r) => prepare_resource(r))
        return resources.map(
            (r) =>
                new GetResources(r.kind, {
                    name: (r.metadata || {}).name,
                    namespace: (r.metadata || {}).namespace,
                    api_version: r.apiVersion,
                }),
        )
    }
}

module.exports = {
    GetResources,
}
