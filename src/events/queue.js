const { Lock } = require('./lock')

const ASYNC_QUEUE_VALUE_DEQUEUE_LOCK_STOP = {}

class AsyncQueue {
    constructor(col = null) {
        /** @type {Set<Lock>} */
        this._yielders = new Set()
        this._queue = Array.from(col || [])
        this._is_piping_queue_elements = false
        /** @type {Lock} */
        this._value_dequeue_lock = new Lock(false)
        this._last_stopped = null
    }

    async _pipe_queue_elements() {
        if (this._is_piping_queue_elements) return
        this._is_piping_queue_elements = true

        try {
            while (this._queue.length > 0) {
                await this._value_dequeue_lock.wait()
                this._value_dequeue_lock.set()

                let val = this._queue.shift()

                for (let yielder of this._yielders) {
                    yielder.clear(val)
                }
            }
        } catch (err) {
            this._value_dequeue_lock.raise(err)
        } finally {
            this._is_piping_queue_elements = false
        }
    }

    get last_stopped() {
        return this._last_stopped
    }

    _validae_is_piping() {
        if (!this._is_piping_queue_elements) this._pipe_queue_elements()
    }

    endqueue(val) {
        this._queue.push(val)
        this._validae_is_piping()
    }

    startqueue(val) {
        this._queue.unshift(val)
        this._validae_is_piping()
    }

    peek() {
        return this.queue.length > 0 ? this._queue[this._queue.length - 1] : null
    }

    raise(err) {
        this._last_stopped = new Date()
        if (this._value_dequeue_lock.is_locked) this._value_dequeue_lock.raise(err)
        for (let yielder of Array.from(this._yielders)) {
            if (yielder.is_locked) yielder.raise(err)
        }
    }

    stop() {
        this.endqueue(ASYNC_QUEUE_VALUE_DEQUEUE_LOCK_STOP)
    }

    /**
     * @param {DAte} dt
     */
    was_stopped_after(dt) {
        if (this.last_stopped == null) return false
        return this.last_stopped > dt
    }

    clear() {
        this._queue = []
    }

    async *stream() {
        const yielder = new Lock(true)
        this._yielders.add(yielder)
        try {
            while (true) {
                const val = await yielder.wait()

                if (this._value_dequeue_lock.error != null) throw this._value_dequeue_lock.error

                if (Object.is(val, ASYNC_QUEUE_VALUE_DEQUEUE_LOCK_STOP)) break

                if (Array.from(this._yielders).every((y) => !y.is_locked))
                    this._value_dequeue_lock.clear()

                // reset the yielder.
                yielder.set()

                yield val
            }
        } finally {
            this._yielders.delete(yielder)
        }
    }

    [Symbol.asyncIterator]() {
        return this.stream()
    }
}

module.exports = AsyncQueue

if (module == require.main) {
    const queue = new AsyncQueue()

    const interval_index = setInterval(() => {
        let val = Math.random()
        console.log('appended ' + val)
        queue.endqueue(val)
        if (Math.random() < 0.05) {
            queue.stop()
            clearInterval(interval_index)
            console.log('Stopping')
        }
    }, 500)

    queue.endqueue('lama')
    queue.endqueue('kka')

    // eslint-disable-next-line no-inner-declarations
    async function print_form_queue(title) {
        for await (let v of queue.stream()) {
            console.log(title + ': ' + v)
        }
    }

    Promise.all([print_form_queue('a'), print_form_queue('b')]).catch((err) => {
        console.error(err)
        process.exit(1)
    })
}
