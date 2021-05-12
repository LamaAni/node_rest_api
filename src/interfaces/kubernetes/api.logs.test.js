const { KubeApi } = require('./api')
const { GetPodLogs } = require('./requests/logs')
const { GetResources } = require('./requests/info')

async function main() {
    const api = new KubeApi()
    // const resources_query = new GetResources('pod')
    // const pods = await resources_query.send(api)
    // console.log(pods)

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

main().catch((err) => {
    console.error(err)
    process.exit(err.code || 1)
})
