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
     * @param {string} namespace
     * @param {GetNamespaceResourcesOptions} param2
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
                field_selector,
                label_selector,
                watch,
            },
        })
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
    GetResources,
}
