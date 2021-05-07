const { KubeApiRequest } = require('./api')

class GetPodLogs extends KubeApiRequest {
    constructor(name, namespace, { since = null, follow = true, timeout = null }) {}
}

module.exports = {
    GetPodLogs,
}
