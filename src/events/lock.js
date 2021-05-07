class Lock {
    /**
     * Implements an async lock object, with a wait command.
     * @param {bool} is_locked If true the current async lock is locked.
     */
    constructor(is_locked = true) {
        /** @type {LockState} */
        this._state = is_locked ? 'locked' : 'cleared'
        this._value = null
        this._last_error = null
        this._promise_rejects = []
        this._promise_resolves = []
    }

    get is_locked() {
        return this._state == 'locked'
    }

    get error() {
        return this._last_error
    }

    get value() {
        return this._value
    }

    _set_state(is_locked, val = null, err = null) {
        this._value = val
        this._last_error = err
        this._state = is_locked ? 'locked' : 'cleared'
    }

    set() {
        this._set_state(true)
    }

    clear(val) {
        this._set_state(false, val, null)
        const calls = this._promise_resolves
        this._promise_resolves = []
        this._promise_rejects = []
        calls.forEach((f) => f(val))
    }

    raise(err) {
        this._set_state(false, null, err)
        const calls = this._promise_rejects
        this._promise_resolves = []
        this._promise_rejects = []
        calls.forEach((f) => f(err))
    }

    async wait() {
        let rslt = null
        if (!this.is_locked) {
            if (this._last_error != null) throw this._last_error
            else rslt = this._value
        } else {
            rslt = await new Promise((resolve, reject) => {
                if (!this.is_locked) {
                    if (this._last_error != null) reject(this._last_error)
                    else resolve(this._value)
                } else {
                    this._promise_rejects.push(reject)
                    this._promise_resolves.push(resolve)
                }
            })
        }
        return rslt
    }
}

class MaxCountProcessingLock extends Lock {
    constructor(max_allowed = 10) {
        super()
        this.max_allowed = max_allowed
        this.values = new Set()
    }

    async lock(val) {
        while (this.values.size >= this.max_allowed) {
            if (!this.is_locked) this.set()
            await this.wait()
        }
        this.values.add(val)
    }

    clear(val) {
        this.values.delete(val)
        if (this.values.size < this.max_allowed) super.clear()
    }
}

module.exports = {
    Lock,
    MaxCountProcessingLock,
}
