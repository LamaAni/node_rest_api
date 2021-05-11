const { RestApiError, assert } = require('../../errors')

class KubeApiError extends RestApiError {}

class KubeApiServiceError extends RestApiError {}

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
}
