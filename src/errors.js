class RestApiError extends Error {}

/**
 * @param {boolean|any} condition
 * @param {string|Error} err
 * @param {typeof Error} error_type
 * @returns
 */
function assert(condition, err, error_type = RestApiError) {
    if (condition) return
    throw err instanceof Error ? err : new error_type(err)
}

module.exports = {
    RestApiError,
    assert,
}
