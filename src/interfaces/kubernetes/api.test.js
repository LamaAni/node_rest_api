const { KubeApi } = require('./api')
const { GetPodLogs } = require('./requests/logs')
const { GetResources } = require('./requests/info')
const { ConfigureResource } = require('./requests/operations')

const api = new KubeApi()

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

async function test_logs() {
    const log_request = new GetPodLogs(
        'custom-metrics-stackdriver-adapter-87c4bc8c5-pr7kr',
        'core-iflow-services',
        {
            since: new Date(new Date().getTime() - 1000 * 10),
            follow: true,
            collect_log_lines: false,
        },
    )

    log_request.bind_logger(console)

    await log_request.send(api)
}

async function test_apply() {
    const apply_requests = ConfigureResource.from_yaml(
        'APPLY',
        await fs.promises.readFile(__filename + '.yaml', 'utf-8'),
        api,
        (r) => {
            update_metadata_with_labels(r, { randnum: Math.random() + '' })
        },
    )

    apply_requests.forEach((r) => r.bind_logger(console))

    for await (let rsp of api.stream(apply_requests)) {
        console.log('Created/Updated ' + rsp.metadata.name)
    }
}

async function test_secret() {
    const rq = new GetResources('secret', { field_selector: 'metadata.name=iflow-secrets' })
    const secrets_list = await api.send(rq)
    console.log(secrets_list)
}

async function main() {
    test_secret()
}

main().catch((err) => {
    console.error(err)
    process.exit(err.code || 1)
})
