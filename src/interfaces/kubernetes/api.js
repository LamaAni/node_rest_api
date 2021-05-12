const { KubeConfig } = require('@kubernetes/client-node')
const { assert } = require('./errors')
const { RestApi } = require('../../rest/api')

class KubeApiConfig {
    constructor({ config_file = null, load_defaults = true } = {}) {
        this.config = new KubeConfig()
        if (config_file != null) this.config.loadFromFile(config_file)
        else if (load_defaults) this.config.loadFromDefault()
    }

    get server_base_url() {
        return this.config.getCurrentCluster().server
    }

    get current_namespace() {
        return (
            (this.config.getContextObject(this.config.currentContext) || {}).namespace || 'default'
        )
    }

    async apply_to_request_options(options) {
        await this.config.applyToRequest(options)
    }
}

class KubeApi extends RestApi {
    constructor({
        max_active_requests = 1000,
        params = {},
        headers = {},
        delay_between_concurrent_requests = null,
        config_file = null,
        load_default_config = true,
    } = {}) {
        super({
            max_active_requests,
            params,
            headers,
            delay_between_concurrent_requests,
        })

        this.config = new KubeApiConfig({
            config_file: config_file,
            load_defaults: load_default_config,
        })
    }
}

module.exports = {
    KubeApi,
}
