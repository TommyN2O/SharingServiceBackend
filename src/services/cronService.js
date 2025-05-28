const cron = require('node-cron');
const OpenTask = require('../models/OpenTask');

class CronService {
  constructor() {
    this.openTaskModel = new OpenTask();
  }

  // Schedule all cron jobs
  initializeJobs() {
    // Run every day at midnight (00:00)
    cron.schedule('0 0 * * *', async () => {
      try {
        console.log('Running daily cleanup...');
        
        // Delete expired dates
        const deletedDatesCount = await this.openTaskModel.deleteExpiredDates();
        console.log(`Deleted ${deletedDatesCount} expired dates`);

        // Delete open tasks without dates
        const deletedTasksCount = await this.openTaskModel.deleteOpenTasksWithoutDates();
        console.log(`Deleted ${deletedTasksCount} open tasks without dates`);
      } catch (error) {
        console.error('Error in daily cleanup job:', error);
      }
    });

    console.log('Cron jobs initialized');
  }
}

module.exports = new CronService(); 