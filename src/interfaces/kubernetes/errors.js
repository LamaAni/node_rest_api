const { RestApiError, assert } = require('../../errors')

class KubernetesApiError extends RestApiError {}

module.exports = {
    assert:
        /**
         * @param {boolean|any} condition
         * @param {string|Error} err
         * @param {typeof Error} error_type
         * @returns
         */
        (condition, err, error_type = KubernetesApiError) => {
            assert(condition, err, error_type)
        },
    KubernetesApiError,
}
