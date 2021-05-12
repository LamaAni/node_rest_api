const fs = require('fs')
const { KubeApi } = require('./api')
const { ConfigureNamespaceResource } = require('./requests/operations')

async function main() {
    const api = new KubeApi()

    const apply_requests = ConfigureNamespaceResource.from_yaml(
        'APPLY',
        await fs.promises.readFile(__filename + '.yaml', 'utf-8'),
        api,
    )
    apply_requests.forEach((r) => r.bind_logger(console))

    for await (let rsp of api.stream(apply_requests)) {
        console.log('complete ' + rsp)
    }
}

main().catch((err) => {
    console.error(err)
    process.exit(err.code || 1)
})
