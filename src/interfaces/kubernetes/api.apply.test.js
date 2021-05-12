const fs = require('fs')
const extend = require('extend')
const { KubeApi } = require('./api')
const { ConfigureNamespaceResource } = require('./requests/operations')

function update_metadata_with_labels(resource, labels) {
    if (resource.spec != null) {
        resource.spec.metadata = resource.spec.metadata || {}
        resource.spec.metadata.labels = resource.spec.metadata.labels || {}

        extend(resource.spec.metadata.labels, labels)
    }
    for (let inner of Object.values(resource)) {
        if (typeof inner == 'object' && inner != null) update_metadata_with_labels(inner, labels)
    }
}

async function main() {
    const api = new KubeApi()

    const apply_requests = ConfigureNamespaceResource.from_yaml(
        'APPLY',
        await fs.promises.readFile(__filename + '.yaml', 'utf-8'),
        api,
        (r) => {
            // update_metadata_with_labels(r, { randnum: Math.random() + '' })
        },
    )

    apply_requests.forEach((r) => r.bind_logger(console))

    for await (let rsp of api.stream(apply_requests)) {
        console.log('Created/Updated ' + rsp.metadata.name)
    }
}

main().catch((err) => {
    console.error(err)
    process.exit(err.code || 1)
})
