const { RestApi, RestApiRequest } = require('./rest/api')

module.exports = {
    RestApi,
    RestApiRequest,
    events: require('./events/index'),
    kube: require('./interfaces/kubernetes/index'),
}
