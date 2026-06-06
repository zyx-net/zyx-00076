const DeadlineService = require('./DeadlineService');

class DeadlineScheduler {
  constructor() {
    this.reminderInterval = null;
    this.isRunning = false;
    this.checkIntervalMs = 60 * 1000;
  }

  start(intervalMs = null) {
    if (this.isRunning) {
      console.log('[DeadlineScheduler] 定时任务已在运行中');
      return;
    }

    if (intervalMs) {
      this.checkIntervalMs = intervalMs;
    }

    this.isRunning = true;
    console.log(`[DeadlineScheduler] 定时任务已启动，检查间隔: ${this.checkIntervalMs / 1000} 秒`);

    this.runOnce();

    this.reminderInterval = setInterval(() => {
      this.runOnce();
    }, this.checkIntervalMs);
  }

  stop() {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
    }
    this.isRunning = false;
    console.log('[DeadlineScheduler] 定时任务已停止');
  }

  async runOnce() {
    if (!this.isRunning) return;

    try {
      const now = Date.now();
      const results = DeadlineService.processAutomaticReminders(now);

      const total = results.first_reminders.length + results.second_reminders.length + results.escalations.length;
      if (total > 0) {
        console.log(`[DeadlineScheduler] ${new Date().toISOString()} 处理了 ${total} 条时限提醒: ` +
          `首次催办 ${results.first_reminders.length}, ` +
          `二次催办 ${results.second_reminders.length}, ` +
          `升级 ${results.escalations.length}`);
      }

      return results;
    } catch (err) {
      console.error('[DeadlineScheduler] 处理定时任务时出错:', err);
    }
  }

  getStatus() {
    return {
      is_running: this.isRunning,
      check_interval_seconds: this.checkIntervalMs / 1000,
      next_check: this.reminderInterval 
        ? new Date(Date.now() + this.checkIntervalMs).toISOString()
        : null
    };
  }
}

const scheduler = new DeadlineScheduler();

process.on('SIGINT', () => {
  console.log('\n[DeadlineScheduler] 收到SIGINT信号，正在停止...');
  scheduler.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[DeadlineScheduler] 收到SIGTERM信号，正在停止...');
  scheduler.stop();
  process.exit(0);
});

module.exports = scheduler;
