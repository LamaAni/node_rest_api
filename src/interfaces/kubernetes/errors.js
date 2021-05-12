const { RestApiError, assert } = require('../../errors')

class KubeApiError extends RestApiError {}

class KubeApiServiceError extends RestApiError {}

class KubeApiResourceStatusError extends KubeApiError {
    constructor(api_response) {
        super(`${api_response.message} (${api_response.code}): ${api_response.reason}`)
        /** @type {number} */
        this.code = api_response.code
        /** @type {string} */
        this.status = api_response.status
        /** @type {Object} */
        this.api_response = api_response
    }
}

module.exports = {
    assert:
        /**
         * @param {boolean|any} condition
         * @param {string|Error} err
         * @param {typeof Error} error_type
         * @returns
         */
        (condition, err, error_type = KubeApiError) => {
            assert(condition, err, error_type)
        },
    KubeApiError,
    KubeApiServiceError,
    KubeApiResourceStatusError,
}
