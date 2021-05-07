const { RestApi, RestApiRequest } = require('../../rest/api')

class KubeApiRequest extends RestApiRequest {
    constructor(
        url,
        {
            params = null,
            headers = null,
            method = REST_API_REQUEST_METHODS.GET,
            timeout = null,
            body = null,
            ignore_errors = null,
            max_cuncurrent_request_failures = null,
        } = {},
    ) {
        super(url, {
            params,
            headers,
            method,
            timeout,
            body,
            ignore_errors,
            max_cuncurrent_request_failures,
        })
    }
}

class KubeApi extends RestApi {
    constructor({
        max_active_requests = 1000,
        params = {},
        headers = {},
        delay_between_concurrent_requests = null,
    } = {}) {
        super({
            max_active_requests,
            params,
            headers,
            delay_between_concurrent_requests,
        })
    }
}

module.exports = {
    KubeApi,
    KubeApiRequest,
}
