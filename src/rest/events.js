const { assert } = require('../errors')
const { EventEmitter } = require('events')

const DEFAULT_ERROR_EVENT_NAME = 'error'
const DEFAULT_WARNING_EVENT_NAME = 'warning'
class RestApiEventEmitter extends EventEmitter {
    constructor() {
        super()
        this.error_event_name = DEFAULT_ERROR_EVENT_NAME
        this.warning_event_name = DEFAULT_WARNING_EVENT_NAME
        /** @type {Set<EventEmitter>} */
        this._pipe_to = new Set()
    }

    emit_error(err) {
        this.emit(this.error_event_name, err, this)
    }

    emit_warning(warning) {
        this.emit(this.warning_event_name, warning, this)
    }

    /**
     * Emit an event to the current emitter and all of its piped emitters.
     * @param {string|symbol} event The event name to emit.
     * @param  {...any} args The event arguments.
     */
    emit(event, ...args) {
        try {
            super.emit(event, ...args)
        } finally {
            if (this._pipe_to.size > 0)
                Array.from(this._pipe_to).forEach((other) => other.emit(event, ...args))
        }
    }

    pipe(other) {
        assert(other instanceof EventEmitter)
        this._pipe_to.add(other)
    }

    clear_pipe(other) {
        if (this._pipe_to.has(other)) this._pipe_to.delete(other)
    }

    /**
     *
     * @param {string | symbol| [string|symbol]} event
     * @param {(...args: any[]) => void} listener
     * @param {bool} allow_duplicates Would not execute distinct operation of event names.
     */
    on(event, listener, allow_duplicates = false) {
        if (!Array.isArray(event)) {
            event = [event]
        }

        event = allow_duplicates == true ? event : Array.from(new Set(event))
        for (let ev of event) super.on(ev, listener)
    }

    /**
     * @param {string | symbol| [string|symbol]} event
     * @param {(...args: any[]) => void} listener
     * @param {bool} allow_duplicates Would not execute distinct operation of event names.
     */
    off(event, listener = null) {
        if (!Array.isArray(event)) {
            event = [event]
        }
        event = Array.from(new Set(event))
        for (let ev in event) super.off(ev, listener)
    }

    /**
     * @param {string} name The name of the event to wait for.
     * @param {(...args)=>{}} predict A function to predict if the event should triggger.
     */
    async wait_for_event(name = null, predict = null) {
        await new Promise((resolve, reject) => {
            let on_event_triggered = (...args) => {
                try {
                    if (predict != null && !predict(...args)) return
                    this.off(name, on_event_triggered)
                    resolve()
                } catch (err) {
                    reject(err)
                }
            }
            this.on(name, on_event_triggered)
        })
    }
}

module.exports = {
    RestApiEventEmitter,
}
