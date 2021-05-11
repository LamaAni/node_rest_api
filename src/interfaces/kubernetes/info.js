const { assert, KubeApiServiceError } = require('./errors')
const { KubeResourceKind } = require('./resources')
const { KubeApiRequest } = require('./api')
const moment = require('moment')

/**
 * @typedef {Object} GetNamespaceResourcesOptions
 * @property {string} name The resource name.
 * @property {string} api_version override kind api version.
 * @property {boolean} watch Watch for changes.
 * @property {string} label_selector The resource label selector.
 * @property {string} field_selector The resource field selector.
 */

class GetNamespaceResources extends KubeApiRequest {
    /**
     * Returns the list of namespace resources.
     * @param {KubeResourceKind} kind
     * @param {string} namespace
     * @param {GetNamespaceResourcesOptions} param2
     */
    constructor(
        kind,
        namespace,
        {
            name = null,
            api_version = null,
            watch = false,
            label_selector = null,
            field_selector = null,
        } = {},
    ) {
        kind = kind instanceof KubeResourceKind ? kind : KubeResourceKind.get_kind(kind)

        super(
            kind.compose_resource_path(namespace, name, {
                api_version,
            }),
            {
                method: 'GET',
                params: {
                    pretty: false,
                    field_selector,
                    label_selector,
                    watch,
                },
            },
        )

        this.kind = kind
        this.namespace = namespace
        this.name = name
    }

    parse_data(data) {
        data = JSON.parse(data)
        if (data.kind != null) {
            if (data.kind == 'status') {
                if (data.status == 'Failure') {
                    throw new KubeApiServiceError('List namespace resources is invalid.', data)
                }
            } else if (data.kind.endsWith('List')) {
                const item_kind = data.kind.slice(0, -4)
                for (let item of data.items) {
                    item.kind = item_kind
                }
                return data.items
            }
        }
        return data
    }

    emit_data(data) {
        if (Array.isArray(data)) data.forEach((item) => super.emit_data(item))
        else super.emit_data(data)
    }
}

module.exports = {
    GetNamespaceResources,
}
