var logger = require('oe-logger');
var log = logger('boot-job-scheduler');
var jshPath = '../../lib/jobScheduler.js';
var masterJob = require(jshPath);
var TAG = 'boot-job-scheduler.js';
log.debug(TAG, '************* boot-job-scheduler.js is loaded ***************');
module.exports = function startJobScheduler(server, callback) {
  masterJob.init(server, callback);
  log.debug(TAG, '************* boot-job-scheduler.js is executed and masterJob.init(server, callback) is invoked ***************');
};
