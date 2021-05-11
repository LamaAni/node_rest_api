const { KubeApi } = require('./api')
const { GetPodLogs } = require('./queries')

const api = new KubeApi()
const logs_query = new GetPodLogs('iflow-airflow-zairflow-web-6d7b47d8c4-dl85p', 'iflow-main', {
    follow: true,
    since: new Date(new Date().getTime() - 60 * 1000),
})

logs_query.bind_logger(console)
api.send(logs_query)
