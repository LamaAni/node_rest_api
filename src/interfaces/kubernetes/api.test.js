const { KubeApi } = require('./api')
const { GetPodLogs } = require('./logs')
const { GetNamespaceResources } = require('./info')

async function main() {
    const api = new KubeApi()
    const resources_query = new GetNamespaceResources('pod', 'zav-dev')
    const pods = await resources_query.send(api)
    console.log(pods)
}

main().catch((err) => {
    console.error(err)
    process.exit(err.code || 1)
})
