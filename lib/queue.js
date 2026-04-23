/**
 * lib/queue.js — Concurrency-limited async task queue for Wingman
 *
 * Prevents thundering-herd on Gemini API when multiple users
 * fire /evaluate simultaneously. Configurable concurrency limit
 * with backpressure (queue full → reject with friendly message).
 */

const DEFAULT_CONCURRENCY = parseInt(process.env.QUEUE_CONCURRENCY || '3');
const DEFAULT_MAX_QUEUED   = parseInt(process.env.QUEUE_MAX_WAITING || '10');

class TaskQueue {
  constructor(concurrency = DEFAULT_CONCURRENCY, maxQueued = DEFAULT_MAX_QUEUED) {
    this.concurrency = concurrency;
    this.maxQueued   = maxQueued;
    this.running     = 0;
    this.queue       = [];
  }

  /**
   * Enqueue an async task. Resolves with the task result or rejects.
   * Throws immediately if the queue is full (backpressure).
   */
  run(fn) {
    return new Promise((resolve, reject) => {
      if (this.queue.length >= this.maxQueued) {
        return reject(new QueueFullError(
          `Wingman is handling too many requests right now. Please try again in a few seconds.`
        ));
      }

      const task = async () => {
        this.running++;
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.running--;
          this._next();
        }
      };

      if (this.running < this.concurrency) {
        task();
      } else {
        this.queue.push(task);
      }
    });
  }

  _next() {
    if (this.queue.length > 0 && this.running < this.concurrency) {
      const task = this.queue.shift();
      task();
    }
  }

  get stats() {
    return {
      running: this.running,
      queued: this.queue.length,
      concurrency: this.concurrency,
    };
  }
}

class QueueFullError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QueueFullError';
    this.isQueueFull = true;
  }
}

// Singleton — shared across all commands
export const geminiQueue = new TaskQueue();

export { TaskQueue, QueueFullError };
